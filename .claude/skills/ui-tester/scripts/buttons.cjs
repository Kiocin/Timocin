#!/usr/bin/env node
'use strict';
// T3 Buttons: Funktionieren alle Buttons? Sind sie richtig beschriftet? Haben sie die richtige Größe?
//  - Jeder Button wird einzeln in frischem Zustand geklickt; gemessen wird die Wirkung
//    (DOM-Änderung, Navigation, Request, Dialog, neues Fenster, Download) und ob JS-Fehler auftreten.
//  - Beschriftung: leer, nur Symbol, nichtssagend, Sprachmix (englisch in deutscher App), doppelt.
//  - Größe: < 24×24 px (WCAG 2.5.8), uneinheitliche Höhen in einer Button-Gruppe.
//
//   node buttons.cjs --url http://localhost:5173 [--pages /a,/b] [--avoid "regex"] [--all] [--max 60]
//                    [--browser webkit] [--viewport 375x667] [--out dir] [--storage-state …] [--cdp …]
//
// Standardmäßig werden Buttons mit "löschen|entfernen|delete|abmelden|logout|senden|bezahlen" NICHT geklickt
// (nur Beschriftung/Größe geprüft). Mit --all werden auch sie geklickt – nur in Testumgebungen!

const path = require('path');
const { parseArgs, ensureDir, defaultOutDir, openTarget, writeJson } = require('./_common.cjs');

const SEL = 'button, [role=button], input[type=submit], input[type=button], input[type=reset], a[class*=btn i], a[class*=button i]';

async function collect(page) {
  return page.evaluate((SEL) => {
    const lang = (document.documentElement.lang || '').toLowerCase();
    const out = [];
    let i = 0;
    for (const el of document.querySelectorAll(SEL)) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue;
      el.setAttribute('data-uitest-btn', String(i));
      const visibleText = (el.innerText || el.value || '').replace(/\s+/g, ' ').trim();
      const aria = (el.getAttribute('aria-label') || '').trim();
      const labelledby = el.getAttribute('aria-labelledby');
      const lbText = labelledby ? labelledby.split(/\s+/).map((id) => document.getElementById(id)?.innerText || '').join(' ').trim() : '';
      const title = (el.getAttribute('title') || '').trim();
      const imgAlt = [...el.querySelectorAll('img[alt],svg title')].map((x) => x.getAttribute?.('alt') || x.textContent).join(' ').trim();
      const name = aria || lbText || visibleText || imgAlt || title;
      // Gruppe = Elternelement; für Höhenvergleich
      out.push({
        idx: i++,
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || '',
        name,
        visibleText,
        hasAria: !!(aria || lbText),
        title,
        disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
        w: Math.round(r.width),
        h: Math.round(r.height),
        group: el.parentElement ? el.parentElement.tagName + (el.parentElement.id ? '#' + el.parentElement.id : '') + '|' + Math.round(el.parentElement.getBoundingClientRect().top) : '',
        inForm: !!el.closest('form'),
        lang,
        font: `${cs.fontFamily.split(',')[0]} ${cs.fontSize}`,
      });
    }
    return out;
  }, SEL);
}

function labelFindings(b, all) {
  const f = [];
  const symbolOnly = b.visibleText && !/[\p{L}\p{N}]/u.test(b.visibleText);
  if (!b.name) f.push('keine Beschriftung (weder Text noch aria-label)');
  else if (symbolOnly && !b.hasAria) f.push(`nur Symbol "${b.visibleText}" ohne aria-label${b.title ? ' (nur title, der auf Touch-Geräten nicht erscheint)' : ''}`);
  if (/^(ok|klick( hier)?|hier( klicken)?|button|submit|mehr|weiter|los|go|click( here)?)$/i.test(b.name)) f.push(`nichtssagende Beschriftung "${b.name}" – was passiert beim Klick?`);
  if (b.lang.startsWith('de') && /^(save|cancel|delete|submit|edit|close|add|remove|search|next|back|ok|yes|no|send|update|create)$/i.test(b.name)) f.push(`englische Beschriftung "${b.name}" in deutscher Oberfläche`);
  const same = all.filter((o) => o.name && o.name === b.name);
  if (b.name && same.length > 1 && same[0].idx === b.idx && !/bearbeiten|löschen|edit|delete|details|öffnen/i.test(b.name)) f.push(`Beschriftung "${b.name}" ${same.length}× vorhanden – eindeutig?`);
  return f;
}

function sizeFindings(b, all) {
  const f = [];
  if (b.w < 24 || b.h < 24) f.push(`zu klein: ${b.w}×${b.h}px (mindestens 24×24px, besser 44×44px auf Touch-Geräten)`);
  const group = all.filter((o) => o.group === b.group);
  if (group.length > 1 && group[0].idx === b.idx) {
    const hs = [...new Set(group.map((o) => o.h))];
    if (Math.max(...hs) - Math.min(...hs) > 4) f.push(`uneinheitliche Höhen in einer Button-Reihe: ${group.map((o) => `"${o.name || '?'}" ${o.h}px`).join(', ')}`);
    const fonts = [...new Set(group.map((o) => o.font))];
    if (fonts.length > 1) f.push(`uneinheitliche Schrift in einer Button-Reihe: ${group.map((o) => `"${o.name || '?'}" ${o.font}`).join(', ')}`);
  }
  return f;
}

async function clickAndObserve(page, context, idx) {
  const effects = [];
  const errors = [];
  const onReq = (r) => { if (!/\.(png|jpe?g|gif|svg|woff2?|ico)(\?|$)/.test(r.url())) effects.push(`Request ${r.method()} ${new URL(r.url()).pathname}`); };
  const onErr = (e) => errors.push(e.message);
  const onDialog = async (d) => { effects.push(`Dialog "${d.message().slice(0, 60)}"`); await d.dismiss().catch(() => {}); };
  const onPage = async (p) => { effects.push(`neues Fenster ${p.url()}`); await p.close().catch(() => {}); };
  const onDl = (d) => effects.push(`Download ${d.suggestedFilename()}`);
  page.on('request', onReq);
  page.on('pageerror', onErr);
  page.on('dialog', onDialog);
  page.on('download', onDl);
  context.on('page', onPage);
  const urlBefore = page.url();
  await page.evaluate(() => {
    window.__uiMut = 0;
    window.__uiObs && window.__uiObs.disconnect();
    window.__uiObs = new MutationObserver((ms) => {
      for (const m of ms) if (!(m.type === 'attributes' && m.attributeName && m.attributeName.startsWith('data-uitest'))) window.__uiMut++;
    });
    window.__uiObs.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    window.__uiFocus = document.activeElement;
  });
  let clickError = null;
  try {
    await page.locator(`[data-uitest-btn="${idx}"]`).click({ timeout: 3000 });
  } catch (e) {
    clickError = e.message.split('\n')[0];
  }
  await page.waitForTimeout(700);
  if (page.url() !== urlBefore) effects.push(`Navigation → ${page.url()}`);
  const mut = await page.evaluate(() => window.__uiMut || 0).catch(() => 0);
  if (mut > 0) effects.push(`${mut} Änderung(en) an der Seite`);
  page.off('request', onReq);
  page.off('pageerror', onErr);
  page.off('dialog', onDialog);
  page.off('download', onDl);
  context.off('page', onPage);
  return { effects: [...new Set(effects)], errors, clickError };
}

(async () => {
  const args = parseArgs();
  const outDir = ensureDir(path.resolve(args.out || defaultOutDir('buttons')));
  const avoid = new RegExp(args.avoid || 'lösch|entfern|delete|remove|abmeld|logout|log out|sign out|senden|send|bezahl|kaufen|pay|zurücksetzen|reset', 'i');
  const max = Number(args.max || 60);
  const { page, context, close } = await openTarget(args);
  const base = page.url();
  const urls = [base, ...String(args.pages || '').split(',').filter(Boolean).map((p) => new URL(p, base).href)];

  const results = [];
  for (const url of urls) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    const buttons = (await collect(page)).slice(0, max);
    for (const b of buttons) {
      const r = { url, ...b, label: labelFindings(b, buttons), size: sizeFindings(b, buttons) };
      if (b.disabled) r.click = { skipped: 'deaktiviert' };
      else if (!args.all && avoid.test(`${b.name} ${b.title}`)) r.click = { skipped: 'riskante Aktion (--all zum Klicken)' };
      else {
        // frischer Zustand für jeden Button
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
        await collect(page);
        r.click = await clickAndObserve(page, context, b.idx);
        if (r.click.errors.length || (!r.click.effects.length && !r.click.clickError) || r.click.clickError)
          await page.screenshot({ path: path.join(outDir, `button-${results.length}.png`) }).catch(() => {});
      }
      results.push(r);
    }
  }
  writeJson(path.join(outDir, 'buttons.json'), { results });

  let total = 0;
  console.log(`Buttons geprüft: ${results.length}\n`);
  for (const r of results) {
    const probs = [];
    if (r.click.clickError) probs.push(`nicht klickbar: ${r.click.clickError}`);
    else if (r.click.effects && !r.click.effects.length) probs.push('Klick ohne erkennbare Wirkung');
    if (r.click.errors && r.click.errors.length) probs.push(`JS-Fehler beim Klick: ${r.click.errors[0]}`);
    probs.push(...r.label, ...r.size);
    const head = `"${r.name || '(ohne Namen)'}" [${r.tag}${r.type ? ':' + r.type : ''}] ${r.w}×${r.h}`;
    if (probs.length) {
      total += probs.length;
      console.log(`✘ ${head}`);
      for (const p of probs) console.log(`    ! ${p}`);
    } else console.log(`✔ ${head} → ${r.click.skipped || r.click.effects.slice(0, 2).join(', ')}`);
    if (r.click.skipped && probs.length) console.log(`    (nicht geklickt: ${r.click.skipped})`);
  }
  console.log(`\nGesamt: ${total} Befunde. Details: ${path.join(outDir, 'buttons.json')}`);
  console.log('Hinweis: "Wirkung" heißt nur, dass etwas passiert – ob es das RICHTIGE ist, prüfen die Szenarien (T10).');
  await close();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
