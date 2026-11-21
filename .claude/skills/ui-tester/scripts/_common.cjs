'use strict';
// Gemeinsame Hilfsfunktionen für die ui-tester-Skripte.
// CommonJS (.cjs), damit die Skripte auch in Projekten mit "type": "module" laufen.

const fs = require('fs');
const path = require('path');

function loadPlaywright() {
  const names = ['playwright', '@playwright/test', 'playwright-core'];
  const searchPaths = [process.cwd(), __dirname];
  for (const name of names) {
    try {
      return require(require.resolve(name, { paths: searchPaths }));
    } catch (_) {
      try {
        return require(name);
      } catch (_) {
        /* nächster Kandidat */
      }
    }
  }
  console.error(
    'Playwright wurde nicht gefunden.\n' +
      'Im Projekt installieren:  npm i -D playwright && npx playwright install chromium'
  );
  process.exit(2);
}

// Minimaler Argument-Parser: --key value, --key=value, --flag
function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      (args._ = args._ || []).push(a);
      continue;
    }
    const eq = a.indexOf('=');
    if (eq !== -1) {
      args[a.slice(2, eq)] = a.slice(eq + 1);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      args[a.slice(2)] = argv[++i];
    } else {
      args[a.slice(2)] = true;
    }
  }
  return args;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function defaultOutDir(kind) {
  return path.resolve(process.cwd(), 'ui-test-results', `${kind}-${timestamp()}`);
}

function parseViewport(str, fallback = { width: 1280, height: 800 }) {
  if (!str || str === true) return fallback;
  const m = String(str).match(/^(\d+)x(\d+)$/i);
  if (!m) throw new Error(`Ungültige Fenstergröße "${str}", erwartet z. B. 1280x800`);
  return { width: Number(m[1]), height: Number(m[2]) };
}

/**
 * Öffnet das Testziel.
 *  - Normal: startet Chromium und lädt args.url.
 *  - Mit --cdp <endpoint>: hängt sich an einen laufenden Browser / ein WebView2
 *    (z. B. Tauri unter Windows) an und nimmt die passende vorhandene Seite.
 */
async function openTarget(args) {
  const { chromium } = loadPlaywright();
  const viewport = parseViewport(args.viewport);

  if (args.cdp) {
    const browser = await chromium.connectOverCDP(String(args.cdp));
    const context = browser.contexts()[0] || (await browser.newContext());
    let pages = context.pages();
    let page =
      (args.url && pages.find((p) => p.url().startsWith(String(args.url)))) ||
      pages.find((p) => !p.url().startsWith('devtools://')) ||
      pages[0];
    if (args['init-script']) await context.addInitScript({ path: path.resolve(String(args['init-script'])) });
    if (!page) page = await context.newPage();
    if (args.url && !page.url().startsWith(String(args.url))) {
      await page.goto(String(args.url), { waitUntil: 'domcontentloaded' });
    }
    // Beim Anhängen per CDP die App NICHT schließen – nur trennen.
    return { browser, context, page, attached: true, close: async () => {} };
  }

  if (!args.url) throw new Error('Bitte --url <adresse> angeben (oder --cdp <endpoint>).');

  const browser = await chromium.launch({
    headless: !args.headed,
    slowMo: args.slowmo ? Number(args.slowmo) : 0,
  });
  const contextOptions = { viewport, ignoreHTTPSErrors: true };
  if (args['storage-state']) contextOptions.storageState = String(args['storage-state']);
  if (args.locale) contextOptions.locale = String(args.locale);
  const context = await browser.newContext(contextOptions);
  // z. B. ein Tauri-Mock (siehe references/tauri.md), das vor dem App-Code geladen wird
  if (args['init-script']) await context.addInitScript({ path: path.resolve(String(args['init-script'])) });
  const page = await context.newPage();
  await page.goto(String(args.url), { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  return { browser, context, page, attached: false, close: () => browser.close() };
}

/**
 * Hängt Beobachter an eine Seite und meldet Auffälligkeiten an onIssue(type, message, extra).
 * Typen: console-error, page-error, request-failed, http-4xx, http-5xx, dialog
 */
function attachMonitors(page, onIssue, opts = {}) {
  const ignore = opts.ignore ? new RegExp(opts.ignore, 'i') : null;
  const report = (type, message, extra) => {
    if (ignore && ignore.test(message)) return;
    onIssue(type, message, extra || {});
  };

  page.on('console', (msg) => {
    if (msg.type() === 'error') report('console-error', msg.text().slice(0, 500));
  });
  page.on('pageerror', (err) => {
    report('page-error', `${err.name}: ${err.message}`.slice(0, 500), {
      stack: (err.stack || '').split('\n').slice(0, 6).join('\n'),
    });
  });
  page.on('requestfailed', (req) => {
    const failure = req.failure() ? req.failure().errorText : 'unbekannt';
    // Abgebrochene Requests durch Navigation sind normal.
    if (/ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i.test(failure)) return;
    report('request-failed', `${req.method()} ${req.url()} → ${failure}`);
  });
  page.on('response', (res) => {
    const s = res.status();
    if (s >= 500) report('http-5xx', `${res.request().method()} ${res.url()} → ${s}`);
    else if (s >= 400 && s !== 401 && s !== 404) report('http-4xx', `${res.request().method()} ${res.url()} → ${s}`);
    else if (s === 404 && res.request().resourceType() !== 'image')
      report('http-4xx', `${res.request().method()} ${res.url()} → 404`);
  });
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

module.exports = {
  loadPlaywright,
  parseArgs,
  ensureDir,
  timestamp,
  defaultOutDir,
  parseViewport,
  openTarget,
  attachMonitors,
  writeJson,
};
