#!/usr/bin/env node
'use strict';
// T8 Design-Konsistenz: Passen Farben, Schriftarten, Schriftgrößen, Abstände und Größen zusammen?
// Sammelt die berechneten Stile aller sichtbaren Elemente (über mehrere Seiten) und meldet Ausreißer:
//  - Schriftarten, die nur vereinzelt vorkommen; zu viele Schriftgrößen; krumme Größen (15.5px)
//  - fast gleiche, aber nicht identische Farben (#333 vs. #343434) → fehlende Farbpalette
//  - Abstände außerhalb eines 4px-Rasters; viele verschiedene Eckenradien
//  - Buttons/Felder in vielen Varianten (Höhe, Radius, Schrift)
//  - zu kleine Schrift (< 12px), zu enger Zeilenabstand
// Kontraste prüft T9 (a11y.cjs). Das Auge entscheidet am Ende: Screenshots ansehen.
//
//   node design.cjs --url http://localhost:5173 [--pages /a,/b] [--grid 4] [--out dir] [--storage-state …]

const path = require('path');
const { parseArgs, ensureDir, defaultOutDir, openTarget, writeJson } = require('./_common.cjs');

function collectStyles() {
  const describe = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    else if (el.classList.length) s += '.' + [...el.classList].slice(0, 2).join('.');
    const t = (el.innerText || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 25);
    return t ? `${s} "${t}"` : s;
  };
  const items = [];
  for (const el of document.body.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const kind = el.matches('button,[role=button],input[type=submit],input[type=button]') ? 'button' : el.matches('input:not([type=checkbox]):not([type=radio]):not([type=hidden]),select,textarea') ? 'field' : hasText ? 'text' : 'box';
    items.push({
      el: describe(el),
      kind,
      font: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(),
      size: parseFloat(cs.fontSize),
      weight: cs.fontWeight,
      lineHeight: cs.lineHeight === 'normal' ? null : parseFloat(cs.lineHeight),
      color: cs.color,
      bg: cs.backgroundColor,
      border: cs.borderTopWidth !== '0px' && cs.borderTopStyle !== 'none' ? cs.borderTopColor : null,
      radius: cs.borderTopLeftRadius,
      spacing: [cs.marginTop, cs.marginBottom, cs.marginLeft, cs.marginRight, cs.paddingTop, cs.paddingBottom, cs.paddingLeft, cs.paddingRight, cs.gap].filter((v) => v && v !== '0px' && v !== 'normal' && v !== 'auto').map(parseFloat),
      h: Math.round(r.height),
      padX: cs.paddingLeft,
    });
  }
  return { lang: document.documentElement.lang, items };
}

const rgb = (c) => {
  const m = c && c.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
  if (p.length > 3 && p[3] === 0) return null; // transparent
  return p.slice(0, 3);
};
const hex = (p) => '#' + p.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
const dist = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
const count = (arr) => arr.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());
const top = (m, n = 10) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

(async () => {
  const args = parseArgs();
  const outDir = ensureDir(path.resolve(args.out || defaultOutDir('design')));
  const grid = Number(args.grid || 4);
  const { page, close } = await openTarget(args);
  const base = page.url();
  const urls = [base, ...String(args.pages || '').split(',').filter(Boolean).map((p) => new URL(p, base).href)];
  let items = [];
  for (const [i, url] of urls.entries()) {
    if (page.url() !== url) await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    const r = await page.evaluate(collectStyles);
    items = items.concat(r.items.map((x) => ({ ...x, url })));
    await page.screenshot({ path: path.join(outDir, `seite-${i}.png`), fullPage: true }).catch(() => {});
  }
  const text = items.filter((x) => x.kind !== 'box');
  const findings = [];
  const F = (cat, msg) => findings.push({ cat, msg });

  // Schriftarten
  const fonts = count(text.map((x) => x.font));
  const mainFont = top(fonts, 1)[0];
  for (const [f, n] of fonts) {
    if (f === mainFont[0]) continue;
    const share = n / text.length;
    if (share < 0.1) F('Schriftart', `"${f}" nur bei ${n} Element(en), z. B. ${text.filter((x) => x.font === f).slice(0, 3).map((x) => x.el).join(', ')} (Hauptschrift: "${mainFont[0]}")`);
  }
  if (fonts.size > 3) F('Schriftart', `${fonts.size} verschiedene Schriftarten: ${[...fonts.keys()].join(', ')} – üblich sind 1–2`);

  // Schriftgrößen
  const sizes = count(text.map((x) => x.size));
  if (sizes.size > 8) F('Schriftgröße', `${sizes.size} verschiedene Schriftgrößen (${[...sizes.keys()].sort((a, b) => a - b).join(', ')}px) – eine feste Skala mit 5–7 Stufen wirkt ruhiger`);
  for (const [s, n] of sizes) {
    // 13.333px ist die Browser-Standardgröße für Buttons/Felder – kein Ausreißer
    if (s % 1 !== 0 && Math.abs(s - 13.3333) > 0.01) F('Schriftgröße', `krumme Größe ${s}px bei ${text.filter((x) => x.size === s).slice(0, 3).map((x) => x.el).join(', ')}`);
    if (s < 12) F('Schriftgröße', `sehr kleine Schrift ${s}px bei ${n} Element(en), z. B. ${text.find((x) => x.size === s).el}`);
  }
  for (const x of text) if (x.lineHeight && x.kind === 'text' && x.lineHeight < x.size * 1.15 && x.h > x.size * 2) { F('Zeilenabstand', `enger Zeilenabstand ${x.lineHeight}px bei ${x.size}px Schrift: ${x.el}`); break; }

  // Farben: fast gleiche Farben
  const colorList = [...count(items.flatMap((x) => [x.color, x.bg, x.border]).map(rgb).filter(Boolean).map(hex)).entries()];
  const similar = [];
  for (let i = 0; i < colorList.length; i++)
    for (let j = i + 1; j < colorList.length; j++) {
      const a = colorList[i][0], b = colorList[j][0];
      const d = dist(rgb(`rgb(${parseInt(a.slice(1, 3), 16)},${parseInt(a.slice(3, 5), 16)},${parseInt(a.slice(5, 7), 16)})`), rgb(`rgb(${parseInt(b.slice(1, 3), 16)},${parseInt(b.slice(3, 5), 16)},${parseInt(b.slice(5, 7), 16)})`));
      if (d > 0 && d < 12) similar.push(`${a} (${colorList[i][1]}×) ≈ ${b} (${colorList[j][1]}×)`);
    }
  if (similar.length) F('Farbe', `fast gleiche Farben – vermutlich unbeabsichtigt: ${similar.slice(0, 6).join('; ')}`);
  const textColors = count(text.map((x) => rgb(x.color)).filter(Boolean).map(hex));
  if (textColors.size > 8) F('Farbe', `${textColors.size} verschiedene Textfarben – Farbpalette prüfen`);
  // Einzelne Ausreißer-Farben bei Buttons
  const btns = items.filter((x) => x.kind === 'button');
  const btnBg = count(btns.map((x) => (rgb(x.bg) ? hex(rgb(x.bg)) : 'transparent')));
  if (btnBg.size > 3) F('Farbe', `Buttons in ${btnBg.size} Hintergrundfarben: ${top(btnBg).map(([c, n]) => `${c} (${n}×)`).join(', ')}`);

  // Abstände im Raster
  const spacing = items.flatMap((x) => x.spacing).filter((v) => v > 0 && v < 200);
  const off = spacing.filter((v) => Math.abs(v / grid - Math.round(v / grid)) > 0.01 && v > 2);
  if (spacing.length && off.length / spacing.length > 0.15) {
    const offCount = top(count(off), 8).map(([v, n]) => `${v}px (${n}×)`).join(', ');
    F('Abstand', `${Math.round((off.length / spacing.length) * 100)}% der Abstände liegen nicht im ${grid}px-Raster: ${offCount}`);
  }
  const spacingValues = count(spacing);
  if (spacingValues.size > 15) F('Abstand', `${spacingValues.size} verschiedene Abstandswerte – einheitliche Abstandsstufen fehlen`);
  const radii = count(items.filter((x) => x.kind !== 'text' && x.radius !== '0px').map((x) => x.radius));
  if (radii.size > 4) F('Ecken', `${radii.size} verschiedene Eckenradien: ${top(radii).map(([r, n]) => `${r} (${n}×)`).join(', ')}`);

  // Varianten von Buttons und Feldern
  const variant = (x) => `Höhe ${x.h}px, ${x.size}px ${x.font}, Radius ${x.radius}`;
  for (const [kind, label] of [['button', 'Buttons'], ['field', 'Eingabefelder']]) {
    const v = count(items.filter((x) => x.kind === kind).map(variant));
    if (v.size > 3) F('Komponenten', `${label} in ${v.size} Varianten: ${top(v, 6).map(([k, n]) => `${k} (${n}×)`).join('; ')}`);
  }

  const summary = {
    schriftarten: top(fonts).map(([f, n]) => `${f} (${n}×)`),
    schriftgroessen: [...sizes.keys()].sort((a, b) => a - b),
    textfarben: top(textColors).map(([c, n]) => `${c} (${n}×)`),
    abstaende: top(spacingValues, 12).map(([v, n]) => `${v}px (${n}×)`),
  };
  writeJson(path.join(outDir, 'design.json'), { summary, findings, items });
  console.log('Design-Übersicht');
  console.log(`  Schriftarten:   ${summary.schriftarten.join(', ')}`);
  console.log(`  Schriftgrößen:  ${summary.schriftgroessen.join(', ')} px`);
  console.log(`  Textfarben:     ${summary.textfarben.join(', ')}`);
  console.log(`  Häufigste Abstände: ${summary.abstaende.join(', ')}\n`);
  for (const f of findings) console.log(`  ! [${f.cat}] ${f.msg}`);
  console.log(`\nGesamt: ${findings.length} Befunde. Screenshots: ${outDir}`);
  console.log('Hinweis: Ob Farben und Abstände "passen", entscheidet das Auge – Screenshots ansehen und mit Styleguide/Design-Vorgabe vergleichen.');
  await close();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
