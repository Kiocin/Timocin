#!/usr/bin/env node
'use strict';
// Vorlage für ein gezieltes Szenario. Kopieren nach ui-test-results/szenarien/<testart>-<name>.cjs,
// den Block "SZENARIEN" füllen und im Projektordner ausführen:
//
//   APP_URL=http://localhost:5173 node ui-test-results/szenarien/T2-eintraege.cjs
//
// Optionale Umgebungsvariablen: HEADED=1, STORAGE_STATE=auth.json, INIT_SCRIPT=tauri-mock.js,
// CDP=http://127.0.0.1:9222 (an laufende App anhängen, z. B. Tauri/WebView2).
// Ergebnis: <name>.json neben dem Skript (wird von run.cjs in die Übersicht übernommen) + Screenshots bei Fehlern.

const fs = require('fs');
const path = require('path');

let pw;
for (const n of ['playwright', '@playwright/test']) {
  try { pw = require(require.resolve(n, { paths: [process.cwd()] })); break; } catch (_) {
    try { pw = require(n); break; } catch (_) {}
  }
}
if (!pw) { console.error('Playwright fehlt: npm i -D playwright && npx playwright install chromium'); process.exit(2); }
const { chromium } = pw;

const URL = process.env.APP_URL || 'http://localhost:5173';
const NAME = path.basename(__filename, path.extname(__filename));
const OUT = path.dirname(__filename);
const TESTART = (NAME.match(/^(T\d+)/) || [])[1] || 'T?';

const results = [];
const errors = [];
let browser, context, page;

/** Ein einzelner Prüfschritt. Schlägt er fehl, gibt es einen Screenshot und es geht weiter. */
async function check(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`✔ ${name}`);
  } catch (e) {
    const shot = path.join(OUT, `${NAME}-${results.length + 1}.png`);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    results.push({ name, ok: false, error: e.message.split('\n')[0], screenshot: shot, ms: Date.now() - t0 });
    console.log(`✘ ${name}: ${e.message.split('\n')[0]}`);
  }
}
/** Echte Erwartung prüfen – "kein Fehler geworfen" reicht nicht. */
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function assertEqual(actual, expected, what) {
  if (actual !== expected) throw new Error(`${what}: erwartet ${JSON.stringify(expected)}, tatsächlich ${JSON.stringify(actual)}`);
}
const unique = (prefix = 'Test') => `${prefix} ${Date.now().toString(36)}`;

function watch(p) {
  p.on('pageerror', (e) => errors.push(`JS-Fehler: ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && errors.push(`Konsole: ${m.text().slice(0, 200)}`));
  p.on('response', (r) => r.status() >= 500 && errors.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`));
}

(async () => {
  if (process.env.CDP) {
    browser = await chromium.connectOverCDP(process.env.CDP);
    context = browser.contexts()[0];
    page = context.pages()[0];
  } else {
    browser = await chromium.launch({ headless: !process.env.HEADED });
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      ...(process.env.STORAGE_STATE ? { storageState: process.env.STORAGE_STATE } : {}),
    });
    if (process.env.INIT_SCRIPT) await context.addInitScript({ path: path.resolve(process.env.INIT_SCRIPT) });
    page = await context.newPage();
  }
  watch(page);
  context.on('page', watch);
  await page.goto(URL, { waitUntil: 'domcontentloaded' });

  // ======================= SZENARIEN =======================
  // Beispiele siehe references/tests/T*.md. Jede Prüfung in check(...) kapseln.

  await check('Startseite lädt und zeigt Inhalt', async () => {
    const text = (await page.locator('body').innerText()).trim();
    assert(text.length > 0, 'Seite ist leer');
  });

  // =========================================================

  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} Prüfungen ok`);
  const uniqueErrors = [...new Set(errors)];
  if (uniqueErrors.length) console.log('Fehler während der Szenarien:\n  ' + uniqueErrors.join('\n  '));
  fs.writeFileSync(
    path.join(OUT, `${NAME}.json`),
    JSON.stringify({ testart: TESTART, name: NAME, url: URL, results, errors: uniqueErrors }, null, 2)
  );
  if (!process.env.CDP) await browser.close();
  process.exit(ok === results.length ? 0 : 1);
})().catch(async (e) => {
  console.error(e);
  if (browser && !process.env.CDP) await browser.close().catch(() => {});
  process.exit(1);
});
