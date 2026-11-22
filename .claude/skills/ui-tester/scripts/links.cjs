#!/usr/bin/env node
'use strict';
// T5 Navigation: Funktionieren alle Menüs und Links?
//  - Crawlt interne Seiten (Standard bis 30), öffnet Menüs (aria-haspopup/aria-expanded, Hover-Menüs)
//  - Prüft jedes Linkziel: HTTP-Status, leere Seite, "nicht gefunden"-Inhalt (SPA), JS-Fehler
//  - Sprungmarken (#abschnitt) vorhanden? Links ohne Ziel (href="#", javascript:)?
//  - target=_blank ohne rel="noopener"
//  - optional externe Links prüfen (--external)
//
//   node links.cjs --url http://localhost:5173 [--max-pages 30] [--external] [--avoid regex]
//                  [--browser webkit] [--out dir] [--storage-state …] [--cdp …]

const path = require('path');
const { parseArgs, ensureDir, defaultOutDir, openTarget, writeJson, findCrypticTexts } = require('./_common.cjs');

async function openMenus(page) {
  // Menü-Auslöser öffnen, damit versteckte Untermenü-Links sichtbar und prüfbar werden
  const triggers = await page.locator('[aria-haspopup]:visible, [aria-expanded=false]:visible, nav li:has(ul) > a:visible, nav li:has(ul) > button:visible').all();
  const opened = [];
  for (const t of triggers.slice(0, 20)) {
    const label = ((await t.getAttribute('aria-label').catch(() => '')) || (await t.innerText().catch(() => ''))).trim().slice(0, 40);
    const before = await page.locator('a[href]:visible').count();
    await t.hover({ timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(250);
    let after = await page.locator('a[href]:visible').count();
    if (after <= before && (await t.getAttribute('aria-expanded').catch(() => null)) !== null) {
      await t.click({ timeout: 1500 }).catch(() => {});
      await page.waitForTimeout(300);
      after = await page.locator('a[href]:visible').count();
    }
    const expanded = await t.getAttribute('aria-expanded').catch(() => null);
    opened.push({ menu: label, newLinks: after - before, ariaExpanded: expanded });
  }
  return opened;
}

async function collectLinks(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('a[href], [role=link], [role=menuitem]')].map((a) => {
      const r = a.getBoundingClientRect();
      const href = a.getAttribute('href');
      let abs = null;
      try { abs = href ? new URL(href, location.href).href : null; } catch (_) {}
      return {
        text: (a.getAttribute('aria-label') || a.innerText || a.title || '').replace(/\s+/g, ' ').trim().slice(0, 50),
        href,
        abs,
        visible: r.width > 0 && r.height > 0,
        role: a.getAttribute('role') || '',
        blank: a.target === '_blank',
        rel: a.rel || '',
        current: a.getAttribute('aria-current'),
      };
    })
  );
}

(async () => {
  const args = parseArgs();
  const outDir = ensureDir(path.resolve(args.out || defaultOutDir('links')));
  const maxPages = Number(args['max-pages'] || 30);
  const avoid = new RegExp(args.avoid || 'abmeld|logout|log-out|signout|sign-out|löschen|delete', 'i');
  const { page, context, close } = await openTarget(args);
  const start = page.url();
  const origin = new URL(start).origin;

  const visited = new Map(); // url -> { status, problems }
  const linkIndex = new Map(); // abs -> [{ from, text }]
  const findings = [];
  const queue = [start];
  const F = (cat, msg, where) => findings.push({ cat, msg, where });

  while (queue.length && visited.size < maxPages) {
    const url = queue.shift();
    const key = url.replace(/#(?!\/).*$/, ''); // Sprungmarken nicht als eigene Seite, Hash-Router (#/) schon
    if (visited.has(key)) continue;
    const jsErrors = [];
    const onErr = (e) => jsErrors.push(e.message);
    page.on('pageerror', onErr);
    let status = null;
    try {
      const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      status = res ? res.status() : null;
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    } catch (e) {
      status = `Fehler: ${e.message.split('\n')[0]}`;
    }
    page.off('pageerror', onErr);
    const content = await page.evaluate(() => ({ text: document.body ? document.body.innerText.trim() : '', title: document.title })).catch(() => ({ text: '', title: '' }));
    const v = { url, status, title: content.title, problems: [] };
    visited.set(key, v);
    if (typeof status === 'string' || (status && status >= 400)) v.problems.push(`HTTP ${status}`);
    else if (!content.text) v.problems.push('Seite ist leer');
    else if (/\b404\b|nicht gefunden|not found|seite existiert nicht/i.test(content.title + ' ' + content.text.slice(0, 300))) v.problems.push('zeigt "nicht gefunden"');
    for (const e of jsErrors) v.problems.push(`JS-Fehler: ${e.slice(0, 120)}`);
    for (const c of await findCrypticTexts(page)) v.problems.push(`unverständlicher Text (${c.reason}): "${c.text.slice(0, 80)}"`);
    if (v.problems.length) await page.screenshot({ path: path.join(outDir, `seite-${visited.size}.png`) }).catch(() => {});
    if (typeof status === 'string' || (status && status >= 400) || !content.text) continue;

    const menus = await openMenus(page);
    for (const m of menus) if (m.newLinks === 0 && m.ariaExpanded === 'false') F('Menü', `Menü "${m.menu}" öffnet sich nicht (keine neuen Einträge, aria-expanded bleibt false)`, url);
    const links = await collectLinks(page);
    const ids = new Set(await page.evaluate(() => [...document.querySelectorAll('[id],[name]')].map((e) => e.id || e.getAttribute('name'))));
    for (const l of links) {
      if (!l.visible) continue;
      if (!l.href || l.href === '#' || /^javascript:/i.test(l.href)) {
        if (!l.role) F('Link ohne Ziel', `"${l.text}" hat href="${l.href || ''}" – ist es ein Button? (dann <button> verwenden)`, url);
        continue;
      }
      if (!l.text) F('Beschriftung', `Link ohne Text/aria-label → ${l.href}`, url);
      if (l.blank && !/noopener|noreferrer/.test(l.rel) && l.abs && !l.abs.startsWith(origin)) F('Sicherheit', `"${l.text}" öffnet neuen Tab ohne rel="noopener"`, url);
      if (/^(mailto|tel):/i.test(l.href)) continue;
      // Sprungmarke auf derselben Seite
      if (l.href.startsWith('#') && !l.href.startsWith('#/')) {
        const id = decodeURIComponent(l.href.slice(1));
        if (id && !ids.has(id)) F('Sprungmarke', `"${l.text}" → ${l.href}: Ziel-Element existiert nicht`, url);
        continue;
      }
      if (!l.abs) continue;
      const list = linkIndex.get(l.abs) || [];
      list.push({ from: url, text: l.text });
      linkIndex.set(l.abs, list);
      if (l.abs.startsWith(origin) && !avoid.test(l.abs + ' ' + l.text)) queue.push(l.abs);
    }
  }

  // Nicht besuchte interne Ziele per Request prüfen; externe nur mit --external
  for (const [abs, refs] of linkIndex) {
    const key = abs.replace(/#(?!\/).*$/, '');
    const internal = abs.startsWith(origin);
    if (internal && visited.has(key)) {
      const v = visited.get(key);
      for (const p of v.problems) F('Linkziel', `"${refs[0].text}" → ${abs}: ${p}${refs.length > 1 ? ` (${refs.length} Links zeigen hierher)` : ''}`, refs[0].from);
      continue;
    }
    if (!internal && !args.external) continue;
    if (internal && avoid.test(abs)) continue;
    try {
      const r = await context.request.get(abs, { timeout: 10000, maxRedirects: 5 });
      if (r.status() >= 400) F('Linkziel', `"${refs[0].text}" → ${abs}: HTTP ${r.status()}`, refs[0].from);
    } catch (e) {
      F('Linkziel', `"${refs[0].text}" → ${abs}: nicht erreichbar (${e.message.split('\n')[0].slice(0, 80)})`, refs[0].from);
    }
  }

  writeJson(path.join(outDir, 'links.json'), { start, pages: [...visited.values()], links: Object.fromEntries(linkIndex), findings });
  console.log(`Navigation: ${visited.size} Seite(n) besucht, ${linkIndex.size} unterschiedliche Linkziele\n`);
  for (const v of visited.values()) console.log(`${v.problems.length ? '✘' : '✔'} ${v.url} (${v.status}) ${v.title ? '– ' + v.title : ''}`);
  const seen = new Set();
  console.log('');
  for (const f of findings) {
    const k = f.cat + f.msg;
    if (seen.has(k)) continue;
    seen.add(k);
    console.log(`  ! [${f.cat}] ${f.msg}  (auf ${f.where})`);
  }
  console.log(`\nGesamt: ${seen.size} Befunde. Details: ${path.join(outDir, 'links.json')}`);
  if (!args.external) console.log('Externe Links wurden nicht geprüft (--external).');
  await close();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
