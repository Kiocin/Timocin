#!/usr/bin/env node
'use strict';
// Prüft eine Seite in verschiedenen Fenstergrößen: Screenshot je Größe,
// horizontaler Überlauf, Elemente außerhalb des Fensters, zu kleine Touch-Ziele
// auf schmalen Bildschirmen, abgeschnittener Text.
//
//   node viewports.cjs --url http://localhost:5173 [--sizes 320x568,768x1024,1920x1080]
//                      [--out dir] [--storage-state auth.json] [--cdp http://127.0.0.1:9222]

const path = require('path');
const { parseArgs, ensureDir, defaultOutDir, openTarget, attachMonitors, writeJson, parseViewport } = require('./_common.cjs');

const DEFAULT_SIZES = '320x568,375x667,414x896,768x1024,1024x768,1280x800,1440x900,1920x1080,2560x1440';

async function analyze(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const describe = (el) => {
      let s = el.tagName.toLowerCase();
      if (el.id) s += `#${el.id}`;
      else if (el.classList.length) s += '.' + [...el.classList].slice(0, 2).join('.');
      const t = (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      return t ? `${s} "${t}"` : s;
    };
    const visible = (el) => {
      const cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden';
    };

    const overflowX = document.documentElement.scrollWidth - vw;
    const offenders = [];
    const clipped = [];
    for (const el of document.body.querySelectorAll('*')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > vw + 1 || r.left < -1) {
        // Nur das äußerste überstehende Element melden, nicht alle Kinder
        if (!offenders.some((o) => o.el.contains(el))) offenders.push({ el, right: Math.round(r.right), width: Math.round(r.width) });
      }
      const cs = getComputedStyle(el);
      if (
        el.children.length === 0 &&
        el.innerText &&
        el.innerText.trim() &&
        (cs.overflow === 'hidden' || cs.textOverflow === 'ellipsis') &&
        el.scrollWidth > el.clientWidth + 1
      ) {
        clipped.push(describe(el));
      }
    }

    const smallTargets = [];
    if (vw <= 480) {
      for (const el of document.querySelectorAll('a[href],button,input,select,textarea,[role=button],[onclick]')) {
        if (!visible(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.width < 24 && r.height < 24) smallTargets.push(`${describe(el)} (${Math.round(r.width)}×${Math.round(r.height)})`);
      }
    }

    return {
      viewportWidth: vw,
      horizontalOverflowPx: overflowX > 1 ? overflowX : 0,
      outsideViewport: offenders.slice(0, 8).map((o) => `${describe(o.el)} (rechts bei ${o.right}px, Breite ${o.width}px)`),
      clippedText: clipped.slice(0, 8),
      smallTouchTargets: smallTargets.slice(0, 10),
    };
  });
}

(async () => {
  const args = parseArgs();
  const outDir = ensureDir(path.resolve(args.out || defaultOutDir('viewports')));
  const sizes = String(args.sizes || DEFAULT_SIZES).split(',').map((s) => parseViewport(s.trim()));

  const { page, close } = await openTarget(args);
  const errors = [];
  attachMonitors(page, (type, message) => errors.push({ type, message, viewport: page.viewportSize() }), { ignore: args.ignore });

  const results = [];
  for (const size of sizes) {
    await page.setViewportSize(size);
    await page.waitForTimeout(400); // Layout/Animationen setzen lassen
    const a = await analyze(page);
    const shot = path.join(outDir, `${size.width}x${size.height}.png`);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    results.push({ size: `${size.width}x${size.height}`, ...a, screenshot: shot });
  }

  writeJson(path.join(outDir, 'viewports.json'), { url: page.url(), results, errors });

  console.log(`Fenstergrößen-Test: ${page.url()}\n`);
  for (const r of results) {
    const problems = [];
    if (r.horizontalOverflowPx) problems.push(`horizontaler Überlauf ${r.horizontalOverflowPx}px`);
    if (r.outsideViewport.length) problems.push(`${r.outsideViewport.length} Element(e) außerhalb`);
    if (r.clippedText.length) problems.push(`${r.clippedText.length} abgeschnittene Texte`);
    if (r.smallTouchTargets.length) problems.push(`${r.smallTouchTargets.length} kleine Touch-Ziele`);
    console.log(`${r.size.padEnd(10)} ${problems.length ? '⚠ ' + problems.join(', ') : 'ok'}`);
    for (const o of r.outsideViewport) console.log(`             außerhalb: ${o}`);
    for (const c of r.clippedText) console.log(`             abgeschnitten: ${c}`);
    for (const t of r.smallTouchTargets) console.log(`             klein: ${t}`);
  }
  if (errors.length) {
    console.log(`\nFehler während der Größenänderungen:`);
    for (const e of errors) console.log(`  ! [${e.type}] ${e.message} @ ${e.viewport && e.viewport.width}x${e.viewport && e.viewport.height}`);
  }
  console.log(`\nScreenshots und Details: ${outDir}`);
  await close();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
