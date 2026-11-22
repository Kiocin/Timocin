#!/usr/bin/env node
'use strict';
// T16 Security:
//  1. Abhängigkeiten gegen Schwachstellen-Datenbanken (CVE/GHSA):
//       npm/pnpm/yarn audit   → GitHub Advisory Database (enthält CVE-Nummern und CVSS)
//       OSV.dev (api.osv.dev) → bündelt GitHub Advisories, NVD/CVE, RustSec u. a.; prüft package-lock.json und Cargo.lock
//       cargo audit           → RustSec (für Tauri-Backends), falls installiert
//  2. Laufende App (--url): Sicherheits-Header, Cookies (HttpOnly/Secure/SameSite), Server-Versionen,
//     CORS, Tokens/Passwörter im localStorage, erreichbare Source-Maps
//  3. Tauri-Konfiguration: CSP, gefährliche Berechtigungen, DevTools, Remote-IPC
//  4. Geheimnisse im Repository: eingecheckte .env-Dateien, private Schlüssel, API-Keys
//
//   node security.cjs [--project .] [--url http://localhost:5173] [--no-osv] [--no-audit] [--out dir]

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { parseArgs, ensureDir, defaultOutDir, openTarget, writeJson } = require('./_common.cjs');

const args = parseArgs();
const project = path.resolve(String(args.project || '.'));
const outDir = ensureDir(path.resolve(args.out || defaultOutDir('security')));
const findings = [];
const vulns = [];
const F = (sev, cat, msg, extra = {}) => findings.push({ schweregrad: sev, kategorie: cat, msg, ...extra });
const SEV = { critical: 'kritisch', high: 'hoch', moderate: 'mittel', medium: 'mittel', low: 'niedrig', info: 'niedrig' };
const exists = (f) => fs.existsSync(path.join(project, f));
const has = (cmd) => spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd]).status === 0;

// ---------- 1a. npm / pnpm / yarn audit ----------
function npmAudit() {
  let tool, cmdArgs;
  if (exists('package-lock.json') || exists('npm-shrinkwrap.json')) { tool = 'npm'; cmdArgs = ['audit', '--json']; }
  else if (exists('pnpm-lock.yaml') && has('pnpm')) { tool = 'pnpm'; cmdArgs = ['audit', '--json']; }
  else if (exists('yarn.lock') && has('yarn')) { tool = 'yarn'; cmdArgs = fs.existsSync(path.join(project, '.yarnrc.yml')) ? ['npm', 'audit', '--json', '--recursive'] : ['audit', '--json']; }
  else return { skipped: 'kein Lockfile (package-lock.json / pnpm-lock.yaml / yarn.lock) – ohne Lockfile ist kein verlässlicher Audit möglich' };
  const r = spawnSync(tool, cmdArgs, { cwd: project, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' });
  const out = r.stdout || '';
  let json;
  try { json = JSON.parse(out); } catch (_) {
    // yarn v1 liefert JSON-Zeilen
    const lines = out.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
    if (lines.length) json = { yarnLines: lines }; else return { error: (r.stderr || out).slice(0, 300) };
  }
  if (json.vulnerabilities) {
    // npm v7+
    for (const [name, v] of Object.entries(json.vulnerabilities)) {
      const advisories = v.via.filter((x) => typeof x === 'object');
      if (!advisories.length) continue; // nur indirekt betroffen – die Ursache steht beim anderen Paket
      for (const a of advisories) {
        vulns.push({ quelle: tool, paket: name, version: v.range, schweregrad: SEV[a.severity] || a.severity, ids: [a.url ? a.url.split('/').pop() : a.source].filter(Boolean), titel: a.title, cvss: a.cvss && a.cvss.score, fix: v.fixAvailable === true ? 'npm audit fix' : v.fixAvailable && v.fixAvailable.name ? `${v.fixAvailable.name}@${v.fixAvailable.version}${v.fixAvailable.isSemVerMajor ? ' (Major-Update!)' : ''}` : 'kein Fix verfügbar', direkt: v.isDirect, url: a.url });
      }
    }
  } else if (json.advisories) {
    // pnpm / npm v6
    for (const a of Object.values(json.advisories)) vulns.push({ quelle: tool, paket: a.module_name, version: (a.findings || []).map((f) => f.version).join(', '), schweregrad: SEV[a.severity] || a.severity, ids: a.cves && a.cves.length ? a.cves : [a.github_advisory_id || a.id], titel: a.title, fix: a.patched_versions, url: a.url });
  } else if (json.yarnLines) {
    for (const l of json.yarnLines.filter((x) => x.type === 'auditAdvisory')) { const a = l.data.advisory; vulns.push({ quelle: 'yarn', paket: a.module_name, version: a.findings.map((f) => f.version).join(', '), schweregrad: SEV[a.severity], ids: a.cves.length ? a.cves : [a.github_advisory_id], titel: a.title, fix: a.patched_versions, url: a.url }); }
  }
  return { tool, ok: true };
}

// ---------- 1b. OSV.dev für package-lock.json und Cargo.lock ----------
function lockPackages() {
  const pkgs = [];
  const lock = ['package-lock.json', 'npm-shrinkwrap.json'].find(exists);
  if (lock) {
    const j = JSON.parse(fs.readFileSync(path.join(project, lock), 'utf8'));
    if (j.packages) for (const [p, v] of Object.entries(j.packages)) { if (!p || !v.version || v.link) continue; pkgs.push({ ecosystem: 'npm', name: v.name || p.split('node_modules/').pop(), version: v.version }); }
    else if (j.dependencies) { const walk = (deps) => { for (const [n, v] of Object.entries(deps || {})) { pkgs.push({ ecosystem: 'npm', name: n, version: v.version }); walk(v.dependencies); } }; walk(j.dependencies); }
  }
  for (const cargo of ['Cargo.lock', 'src-tauri/Cargo.lock']) {
    if (!exists(cargo)) continue;
    const txt = fs.readFileSync(path.join(project, cargo), 'utf8');
    for (const m of txt.matchAll(/\[\[package\]\]\s*\nname = "([^"]+)"\s*\nversion = "([^"]+)"(?:\s*\nsource = "registry)?/g)) pkgs.push({ ecosystem: 'crates.io', name: m[1], version: m[2] });
  }
  const seen = new Set();
  return pkgs.filter((p) => { const k = `${p.ecosystem}|${p.name}|${p.version}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

async function osv() {
  const pkgs = lockPackages();
  if (!pkgs.length) return { skipped: 'keine Lockfiles für OSV gefunden' };
  const hits = [];
  try {
    for (let i = 0; i < pkgs.length; i += 500) {
      const chunk = pkgs.slice(i, i + 500);
      const r = await fetch('https://api.osv.dev/v1/querybatch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ queries: chunk.map((p) => ({ package: { ecosystem: p.ecosystem, name: p.name }, version: p.version })) }), signal: AbortSignal.timeout(30000) });
      if (!r.ok) return { error: `OSV antwortet ${r.status}` };
      const j = await r.json();
      j.results.forEach((res, k) => { for (const v of res.vulns || []) hits.push({ ...chunk[k], id: v.id }); });
    }
  } catch (e) {
    return { error: `OSV nicht erreichbar (${e.message}). Alternativ: "npx osv-scanner --lockfile=package-lock.json" oder https://osv.dev manuell` };
  }
  // Details (Schweregrad, CVE-Aliase, Fix-Version) nachladen
  const details = new Map();
  for (const id of [...new Set(hits.map((h) => h.id))].slice(0, 150)) {
    try {
      const d = await (await fetch(`https://api.osv.dev/v1/vulns/${id}`, { signal: AbortSignal.timeout(15000) })).json();
      details.set(id, d);
    } catch (_) {}
  }
  for (const h of hits) {
    const d = details.get(h.id) || {};
    if (vulns.some((v) => v.paket === h.name && (v.ids.includes(h.id) || (d.aliases || []).some((a) => v.ids.includes(a))))) continue; // schon vom Audit gemeldet
    const sevTxt = (d.database_specific && d.database_specific.severity) || '';
    const fixed = (d.affected || []).flatMap((a) => (a.ranges || []).flatMap((r) => r.events.filter((e) => e.fixed).map((e) => e.fixed)));
    vulns.push({ quelle: 'OSV', paket: h.name, version: h.version, ecosystem: h.ecosystem, schweregrad: SEV[sevTxt.toLowerCase()] || 'unbekannt', ids: [h.id, ...(d.aliases || [])], titel: d.summary || (d.details || '').slice(0, 120), fix: fixed.length ? `≥ ${fixed[fixed.length - 1]}` : 'kein Fix bekannt', url: `https://osv.dev/vulnerability/${h.id}` });
  }
  return { ok: true, packages: pkgs.length, hits: hits.length };
}

// ---------- 1c. cargo audit ----------
function cargoAudit() {
  const dir = exists('src-tauri/Cargo.lock') ? path.join(project, 'src-tauri') : exists('Cargo.lock') ? project : null;
  if (!dir) return { skipped: 'kein Cargo.lock' };
  if (spawnSync('cargo', ['audit', '--version']).status !== 0) return { skipped: 'cargo audit nicht installiert (cargo install cargo-audit) – Rust-Pakete werden über OSV geprüft' };
  const r = spawnSync('cargo', ['audit', '--json'], { cwd: dir, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  try {
    const j = JSON.parse(r.stdout);
    for (const v of j.vulnerabilities.list || []) vulns.push({ quelle: 'cargo audit', paket: v.package.name, version: v.package.version, ecosystem: 'crates.io', schweregrad: v.advisory.cvss ? 'siehe CVSS' : 'unbekannt', ids: [v.advisory.id, ...(v.advisory.aliases || [])], titel: v.advisory.title, fix: (v.versions.patched || []).join(', ') || 'kein Fix', url: v.advisory.url });
    for (const w of Object.values(j.warnings || {}).flat()) F('niedrig', 'Abhängigkeiten', `Rust-Paket ${w.package.name} ${w.package.version}: ${w.kind}${w.advisory ? ` – ${w.advisory.title}` : ''}`);
    return { ok: true };
  } catch (e) { return { error: (r.stderr || '').slice(0, 300) }; }
}

// ---------- 3. Tauri-Konfiguration ----------
function tauriConfig() {
  const file = ['src-tauri/tauri.conf.json', 'src-tauri/tauri.conf.json5', 'tauri.conf.json'].find(exists);
  if (!file) return null;
  let conf;
  try { conf = JSON.parse(fs.readFileSync(path.join(project, file), 'utf8').replace(/^\s*\/\/.*$/gm, '')); } catch (_) { return { error: `${file} nicht lesbar` }; }
  const sec = (conf.app && conf.app.security) || (conf.tauri && conf.tauri.security) || {};
  if (!sec.csp) F('hoch', 'Tauri', `${file}: keine Content-Security-Policy (security.csp ist leer/null) – eingeschleustes HTML/JS kann Backend-Befehle aufrufen`);
  else if (/unsafe-eval|unsafe-inline|\*/.test(JSON.stringify(sec.csp))) F('mittel', 'Tauri', `${file}: CSP erlaubt unsafe-inline/unsafe-eval oder * – ${JSON.stringify(sec.csp).slice(0, 120)}`);
  if (sec.dangerousDisableAssetCspModification) F('mittel', 'Tauri', 'dangerousDisableAssetCspModification ist aktiv');
  if (sec.dangerousRemoteDomainIpcAccess || sec.dangerousUseHttpScheme) F('hoch', 'Tauri', 'gefährliche Option dangerousRemoteDomainIpcAccess/dangerousUseHttpScheme aktiv');
  const allow = conf.tauri && conf.tauri.allowlist;
  if (allow && allow.all) F('hoch', 'Tauri', 'v1-allowlist "all": true – das Frontend darf alle Systemfunktionen nutzen');
  if (allow && allow.shell && (allow.shell.all || allow.shell.execute)) F('hoch', 'Tauri', 'v1: shell.execute erlaubt – Frontend kann Programme starten');
  if (allow && allow.fs && allow.fs.scope && JSON.stringify(allow.fs.scope).includes('**')) F('mittel', 'Tauri', `v1: Dateisystem-Zugriff mit weitem Scope ${JSON.stringify(allow.fs.scope).slice(0, 80)}`);
  // v2 capabilities
  const capDir = path.join(project, 'src-tauri', 'capabilities');
  if (fs.existsSync(capDir)) {
    for (const f of fs.readdirSync(capDir).filter((x) => /\.json5?$/.test(x))) {
      const txt = fs.readFileSync(path.join(capDir, f), 'utf8');
      if (/shell:allow-execute|shell:allow-spawn|shell:default/.test(txt)) F('hoch', 'Tauri', `capabilities/${f}: Shell-Ausführung erlaubt`);
      if (/"path"\s*:\s*"(\*\*|\$HOME\/\*\*|\/\*\*)"/.test(txt) || /fs:allow-(read|write)-recursive|fs:scope-home-recursive/.test(txt)) F('mittel', 'Tauri', `capabilities/${f}: weitreichender Dateisystem-Zugriff`);
      if (/"remote"\s*:/.test(txt)) F('mittel', 'Tauri', `capabilities/${f}: Remote-URLs dürfen Backend-Befehle aufrufen – Domains prüfen`);
    }
  }
  if (conf.app && conf.app.withGlobalTauri) F('niedrig', 'Tauri', 'withGlobalTauri: true – window.__TAURI__ ist für jedes Skript auf der Seite erreichbar');
  return { file };
}

// ---------- 4. Geheimnisse im Repository ----------
function secrets() {
  let files = [];
  try { files = execFileSync('git', ['ls-files'], { cwd: project, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean); } catch (_) { return { skipped: 'kein Git-Repository' }; }
  for (const f of files.filter((x) => /(^|\/)\.env(\.|$)/.test(x) && !/\.(example|sample|template|dist)$/.test(x))) F('hoch', 'Geheimnisse', `${f} ist im Git-Repository eingecheckt`);
  const RULES = [
    [/-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, 'privater Schlüssel'],
    [/AKIA[0-9A-Z]{16}/, 'AWS Access Key'],
    [/gh[pousr]_[A-Za-z0-9]{36,}/, 'GitHub-Token'],
    [/sk-(live|proj|ant)-[A-Za-z0-9_-]{20,}/, 'API-Key (Stripe/OpenAI/Anthropic)'],
    [/xox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack-Token'],
    [/AIza[0-9A-Za-z_-]{35}/, 'Google API Key'],
    [/(postgres(ql)?|mysql|mongodb(\+srv)?):\/\/[^:\s/]+:[^@\s]{3,}@(?!localhost|127\.0\.0\.1|db\b|postgres\b)/, 'Datenbank-URL mit Passwort'],
    [/(password|passwort|secret|api_?key|token)\s*[:=]\s*["'][^"'\s]{8,}["']/i, 'Passwort/Schlüssel im Code'],
  ];
  for (const f of files) {
    if (/(^|\/)(node_modules|dist|build|target|vendor)\//.test(f) || /\.(png|jpe?g|gif|ico|woff2?|ttf|pdf|zip|lock|map|min\.js)$/.test(f) || /package-lock\.json$/.test(f)) continue;
    let txt;
    try { const st = fs.statSync(path.join(project, f)); if (st.size > 1024 * 1024) continue; txt = fs.readFileSync(path.join(project, f), 'utf8'); } catch (_) { continue; }
    for (const [re, label] of RULES) {
      const m = txt.match(re);
      if (!m) continue;
      if (/example|beispiel|dummy|changeme|your[-_]|xxx|<.*>|\$\{|process\.env/i.test(m[0])) continue;
      const line = txt.slice(0, m.index).split('\n').length;
      F(label.startsWith('Passwort') ? 'mittel' : 'kritisch', 'Geheimnisse', `${label} in ${f}:${line} (${m[0].slice(0, 12)}…)`);
    }
  }
  return { files: files.length };
}

// ---------- 2. Laufende App ----------
async function liveChecks() {
  const target = await openTarget(args);
  const { page, context } = target;
  const res = await page.goto(String(args.url), { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  const h = res ? res.headers() : {};
  const https = String(args.url).startsWith('https');
  const local = /localhost|127\.0\.0\.1/.test(String(args.url));
  const note = local ? ' (lokal/Dev-Server – in der Produktionskonfiguration erneut prüfen)' : '';
  if (!h['content-security-policy']) F('mittel', 'Header', `keine Content-Security-Policy${note}`);
  else if (/unsafe-inline|unsafe-eval/.test(h['content-security-policy'])) F('niedrig', 'Header', 'CSP erlaubt unsafe-inline/unsafe-eval');
  if (!h['x-frame-options'] && !/frame-ancestors/.test(h['content-security-policy'] || '')) F('mittel', 'Header', `Seite kann in fremde Frames eingebettet werden (Clickjacking): X-Frame-Options/frame-ancestors fehlt${note}`);
  if (h['x-content-type-options'] !== 'nosniff') F('niedrig', 'Header', `X-Content-Type-Options: nosniff fehlt${note}`);
  if (https && !h['strict-transport-security']) F('mittel', 'Header', 'Strict-Transport-Security (HSTS) fehlt');
  if (!h['referrer-policy']) F('niedrig', 'Header', `Referrer-Policy fehlt${note}`);
  if (h['server'] && /\d/.test(h['server'])) F('niedrig', 'Header', `Server verrät Version: "${h['server']}"`);
  if (h['x-powered-by']) F('niedrig', 'Header', `X-Powered-By verrät Technik: "${h['x-powered-by']}"`);
  // CORS der API
  const apiResp = [];
  page.on('response', (r) => { if (['fetch', 'xhr'].includes(r.request().resourceType())) apiResp.push(r); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  for (const r of apiResp.slice(0, 5)) {
    const ah = r.headers();
    if (ah['access-control-allow-origin'] === '*' && ah['access-control-allow-credentials'] === 'true') F('hoch', 'CORS', `${new URL(r.url()).pathname}: Allow-Origin * zusammen mit Allow-Credentials`);
    else if (ah['access-control-allow-origin'] === '*') F('niedrig', 'CORS', `${new URL(r.url()).pathname}: Access-Control-Allow-Origin: * – jede Webseite darf die API lesen`);
  }
  // Cookies
  for (const c of await context.cookies()) {
    const sensitive = /sess|auth|token|jwt|sid|login/i.test(c.name);
    if (sensitive && !c.httpOnly) F('hoch', 'Cookies', `Cookie "${c.name}" ohne HttpOnly – per JavaScript (XSS) auslesbar`);
    if (sensitive && https && !c.secure) F('hoch', 'Cookies', `Cookie "${c.name}" ohne Secure`);
    if (sensitive && (!c.sameSite || c.sameSite === 'None')) F('mittel', 'Cookies', `Cookie "${c.name}" mit SameSite=${c.sameSite || 'nicht gesetzt'} – CSRF-Schutz prüfen`);
  }
  // Tokens/Passwörter im Browser-Speicher
  const stored = await page.evaluate(() => {
    const out = [];
    for (const s of [localStorage, sessionStorage]) for (const k of Object.keys(s)) {
      const v = s.getItem(k) || '';
      if (/passw|kennwort|secret/i.test(k) || /"pass(word)?"\s*:\s*"[^"]+"/i.test(v)) out.push(`${k}: Passwort im ${s === localStorage ? 'localStorage' : 'sessionStorage'}`);
      else if (/token|jwt|auth/i.test(k) || /^eyJ[\w-]+\.[\w-]+\./.test(v)) out.push(`${k}: Token im ${s === localStorage ? 'localStorage' : 'sessionStorage'}`);
    }
    return out;
  }).catch(() => []);
  for (const s of stored) F(s.includes('Passwort') ? 'hoch' : 'niedrig', 'Speicher', `${s} – bei XSS auslesbar (HttpOnly-Cookie ist sicherer)`);
  // Source-Maps öffentlich?
  const scripts = await page.evaluate(() => [...document.scripts].map((s) => s.src).filter(Boolean)).catch(() => []);
  for (const src of scripts.slice(0, 5)) {
    const r = await context.request.get(src + '.map').catch(() => null);
    if (r && r.ok() && /"mappings"/.test(await r.text().catch(() => ''))) { F(local ? 'niedrig' : 'mittel', 'Quellcode', `Source-Map öffentlich: ${src}.map – Originalquellcode einsehbar${note}`); break; }
  }
  await target.close();
}

// GHSA-Kennungen um CVE-Nummern ergänzen (OSV, sonst öffentliche GitHub-API)
async function enrichCve() {
  const ghsa = [...new Set(vulns.filter((v) => !v.ids.some((i) => /^CVE-/.test(i))).flatMap((v) => v.ids.filter((i) => /^GHSA-/.test(i))))].slice(0, 100);
  const map = new Map();
  let reachable = 0;
  for (const id of ghsa) {
    let cve = null;
    try {
      const r = await fetch(`https://api.osv.dev/v1/vulns/${id}`, { signal: AbortSignal.timeout(8000) });
      if (r.ok) { reachable++; cve = ((await r.json()).aliases || []).find((a) => /^CVE-/.test(a)) || null; }
    } catch (_) {}
    if (!cve) {
      try {
        const r = await fetch(`https://api.github.com/advisories/${id}`, { headers: { accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(8000) });
        if (r.ok) { const j = await r.json(); if (j.ghsa_id) reachable++; cve = j.cve_id || null; }
      } catch (_) {}
    }
    if (cve) map.set(id, cve);
  }
  for (const v of vulns) for (const id of [...v.ids]) if (map.has(id) && !v.ids.includes(map.get(id))) v.ids.unshift(map.get(id));
  return ghsa.length ? (reachable ? { ok: true, cve: map.size } : { error: 'CVE-Nummern nicht nachladbar (osv.dev/api.github.com nicht erreichbar) – GHSA-Links nennen die CVE' }) : { skipped: 'nichts nachzuladen' };
}

(async () => {
  const status = {};
  if (!args['no-audit']) status.audit = npmAudit();
  if (!args['no-osv']) status.osv = await osv();
  if (!args['no-osv']) status.cve = await enrichCve();
  status.cargo = cargoAudit();
  status.tauri = tauriConfig();
  status.secrets = secrets();
  if (args.url) await liveChecks();

  const order = { kritisch: 0, hoch: 1, mittel: 2, niedrig: 3, unbekannt: 4, 'siehe CVSS': 4 };
  vulns.sort((a, b) => order[a.schweregrad] - order[b.schweregrad]);
  for (const v of vulns) F(v.schweregrad === 'unbekannt' || v.schweregrad === 'siehe CVSS' ? 'mittel' : v.schweregrad, 'Abhängigkeiten', `${v.paket} ${v.version}: ${v.titel} [${v.ids.filter((i) => /^CVE-/.test(i))[0] || v.ids[0]}]${v.cvss ? ` CVSS ${v.cvss}` : ''} → Fix: ${v.fix}${v.direkt === false ? ' (indirekte Abhängigkeit)' : ''}`, { url: v.url, quelle: v.quelle });
  findings.sort((a, b) => order[a.schweregrad] - order[b.schweregrad]);
  writeJson(path.join(outDir, 'security.json'), { project, status, vulns, findings });

  console.log(`Security-Prüfung: ${project}\n`);
  for (const [k, s] of Object.entries(status)) if (s) console.log(`  ${k.padEnd(8)} ${s.skipped ? 'übersprungen: ' + s.skipped : s.error ? '⚠ ' + s.error : 'ok' + (s.tool ? ` (${s.tool})` : '') + (s.packages ? ` (${s.packages} Pakete geprüft)` : '') + (s.file ? ` (${s.file})` : '') + (s.cve !== undefined ? ` (${s.cve} CVE-Nummern ergänzt)` : '')}`);
  const byCat = {};
  for (const f of findings) (byCat[f.kategorie] = byCat[f.kategorie] || []).push(f);
  for (const [cat, list] of Object.entries(byCat)) {
    console.log(`\n${cat}:`);
    for (const f of list) console.log(`  ! [${f.schweregrad}] ${f.msg}`);
  }
  const bySev = findings.reduce((m, f) => ((m[f.schweregrad] = (m[f.schweregrad] || 0) + 1), m), {});
  console.log(`\nGesamt: ${findings.length} Befunde (${Object.entries(bySev).map(([k, v]) => `${v} ${k}`).join(', ')}). Details: ${path.join(outDir, 'security.json')}`);
  console.log('Nicht abgedeckt: Penetrationstest, Logik-/Rechtefehler (→ T12 API), XSS (→ T4/T13).');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
