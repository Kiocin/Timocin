#!/usr/bin/env node
'use strict';
// Führt ausgewählte Testarten nacheinander aus und schreibt eine gemeinsame Übersicht.
//
//   node run.cjs --url http://localhost:5173 [--tests T1,T2,T3,T4,T5,T6,T8,T9,T13] [--browsers chromium,webkit]
//                [--szenarien ui-test-results/szenarien] [--pages /a,/b] [--seeds 2] [--steps 200]
//                [--api-base http://localhost:3000 --endpoints "…" | --spec openapi.json] [--auth "Authorization: Bearer …"] [--write]
//                [--sqlite app.db | --postgres URL] [--project .] [--storage-state auth.json] [--init-script mock.js]
//                [--cdp http://127.0.0.1:9222] [--no-submit] [--out dir]
//
// Testarten mit Skript: T1 Erkundung · T2 Layout · T3 Buttons · T4 Formulare · T5 Navigation · T6 Tabellen
//   T8 Design · T9 Barrierefreiheit · T11 Datenbank · T12 API · T13 Chaos · T15 Performance · T16 Security
// Nur Szenarien (assets/szenario-vorlage.cjs, Präfix T<n>-): T7 Fehlermeldungen · T10 CRUD · T14 Dateien (+ Ergänzungen zu allen)
// Standard: T1,T2,T3,T4,T5,T6,T8,T9,T13,T15,T16 (T11/T12 nur, wenn Datenbank/API angegeben)

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseArgs, ensureDir, timestamp, writeJson } = require('./_common.cjs');

const NAMES = {
  T1: 'Erkundung', T2: 'Layout', T3: 'Buttons', T4: 'Formulare', T5: 'Navigation', T6: 'Tabellen', T7: 'Fehlermeldungen', T8: 'Design',
  T9: 'Barrierefreiheit', T10: 'CRUD und Persistenz', T11: 'Datenbank', T12: 'API', T13: 'Robustheit und Chaos', T14: 'Dateien und Dialoge', T15: 'Performance', T16: 'Security',
};
const ALIASES = {
  erkundung: 'T1', layout: 'T2', sidebar: 'T2', fenster: 'T2', buttons: 'T3', formulare: 'T4', forms: 'T4', navigation: 'T5', links: 'T5',
  tabellen: 'T6', tables: 'T6', fehlermeldungen: 'T7', design: 'T8', a11y: 'T9', barrierefreiheit: 'T9', crud: 'T10', datenbank: 'T11', db: 'T11',
  api: 'T12', chaos: 'T13', monkey: 'T13', dateien: 'T14', performance: 'T15', perf: 'T15', security: 'T16', sicherheit: 'T16',
};
const UI_COMMON = ['url', 'cdp', 'storage-state', 'init-script', 'viewport', 'headed', 'ignore', 'locale', 'device', 'timezone', 'header'];
const PER_BROWSER = ['T2', 'T3', 'T4', 'T6', 'T8', 'T9']; // Darstellung/Verhalten unterscheidet sich je Browser

const args = parseArgs();
const dbGiven = args.sqlite || args.postgres;
const apiGiven = args['api-base'] || args.spec || args.endpoints;
const defaults = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T8', 'T9', 'T13', 'T15', 'T16', ...(dbGiven ? ['T11'] : []), ...(apiGiven ? ['T12'] : [])];
const tests = args.tests ? String(args.tests).split(',').map((t) => t.trim()).map((t) => ALIASES[t.toLowerCase()] || t.toUpperCase()) : defaults;
const browsers = String(args.browsers || args.browser || 'chromium').split(',').map((b) => b.trim());
const outDir = ensureDir(path.resolve(args.out || path.join(process.cwd(), 'ui-test-results', `lauf-${timestamp()}`)));

const pass = (keys) => keys.flatMap((k) => (args[k] === undefined ? [] : args[k] === true ? [`--${k}`] : [`--${k}`, String(args[k])]));
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; } };
const rel = (p) => path.relative(outDir, p);
const codeText = (c) => (c === 2 ? 'Voraussetzung fehlt (z. B. Browser: npx playwright install webkit, oder Paket) – siehe Ausgabe' : `Skript beendet mit Code ${c}`);

function run(label, script, extra, dir, common = UI_COMMON) {
  console.log(`\n────────── ${label} ──────────`);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, script), ...pass(common), ...extra, '--out', dir], { stdio: 'inherit' });
  return { exit: r.status, sec: Math.round((Date.now() - t0) / 1000) };
}

const summary = []; // { testart, browser, status, info, befunde[], details, sec }
const S = (o) => summary.push({ browser: null, ...o });

// ---------- Definitionen je Testart ----------
const DEF = {
  T1: (b) => {
    const dir = path.join(outDir, 'T1-erkundung');
    const r = run('T1 Erkundung', 'inventory.cjs', [...pass(['crawl']), '--browser', b], dir);
    const j = readJson(path.join(dir, 'inventory.json'));
    S({ testart: 'T1', sec: r.sec, status: j ? 'ok' : 'fehlgeschlagen', info: j ? `${j.pages.length} Seite(n), ${j.pages.reduce((s, p) => s + p.elements.length, 0)} Bedienelemente, ${j.pages.reduce((s, p) => s + p.forms.length, 0)} Formulare` : '', befunde: j ? j.issues.map((i) => `[${i.type}] ${i.message}`) : [`Skript beendet mit Code ${r.exit}`], details: rel(path.join(dir, 'inventory.json')) });
  },
  T2: (b, suf) => {
    const dir = path.join(outDir, `T2-layout${suf}`);
    const r = run(`T2 Layout${suf}`, 'layout.cjs', [...pass(['pages', 'sizes', 'no-sidebar']), '--browser', b], dir);
    const r2 = run(`T2 Fenstergrößen${suf}`, 'viewports.cjs', ['--browser', b], path.join(dir, 'groessen'));
    const j = readJson(path.join(dir, 'layout.json'));
    const v = readJson(path.join(dir, 'groessen', 'viewports.json'));
    const bf = [];
    for (const x of (j && j.results) || []) {
      const at = `@${x.size}`;
      if (x.horizontalOverflowPx) bf.push(`${at}: horizontaler Überlauf ${x.horizontalOverflowPx}px`);
      for (const c of x.covered) bf.push(`${at}: verdeckt (${c.percent}%) ${c.el} ← ${c.by}`);
      for (const s of x.narrowSelects) bf.push(`${at}: Dropdown zu schmal ${s.el} (${s.width}px statt ~${s.needed}px)`);
      for (const c of x.clipped) bf.push(`${at}: Text abgeschnitten ${c.el} (${c.how})`);
      for (const t of x.tables) bf.push(`${at}: Tabelle ${t.el} ${t.problem}`);
      for (const f of (x.sidebar && x.sidebar.findings) || []) bf.push(`${at}: Sidebar – ${f}`);
    }
    for (const x of (v && v.results) || []) for (const c of x.clippedText) bf.push(`@${x.size}: abgeschnitten ${c}`);
    S({ testart: 'T2', browser: b, sec: r.sec + r2.sec, status: j ? 'ok' : 'fehlgeschlagen', info: j ? `${j.results.length} Seite/Größe-Kombinationen + ${v ? v.results.length : 0} Fenstergrößen` : codeText(r.exit), befunde: [...new Set(bf)], details: rel(dir) + '/ (Screenshots ansehen!)' });
  },
  T3: (b, suf) => {
    const dir = path.join(outDir, `T3-buttons${suf}`);
    const r = run(`T3 Buttons${suf}`, 'buttons.cjs', [...pass(['pages', 'avoid', 'all', 'max']), '--browser', b], dir);
    const j = readJson(path.join(dir, 'buttons.json'));
    const bf = [];
    for (const x of (j && j.results) || []) {
      const n = `"${x.name || '(ohne Namen)'}"`;
      if (x.click.clickError) bf.push(`${n}: nicht klickbar`);
      else if (x.click.effects && !x.click.effects.length) bf.push(`${n}: Klick ohne erkennbare Wirkung`);
      if (x.click.errors && x.click.errors.length) bf.push(`${n}: JS-Fehler ${x.click.errors[0]}`);
      for (const f of [...x.label, ...x.size]) bf.push(`${n}: ${f}`);
    }
    S({ testart: 'T3', browser: b, sec: r.sec, status: j ? 'ok' : 'fehlgeschlagen', info: j ? `${j.results.length} Buttons` : codeText(r.exit), befunde: bf, details: rel(path.join(dir, 'buttons.json')) });
  },
  T4: (b, suf) => {
    const dir = path.join(outDir, `T4-formulare${suf}`);
    const r = run(`T4 Formulare${suf}`, 'forms.cjs', [...pass(['pages', 'no-submit']), '--browser', b], dir);
    const j = readJson(path.join(dir, 'forms.json'));
    const bf = [...new Set(((j && j.results) || []).flatMap((f) => f.findings.map((x) => `${f.form}: [${x.cat}] ${x.msg}`)))];
    S({ testart: 'T4', browser: b, sec: r.sec, status: j ? 'ok' : 'fehlgeschlagen', info: j ? `${j.results.length} Formular(e)` : codeText(r.exit), befunde: bf, details: rel(path.join(dir, 'forms.json')) });
  },
  T5: (b) => {
    const dir = path.join(outDir, 'T5-navigation');
    const r = run('T5 Navigation', 'links.cjs', [...pass(['max-pages', 'external', 'avoid']), '--browser', b], dir);
    const j = readJson(path.join(dir, 'links.json'));
    S({ testart: 'T5', sec: r.sec, status: j ? 'ok' : 'fehlgeschlagen', info: j ? `${j.pages.length} Seiten, ${Object.keys(j.links).length} Linkziele` : codeText(r.exit), befunde: j ? [...new Set(j.findings.map((f) => `[${f.cat}] ${f.msg}`))] : [], details: rel(path.join(dir, 'links.json')) });
  },
  T6: (b, suf) => {
    const dir = path.join(outDir, `T6-tabellen${suf}`);
    const r = run(`T6 Tabellen${suf}`, 'tables.cjs', [...pass(['pages']), '--browser', b], dir);
    const j = readJson(path.join(dir, 'tables.json'));
    const bf = ((j && j.results) || []).flatMap((t) => t.findings.filter((f) => f.cat !== 'Hinweis').map((f) => `${t.el}: [${f.cat}] ${f.msg}`));
    S({ testart: 'T6', browser: b, sec: r.sec, status: j ? 'ok' : 'fehlgeschlagen', info: j ? `${j.results.length} Tabelle(n)` : codeText(r.exit), befunde: bf, details: rel(dir) + '/ (Screenshots vor/nach Scrollen)' });
  },
  T8: (b, suf) => {
    const dir = path.join(outDir, `T8-design${suf}`);
    const r = run(`T8 Design${suf}`, 'design.cjs', [...pass(['pages', 'grid']), '--browser', b], dir);
    const j = readJson(path.join(dir, 'design.json'));
    S({ testart: 'T8', browser: b, sec: r.sec, status: j ? 'ok' : 'fehlgeschlagen', info: j ? `${j.summary.schriftarten.length} Schriftarten, ${j.summary.schriftgroessen.length} Schriftgrößen` : codeText(r.exit), befunde: j ? j.findings.map((f) => `[${f.cat}] ${f.msg}`) : [], details: rel(path.join(dir, 'design.json')) });
  },
  T9: (b, suf) => {
    const dir = path.join(outDir, `T9-barrierefreiheit${suf}`);
    const r = run(`T9 Barrierefreiheit${suf}`, 'a11y.cjs', [...pass(['pages', 'level', 'tabs', 'axe-path']), '--browser', b], dir);
    const j = readJson(path.join(dir, 'a11y.json'));
    const bf = [];
    for (const p of (j && j.results) || []) {
      if (!p.axe) bf.push('axe-core nicht installiert – nur Tastatur-Check (npm i -D axe-core)');
      else if (p.axe.violations) for (const v of p.axe.violations) bf.push(`[axe/${v.impact}] ${v.id}: ${v.help} (${v.count}×)`);
      for (const f of p.keyboard.findings) bf.push(`[Tastatur] ${f}`);
    }
    S({ testart: 'T9', browser: b, sec: r.sec, status: j ? 'ok' : 'fehlgeschlagen', info: j ? `${j.results.length} Seite(n), ${j.level}` : codeText(r.exit), befunde: bf, details: rel(path.join(dir, 'a11y.json')) });
  },
  T11: () => {
    if (!dbGiven) return S({ testart: 'T11', status: 'übersprungen', info: '--sqlite oder --postgres fehlt', befunde: [], details: '' });
    const dir = path.join(outDir, 'T11-datenbank');
    const r = run('T11 Datenbank', 'db.cjs', pass(['sqlite', 'postgres', 'tables', 'unique']), dir, []);
    const j = readJson(path.join(dir, 'db.json'));
    S({ testart: 'T11', sec: r.sec, status: j ? 'ok' : 'fehlgeschlagen', info: j ? `${j.tables.length} Tabellen (${j.kind})` : codeText(r.exit), befunde: j ? j.findings.map((f) => `[${f.schweregrad}] ${f.tabelle}: ${f.msg}`) : [], details: rel(path.join(dir, 'db.json')) });
  },
  T12: () => {
    if (!apiGiven && !args.calls) return S({ testart: 'T12', status: 'übersprungen', info: '--api-base/--spec/--endpoints fehlt', befunde: [], details: '' });
    const dir = path.join(outDir, 'T12-api');
    const extra = [...pass(['spec', 'endpoints', 'calls', 'auth', 'auth2', 'write', 'id', 'slow'])];
    if (args['api-base']) extra.push('--base', String(args['api-base']));
    const r = run('T12 API', 'api.cjs', extra, dir, []);
    const j = readJson(path.join(dir, 'api.json'));
    S({ testart: 'T12', sec: r.sec, status: j ? 'ok' : 'fehlgeschlagen', info: j ? `${j.endpoints.length} Endpunkte, ${j.log.length} Anfragen${args.write ? '' : ' (ohne --write)'}` : codeText(r.exit), befunde: j ? j.findings.map((f) => `[${f.schweregrad}] ${f.endpoint}: ${f.msg}`) : [], details: rel(path.join(dir, 'api.json')) });
  },
  T13: (b) => {
    const seeds = Number(args.seeds || 2);
    const bf = [];
    const reports = [];
    let sec = 0;
    for (let s = 1; s <= seeds; s++) {
      const dir = path.join(outDir, `T13-chaos-seed${s}`);
      const r = run(`T13 Chaos (Seed ${s}/${seeds})`, 'monkey.cjs', [...pass(['steps', 'avoid', 'minutes', 'delay', 'no-resize', 'no-nav', 'allow-external']), '--seed', String(s), '--browser', b], dir);
      sec += r.sec;
      const j = readJson(path.join(dir, 'report.json'));
      if (!j) { bf.push(`Seed ${s}: Skript beendet mit Code ${r.exit}`); continue; }
      reports.push(rel(path.join(dir, 'report.md')));
      for (const i of j.issues) bf.push(`[${i.type}] ${i.message.slice(0, 200)} (Seed ${s}, Schritt ${i.firstStep}, ${i.count}×)`);
    }
    S({ testart: 'T13', sec, status: reports.length ? 'ok' : 'fehlgeschlagen', info: `${seeds} Lauf/Läufe`, befunde: bf, details: reports.join(', ') + ' (apiCalls → T12 --calls)' });
  },
  T15: (b) => {
    const dir = path.join(outDir, 'T15-performance');
    const r = run('T15 Performance', 'perf.cjs', [...pass(['pages', 'runs', 'throttle', 'leak']), '--browser', b], dir);
    const j = readJson(path.join(dir, 'perf.json'));
    const k = j && j.results[0] ? j.results[0].kalt : null;
    S({ testart: 'T15', sec: r.sec, status: j ? 'ok' : 'fehlgeschlagen', info: k ? `Startseite: LCP ${k.lcp} ms, CLS ${k.cls}, blockiert ${k.tbt} ms` : codeText(r.exit), befunde: j && j.findings ? j.findings.map((f) => `[${f.schweregrad}] ${f.msg}`) : [], details: rel(path.join(dir, 'perf.json')) });
  },
  T16: (b) => {
    const dir = path.join(outDir, 'T16-security');
    const r = run('T16 Security', 'security.cjs', [...pass(['project', 'no-osv', 'no-audit']), '--browser', b], dir, ['url', 'storage-state', 'header']);
    const j = readJson(path.join(dir, 'security.json'));
    S({ testart: 'T16', sec: r.sec, status: j ? 'ok' : 'fehlgeschlagen', info: j ? `${j.vulns.length} Schwachstellen in Abhängigkeiten` : codeText(r.exit), befunde: j ? j.findings.map((f) => `[${f.schweregrad}] ${f.kategorie}: ${f.msg}`) : [], details: rel(path.join(dir, 'security.json')) });
  },
};

// ---------- Ausführen ----------
for (const t of tests) {
  if (!DEF[t]) continue; // T7, T10, T14: nur Szenarien
  if (PER_BROWSER.includes(t)) for (const b of browsers) DEF[t](b, browsers.length > 1 ? `-${b}` : '');
  else DEF[t](browsers[0], '');
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
    const e = (byType[t] = byType[t] || { testart: t, browser: 'Szenario', status: 'ok', sec: 0, ok: 0, total: 0, befunde: [], details: [] });
    e.sec += Math.round((Date.now() - t0) / 1000);
    e.details.push(rel(path.join(dir, f)));
    if (!j) { e.status = 'fehlgeschlagen'; e.befunde.push(`${f}: Skript abgebrochen (Code ${r.status})`); continue; }
    e.ok += j.results.filter((x) => x.ok).length;
    e.total += j.results.length;
    for (const x of j.results.filter((x) => !x.ok)) e.befunde.push(`${x.name}: ${x.error}${x.screenshot ? ` (Screenshot ${rel(x.screenshot)})` : ''}`);
    for (const x of j.errors) e.befunde.push(`[während ${f}] ${x}`);
  }
  for (const e of Object.values(byType)) summary.push({ ...e, info: `${e.ok}/${e.total} Prüfungen ok`, details: e.details.join(', ') });
}

summary.sort((a, b) => Number(a.testart.slice(1)) - Number(b.testart.slice(1)));
const label = (s) => `${s.testart} ${NAMES[s.testart] || ''}${s.browser && s.browser !== 'chromium' ? ` (${s.browser})` : ''}`;
writeJson(path.join(outDir, 'uebersicht.json'), { url: args.url || args.cdp, zeit: new Date().toISOString(), browsers, testarten: summary });
writeJson(path.join(outDir, 'alle-befunde.json'), summary.flatMap((s) => s.befunde.map((b) => ({ testart: s.testart, browser: s.browser, befund: b, details: s.details }))));

const notRun = Object.keys(NAMES).filter((t) => !summary.some((s) => s.testart === t));
const md = [
  '# UI-Testlauf – Übersicht',
  '',
  `- Ziel: ${args.url || args.cdp || '-'}`,
  `- Browser: ${browsers.join(', ')}`,
  `- Zeit: ${new Date().toLocaleString('de-DE')}`,
  '',
  '| Testart | Ergebnis | Rohbefunde | Dauer |',
  '|---|---|---|---|',
  ...summary.map((s) => `| ${label(s)} | ${s.status === 'ok' ? s.info : '⚠ ' + s.status + (s.info ? ': ' + s.info : '')} | ${s.befunde.length} | ${s.sec || 0}s |`),
  '',
  notRun.length ? `Nicht ausgeführt: ${notRun.map((t) => `${t} ${NAMES[t]}`).join(', ')}${notRun.some((t) => ['T7', 'T10', 'T14'].includes(t)) ? ' (T7/T10/T14 laufen über Szenarien: --szenarien)' : ''}` : '',
  '',
  ...summary.flatMap((s) => [`## ${label(s)}`, '', s.befunde.length ? s.befunde.map((b) => `- ${b}`).join('\n') : '- keine automatischen Befunde', '', `Details: ${s.details}`, '']),
  '> Rohbefunde: vor dem Bericht und vor GitHub-Issues verifizieren, Duplikate zusammenfassen, Falschmeldungen aussortieren, Screenshots ansehen.',
].join('\n');
fs.writeFileSync(path.join(outDir, 'uebersicht.md'), md + '\n', 'utf8');

console.log('\n══════════ Übersicht ══════════');
for (const s of summary) console.log(`${label(s).padEnd(36)} ${String(s.befunde.length).padStart(3)} Rohbefunde  ${s.status === 'ok' ? s.info : '⚠ ' + s.status + (s.info ? ': ' + s.info : '')}`);
if (notRun.length) console.log(`Nicht ausgeführt: ${notRun.join(', ')}`);
console.log(`\n${path.join(outDir, 'uebersicht.md')}`);
console.log(`${path.join(outDir, 'alle-befunde.json')}  (Rohbefunde – Grundlage für befunde.json / GitHub-Issues)`);
