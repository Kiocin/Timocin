#!/usr/bin/env node
'use strict';
// Bestandsaufnahme einer Oberfläche: Bedienelemente, Formulare, Überschriften,
// interne Links, Browser-Speicher, Fehler beim Laden, Screenshot.
//
//   node inventory.cjs --url http://localhost:5173 [--crawl 5] [--out dir]
//                      [--viewport 1280x800] [--storage-state auth.json] [--cdp http://127.0.0.1:9222]

const path = require('path');
const { parseArgs, ensureDir, defaultOutDir, openTarget, attachMonitors, writeJson } = require('./_common.cjs');

async function inspectPage(page) {
  return page.evaluate(() => {
    const isVisible = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0;
    };
    const textOf = (el) =>
      (
        el.getAttribute('aria-label') ||
        el.innerText ||
        (['checkbox', 'radio'].includes(el.type) ? '' : el.value) ||
        el.getAttribute('placeholder') ||
        el.getAttribute('title') ||
        el.getAttribute('name') ||
        ''
      )
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);
    const labelFor = (el) => {
      if (el.id) {
        const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (l) return l.innerText.trim().slice(0, 80);
      }
      const parent = el.closest('label');
      return parent ? parent.innerText.trim().slice(0, 80) : '';
    };
    const selectorHint = (el) => {
      if (el.getAttribute('data-testid')) return `[data-testid="${el.getAttribute('data-testid')}"]`;
      if (el.id) return `#${el.id}`;
      if (el.getAttribute('name')) return `${el.tagName.toLowerCase()}[name="${el.getAttribute('name')}"]`;
      return '';
    };

    const SEL = [
      'a[href]', 'button', 'input', 'textarea', 'select', 'summary',
      '[role=button]', '[role=link]', '[role=tab]', '[role=menuitem]', '[role=checkbox]',
      '[role=switch]', '[role=combobox]', '[role=option]', '[onclick]', '[contenteditable="true"]',
    ].join(',');

    const elements = [...document.querySelectorAll(SEL)].filter(isVisible).map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || undefined,
      role: el.getAttribute('role') || undefined,
      text: textOf(el),
      label: ['input', 'textarea', 'select'].includes(el.tagName.toLowerCase()) ? labelFor(el) : undefined,
      selector: selectorHint(el) || undefined,
      disabled: el.disabled || el.getAttribute('aria-disabled') === 'true' || undefined,
      href: el.tagName === 'A' ? el.getAttribute('href') : undefined,
    }));

    const forms = [...document.querySelectorAll('form')].map((f, i) => ({
      index: i,
      id: f.id || undefined,
      action: f.getAttribute('action') || undefined,
      method: (f.getAttribute('method') || 'get').toLowerCase(),
      fields: [...f.querySelectorAll('input,textarea,select')].map((el) => ({
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || undefined,
        name: el.getAttribute('name') || undefined,
        label: labelFor(el) || el.getAttribute('placeholder') || undefined,
        required: el.required || undefined,
        pattern: el.getAttribute('pattern') || undefined,
        min: el.getAttribute('min') || undefined,
        max: el.getAttribute('max') || undefined,
        maxlength: el.getAttribute('maxlength') || undefined,
      })),
    }));

    const headings = [...document.querySelectorAll('h1,h2,h3')]
      .filter(isVisible)
      .map((h) => `${h.tagName.toLowerCase()}: ${h.innerText.trim().slice(0, 80)}`);

    const internalLinks = [
      ...new Set(
        [...document.querySelectorAll('a[href]')]
          .map((a) => {
            try {
              const u = new URL(a.getAttribute('href'), location.href);
              u.hash = u.hash.startsWith('#/') ? u.hash : ''; // Hash-Router behalten
              return u.origin === location.origin ? u.href : null;
            } catch (_) {
              return null;
            }
          })
          .filter(Boolean)
      ),
    ];

    const keys = (s) => {
      try {
        return Object.keys(s);
      } catch (_) {
        return [];
      }
    };

    return {
      url: location.href,
      title: document.title,
      headings,
      elements,
      forms,
      internalLinks,
      storage: { localStorage: keys(localStorage), sessionStorage: keys(sessionStorage) },
      tauri: {
        v1: typeof window.__TAURI_IPC__ !== 'undefined',
        v2: typeof window.__TAURI_INTERNALS__ !== 'undefined',
        globalApi: typeof window.__TAURI__ !== 'undefined',
      },
    };
  });
}

(async () => {
  const args = parseArgs();
  const outDir = ensureDir(path.resolve(args.out || defaultOutDir('inventory')));
  const crawl = Number(args.crawl || 0);

  const { page, context, close } = await openTarget(args);
  const issues = [];
  attachMonitors(page, (type, message) => issues.push({ type, message, url: page.url() }), { ignore: args.ignore });

  const pages = [];
  const visited = new Set();
  const queue = [page.url()];
  while (queue.length && pages.length <= crawl) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);
    if (page.url() !== url) {
      await page.goto(url, { waitUntil: 'domcontentloaded' }).catch((e) => issues.push({ type: 'navigation', message: e.message, url }));
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    }
    const info = await inspectPage(page);
    info.idb = await page.evaluate(async () => {
      try {
        return (await indexedDB.databases()).map((d) => d.name);
      } catch (_) {
        return [];
      }
    });
    const shot = path.join(outDir, `page-${pages.length}.png`);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    info.screenshot = shot;
    pages.push(info);
    for (const l of info.internalLinks) if (!visited.has(l)) queue.push(l);
  }

  const cookies = (await context.cookies().catch(() => [])).map((c) => `${c.name} (${c.domain})`);
  const result = { startedAt: new Date().toISOString(), pages, cookies, issues };
  writeJson(path.join(outDir, 'inventory.json'), result);

  // Kurze Zusammenfassung für die Konsole
  for (const p of pages) {
    console.log(`\n=== ${p.title || '(ohne Titel)'} — ${p.url}`);
    if (p.tauri.v1 || p.tauri.v2) console.log(`Tauri erkannt: ${JSON.stringify(p.tauri)}`);
    console.log(`Überschriften: ${p.headings.join(' | ') || '-'}`);
    console.log(`Bedienelemente: ${p.elements.length}, Formulare: ${p.forms.length}, interne Links: ${p.internalLinks.length}`);
    for (const e of p.elements.slice(0, 60)) {
      const bits = [e.tag + (e.type ? `[${e.type}]` : ''), e.role && `role=${e.role}`, e.text && `"${e.text}"`, e.label && `label="${e.label}"`, e.selector, e.disabled && '(deaktiviert)']
        .filter(Boolean)
        .join(' ');
      console.log(`  - ${bits}`);
    }
    if (p.elements.length > 60) console.log(`  … ${p.elements.length - 60} weitere (siehe inventory.json)`);
    console.log(`Speicher: localStorage=[${p.storage.localStorage}] sessionStorage=[${p.storage.sessionStorage}] IndexedDB=[${p.idb}]`);
  }
  console.log(`\nCookies: ${cookies.join(', ') || '-'}`);
  console.log(`Auffälligkeiten beim Laden: ${issues.length}`);
  for (const i of issues.slice(0, 20)) console.log(`  ! [${i.type}] ${i.message}`);
  console.log(`\nErgebnis: ${path.join(outDir, 'inventory.json')}`);

  await close();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
