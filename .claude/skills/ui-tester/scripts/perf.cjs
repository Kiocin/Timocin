#!/usr/bin/env node
'use strict';
// T15 Performance (Browser-Sicht):
//  - Ladezeiten je Seite: TTFB, FCP, LCP, CLS, blockierte Zeit (TBT aus Long Tasks), DOM fertig, Load
//    (mehrere Läufe, Median; kalt = ohne Cache, warm = mit Cache)
//  - Datenmenge: gesamt, JS, CSS, Bilder, Anzahl Requests, größte Dateien
//  - fehlende Kompression, übergroße Bilder, langsame API-Aufrufe beim Laden
//  - optional: langsames Netz + langsame CPU (--throttle), Speicherleck-Test (--leak, nur Chromium)
//
//   node perf.cjs --url http://localhost:5173 [--pages /a,/b] [--runs 3] [--throttle] [--leak]
//                 [--browser chromium] [--out dir] [--storage-state …]
//
// Lasttests (viele gleichzeitige Benutzer) gegen den Server: siehe references/tests/T15-performance.md.

const path = require('path');
const { parseArgs, ensureDir, defaultOutDir, openTarget, writeJson } = require('./_common.cjs');

// Grenzwerte nach Google Core Web Vitals (gut / schlecht)
const LIMITS = { ttfb: [800, 1800], fcp: [1800, 3000], lcp: [2500, 4000], cls: [0.1, 0.25], tbt: [200, 600] };
const rate = (k, v) => (v == null ? '–' : v <= LIMITS[k][0] ? 'gut' : v <= LIMITS[k][1] ? 'verbesserungswürdig' : 'schlecht');

const OBSERVER = `
  window.__perf = { lcp: 0, cls: 0, longTasks: [] };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch (_) {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__perf.cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch (_) {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.longTasks.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: true }); } catch (_) {}
`;

async function measure(page) {
  await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    const res = performance.getEntriesByType('resource');
    const p = window.__perf || { lcp: 0, cls: 0, longTasks: [] };
    const sum = (f) => res.filter(f).reduce((s, r) => s + (r.transferSize || r.encodedBodySize || 0), 0);
    const isJs = (r) => r.initiatorType === 'script' || /\.m?js(\?|$)/.test(r.name);
    const isCss = (r) => /\.css(\?|$)/.test(r.name) || (r.initiatorType === 'link' && /css/.test(r.name));
    const isImg = (r) => r.initiatorType === 'img' || /\.(png|jpe?g|gif|webp|avif|svg)(\?|$)/.test(r.name);
    const isApi = (r) => ['fetch', 'xmlhttprequest'].includes(r.initiatorType);
    // übergroße Bilder: natürliche Größe viel größer als dargestellt
    const bigImages = [...document.images]
      .filter((i) => i.complete && i.naturalWidth && i.getBoundingClientRect().width)
      .map((i) => ({ src: i.currentSrc.split('/').pop().slice(0, 60), natural: `${i.naturalWidth}×${i.naturalHeight}`, shown: `${Math.round(i.getBoundingClientRect().width)}×${Math.round(i.getBoundingClientRect().height)}`, factor: i.naturalWidth / (i.getBoundingClientRect().width * devicePixelRatio) }))
      .filter((i) => i.factor > 2);
    return {
      ttfb: Math.round(nav.responseStart || 0),
      fcp: fcp ? Math.round(fcp.startTime) : null,
      lcp: p.lcp ? Math.round(p.lcp) : null,
      cls: Math.round(p.cls * 1000) / 1000,
      tbt: p.longTasks.reduce((s, d) => s + Math.max(0, d - 50), 0),
      longTasks: p.longTasks.length,
      longestTask: Math.max(0, ...p.longTasks),
      domReady: Math.round(nav.domContentLoadedEventEnd || 0),
      load: Math.round(nav.loadEventEnd || 0),
      requests: res.length + 1,
      bytes: { total: sum(() => true) + (nav.transferSize || 0), js: sum(isJs), css: sum(isCss), img: sum(isImg), api: sum(isApi) },
      largest: res.map((r) => ({ name: r.name.split('?')[0].split('/').slice(-2).join('/'), kb: Math.round((r.transferSize || r.encodedBodySize || 0) / 1024) })).sort((a, b) => b.kb - a.kb).slice(0, 5),
      uncompressed: res.filter((r) => (isJs(r) || isCss(r) || /\.(json|html|svg)(\?|$)/.test(r.name)) && r.encodedBodySize > 20000 && r.decodedBodySize && r.encodedBodySize >= r.decodedBodySize * 0.95).map((r) => `${r.name.split('/').pop().slice(0, 50)} (${Math.round(r.decodedBodySize / 1024)} KB)`),
      slowApi: res.filter((r) => isApi(r) && r.duration > 500).map((r) => `${r.name.replace(location.origin, '').slice(0, 60)} ${Math.round(r.duration)} ms`),
      bigImages,
      domNodes: document.getElementsByTagName('*').length,
    };
  });
}

const median = (arr) => { const a = arr.filter((x) => x != null).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };

(async () => {
  const args = parseArgs();
  const outDir = ensureDir(path.resolve(args.out || defaultOutDir('perf')));
  const runs = Number(args.runs || 3);
  const target = await openTarget(args);
  const { page, context } = target;
  await context.addInitScript(OBSERVER);
  const base = page.url();
  const urls = [base, ...String(args.pages || '').split(',').filter(Boolean).map((p) => new URL(p, base).href)];
  const chromium = (target.browserName || 'chromium') === 'chromium';
  let cdp = null;
  if (chromium) cdp = await context.newCDPSession(page).catch(() => null);
  if (args.throttle && cdp) {
    // etwa "schnelles 3G" + 4× langsamere CPU (Mittelklasse-Laptop/Handy)
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }

  const results = [];
  for (const url of urls) {
    const cold = [];
    const warm = [];
    for (let i = 0; i < runs; i++) {
      if (cdp) { await cdp.send('Network.enable').catch(() => {}); await cdp.send('Network.clearBrowserCache').catch(() => {}); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }).catch(() => {}); }
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      cold.push(await measure(page));
      if (cdp) await cdp.send('Network.setCacheDisabled', { cacheDisabled: false }).catch(() => {});
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      warm.push(await measure(page));
    }
    const pick = (list, k) => median(list.map((m) => m[k]));
    const r = {
      url,
      kalt: { ttfb: pick(cold, 'ttfb'), fcp: pick(cold, 'fcp'), lcp: pick(cold, 'lcp'), cls: pick(cold, 'cls'), tbt: pick(cold, 'tbt'), domReady: pick(cold, 'domReady'), load: pick(cold, 'load') },
      warm: { fcp: pick(warm, 'fcp'), lcp: pick(warm, 'lcp'), load: pick(warm, 'load') },
      detail: cold[cold.length - 1],
    };
    await page.screenshot({ path: path.join(outDir, `seite-${results.length}.png`) }).catch(() => {});
    results.push(r);
  }

  // Speicherleck: zwischen Seiten hin und her navigieren (clientseitig per Link-Klick), Heap nach GC vergleichen
  let leak = null;
  if (args.leak && cdp) {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    const heap = async () => { await cdp.send('HeapProfiler.collectGarbage').catch(() => {}); const m = await cdp.send('Performance.getMetrics'); return m.metrics.find((x) => x.name === 'JSHeapUsedSize').value; };
    await cdp.send('Performance.enable');
    const links = await page.locator('nav a[href], aside a[href]').all();
    const internal = [];
    for (const l of links) { const h = await l.getAttribute('href'); if (h && !/^(https?:|mailto:|tel:)/.test(h) && !/logout|abmeld/i.test(h)) internal.push(h); }
    const cycle = async () => { for (const h of internal.slice(0, 6)) { await page.locator(`a[href="${h}"]`).first().click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(400); } await page.goBack().catch(() => {}); };
    await cycle();
    const before = await heap();
    for (let i = 0; i < 10; i++) await cycle();
    const after = await heap();
    leak = { vorher_MB: +(before / 1048576).toFixed(1), nachher_MB: +(after / 1048576).toFixed(1), wachstum: Math.round(((after - before) / before) * 100), links: internal.slice(0, 6) };
  }

  writeJson(path.join(outDir, 'perf.json'), { throttled: !!args.throttle, runs, results, leak });
  const kb = (b) => `${Math.round(b / 1024)} KB`;
  const findings = [];
  for (const r of results) {
    const k = r.kalt;
    const d = r.detail;
    console.log(`\n=== ${r.url}${args.throttle ? '  (gedrosselt: langsames Netz, 4× CPU)' : ''}  – Median aus ${runs} Läufen`);
    console.log(`  TTFB ${k.ttfb} ms (${rate('ttfb', k.ttfb)}) · FCP ${k.fcp} ms (${rate('fcp', k.fcp)}) · LCP ${k.lcp} ms (${rate('lcp', k.lcp)}) · CLS ${k.cls} (${rate('cls', k.cls)}) · blockiert ${k.tbt} ms (${rate('tbt', k.tbt)})`);
    console.log(`  DOM fertig ${k.domReady} ms · geladen ${k.load} ms · mit Cache: LCP ${r.warm.lcp} ms, geladen ${r.warm.load} ms`);
    console.log(`  ${d.requests} Requests, ${kb(d.bytes.total)} gesamt (JS ${kb(d.bytes.js)}, CSS ${kb(d.bytes.css)}, Bilder ${kb(d.bytes.img)}), ${d.domNodes} DOM-Elemente`);
    const f = (sev, m) => { findings.push({ url: r.url, schweregrad: sev, msg: m }); console.log(`  ! [${sev}] ${m}`); };
    for (const key of ['ttfb', 'fcp', 'lcp', 'cls', 'tbt']) if (rate(key, k[key]) === 'schlecht') f('mittel', `${key.toUpperCase()} schlecht: ${k[key]}${key === 'cls' ? '' : ' ms'} (Grenze ${LIMITS[key][1]})`);
    if (d.longestTask > 200) f('mittel', `längste blockierende Aufgabe ${d.longestTask} ms – Seite reagiert so lange nicht auf Klicks`);
    if (d.bytes.js > 500 * 1024) f('niedrig', `${kb(d.bytes.js)} JavaScript – Code-Splitting/Lazy Loading prüfen`);
    if (d.bytes.total > 3 * 1024 * 1024) f('niedrig', `Seite überträgt ${kb(d.bytes.total)}`);
    if (d.requests > 100) f('niedrig', `${d.requests} Requests beim Laden`);
    for (const u of d.uncompressed) f('niedrig', `nicht komprimiert übertragen: ${u} (gzip/brotli aktivieren)`);
    for (const i of d.bigImages) f('niedrig', `Bild ${i.src} ist ${i.natural}, angezeigt ${i.shown} – ${Math.round(i.factor)}× zu groß`);
    for (const a of d.slowApi) f('mittel', `langsamer API-Aufruf beim Laden: ${a}`);
    if (d.domNodes > 3000) f('niedrig', `${d.domNodes} DOM-Elemente – große Listen/Tabellen virtualisieren oder seitenweise laden`);
    console.log(`  Größte Dateien: ${d.largest.map((x) => `${x.name} ${x.kb} KB`).join(', ')}`);
  }
  if (leak) {
    console.log(`\nSpeicher nach 10 Navigationsrunden: ${leak.vorher_MB} MB → ${leak.nachher_MB} MB (${leak.wachstum > 0 ? '+' : ''}${leak.wachstum}%)`);
    if (leak.wachstum > 30) { findings.push({ url: base, schweregrad: 'mittel', msg: `möglicher Speicherleck: JS-Heap wächst um ${leak.wachstum}% bei wiederholter Navigation` }); console.log('  ! [mittel] möglicher Speicherleck'); }
  } else if (args.leak) console.log('\nSpeicherleck-Test nur mit Chromium möglich.');
  writeJson(path.join(outDir, 'perf.json'), { throttled: !!args.throttle, runs, results, leak, findings });
  console.log(`\nGesamt: ${findings.length} Befunde. Details: ${path.join(outDir, 'perf.json')}`);
  console.log('Hinweis: Lokale Messungen sind schneller als echte Nutzer – mit --throttle realistischer messen. Lasttests: T15-Anleitung.');
  await target.close();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
