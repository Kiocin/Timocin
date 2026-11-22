#!/usr/bin/env node
'use strict';
// T6 Tabellen: korrekte Darstellung, Überschneidungen, fixierte Bereiche (oben und links).
//  - Struktur: Spaltenzahl Kopf vs. Zeilen, leere Spaltenköpfe
//  - abgeschnittene Zellen, Zellen die sich überdecken
//  - Spaltenformate: Zahlen rechtsbündig? einheitliches Datumsformat?
//  - Scrollen in der Tabelle (vertikal + horizontal) und messen:
//      bleibt die fixierte Kopfzeile oben, die fixierte Spalte links?
//      sind ALLE Zellen der fixierten Spalte fixiert (sonst verrutscht die Kopfzelle)?
//      haben fixierte Zellen einen Hintergrund (sonst scheint Inhalt durch)?
//      liegt etwas über der Kopfzeile / Eckzelle (z-index)?
//
//   node tables.cjs --url http://localhost:5173 [--pages /a,/b] [--browser webkit] [--out dir] [--storage-state …]

const path = require('path');
const { parseArgs, ensureDir, defaultOutDir, openTarget, writeJson } = require('./_common.cjs');

function analyzeTables() {
  const describe = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    else if (el.classList.length) s += '.' + [...el.classList].slice(0, 2).join('.');
    return s;
  };
  const transparent = (el) => {
    // Hintergrund des Elements oder seiner Zeile/Gruppe (bis zur Tabelle)
    for (let e = el; e && !['TABLE', 'BODY'].includes(e.tagName); e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage !== 'none') return false;
      const m = cs.backgroundColor.match(/rgba?\(([^)]+)\)/);
      if (m) {
        const parts = m[1].split(',').map((x) => parseFloat(x));
        if (parts.length < 4 || parts[3] > 0.9) return false;
      }
    }
    return true;
  };
  const scroller = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll)/.test(cs.overflowX + cs.overflowY) && (p.scrollHeight > p.clientHeight + 1 || p.scrollWidth > p.clientWidth + 1)) return p;
    }
    return document.scrollingElement;
  };
  const tables = [...document.querySelectorAll('table,[role=grid],[role=table]')].filter((t) => t.getBoundingClientRect().width > 0);
  return tables.map((t, ti) => {
    t.setAttribute('data-uitest-table', String(ti));
    const isHtml = t.tagName === 'TABLE';
    const rows = isHtml ? [...t.rows] : [...t.querySelectorAll('[role=row]')];
    const cellsOf = (r) => (isHtml ? [...r.cells] : [...r.querySelectorAll('[role=cell],[role=gridcell],[role=columnheader],[role=rowheader]')]);
    const width = (r) => cellsOf(r).reduce((s, c) => s + (Number(c.colSpan) || 1), 0);
    const headRows = isHtml ? (t.tHead ? [...t.tHead.rows] : rows.filter((r) => [...r.cells].every((c) => c.tagName === 'TH'))) : rows.filter((r) => r.querySelector('[role=columnheader]'));
    const bodyRows = rows.filter((r) => !headRows.includes(r));
    const headerCells = headRows.length ? cellsOf(headRows[headRows.length - 1]) : [];
    const headerTexts = headerCells.map((c) => c.innerText.replace(/\s+/g, ' ').trim());
    const findings = [];
    const F = (cat, msg) => findings.push({ cat, msg });

    // Struktur
    const hw = headRows.length ? width(headRows[headRows.length - 1]) : null;
    const widths = bodyRows.map(width);
    const odd = widths.filter((w) => hw !== null && w !== hw && w > 1);
    if (odd.length) F('Struktur', `${odd.length} Zeile(n) haben ${[...new Set(odd)].join('/')} Zellen, Kopfzeile hat ${hw}`);
    if (!headRows.length && bodyRows.length) F('Struktur', 'keine Kopfzeile (th/thead) – Spalten haben keine Überschriften für Screenreader');
    const empty = headerTexts.filter((x, i) => !x && !headerCells[i].getAttribute('aria-label')).length;
    if (empty) F('Struktur', `${empty} Spaltenkopf/-köpfe ohne Text`);

    // Abgeschnittene Zellen
    let clipped = 0;
    const clippedEx = [];
    for (const c of t.querySelectorAll('th,td,[role=cell],[role=gridcell],[role=columnheader]')) {
      const cs = getComputedStyle(c);
      if (c.scrollWidth > c.clientWidth + 1 && (/(hidden|clip)/.test(cs.overflowX) || cs.textOverflow === 'ellipsis')) {
        clipped++;
        if (clippedEx.length < 3) clippedEx.push(c.innerText.trim().slice(0, 30) + (c.title ? ' (Tooltip vorhanden)' : ''));
      }
    }
    if (clipped) F('Abgeschnitten', `${clipped} Zelle(n) abgeschnitten, z. B. ${clippedEx.map((x) => `"${x}"`).join(', ')}`);

    // Spaltenformate
    headerTexts.forEach((h, ci) => {
      const vals = bodyRows.map((r) => cellsOf(r)[ci]).filter(Boolean);
      const texts = vals.map((c) => c.innerText.trim()).filter(Boolean);
      if (texts.length < 3) return;
      const numeric = texts.filter((x) => /^-?[\d.,\s]+(\s?(€|%|h|std|min))?$/i.test(x)).length / texts.length;
      if (numeric > 0.8) {
        const align = getComputedStyle(vals[0]).textAlign;
        if (!['right', 'end'].includes(align)) F('Format', `Spalte "${h}": Zahlen sind ${align === 'center' ? 'zentriert' : 'linksbündig'} – rechtsbündig ist lesbarer`);
        const dec = new Set(texts.map((x) => (x.match(/[.,](\d+)\D*$/) || [, ''])[1].length));
        if (dec.size > 1) F('Format', `Spalte "${h}": uneinheitliche Nachkommastellen (${[...dec].join('/')})`);
        if (texts.some((x) => /\d\.\d/.test(x)) && document.documentElement.lang.startsWith('de')) F('Format', `Spalte "${h}": Dezimalpunkt statt Komma (deutsche Oberfläche)`);
      }
      const formats = new Set(texts.map((x) => (/^\d{4}-\d{2}-\d{2}/.test(x) ? 'JJJJ-MM-TT' : /^\d{1,2}\.\d{1,2}\.\d{2,4}/.test(x) ? 'TT.MM.JJJJ' : /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(x) ? 'MM/TT/JJJJ' : null)).filter(Boolean));
      if (formats.size > 1) F('Format', `Spalte "${h}": gemischte Datumsformate (${[...formats].join(', ')})`);
      else if (formats.has('JJJJ-MM-TT') && document.documentElement.lang.startsWith('de')) F('Format', `Spalte "${h}": Datum im ISO-Format JJJJ-MM-TT statt TT.MM.JJJJ`);
      else if (formats.has('MM/TT/JJJJ')) F('Format', `Spalte "${h}": amerikanisches Datumsformat`);
    });

    // Fixierte Zellen erfassen
    const sticky = [...t.querySelectorAll('th,td,[role=cell],[role=gridcell],[role=columnheader],[role=rowheader],thead,tr')].filter((c) => getComputedStyle(c).position === 'sticky');
    const stickyTop = sticky.filter((c) => getComputedStyle(c).top !== 'auto');
    const stickyLeft = sticky.filter((c) => getComputedStyle(c).left !== 'auto');
    for (const c of sticky) if (['TH', 'TD'].includes(c.tagName) && transparent(c)) { F('Fixiert', `fixierte Zelle ${describe(c)} "${c.innerText.trim().slice(0, 20)}" hat keinen Hintergrund – beim Scrollen scheint Inhalt durch`); break; }
    // Fixierte Spalte: sind alle Zellen dieser Spalte fixiert?
    const leftCols = new Set(stickyLeft.filter((c) => c.cellIndex !== undefined).map((c) => c.cellIndex));
    for (const ci of leftCols) {
      const colCells = rows.map((r) => cellsOf(r)[ci]).filter(Boolean);
      const notSticky = colCells.filter((c) => getComputedStyle(c).position !== 'sticky' || getComputedStyle(c).left === 'auto');
      if (notSticky.length) F('Fixiert', `Spalte ${ci + 1} ("${headerTexts[ci] || ''}") ist nur teilweise fixiert: ${notSticky.length} von ${colCells.length} Zellen scrollen mit – Kopf und Inhalt verrutschen gegeneinander`);
    }
    const sc = scroller(t);
    sc.setAttribute('data-uitest-scroller', String(ti));
    const scR = sc === document.scrollingElement ? { top: 0, left: 0 } : sc.getBoundingClientRect();
    return {
      index: ti,
      el: describe(t),
      rows: bodyRows.length,
      cols: hw ?? (widths[0] || 0),
      headers: headerTexts,
      scroller: sc === document.scrollingElement ? 'Seite' : describe(sc),
      canScrollY: sc.scrollHeight > sc.clientHeight + 1,
      canScrollX: sc.scrollWidth > sc.clientWidth + 1,
      stickyTop: stickyTop.length,
      stickyLeft: stickyLeft.length,
      scrollerTop: scR.top,
      scrollerLeft: scR.left,
      findings,
    };
  });
}

// Nach dem Scrollen: wo stehen Kopfzeile und erste Spalte? Was liegt oben?
function measureAfterScroll(ti) {
  const t = document.querySelector(`[data-uitest-table="${ti}"]`);
  const sc = document.querySelector(`[data-uitest-scroller="${ti}"]`) || document.scrollingElement;
  const scR = sc === document.scrollingElement || sc === document.documentElement ? { top: 0, left: 0 } : sc.getBoundingClientRect();
  const head = t.tHead ? t.tHead.rows[t.tHead.rows.length - 1] : t.rows[0];
  const out = { findings: [] };
  if (!head) return out;
  const ths = [...head.cells];
  const firstTh = ths[0];
  const stickyTopTh = ths.filter((c) => getComputedStyle(c).position === 'sticky' && getComputedStyle(c).top !== 'auto');
  if (stickyTopTh.length) {
    const r = stickyTopTh[stickyTopTh.length - 1].getBoundingClientRect();
    out.headerOffset = Math.round(r.top - scR.top);
    if (Math.abs(out.headerOffset - (parseFloat(getComputedStyle(stickyTopTh[0]).top) || 0)) > 3) out.findings.push(`fixierte Kopfzeile bleibt nicht oben (steht ${out.headerOffset}px unter dem Rand des Scrollbereichs)`);
    // Liegt etwas über der Kopfzeile?
    for (const th of stickyTopTh.slice(0, 8)) {
      if (getComputedStyle(th).left !== 'auto') continue; // Eckzelle wird unten separat geprüft
      const rr = th.getBoundingClientRect();
      if (rr.right < scR.left || rr.width === 0) continue;
      const top = document.elementFromPoint(Math.max(rr.left + 4, scR.left + 4), rr.top + rr.height / 2);
      if (top && !th.contains(top) && top !== th && t.contains(top)) { out.findings.push(`Kopfzelle "${th.innerText.trim().slice(0, 20)}" wird beim Scrollen von Tabelleninhalt überdeckt (z-index)`); break; }
    }
  }
  // Fixierte erste Spalte
  const body = t.tBodies[0];
  const firstBody = body && body.rows[0] ? body.rows[0].cells[0] : null;
  if (firstTh && getComputedStyle(firstTh).position === 'sticky' && getComputedStyle(firstTh).left !== 'auto') {
    out.firstHeaderLeft = Math.round(firstTh.getBoundingClientRect().left - scR.left);
    if (firstBody) out.firstBodyLeft = Math.round(firstBody.getBoundingClientRect().left - scR.left);
    if (out.firstBodyLeft !== undefined && Math.abs(out.firstHeaderLeft - out.firstBodyLeft) > 2) out.findings.push(`nach horizontalem Scrollen: Kopfzelle der ersten Spalte bei x=${out.firstHeaderLeft}, Datenzellen bei x=${out.firstBodyLeft} – verrutscht`);
    // Eckzelle: muss über beiden fixierten Bereichen liegen
    const r = firstTh.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (top && top !== firstTh && !firstTh.contains(top)) out.findings.push('Eckzelle (oben links) wird beim Scrollen überdeckt – z-index der Eckzelle zu niedrig');
  } else if (firstBody && getComputedStyle(firstBody).position === 'sticky') out.findings.push('erste Spalte ist nur in den Datenzeilen fixiert, nicht im Kopf');
  return out;
}

(async () => {
  const args = parseArgs();
  const outDir = ensureDir(path.resolve(args.out || defaultOutDir('tables')));
  const { page, close } = await openTarget(args);
  const base = page.url();
  const urls = [base, ...String(args.pages || '').split(',').filter(Boolean).map((p) => new URL(p, base).href)];
  const results = [];
  for (const url of urls) {
    if (page.url() !== url) await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
    const tables = await page.evaluate(analyzeTables);
    for (const t of tables) {
      const tag = `${results.length}`;
      await page.locator(`[data-uitest-table="${t.index}"]`).scrollIntoViewIfNeeded().catch(() => {});
      await page.locator(`[data-uitest-table="${t.index}"]`).screenshot({ path: path.join(outDir, `tabelle-${tag}-start.png`) }).catch(() => {});
      // Scrollen: erst vertikal, dann horizontal
      await page.evaluate(({ ti, y, x }) => {
        const sc = document.querySelector(`[data-uitest-scroller="${ti}"]`) || document.scrollingElement;
        sc.scrollTop += y;
        sc.scrollLeft += x;
      }, { ti: t.index, y: t.canScrollY ? 120 : 0, x: t.canScrollX ? 250 : 0 });
      await page.waitForTimeout(250);
      const after = await page.evaluate(measureAfterScroll, t.index);
      await page.screenshot({ path: path.join(outDir, `tabelle-${tag}-gescrollt.png`) }).catch(() => {});
      for (const f of after.findings) t.findings.push({ cat: 'Fixiert', msg: f });
      if (t.canScrollY && !t.stickyTop && t.rows > 10) t.findings.push({ cat: 'Hinweis', msg: `${t.rows} Zeilen, Kopfzeile scrollt mit weg – fixierte Kopfzeile erwägen` });
      if (t.canScrollX && !t.stickyLeft && t.cols > 6) t.findings.push({ cat: 'Hinweis', msg: `horizontal scrollbar, erste Spalte scrollt mit weg – fixierte erste Spalte erwägen` });
      if (t.rows > 300) t.findings.push({ cat: 'Hinweis', msg: `${t.rows} Zeilen ohne Seitenaufteilung – Performance prüfen (T15)` });
      results.push({ url, ...t, afterScroll: after });
      await page.evaluate((ti) => { const sc = document.querySelector(`[data-uitest-scroller="${ti}"]`) || document.scrollingElement; sc.scrollTop = 0; sc.scrollLeft = 0; }, t.index);
    }
  }
  writeJson(path.join(outDir, 'tables.json'), { results });
  let total = 0;
  for (const r of results) {
    console.log(`\n=== Tabelle ${r.el} @ ${r.url}: ${r.rows} Zeilen × ${r.cols} Spalten, Scrollbereich: ${r.scroller}${r.canScrollX ? ' ↔' : ''}${r.canScrollY ? ' ↕' : ''}, fixiert: oben ${r.stickyTop ? 'ja' : 'nein'}, links ${r.stickyLeft ? 'ja' : 'nein'}`);
    for (const f of r.findings) { if (f.cat !== 'Hinweis') total++; console.log(`  ${f.cat === 'Hinweis' ? 'ℹ' : '!'} [${f.cat}] ${f.msg}`); }
    if (!r.findings.length) console.log('  ✔ keine Befunde');
  }
  if (!results.length) console.log('Keine Tabellen gefunden.');
  console.log(`\nGesamt: ${total} Befunde. Screenshots vor/nach dem Scrollen: ${outDir}`);
  await close();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
