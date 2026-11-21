#!/usr/bin/env node
'use strict';
// Chaos-/Monkey-Test: zufällige, aber per Seed reproduzierbare Benutzeraktionen.
// Klickt, tippt fiese Eingaben, drückt Tasten, scrollt, ändert die Fenstergröße,
// navigiert zurück/vor, lädt neu – und sammelt dabei alle Fehler.
//
//   node monkey.cjs --url http://localhost:5173 [--steps 200] [--seed 42] [--minutes 5]
//                   [--avoid "löschen|delete"] [--ignore "favicon"] [--delay 150]
//                   [--headed] [--storage-state auth.json] [--cdp http://127.0.0.1:9222]
//                   [--allow-external] [--no-resize] [--no-nav] [--out dir]
//
// Ergebnis: <out>/report.json, <out>/report.md, Screenshots je neuem Problem.

const path = require('path');
const fs = require('fs');
const { parseArgs, ensureDir, defaultOutDir, openTarget, attachMonitors, writeJson } = require('./_common.cjs');

// ---------- Zufall mit Seed (mulberry32) ----------
function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => Math.floor(next() * (max - min + 1)) + min,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    weighted: (entries) => {
      const total = entries.reduce((s, [, w]) => s + w, 0);
      let r = next() * total;
      for (const [v, w] of entries) if ((r -= w) < 0) return v;
      return entries[entries.length - 1][0];
    },
  };
}

// ---------- Eingabewerte ----------
// Harmloser Köder: wird er als HTML ausgeführt, setzt er nur eine Variable → HTML-Injection/XSS erkannt.
const XSS_CANARY = `<img src="data:x" onerror="window.__uiTesterXss='img'">`;
const NASTY_TEXT = [
  '', ' ', '   führende Leerzeichen', 'a'.repeat(2000), 'Ümläüte ÄÖÜ ß €', '😀👍🏽🚀 Emoji',
  '<script>alert(1)</script>', '<b>fett</b>', XSS_CANARY, `"><svg onload="window.__uiTesterXss='svg'">`, "O'Brien \"Zitat\"", "'; DROP TABLE users;--",
  'null', 'undefined', 'NaN', '{{7*7}}', '${7*7}', '%s %d %n', '‮abc (RTL-Override)',
  'Zeile1\nZeile2', '\t', '0', '-1', '1e309', '١٢٣ (arabische Ziffern)', 'test@', '@@@',
];
const BY_TYPE = {
  number: ['0', '-1', '-0', '3.14', '3,14', '999999999999999', '1e309', '', '00012', '-999999'],
  email: ['test@example.com', 'kein-at-zeichen', 'a@b', '@example.com', 'ä@ü.de', ' test@example.com '],
  date: ['2026-02-30', '1900-01-01', '9999-12-31', '2026-13-01', ''],
  time: ['00:00', '23:59', '24:00', '12:60', ''],
  'datetime-local': ['2026-02-29T25:00', '1970-01-01T00:00', ''],
  tel: ['+49 123 456', 'abc', '0000000000000000000000'],
  url: ['https://example.com', 'javascript:alert(1)', 'kein url', 'http://'],
  password: ['', 'a', 'P@ssw0rd!'.repeat(20)],
  search: NASTY_TEXT,
  text: NASTY_TEXT,
};
const REALISTIC = ['Max Mustermann', 'Projekt Alpha', 'Besprechung', '42', 'Hallo Welt', 'Testeintrag'];

const KEYS = ['Escape', 'Enter', 'Tab', 'Shift+Tab', 'Backspace', 'Delete', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Space', 'Home', 'End', 'PageDown', 'Control+a', 'Control+z', 'Control+s'];
const VIEWPORTS = [
  [280, 480], [320, 568], [375, 667], [414, 896], [768, 1024], [1024, 768],
  [1280, 800], [1440, 900], [1920, 1080], [2560, 1440], [800, 300], [400, 1400],
];

// ---------- Seite abtasten ----------
async function collectCandidates(page) {
  return page.evaluate(() => {
    const SEL = [
      'a[href]', 'button', 'input', 'textarea', 'select', 'summary', 'label', '[role=button]',
      '[role=link]', '[role=tab]', '[role=menuitem]', '[role=checkbox]', '[role=switch]',
      '[role=option]', '[role=combobox]', '[onclick]', '[tabindex]:not([tabindex="-1"])',
      '[contenteditable="true"]', '[contenteditable=""]',
    ].join(',');
    let n = 0;
    const out = [];
    for (const el of document.querySelectorAll(SEL)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || cs.pointerEvents === 'none') continue;
      const id = String(n++);
      el.setAttribute('data-monkey-id', id);
      out.push({
        id,
        tag: el.tagName.toLowerCase(),
        type: (el.getAttribute('type') || '').toLowerCase(),
        role: el.getAttribute('role') || '',
        href: el.tagName === 'A' ? el.href : '',
        text: (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('placeholder') || el.getAttribute('title') || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 60),
        editable: el.isContentEditable,
        disabled: !!el.disabled,
      });
    }
    return out;
  });
}

const describe = (c) => `${c.tag}${c.type ? `[${c.type}]` : ''}${c.role ? `(role=${c.role})` : ''}${c.text ? ` "${c.text}"` : ''}`;

(async () => {
  const args = parseArgs();
  const seed = args.seed !== undefined ? Number(args.seed) : Math.floor(Math.random() * 1e9);
  const steps = Number(args.steps || 200);
  const deadline = Date.now() + Number(args.minutes || 10) * 60000;
  const delay = Number(args.delay || 150);
  const avoid = new RegExp(args.avoid || 'log ?out|logout|sign ?out|abmelden|ausloggen', 'i');
  const outDir = ensureDir(path.resolve(args.out || defaultOutDir('monkey')));
  const R = rng(seed);

  const target = await openTarget(args);
  let { page } = target;
  const { context } = target;
  const startUrl = args.url ? String(args.url) : page.url();
  const startOrigin = new URL(startUrl).origin;

  const log = []; // alle Aktionen
  const issues = new Map(); // dedupliziert
  let step = 0;
  let pendingShots = [];

  const onIssue = (type, message, extra) => {
    const key = `${type}|${message.replace(/\d+/g, '#')}`;
    if (issues.has(key)) {
      issues.get(key).count++;
      return;
    }
    const issue = {
      type,
      message,
      ...extra,
      firstStep: step,
      url: page && !page.isClosed() ? page.url() : '',
      count: 1,
      lastActions: log.slice(-6).map((l) => `#${l.step} ${l.action}`),
    };
    issue.screenshot = path.join(outDir, `issue-${issues.size + 1}.png`);
    issues.set(key, issue);
    pendingShots.push(issue);
  };

  const wire = (p) => {
    attachMonitors(p, onIssue, { ignore: args.ignore });
    p.on('dialog', async (d) => {
      const accept = R.chance(0.5);
      log.push({ step, action: `Dialog (${d.type()}) "${d.message().slice(0, 80)}" → ${accept ? 'OK' : 'Abbrechen'}` });
      try {
        if (accept) await d.accept(d.type() === 'prompt' ? R.pick(NASTY_TEXT) : undefined);
        else await d.dismiss();
      } catch (_) {}
    });
  };
  wire(page);

  // Neue Tabs/Popups protokollieren und wieder schließen
  context.on('page', async (p) => {
    if (p === page) return;
    log.push({ step, action: `Neues Fenster/Tab geöffnet: ${p.url() || '(lädt)'}` });
    await p.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
    if (!target.attached) await p.close().catch(() => {});
  });

  let hadContent = false;
  const checkHealth = async () => {
    if (page.isClosed()) return;
    const state = await page
      .evaluate(() => ({
        xss: window.__uiTesterXss || null,
        text: (document.body && document.body.innerText.trim().length) || 0,
        nodes: document.body ? document.body.querySelectorAll('*').length : 0,
      }))
      .catch(() => null);
    if (!state) return;
    if (state.xss) {
      onIssue('xss', `Eingabe wurde als HTML/JavaScript ausgeführt (Köder "${state.xss}") – HTML-Injection/XSS`, {});
      await page.evaluate(() => delete window.__uiTesterXss).catch(() => {});
    }
    if (state.text > 0 || state.nodes > 5) hadContent = true;
    else if (hadContent) {
      onIssue('blank-page', 'Seite ist plötzlich leer (möglicher Absturz des Frontends)', {});
      await flushShots();
      // Weitertesten statt auf der leeren Seite festzuhängen
      log.push({ step, action: 'Leere Seite → App neu geladen' });
      await page.goto(startUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    }
  };

  const flushShots = async () => {
    for (const issue of pendingShots) {
      if (page.isClosed()) break;
      await page.screenshot({ path: issue.screenshot }).catch(() => (issue.screenshot = null));
    }
    pendingShots = [];
  };

  const ensureOnApp = async () => {
    if (page.isClosed()) {
      page = await context.newPage();
      wire(page);
      await page.goto(startUrl).catch(() => {});
      log.push({ step, action: 'Seite war geschlossen → neu geöffnet' });
      return;
    }
    let origin = '';
    try {
      origin = new URL(page.url()).origin;
    } catch (_) {}
    if (!args['allow-external'] && origin && origin !== startOrigin && page.url() !== 'about:blank') {
      log.push({ step, action: `Externe Seite ${page.url()} → zurück zur App` });
      await page.goto(startUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    }
  };

  const actionWeights = [
    ['click', 34], ['type', 18], ['key', 8], ['randomPoint', 6], ['scroll', 6], ['select', 4],
    ['toggle', 4], ['dblclick', 3], ['rapidclick', 3], ['hover', 3],
    ...(args['no-resize'] ? [] : [['resize', 5]]),
    ...(args['no-nav'] ? [] : [['back', 2], ['forward', 1], ['reload', 2]]),
  ];

  const t0 = Date.now();
  console.log(`Monkey-Test: ${startUrl}  Seed=${seed}  Schritte=${steps}`);

  for (step = 1; step <= steps && Date.now() < deadline; step++) {
    await ensureOnApp();
    let candidates = await collectCandidates(page).catch(() => []);
    candidates = candidates.filter((c) => !c.disabled && !avoid.test(`${c.text} ${c.href}`));
    if (!args['allow-external']) {
      candidates = candidates.filter((c) => {
        if (!c.href) return true;
        try {
          const u = new URL(c.href);
          return u.origin === startOrigin || u.protocol === 'javascript:';
        } catch (_) {
          return true;
        }
      });
    }
    const inputs = candidates.filter(
      (c) => (c.tag === 'input' && !['checkbox', 'radio', 'submit', 'button', 'reset', 'file', 'hidden', 'range', 'color', 'image'].includes(c.type)) || c.tag === 'textarea' || c.editable
    );
    const selects = candidates.filter((c) => c.tag === 'select');
    const toggles = candidates.filter((c) => ['checkbox', 'radio'].includes(c.type) || ['checkbox', 'switch'].includes(c.role));

    let action = R.weighted(actionWeights);
    if (action === 'type' && !inputs.length) action = 'click';
    if (action === 'select' && !selects.length) action = 'click';
    if (action === 'toggle' && !toggles.length) action = 'click';
    if (['click', 'dblclick', 'rapidclick', 'hover'].includes(action) && !candidates.length) action = 'randomPoint';

    const loc = (c) => page.locator(`[data-monkey-id="${c.id}"]`).first();
    let desc = action;
    try {
      switch (action) {
        case 'click': {
          const c = R.pick(candidates);
          desc = `Klick auf ${describe(c)}`;
          await loc(c).click({ timeout: 2000 });
          break;
        }
        case 'dblclick': {
          const c = R.pick(candidates);
          desc = `Doppelklick auf ${describe(c)}`;
          await loc(c).dblclick({ timeout: 2000 });
          break;
        }
        case 'rapidclick': {
          const c = R.pick(candidates);
          const n = R.int(3, 8);
          desc = `${n}× schnell auf ${describe(c)}`;
          await loc(c).click({ timeout: 2000, clickCount: 1 });
          for (let i = 1; i < n; i++) await loc(c).click({ timeout: 500, noWaitAfter: true }).catch(() => {});
          break;
        }
        case 'hover': {
          const c = R.pick(candidates);
          desc = `Maus über ${describe(c)}`;
          await loc(c).hover({ timeout: 2000 });
          break;
        }
        case 'type': {
          const c = R.pick(inputs);
          const pool = R.chance(0.3) ? REALISTIC : BY_TYPE[c.type] || NASTY_TEXT;
          const value = R.pick(pool);
          const submit = R.chance(0.3);
          desc = `Eingabe in ${describe(c)}: ${JSON.stringify(value.length > 40 ? value.slice(0, 40) + '…' : value)}${submit ? ' + Enter' : ''}`;
          const l = loc(c);
          try {
            await l.fill(value, { timeout: 2000 });
          } catch (_) {
            // z. B. Text in input[type=number]: dann tippen wie ein Mensch
            await l.click({ timeout: 2000 });
            await page.keyboard.press('Control+a');
            await page.keyboard.type(value.slice(0, 200));
          }
          if (submit) await l.press('Enter', { timeout: 2000 });
          break;
        }
        case 'select': {
          const c = R.pick(selects);
          const opts = await loc(c).locator('option').evaluateAll((os) => os.map((o) => o.value));
          if (!opts.length) {
            desc = `Select ohne Optionen: ${describe(c)}`;
            break;
          }
          const v = R.pick(opts);
          desc = `Auswahl "${v}" in ${describe(c)}`;
          await loc(c).selectOption(v, { timeout: 2000 });
          break;
        }
        case 'toggle': {
          const c = R.pick(toggles);
          desc = `Umschalten ${describe(c)}`;
          await loc(c).click({ timeout: 2000 });
          break;
        }
        case 'key': {
          const k = R.pick(KEYS);
          desc = `Taste ${k}`;
          await page.keyboard.press(k);
          break;
        }
        case 'randomPoint': {
          const vp = page.viewportSize() || { width: 1280, height: 800 };
          const x = R.int(1, vp.width - 1);
          const y = R.int(1, vp.height - 1);
          desc = `Klick auf freie Stelle (${x}, ${y})`;
          await page.mouse.click(x, y);
          break;
        }
        case 'scroll': {
          const dy = R.int(-1500, 2500);
          desc = `Scrollen um ${dy}px`;
          await page.mouse.wheel(0, dy);
          break;
        }
        case 'resize': {
          const [w, h] = R.pick(VIEWPORTS);
          desc = `Fenstergröße ${w}×${h}`;
          await page.setViewportSize({ width: w, height: h });
          break;
        }
        case 'back':
          desc = 'Browser zurück';
          await page.goBack({ timeout: 5000 });
          break;
        case 'forward':
          desc = 'Browser vor';
          await page.goForward({ timeout: 5000 });
          break;
        case 'reload':
          desc = 'Seite neu laden';
          await page.reload({ timeout: 10000 });
          break;
      }
      log.push({ step, action: desc });
    } catch (e) {
      // Element verschwunden, verdeckt o. ä. – das ist meist kein App-Fehler.
      log.push({ step, action: `${desc} (übersprungen: ${e.message.split('\n')[0].slice(0, 100)})`, skipped: true });
    }

    await page.waitForTimeout(delay).catch(() => {});
    await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
    await flushShots();
    await checkHealth();
    if (step % 25 === 0) console.log(`  … Schritt ${step}, Probleme bisher: ${issues.size}`);
  }
  await checkHealth();
  await flushShots();

  const stepsDone = step - 1;
  const list = [...issues.values()];
  const report = {
    url: startUrl,
    seed,
    stepsPlanned: steps,
    stepsDone,
    skipped: log.filter((l) => l.skipped).length,
    durationSec: Math.round((Date.now() - t0) / 1000),
    reproduce: `node ${__filename} --url ${startUrl} --seed ${seed} --steps ${stepsDone}`,
    issues: list,
    actions: log,
  };
  writeJson(path.join(outDir, 'report.json'), report);

  const md = [
    `# Monkey-Test-Bericht`,
    ``,
    `- URL: ${startUrl}`,
    `- Seed: \`${seed}\` (Wiederholen: \`${report.reproduce}\`)`,
    `- Schritte: ${stepsDone} (davon ${report.skipped} übersprungen), Dauer: ${report.durationSec}s`,
    `- Gefundene Probleme: **${list.length}**`,
    ``,
    ...list.flatMap((i, n) => [
      `## ${n + 1}. [${i.type}] ${i.message}`,
      ``,
      `- Zuerst bei Schritt ${i.firstStep}, insgesamt ${i.count}×, URL: ${i.url}`,
      i.screenshot ? `- Screenshot: ${path.basename(i.screenshot)}` : null,
      `- Letzte Aktionen davor:`,
      ...i.lastActions.map((a) => `  - ${a}`),
      i.stack ? `\n\`\`\`\n${i.stack}\n\`\`\`` : null,
      ``,
    ]),
  ]
    .filter((l) => l !== null)
    .join('\n');
  fs.writeFileSync(path.join(outDir, 'report.md'), md + '\n', 'utf8');

  console.log(`\nFertig: ${stepsDone} Schritte, ${list.length} unterschiedliche Probleme.`);
  for (const i of list) console.log(`  ! [${i.type}] ${i.message.slice(0, 160)} (Schritt ${i.firstStep}, ${i.count}×)`);
  console.log(`Seed: ${seed}`);
  console.log(`Bericht: ${path.join(outDir, 'report.md')}`);

  await target.close();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
