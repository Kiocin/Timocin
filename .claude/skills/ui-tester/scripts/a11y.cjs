#!/usr/bin/env node
'use strict';
// Barrierefreiheit: automatische WCAG-Prüfung mit axe-core plus eigener Tastatur-Check
// (Tab-Reihenfolge, sichtbarer Fokus, Fokus außerhalb des Fensters, Tastaturfallen).
//
//   node a11y.cjs --url http://localhost:5173 [--pages /einstellungen,/berichte]
//                 [--level wcag22aa] [--tabs 40] [--out dir]
//                 [--storage-state auth.json] [--init-script mock.js] [--cdp http://127.0.0.1:9222]
//
// Braucht axe-core (npm i -D axe-core) oder --axe-path <pfad/zu/axe.min.js>.
// Ohne axe-core läuft nur der Tastatur-Check.

const fs = require('fs');
const path = require('path');
const { parseArgs, ensureDir, defaultOutDir, openTarget, writeJson } = require('./_common.cjs');

const LEVEL_TAGS = {
  wcag2a: ['wcag2a'],
  wcag2aa: ['wcag2a', 'wcag2aa'],
  wcag21aa: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
  wcag22aa: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
};
const IMPACT_DE = { critical: 'kritisch', serious: 'hoch', moderate: 'mittel', minor: 'niedrig' };

function findAxe(args) {
  if (args['axe-path']) return path.resolve(String(args['axe-path']));
  for (const base of [process.cwd(), __dirname]) {
    try {
      return require.resolve('axe-core/axe.min.js', { paths: [base] });
    } catch (_) {}
  }
  try {
    return require.resolve('axe-core/axe.min.js');
  } catch (_) {
    return null;
  }
}

async function runAxe(page, axeSource, tags) {
  await page.addScriptTag({ content: axeSource });
  return page.evaluate(async (tags) => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations', 'incomplete'] });
    const slim = (list) =>
      list.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        helpUrl: v.helpUrl,
        nodes: v.nodes.slice(0, 8).map((n) => ({ target: n.target.join(' '), html: n.html.slice(0, 160), summary: (n.failureSummary || '').slice(0, 300) })),
        count: v.nodes.length,
      }));
    return { violations: slim(r.violations), incomplete: slim(r.incomplete).slice(0, 15) };
  }, tags);
}

async function keyboardCheck(page, maxTabs) {
  // Fokus an den Seitenanfang setzen
  await page.evaluate(() => {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    window.scrollTo(0, 0);
  });
  const stops = [];
  for (let i = 0; i < maxTabs; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      // Fokus-Stil grob erkennen: Outline, Box-Shadow oder Rahmenänderung
      const hasOutline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
      const hasShadow = cs.boxShadow && cs.boxShadow !== 'none';
      let s = el.tagName.toLowerCase();
      if (el.id) s += `#${el.id}`;
      const name = (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('placeholder') || el.getAttribute('title') || el.name || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 40);
      return {
        el: s,
        name,
        visibleFocus: hasOutline || hasShadow,
        inViewport: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth,
        tiny: r.width < 2 || r.height < 2,
      };
    });
    if (!info) {
      stops.push({ el: '(body – Fokus verlassen/zurück am Anfang)' });
      break;
    }
    // Nach dem Tab scrollt der Browser normalerweise zum Element; trotzdem außerhalb = Problem
    stops.push(info);
    const last = stops.slice(-4).map((s) => s.el + s.name);
    if (last.length === 4 && new Set(last).size === 1) {
      stops.push({ el: '(Tastaturfalle: Fokus bleibt auf demselben Element)', trap: true });
      break;
    }
  }
  const real = stops.filter((s) => s.name !== undefined);
  return {
    stops,
    findings: [
      ...(real.length === 0 ? ['Mit Tab ist kein einziges Element erreichbar.'] : []),
      ...real.filter((s) => !s.visibleFocus).map((s) => `Kein sichtbarer Fokus: ${s.el} "${s.name}"`),
      ...real.filter((s) => !s.inViewport || s.tiny).map((s) => `Fokus auf unsichtbarem/verstecktem Element: ${s.el} "${s.name}"`),
      ...real.filter((s) => !s.name).map((s) => `Fokussierbares Element ohne erkennbaren Namen: ${s.el}`),
      ...stops.filter((s) => s.trap).map((s) => s.el),
    ],
  };
}

(async () => {
  const args = parseArgs();
  const outDir = ensureDir(path.resolve(args.out || defaultOutDir('a11y')));
  const tags = LEVEL_TAGS[String(args.level || 'wcag22aa')] || LEVEL_TAGS.wcag22aa;
  const maxTabs = Number(args.tabs || 40);
  const axePath = findAxe(args);
  const axeSource = axePath ? fs.readFileSync(axePath, 'utf8') : null;
  if (!axeSource) console.log('⚠ axe-core nicht gefunden (npm i -D axe-core) – es läuft nur der Tastatur-Check.\n');

  const { page, close } = await openTarget(args);
  const base = page.url();
  const urls = [base, ...String(args.pages || '').split(',').filter(Boolean).map((p) => new URL(p, base).href)];

  const results = [];
  for (const url of urls) {
    if (page.url() !== url) {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    }
    const axeResult = axeSource ? await runAxe(page, axeSource, tags).catch((e) => ({ error: e.message })) : null;
    const kb = await keyboardCheck(page, maxTabs);
    const shot = path.join(outDir, `a11y-${results.length}.png`);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    results.push({ url, axe: axeResult, keyboard: kb, screenshot: shot });
  }

  writeJson(path.join(outDir, 'a11y.json'), { level: args.level || 'wcag22aa', results });

  let total = 0;
  for (const r of results) {
    console.log(`\n=== ${r.url}`);
    if (r.axe && r.axe.error) console.log(`axe-Fehler: ${r.axe.error}`);
    else if (r.axe) {
      console.log(`axe (${tags[tags.length - 1]}): ${r.axe.violations.length} Regelverstöße, ${r.axe.incomplete.length} manuell zu prüfen`);
      for (const v of r.axe.violations) {
        total++;
        console.log(`  ! [${IMPACT_DE[v.impact] || v.impact}] ${v.id}: ${v.help} (${v.count}×)`);
        for (const n of v.nodes.slice(0, 3)) console.log(`      ${n.target}`);
      }
    }
    console.log(`Tastatur: ${r.keyboard.stops.length} Tab-Stopps`);
    for (const f of r.keyboard.findings) {
      total++;
      console.log(`  ! ${f}`);
    }
  }
  console.log(`\nGesamt: ${total} Befunde. Details: ${path.join(outDir, 'a11y.json')}`);
  console.log('Hinweis: Automatische Prüfungen finden nur einen Teil der Probleme (Screenreader, Verständlichkeit, Fokus nach Dialogen manuell prüfen).');
  await close();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
