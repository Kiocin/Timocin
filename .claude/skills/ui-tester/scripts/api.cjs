#!/usr/bin/env node
'use strict';
// T12 API-Test: GET/POST/PUT/PATCH/DELETE, Statuscodes, Daten, Validierung, Authentifizierung, Berechtigungen.
//
// Endpunkte aus (mindestens eine Quelle):
//   --spec openapi.json            OpenAPI 3 (JSON; YAML wenn "yaml" oder "js-yaml" im Projekt installiert ist)
//   --calls ui-test-results/…/report.json   beim Monkey-Test beobachtete Aufrufe (apiCalls), mehrere mit Komma
//   --endpoints "GET /api/entries, POST /api/entries, GET /api/entries/:id, PUT /api/entries/:id, DELETE /api/entries/:id"
//
//   node api.cjs --base http://localhost:3000 --endpoints "…" --auth "Authorization: Bearer <token>"
//                [--auth2 "Authorization: Bearer <token-ohne-rechte>"] [--write] [--id 1] [--slow 1000] [--out dir]
//
// Ohne --write werden nur lesende Anfragen und Anfragen ohne/mit ungültigem Login gesendet, die NICHTS ändern sollten.
// ⚠ Auch die können bei einer Sicherheitslücke Daten ändern (z. B. DELETE ohne Login). Darum nur gegen Testumgebungen.
// Mit --write wird der komplette CRUD-Rundlauf mit eigenen Testdatensätzen ausgeführt.

const fs = require('fs');
const path = require('path');
const { parseArgs, ensureDir, defaultOutDir, writeJson } = require('./_common.cjs');

const args = parseArgs();
const outDir = ensureDir(path.resolve(args.out || defaultOutDir('api')));
const slow = Number(args.slow || 1000);
const headerObj = (s) => (s ? Object.fromEntries(String(s).split(';').map((h) => h.split(/:(.*)/s).map((x) => x.trim())).filter(([k]) => k)) : {});
const AUTH = headerObj(args.auth);
const AUTH2 = headerObj(args.auth2);
const log = [];
const findings = [];
const F = (sev, endpoint, msg, evidence) => findings.push({ schweregrad: sev, endpoint, msg, evidence });

// ---------- Endpunkte einsammeln ----------
function loadSpec(file) {
  const raw = fs.readFileSync(file, 'utf8');
  if (/\.ya?ml$/i.test(file)) {
    for (const lib of ['yaml', 'js-yaml']) {
      try {
        const y = require(require.resolve(lib, { paths: [process.cwd()] }));
        return y.parse ? y.parse(raw) : y.load(raw);
      } catch (_) {}
    }
    throw new Error('YAML-Spec: bitte "npm i -D yaml" oder die Spec als JSON angeben');
  }
  return JSON.parse(raw);
}
function exampleFromSchema(schema, spec, depth = 0) {
  if (!schema || depth > 4) return null;
  if (schema.$ref) return exampleFromSchema(schema.$ref.split('/').slice(1).reduce((o, k) => o[k], spec), spec, depth + 1);
  if (schema.example !== undefined) return schema.example;
  if (schema.enum) return schema.enum[0];
  switch (schema.type) {
    case 'object': {
      const o = {};
      for (const [k, v] of Object.entries(schema.properties || {})) if (!v.readOnly) o[k] = exampleFromSchema(v, spec, depth + 1);
      return o;
    }
    case 'array': return [exampleFromSchema(schema.items, spec, depth + 1)];
    case 'integer': case 'number': return schema.minimum ?? 1;
    case 'boolean': return true;
    case 'string':
      if (schema.format === 'date') return '2026-11-21';
      if (schema.format === 'date-time') return '2026-11-21T09:30:00Z';
      if (schema.format === 'email') return `test${Date.now()}@example.com`;
      return 'Testwert';
  }
  return null;
}
const endpoints = new Map(); // "METHOD /pfad/:id" -> { method, path, body, required, secured }
function add(method, p, extra = {}) {
  const tpl = p.replace(/\{[^}]+\}/g, ':id').replace(/\/\d+(?=\/|$)/g, '/:id');
  const key = `${method.toUpperCase()} ${tpl}`;
  endpoints.set(key, { method: method.toUpperCase(), path: tpl, ...(endpoints.get(key) || {}), ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined && v !== null)) });
}
let base = args.base ? String(args.base).replace(/\/$/, '') : null;
if (args.spec) {
  const spec = loadSpec(String(args.spec));
  if (!base && spec.servers && spec.servers[0]) base = spec.servers[0].url.replace(/\/$/, '');
  for (const [p, ops] of Object.entries(spec.paths || {})) {
    for (const [m, op] of Object.entries(ops)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(m)) continue;
      const schema = op.requestBody?.content?.['application/json']?.schema;
      const resolved = schema?.$ref ? schema.$ref.split('/').slice(1).reduce((o, k) => o[k], spec) : schema;
      add(m, p, { body: schema ? exampleFromSchema(schema, spec) : undefined, required: resolved?.required, secured: !!(op.security?.length || spec.security?.length) });
    }
  }
}
if (args.calls) {
  for (const f of String(args.calls).split(',')) {
    const r = JSON.parse(fs.readFileSync(f.trim(), 'utf8'));
    for (const c of r.apiCalls || []) {
      const u = new URL(c.url.replace(/:id/g, '1'));
      if (!base) base = u.origin;
      let body;
      try { body = c.body ? JSON.parse(c.body) : undefined; } catch (_) {}
      add(c.method, c.url.replace(u.origin, ''), { body });
    }
  }
}
if (args.endpoints) for (const e of String(args.endpoints).split(',')) { const [m, p] = e.trim().split(/\s+/); if (m && p) add(m, p); }
if (!base || !endpoints.size) {
  console.error('Bitte --base und Endpunkte angeben (--spec, --calls oder --endpoints).');
  process.exit(2);
}

// ---------- HTTP ----------
async function call(method, p, { body, headers = {}, raw } = {}) {
  const url = base + p;
  const h = { accept: 'application/json', ...headers };
  let payload;
  if (raw !== undefined) { payload = raw; h['content-type'] = 'application/json'; }
  else if (body !== undefined) { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
  const t0 = Date.now();
  let res, text = '', json = null, error = null;
  try {
    res = await fetch(url, { method, headers: h, body: payload, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    text = await res.text();
    try { json = text ? JSON.parse(text) : null; } catch (_) {}
  } catch (e) { error = e.message; }
  const ms = Date.now() - t0;
  const entry = { method, url, sent: payload ? payload.slice(0, 500) : undefined, auth: Object.keys(headers).length ? 'ja' : 'nein', status: res ? res.status : null, ms, contentType: res ? res.headers.get('content-type') : null, response: text.slice(0, 500), error };
  log.push(entry);
  if (ms > slow) F('niedrig', `${method} ${p}`, `langsame Antwort: ${ms} ms`, entry);
  // Fehlerantworten auf verratene Interna prüfen
  if (res && res.status >= 400 && /(\bat [\w$.<>]+ \(?[\w/\\:.-]+:\d+:\d+|"stack"\s*:|Traceback|SQLITE_|SQLSTATE|syntax error at or near|ORA-\d+|node_modules)/.test(text))
    F('hoch', `${method} ${p}`, `Fehlerantwort verrät Interna (Stacktrace/SQL/Dateipfade)`, entry);
  return { status: res ? res.status : null, json, text, ms, error, entry };
}
const ok = (s) => s >= 200 && s < 300;
const sample = (ep) => (ep.body && typeof ep.body === 'object' && !Array.isArray(ep.body) ? JSON.parse(JSON.stringify(ep.body)) : null);
const idOf = (o) => (o && typeof o === 'object' ? o.id ?? o._id ?? o.uuid ?? o.ID ?? null : null);
const withId = (p, id) => p.replace(':id', encodeURIComponent(id));

(async () => {
  const list = [...endpoints.values()];
  console.log(`API-Test gegen ${base}: ${list.length} Endpunkte${args.write ? ' (mit Schreibzugriffen)' : ' (nur lesend + Auth-Prüfung, --write für CRUD)'}\n`);

  // Existierende ID ermitteln
  let existingId = args.id ? String(args.id) : null;
  if (!existingId) {
    for (const ep of list.filter((e) => e.method === 'GET' && !e.path.includes(':id'))) {
      const r = await call('GET', ep.path, { headers: AUTH });
      const arr = Array.isArray(r.json) ? r.json : Array.isArray(r.json?.data) ? r.json.data : Array.isArray(r.json?.items) ? r.json.items : null;
      if (arr && arr.length && idOf(arr[0]) !== null) { existingId = String(idOf(arr[0])); break; }
    }
  }

  // 1. Lesen + Statuscodes
  for (const ep of list.filter((e) => e.method === 'GET')) {
    const name = `GET ${ep.path}`;
    if (ep.path.includes(':id')) {
      if (existingId) {
        const r = await call('GET', withId(ep.path, existingId), { headers: AUTH });
        if (r.status !== 200) F('hoch', name, `vorhandene ID ${existingId} → ${r.status} statt 200`, r.entry);
        else if (idOf(r.json) !== null && String(idOf(r.json)) !== existingId) F('hoch', name, `angefragt ID ${existingId}, geliefert ID ${idOf(r.json)}`, r.entry);
      }
      const nf = await call('GET', withId(ep.path, '99999999'), { headers: AUTH });
      if (nf.status !== 404) F(nf.status >= 500 ? 'hoch' : 'mittel', name, `unbekannte ID → ${nf.status} statt 404${ok(nf.status) ? ` (Antwort: ${nf.text.slice(0, 60) || 'leer'})` : ''}`, nf.entry);
      const bad = await call('GET', withId(ep.path, 'abc'), { headers: AUTH });
      if (bad.status >= 500) F('mittel', name, `ungültige ID "abc" → Serverfehler ${bad.status} statt 400/404`, bad.entry);
    } else {
      const r = await call('GET', ep.path, { headers: AUTH });
      if (!ok(r.status)) F('hoch', name, `Liste → ${r.status} statt 200`, r.entry);
      if (ok(r.status) && r.text && r.json === null) F('mittel', name, `Antwort ist kein JSON (content-type: ${r.entry.contentType})`, r.entry);
    }
  }

  // 2. Authentifizierung: ohne Login und mit ungültigem Token.
  //    Schreibende Proben treffen NIE vorhandene Daten: nur nicht existierende IDs bzw. ungültiger Body.
  //    So wird bei einer Sicherheitslücke nichts gelöscht oder angelegt – die Lücke zeigt sich am Statuscode.
  if (Object.keys(AUTH).length) {
    const badAuth = Object.fromEntries(Object.keys(AUTH).map((k) => [k, 'Bearer ungueltig']));
    for (const ep of list) {
      const write = ep.method !== 'GET';
      const name = `${ep.method} ${ep.path}`;
      let p, opts;
      if (!write) { p = ep.path.includes(':id') ? withId(ep.path, existingId || '1') : ep.path; opts = {}; }
      else if (ep.path.includes(':id')) { p = withId(ep.path, '99999999'); opts = { body: sample(ep) || {} }; }
      else if (ep.method === 'POST') { p = ep.path; opts = { raw: '{' }; } // kaputter Body: legt auch bei Lücke nichts an
      else continue; // PUT/PATCH/DELETE auf ganze Sammlung nicht ohne Login probieren
      const how = write ? (ep.path.includes(':id') ? ' (geprüft mit nicht vorhandener ID)' : ' (geprüft mit ungültigem Body)') : '';
      const r = await call(ep.method, p, opts);
      if (![401, 403].includes(r.status)) F(write ? 'kritisch' : ep.secured ? 'hoch' : 'mittel', name, `ohne Anmeldung → ${r.status} statt 401${write ? ' – schreibender Zugriff wird nicht abgewiesen!' : ' (öffentlich gewollt?)'}${how}`, r.entry);
      const bad = await call(ep.method, p, { ...opts, headers: badAuth });
      if (![401, 403].includes(bad.status)) F(write ? 'kritisch' : 'hoch', name, `ungültiges Token → ${bad.status} statt 401${how}`, bad.entry);
    }
  } else console.log('ℹ Ohne --auth wird die Authentifizierung nicht geprüft.');

  // 3. Berechtigungen (zweiter Benutzer mit weniger Rechten)
  if (Object.keys(AUTH2).length) {
    for (const ep of list.filter((e) => e.method !== 'GET')) {
      const p = ep.path.includes(':id') ? withId(ep.path, '99999999') : ep.path;
      const r = await call(ep.method, p, ep.path.includes(':id') ? { body: sample(ep) || {}, headers: AUTH2 } : { raw: '{', headers: AUTH2 });
      if (![401, 403].includes(r.status)) F('kritisch', `${ep.method} ${ep.path}`, `Benutzer ohne Rechte wird bei ${ep.method} nicht mit 403 abgewiesen (${r.status}) – mit eigenem Testdatensatz nachprüfen`, r.entry);
    }
  }

  // 4. CRUD-Rundlauf und Validierung (nur mit --write)
  const created = [];
  if (args.write) {
    for (const post of list.filter((e) => e.method === 'POST' && !e.path.includes(':id'))) {
      const name = `POST ${post.path}`;
      let body = sample(post);
      if (!body) {
        // Beispiel aus vorhandenem Datensatz ableiten
        const g = await call('GET', post.path, { headers: AUTH });
        const arr = Array.isArray(g.json) ? g.json : g.json?.data || g.json?.items;
        const item = Array.isArray(arr) ? arr.find((x) => x && typeof x === 'object') : null;
        if (item) { body = { ...item }; for (const k of ['id', '_id', 'uuid', 'createdAt', 'updatedAt', 'created_at', 'updated_at']) delete body[k]; }
      }
      if (!body) { console.log(`ℹ ${name}: kein Beispiel-Body bekannt (--spec oder --calls angeben) – übersprungen`); continue; }
      for (const [k, v] of Object.entries(body)) if (typeof v === 'string' && !/date|zeit|time|email/i.test(k)) body[k] = `${v} API-Test ${Date.now() % 100000}`;
      // C
      const c = await call('POST', post.path, { body, headers: AUTH });
      if (!ok(c.status)) { F('hoch', name, `gültiger Datensatz wird abgelehnt: ${c.status} ${c.text.slice(0, 100)}`, c.entry); continue; }
      if (c.status !== 201) F('niedrig', name, `Anlegen liefert ${c.status} statt 201 Created`, c.entry);
      const id = idOf(c.json);
      if (id === null) { F('mittel', name, 'Antwort enthält keine ID des neuen Datensatzes', c.entry); continue; }
      created.push({ path: post.path, id });
      for (const [k, v] of Object.entries(body)) if (c.json && k in c.json && String(c.json[k]) !== String(v)) F('hoch', name, `Feld "${k}": gesendet ${JSON.stringify(v)}, zurück ${JSON.stringify(c.json[k])}`, c.entry);
      // R
      const r = await call('GET', `${post.path}/${id}`, { headers: AUTH });
      if (r.status !== 200) F('hoch', `GET ${post.path}/:id`, `neu angelegter Datensatz ${id} nicht lesbar: ${r.status}`, r.entry);
      else for (const [k, v] of Object.entries(body)) if (r.json && k in r.json && String(r.json[k]) !== String(v)) F('hoch', `GET ${post.path}/:id`, `Feld "${k}" gespeichert als ${JSON.stringify(r.json[k])}, gesendet ${JSON.stringify(v)}`, r.entry);
      else if (r.json && !(k in r.json)) F('mittel', `GET ${post.path}/:id`, `Feld "${k}" fehlt in der Antwort`, r.entry);
      // U
      for (const m of ['PUT', 'PATCH']) {
        const ep = endpoints.get(`${m} ${post.path}/:id`);
        if (!ep) continue;
        const key = Object.keys(body).find((k) => typeof body[k] === 'string') || Object.keys(body)[0];
        const upd = m === 'PUT' ? { ...body, [key]: `${body[key]} geändert` } : { [key]: `${body[key]} geändert` };
        const u = await call(m, `${post.path}/${id}`, { body: upd, headers: AUTH });
        if (!ok(u.status)) F('hoch', `${m} ${post.path}/:id`, `Ändern → ${u.status}`, u.entry);
        const r2 = await call('GET', `${post.path}/${id}`, { headers: AUTH });
        if (r2.json && String(r2.json[key]) !== String(upd[key])) F('hoch', `${m} ${post.path}/:id`, `Änderung von "${key}" nicht übernommen (gelesen: ${JSON.stringify(r2.json[key])})`, r2.entry);
        // Primärschlüssel / Lesefelder ändern
        const idKey = ['id', '_id', 'uuid'].find((k) => r2.json && k in r2.json) || 'id';
        const evil = await call(m, `${post.path}/${id}`, { body: { ...upd, [idKey]: 777777, createdAt: '2000-01-01T00:00:00Z', created_at: '2000-01-01' }, headers: AUTH });
        const moved = await call('GET', `${post.path}/777777`, { headers: AUTH });
        if (ok(moved.status) && moved.json) { F('kritisch', `${m} ${post.path}/:id`, `Primärschlüssel "${idKey}" lässt sich per ${m} ändern (${id} → 777777)`, evil.entry); created.push({ path: post.path, id: 777777 }); }
        const after = await call('GET', `${post.path}/${id}`, { headers: AUTH });
        if (after.json && (after.json.createdAt === '2000-01-01T00:00:00Z' || after.json.created_at === '2000-01-01')) F('mittel', `${m} ${post.path}/:id`, 'Erstellungsdatum lässt sich überschreiben', evil.entry);
        // Validierung beim Ändern
        const inv = await call(m, `${post.path}/${id}`, { body: Object.fromEntries(Object.keys(body).map((k) => [k, typeof body[k] === 'number' ? 'keine Zahl' : 12345])), headers: AUTH });
        if (ok(inv.status)) F('hoch', `${m} ${post.path}/:id`, `Ändern mit falschen Datentypen angenommen (${inv.status})`, inv.entry);
        else if (inv.status >= 500) F('hoch', `${m} ${post.path}/:id`, `falsche Datentypen → Serverfehler ${inv.status} statt 400/422`, inv.entry);
      }
      // Validierung beim Anlegen
      const requiredKnown = !!post.required;
      const required = post.required || Object.keys(body);
      const cases = [
        ['leerer Body {}', {}],
        ['kaputtes JSON', undefined, '{"name": '],
        ...required.map((k) => [`ohne Pflichtfeld "${k}"`, Object.fromEntries(Object.entries(body).filter(([x]) => x !== k))]),
        ...Object.keys(body).map((k) => [`"${k}" mit falschem Typ`, { ...body, [k]: typeof body[k] === 'number' ? 'abc' : typeof body[k] === 'string' ? { nested: true } : 'abc' }]),
        ...Object.keys(body).filter((k) => typeof body[k] === 'string').slice(0, 2).map((k) => [`"${k}" mit 10.000 Zeichen`, { ...body, [k]: 'x'.repeat(10000) }]),
        ...Object.keys(body).filter((k) => typeof body[k] === 'number').map((k) => [`"${k}" negativ`, { ...body, [k]: -1 }]),
      ];
      for (const [label, b, raw] of cases) {
        const v = await call('POST', post.path, { body: b, raw, headers: AUTH });
        if (ok(v.status)) {
          const unsure = !requiredKnown && label.startsWith('ohne Pflichtfeld');
          F(unsure ? 'niedrig' : 'hoch', name, unsure ? `ohne Feld angenommen – Pflicht laut Fachlogik? (${label.replace('ohne Pflichtfeld ', '')}) → ${v.status}` : `ungültige Daten angenommen (${label}) → ${v.status}`, v.entry);
          if (idOf(v.json) !== null) created.push({ path: post.path, id: idOf(v.json) });
        } else if (v.status >= 500) F('hoch', name, `${label} → Serverfehler ${v.status} statt 400/422`, v.entry);
        else if (![400, 409, 413, 415, 422].includes(v.status)) F('niedrig', name, `${label} → ${v.status} (erwartet 400 oder 422)`, v.entry);
        if (!ok(v.status) && v.status < 500 && v.json === null && v.text) F('niedrig', name, `Fehlerantwort (${label}) ist kein JSON – Frontend kann keine Meldung anzeigen`, v.entry);
      }
      // Doppelt anlegen (Unique-Werte)
      const dup = await call('POST', post.path, { body, headers: AUTH });
      if (ok(dup.status) && idOf(dup.json) !== null) { created.push({ path: post.path, id: idOf(dup.json) }); console.log(`ℹ ${name}: identischer Datensatz ein zweites Mal angelegt – ist das erlaubt? (Unique-Felder siehe T11)`); }
      // D
      const del = endpoints.get(`DELETE ${post.path}/:id`);
      if (del) {
        const d = await call('DELETE', `${post.path}/${id}`, { headers: AUTH });
        if (!ok(d.status)) F('hoch', `DELETE ${post.path}/:id`, `Löschen → ${d.status}`, d.entry);
        const g = await call('GET', `${post.path}/${id}`, { headers: AUTH });
        if (g.status !== 404) F('hoch', `DELETE ${post.path}/:id`, `nach dem Löschen liefert GET ${g.status} statt 404${ok(g.status) && g.json ? ' – Datensatz noch da' : ''}`, g.entry);
        const d2 = await call('DELETE', `${post.path}/${id}`, { headers: AUTH });
        if (d2.status >= 500) F('mittel', `DELETE ${post.path}/:id`, `zweites Löschen → Serverfehler ${d2.status} statt 404`, d2.entry);
        const nf = await call('DELETE', `${post.path}/99999999`, { headers: AUTH });
        if (ok(nf.status) && nf.status !== 204) F('niedrig', `DELETE ${post.path}/:id`, `Löschen einer unbekannten ID → ${nf.status} statt 404`, nf.entry);
        created.splice(created.findIndex((x) => x.id === id), 1);
      }
    }
    // Nicht vorhandene Methoden
    const paths = [...new Set(list.map((e) => e.path))];
    for (const p of paths) {
      for (const m of ['PATCH', 'PUT', 'DELETE', 'POST']) {
        if (endpoints.has(`${m} ${p}`)) continue;
        if (m === 'DELETE' && !p.includes(':id')) continue; // ganze Sammlung löschen nie testen
        const r = await call(m, p.includes(':id') ? withId(p, '99999999') : p, { body: {}, headers: AUTH });
        if (r.status >= 500) F('mittel', `${m} ${p}`, `nicht unterstützte Methode → Serverfehler ${r.status} statt 405`, r.entry);
        else if (ok(r.status)) F('mittel', `${m} ${p}`, `nicht dokumentierte Methode ${m} wird akzeptiert (${r.status})`, r.entry);
      }
    }
    // Aufräumen
    for (const c of created) await call('DELETE', `${c.path}/${c.id}`, { headers: AUTH });
    if (created.length) console.log(`ℹ ${created.length} Testdatensätze wieder gelöscht (soweit DELETE existiert).`);
  }

  // Gleichartige Befunde je Endpunkt zusammenfassen
  const merged = [];
  const groups = new Map();
  for (const f of findings) {
    const m = f.msg.match(/^(ungültige Daten angenommen|ohne Feld angenommen – Pflicht laut Fachlogik\?) \((.+)\) → (\d+)$/) || f.msg.match(/^(.+) → (Serverfehler \d+ statt 400\/422)$/);
    if (!m) { merged.push(f); continue; }
    const key = `${f.endpoint}|${f.schweregrad}|${m[1].startsWith('ungültige') || m[1].startsWith('ohne Feld') ? m[1] : m[2]}`;
    const g = groups.get(key) || { ...f, cases: [], kind: m[1].startsWith('ungültige') || m[1].startsWith('ohne Feld') ? m[1] : m[2], evidence: [] };
    g.cases.push(m[1].startsWith('ungültige') || m[1].startsWith('ohne Feld') ? m[2] : m[1]);
    g.evidence.push(f.evidence);
    groups.set(key, g);
  }
  for (const g of groups.values()) merged.push({ schweregrad: g.schweregrad, endpoint: g.endpoint, msg: `${g.kind}: ${g.cases.join('; ')}`, evidence: g.evidence });
  findings.length = 0;
  findings.push(...merged);
  writeJson(path.join(outDir, 'api.json'), { base, endpoints: list, findings, log });
  const order = { kritisch: 0, hoch: 1, mittel: 2, niedrig: 3 };
  findings.sort((a, b) => order[a.schweregrad] - order[b.schweregrad]);
  const seen = new Set();
  for (const f of findings) {
    const k = f.endpoint + f.msg;
    if (seen.has(k)) continue;
    seen.add(k);
    console.log(`  ! [${f.schweregrad}] ${f.endpoint}: ${f.msg}`);
  }
  const times = log.filter((l) => l.status).map((l) => l.ms).sort((a, b) => a - b);
  console.log(`\n${log.length} Anfragen, Antwortzeit Median ${times[Math.floor(times.length / 2)] || 0} ms, Maximum ${times[times.length - 1] || 0} ms`);
  console.log(`Gesamt: ${seen.size} Befunde. Alle Anfragen und Antworten: ${path.join(outDir, 'api.json')}`);
  console.log('Nicht automatisch prüfbar: was der Server bei internen Fehlern (DB weg) liefert – dafür T7 (Frontend mit simulierten Fehlern) und T11.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
