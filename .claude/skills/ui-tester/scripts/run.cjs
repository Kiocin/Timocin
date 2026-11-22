#!/usr/bin/env node
'use strict';
// Führt ausgewählte Testarten nacheinander aus und schreibt eine gemeinsame Übersicht.
//
//   node run.cjs --url http://localhost:5173 [--tests T1,T5,T6,T7] [--szenarien ui-test-results/szenarien]
//                [--seeds 2] [--steps 200] [--pages /a,/b] [--sizes 375x667,1280x800] [--crawl 5]
//                [--avoid regex] [--ignore regex] [--storage-state auth.json] [--init-script mock.js]
//                [--cdp http://127.0.0.1:9222] [--headed] [--out dir]
//
// Automatische Testarten:  T1 Erkundung (inventory) · T5 Layout (viewports)
//                          T6 Barrierefreiheit (a11y) · T7 Chaos (monkey, je Seed ein Lauf)
// Mit --szenarien werden zusätzlich alle T*.cjs-Szenarien in dem Ordner ausgeführt
// (T2, T3, T4, T8, T9 … aus assets/szenario-vorlage.cjs).

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseArgs, ensureDir, timestamp, writeJson } = require('./_common.cjs');

const ALIASES = { erkundung: 'T1', layout: 'T5', fenster: 'T5', a11y: 'T6', barrierefreiheit: 'T6', chaos: 'T7', monkey: 'T7' };
const NAMES = {
  T1: 'Erkundung', T2: 'Funktion und Daten', T3: 'Persistenz', T4: 'Eingaben und Sicherheit', T5: 'Layout und Fenster',
  T6: 'Barrierefreiheit', T7: 'Robustheit und Chaos', T8: 'Netzwerk und Fehlerfälle', T9: 'Dateien und Dialoge',
};
const COMMON = ['url', 'cdp', 'storage-state', 'init-script', 'viewport', 'headed', 'ignore', 'locale'];

const args = parseArgs();
const tests = String(args.tests || 'T1,T5,T6,T7')
  .split(',')
  .map((t) => t.trim())
  .map((t) => ALIASES[t.toLowerCase()] || t.toUpperCase());
const outDir = ensureDir(path.resolve(args.out || path.join(process.cwd(), 'ui-test-results', `lauf-${timestamp()}`)));

function pass(keys) {
  const out = [];
  for (const k of keys) {
    if (args[k] === undefined) continue;
    out.push(`--${k}`);
    if (args[k] !== true) out.push(String(args[k]));
  }
  return out;
}

function run(label, script, extra, dir) {
  console.log(`\n────────── ${label} ──────────`);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, script), ...pass(COMMON), ...extra, '--out', dir], { stdio: 'inherit' });
  return { exit: r.status, sec: Math.round((Date.now() - t0) / 1000) };
}

const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (_) {
    return null;
  }
};

const summary = []; // { testart, titel, status, befunde: [..], details }

if (tests.includes('T1')) {
  const dir = path.join(outDir, 'T1-erkundung');
  const r = run('T1 Erkundung', 'inventory.cjs', pass(['crawl']), dir);
  const j = readJson(path.join(dir, 'inventory.json'));
  summary.push({
    testart: 'T1',
    status: j ? 'ok' : 'fehlgeschlagen',
    sec: r.sec,
    info: j ? `${j.pages.length} Seite(n), ${j.pages.reduce((s, p) => s + p.elements.length, 0)} Bedienelemente, ${j.pages.reduce((s, p) => s + p.forms.length, 0)} Formulare` : '',
    befunde: j ? j.issues.map((i) => `[${i.type}] ${i.message}`) : [`Skript beendet mit Code ${r.exit}`],
    details: path.relative(outDir, path.join(dir, 'inventory.json')),
  });
}

if (tests.includes('T5')) {
  const dir = path.join(outDir, 'T5-layout');
  const r = run('T5 Layout und Fenster', 'viewports.cjs', pass(['sizes']), dir);
  const j = readJson(path.join(dir, 'viewports.json'));
  const befunde = [];
  if (j) {
    for (const v of j.results) {
      if (v.horizontalOverflowPx) befunde.push(`${v.size}: horizontaler Überlauf ${v.horizontalOverflowPx}px (${v.outsideViewport[0] || ''})`);
      for (const c of v.clippedText) befunde.push(`${v.size}: abgeschnitten ${c}`);
      if (v.smallTouchTargets.length) befunde.push(`${v.size}: ${v.smallTouchTargets.length} zu kleine Touch-Ziele (${v.smallTouchTargets[0]})`);
    }
    for (const e of j.errors) befunde.push(`[${e.type}] ${e.message}`);
  } else befunde.push(`Skript beendet mit Code ${r.exit}`);
  summary.push({ testart: 'T5', status: j ? 'ok' : 'fehlgeschlagen', sec: r.sec, info: j ? `${j.results.length} Fenstergrößen` : '', befunde, details: path.relative(outDir, dir) + '/ (Screenshots ansehen!)' });
}

if (tests.includes('T6')) {
  const dir = path.join(outDir, 'T6-barrierefreiheit');
  const r = run('T6 Barrierefreiheit', 'a11y.cjs', pass(['pages', 'level', 'tabs', 'axe-path']), dir);
  const j = readJson(path.join(dir, 'a11y.json'));
  const befunde = [];
  if (j) {
    for (const p of j.results) {
      if (p.axe && p.axe.violations) for (const v of p.axe.violations) befunde.push(`[axe/${v.impact}] ${v.id}: ${v.help} (${v.count}×) @ ${p.url}`);
      if (!p.axe) befunde.push('axe-core nicht installiert – nur Tastatur-Check (npm i -D axe-core)');
      for (const f of p.keyboard.findings) befunde.push(`[Tastatur] ${f} @ ${p.url}`);
    }
  } else befunde.push(`Skript beendet mit Code ${r.exit}`);
  summary.push({ testart: 'T6', status: j ? 'ok' : 'fehlgeschlagen', sec: r.sec, info: j ? `${j.results.length} Seite(n), ${j.level}` : '', befunde, details: path.relative(outDir, path.join(dir, 'a11y.json')) });
}

if (tests.includes('T7')) {
  const seeds = Number(args.seeds || 2);
  const befunde = [];
  let sec = 0;
  const reports = [];
  for (let s = 1; s <= seeds; s++) {
    const dir = path.join(outDir, `T7-chaos-seed${s}`);
    const r = run(`T7 Chaos (Seed ${s}/${seeds})`, 'monkey.cjs', [...pass(['steps', 'avoid', 'minutes', 'delay', 'no-resize', 'no-nav', 'allow-external']), '--seed', String(s)], dir);
    sec += r.sec;
    const j = readJson(path.join(dir, 'report.json'));
    if (!j) {
      befunde.push(`Seed ${s}: Skript beendet mit Code ${r.exit}`);
      continue;
    }
    reports.push(path.relative(outDir, path.join(dir, 'report.md')));
    for (const i of j.issues) befunde.push(`[${i.type}] ${i.message.slice(0, 200)} (Seed ${s}, Schritt ${i.firstStep}, ${i.count}×)`);
  }
  summary.push({ testart: 'T7', status: reports.length ? 'ok' : 'fehlgeschlagen', sec, info: `${seeds} Lauf/Läufe`, befunde, details: reports.join(', ') });
}

if (args.szenarien) {
  const dir = path.resolve(String(args.szenarien));
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^T\d+.*\.cjs$/.test(f)).sort() : [];
  if (!files.length) console.log(`\nKeine Szenarien (T*.cjs) in ${dir} gefunden.`);
  const env = {
    ...process.env,
    ...(args.url ? { APP_URL: String(args.url) } : {}),
    ...(args.cdp ? { CDP: String(args.cdp) } : {}),
    ...(args['storage-state'] ? { STORAGE_STATE: path.resolve(String(args['storage-state'])) } : {}),
    ...(args['init-script'] ? { INIT_SCRIPT: path.resolve(String(args['init-script'])) } : {}),
    ...(args.headed ? { HEADED: '1' } : {}),
  };
  const byType = {};
  for (const f of files) {
    console.log(`\n────────── Szenario ${f} ──────────`);
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: 'inherit', env });
    const j = readJson(path.join(dir, f.replace(/\.cjs$/, '.json')));
    const t = (f.match(/^(T\d+)/) || [])[1];
    const e = (byType[t] = byType[t] || { testart: t, status: 'ok', sec: 0, ok: 0, total: 0, befunde: [], details: [] });
    e.sec += Math.round((Date.now() - t0) / 1000);
    e.details.push(path.relative(outDir, path.join(dir, f)));
    if (!j) {
      e.status = 'fehlgeschlagen';
      e.befunde.push(`${f}: Skript abgebrochen (Code ${r.status})`);
      continue;
    }
    e.ok += j.results.filter((x) => x.ok).length;
    e.total += j.results.length;
    for (const x of j.results.filter((x) => !x.ok)) e.befunde.push(`${x.name}: ${x.error}`);
    for (const x of j.errors) e.befunde.push(`[während ${f}] ${x}`);
  }
  for (const e of Object.values(byType)) summary.push({ ...e, info: `${e.ok}/${e.total} Prüfungen ok`, details: e.details.join(', ') });
}

summary.sort((a, b) => Number(a.testart.slice(1)) - Number(b.testart.slice(1)));
writeJson(path.join(outDir, 'uebersicht.json'), { url: args.url || args.cdp, zeit: new Date().toISOString(), testarten: summary });

const md = [
  '# UI-Testlauf – Übersicht',
  '',
  `- Ziel: ${args.url || args.cdp}`,
  `- Zeit: ${new Date().toLocaleString('de-DE')}`,
  '',
  '| Testart | Ergebnis | Befunde | Dauer |',
  '|---|---|---|---|',
  ...summary.map((s) => `| ${s.testart} ${NAMES[s.testart] || ''} | ${s.status === 'ok' ? s.info : '⚠ ' + s.status} | ${s.befunde.length} | ${s.sec}s |`),
  '',
  ...summary.flatMap((s) => [
    `## ${s.testart} ${NAMES[s.testart] || ''}`,
    '',
    s.befunde.length ? s.befunde.map((b) => `- ${b}`).join('\n') : '- keine automatischen Befunde',
    '',
    `Details: ${s.details}`,
    '',
  ]),
  '> Automatische Befunde sind Rohdaten: vor dem Bericht verifizieren, Falschmeldungen aussortieren, Screenshots ansehen.',
].join('\n');
fs.writeFileSync(path.join(outDir, 'uebersicht.md'), md + '\n', 'utf8');

console.log('\n══════════ Übersicht ══════════');
for (const s of summary) console.log(`${(s.testart + ' ' + (NAMES[s.testart] || '')).padEnd(30)} ${String(s.befunde.length).padStart(3)} Befunde  ${s.status === 'ok' ? s.info : '⚠ ' + s.status}`);
console.log(`\n${path.join(outDir, 'uebersicht.md')}`);
