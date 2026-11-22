#!/usr/bin/env node
'use strict';
// Verifizierte Befunde als GitHub-Issues anlegen.
//
// Eingabe: befunde.json (Format: references/github-issues.md), z. B. ui-test-results/befunde.json
//
//   node issues.cjs --befunde ui-test-results/befunde.json --repo owner/name            → nur Vorschau (Markdown-Dateien)
//   node issues.cjs --befunde … --repo owner/name --evidence-base <url>                 → Screenshot-Links einsetzen
//   node issues.cjs --befunde … --repo owner/name --create                              → mit gh CLI anlegen
//        [--include-security]  Sicherheitsbefunde (T16 / Kategorie security) auch anlegen
//        [--milestone "Sprint 3"] [--assignee name] [--extra-label ui-test]
//
// Ohne gh CLI: Vorschau erzeugen und die Issues mit dem GitHub-MCP-Werkzeug (issue_write) aus den
// Markdown-Dateien anlegen – Titel, Labels und Body stehen in <out>/issues.json.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseArgs, ensureDir, writeJson } = require('./_common.cjs');

const args = parseArgs();
if (!args.befunde) { console.error('Bitte --befunde <datei.json> angeben.'); process.exit(2); }
const befundeFile = path.resolve(String(args.befunde));
const raw = JSON.parse(fs.readFileSync(befundeFile, 'utf8'));
const befunde = Array.isArray(raw) ? raw : raw.befunde;
const meta = Array.isArray(raw) ? {} : raw;
const outDir = ensureDir(path.resolve(args.out || path.join(path.dirname(befundeFile), 'issues')));
const evDir = ensureDir(path.join(outDir, 'evidence'));
const repo = args.repo ? String(args.repo) : null;

const TESTARTEN = {
  T1: 'Erkundung', T2: 'Layout', T3: 'Buttons', T4: 'Formulare', T5: 'Navigation', T6: 'Tabellen', T7: 'Fehlermeldungen',
  T8: 'Design', T9: 'Barrierefreiheit', T10: 'CRUD', T11: 'Datenbank', T12: 'API', T13: 'Robustheit', T14: 'Dateien', T15: 'Performance', T16: 'Security',
};
const SEV = {
  kritisch: { color: 'b60205', text: 'Datenverlust, Sicherheitslücke oder Absturz im Kernablauf – sofort beheben' },
  hoch: { color: 'd93f0b', text: 'Kernfunktion falsch oder nicht bedienbar – vor dem nächsten Release beheben' },
  mittel: { color: 'fbca04', text: 'Nebenfunktion falsch oder deutlich störend – zeitnah beheben' },
  niedrig: { color: '0e8a16', text: 'kosmetisch oder geringe Auswirkung – bei Gelegenheit beheben' },
};

function validate(b, i) {
  const missing = ['titel', 'testart', 'schweregrad', 'beschreibung', 'schritte', 'erwartet', 'tatsaechlich'].filter((k) => !b[k] || (Array.isArray(b[k]) && !b[k].length));
  if (missing.length) throw new Error(`Befund ${b.id || i + 1} ("${b.titel || '?'}"): es fehlen ${missing.join(', ')}`);
  if (!SEV[b.schweregrad]) throw new Error(`Befund ${b.id || i + 1}: Schweregrad "${b.schweregrad}" unbekannt (kritisch|hoch|mittel|niedrig)`);
}

function render(b) {
  const testart = `${b.testart} ${TESTARTEN[b.testart] || ''}`.trim();
  const u = { ...(meta.umgebung || {}), ...(b.umgebung || {}) };
  const shots = (b.screenshots || []).map((s, i) => {
    const src = path.resolve(path.dirname(befundeFile), s);
    const name = `${b.id || 'F'}-${i + 1}${path.extname(s) || '.png'}`;
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(evDir, name));
    else console.warn(`⚠ Screenshot fehlt: ${src}`);
    return { name, url: args['evidence-base'] ? `${String(args['evidence-base']).replace(/\/$/, '')}/${name}?raw=true` : null };
  });
  const lines = [
    '## Beschreibung', '', b.beschreibung, '',
    ...(b.wo ? [`**Wo:** ${b.wo}`, ''] : []),
    '## Schritte zum Reproduzieren', '', ...b.schritte.map((s, i) => `${i + 1}. ${s}`), '',
    '## Erwartetes Ergebnis', '', b.erwartet, '',
    '## Tatsächliches Ergebnis', '', b.tatsaechlich, '',
  ];
  if (shots.length) {
    lines.push('## Screenshots', '');
    for (const s of shots) lines.push(s.url ? `![${s.name}](${s.url})` : `_Screenshot \`${s.name}\` – noch nicht hochgeladen (siehe ${path.relative(process.cwd(), evDir)})_`, '');
  }
  lines.push('## Schweregrad', '', `**${b.schweregrad}** – ${b.begruendung || SEV[b.schweregrad].text}`, '');
  lines.push('## Umgebung', '', '| | |', '|---|---|');
  for (const [k, l] of [['url', 'URL'], ['browser', 'Browser'], ['viewport', 'Fenstergröße'], ['geraet', 'Gerät'], ['commit', 'Commit'], ['version', 'Version'], ['datum', 'Getestet am']]) if (u[k]) lines.push(`| ${l} | ${u[k]} |`);
  if (!u.datum) lines.push(`| Getestet am | ${new Date().toLocaleDateString('de-DE')} |`);
  lines.push('');
  if (b.belege && b.belege.length) {
    lines.push('## Technische Details', '', '<details><summary>Fehlermeldungen, Logs, Antworten</summary>', '', '```', ...b.belege.map((x) => String(x).slice(0, 3000)), '```', '', '</details>', '');
  }
  if (b.ursache || b.loesung) {
    lines.push('## Vermutete Ursache und Lösungsidee', '');
    if (b.ursache) lines.push(`**Ursache:** ${b.ursache}`, '');
    if (b.loesung) lines.push(`**Lösung:** ${b.loesung}`, '');
  }
  if (b.reproduktion) lines.push(`**Automatisch nachstellen:** \`${b.reproduktion}\``, '');
  lines.push('---', `_Befund ${b.id || ''} · Testart ${testart} · gefunden mit dem Skill ui-tester_`, '', '---', '_Generated by [Claude Code](https://claude.ai/code)_');
  const labels = ['bug', `schweregrad: ${b.schweregrad}`, `test: ${testart}`, ...(b.labels || []), ...(args['extra-label'] ? [String(args['extra-label'])] : [])];
  if (b.testart === 'T16' || b.security) labels.push('security');
  return { id: b.id, title: `[${b.testart}] ${b.titel}`, labels: [...new Set(labels)], body: lines.join('\n'), security: b.testart === 'T16' || !!b.security, schweregrad: b.schweregrad, shots };
}

const gh = (a, input) => spawnSync('gh', a, { encoding: 'utf8', input, maxBuffer: 16 * 1024 * 1024 });

(async () => {
  befunde.forEach(validate);
  const order = { kritisch: 0, hoch: 1, mittel: 2, niedrig: 3 };
  const issues = befunde.map(render).sort((a, b) => order[a.schweregrad] - order[b.schweregrad]);
  for (const i of issues) fs.writeFileSync(path.join(outDir, `${i.id || i.title.replace(/\W+/g, '_').slice(0, 40)}.md`), `# ${i.title}\n\nLabels: ${i.labels.join(', ')}\n\n${i.body}\n`);
  writeJson(path.join(outDir, 'issues.json'), { repo, issues: issues.map((i) => ({ id: i.id, title: i.title, labels: i.labels, security: i.security, bodyFile: `${i.id}.md`, body: i.body })) });

  console.log(`${issues.length} Issue-Entwürfe in ${outDir}\n`);
  for (const i of issues) console.log(`  [${i.schweregrad.padEnd(8)}] ${i.title}${i.security ? '  🔒 Sicherheitsbefund' : ''}${i.shots.length && !i.shots[0].url ? '  (Screenshot noch ohne Link)' : ''}`);
  const sec = issues.filter((i) => i.security);
  if (sec.length) console.log(`\n🔒 ${sec.length} Sicherheitsbefund(e): in öffentlichen Repositories NICHT als normales Issue anlegen, sondern als private Security Advisory (Repository → Security → Advisories → New draft). Mit --include-security trotzdem anlegen (nur private Repos).`);

  if (!args.create) {
    console.log('\nNur Vorschau. Zum Anlegen: --create (gh CLI) oder mit dem GitHub-MCP-Werkzeug aus issues.json.');
    return;
  }
  if (!repo) { console.error('--repo owner/name fehlt'); process.exit(2); }
  if (gh(['auth', 'status']).status !== 0) { console.error('gh CLI nicht angemeldet (gh auth login) – Issues stattdessen mit dem GitHub-MCP-Werkzeug aus issues.json anlegen.'); process.exit(3); }

  // Labels anlegen (vorhandene bleiben unverändert)
  const allLabels = new Set(issues.flatMap((i) => i.labels));
  for (const l of allLabels) {
    const color = l.startsWith('schweregrad: ') ? SEV[l.slice(13)].color : l === 'security' ? 'b60205' : l.startsWith('test: ') ? '1d76db' : 'ededed';
    gh(['label', 'create', l, '--repo', repo, '--color', color, '--description', l.startsWith('test: ') ? 'Testart des ui-tester-Skills' : '']);
  }
  const created = [];
  for (const i of issues) {
    if (i.security && !args['include-security']) { console.log(`  übersprungen (Sicherheit): ${i.title}`); continue; }
    // Duplikat? Offene Issues mit gleichem Titel
    const s = gh(['issue', 'list', '--repo', repo, '--state', 'open', '--search', `"${i.title.replace(/"/g, '')}" in:title`, '--json', 'number,title,url']);
    const dup = s.status === 0 ? JSON.parse(s.stdout || '[]').find((x) => x.title.trim() === i.title.trim()) : null;
    if (dup) { console.log(`  existiert schon: #${dup.number} ${dup.title}`); created.push({ ...dup, existing: true }); continue; }
    const a = ['issue', 'create', '--repo', repo, '--title', i.title, '--body-file', '-'];
    for (const l of i.labels) a.push('--label', l);
    if (args.milestone) a.push('--milestone', String(args.milestone));
    if (args.assignee) a.push('--assignee', String(args.assignee));
    const r = gh(a, i.body);
    if (r.status === 0) { const url = r.stdout.trim(); created.push({ title: i.title, url }); console.log(`  ✔ ${url}  ${i.title}`); }
    else console.log(`  ✘ ${i.title}: ${r.stderr.trim()}`);
  }
  writeJson(path.join(outDir, 'created.json'), created);
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
