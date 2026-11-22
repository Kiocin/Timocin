#!/usr/bin/env node
'use strict';
// T11 Datenbank: Schema und Datenqualität prüfen – NUR LESEND.
//  - Primärschlüssel vorhanden? Fremdschlüssel für *_id-Spalten? Index auf Fremdschlüsseln?
//  - verwaiste Datensätze (Verweis auf nicht existierenden Eltern-Datensatz)
//  - Spalten, die eindeutig sein sollten (email, username, …) ohne UNIQUE – und echte Duplikate
//  - NULL in Spalten, die fachlich nötig sind (name, email, …); NOT NULL fehlt
//  - Datentypen: Zahlen als TEXT, Geld als FLOAT, Datum als TEXT, Werte passen nicht zum Typ (SQLite)
//
//   node db.cjs --sqlite pfad/zur/app.db
//   node db.cjs --postgres "postgresql://user:pass@localhost:5432/db"   (braucht psql im PATH)
//   Optionen: --tables a,b (nur diese) --unique "users.email,projects.name" (zusätzliche Unique-Erwartungen)
//
// MySQL/MariaDB: Abfragen stehen in references/tests/T11-datenbank.md.

const path = require('path');
const { execFileSync } = require('child_process');
const { parseArgs, ensureDir, defaultOutDir, writeJson } = require('./_common.cjs');

const args = parseArgs();
const outDir = ensureDir(path.resolve(args.out || defaultOutDir('db')));
const findings = [];
const F = (sev, table, msg) => findings.push({ schweregrad: sev, tabelle: table, msg });
const UNIQUE_RE = /^(e?mail|email_?address|username|user_?name|login|slug|code|kuerzel|kürzel|personalnummer|personal_?nr|kundennummer|kunden_?nr|iban|steuer_?id|ust_?id|sku|ean|token|external_?id|uuid)$/i;
const REQUIRED_RE = /^(name|title|titel|bezeichnung|email|e_?mail|username|created_?at|erstellt_?am|status|typ|type)$/i;
const NUMBER_RE = /(hours|stunden|amount|betrag|price|preis|count|anzahl|menge|quantity|qty|minutes|minuten|duration|dauer|total|summe|cost|kosten|rate|satz)$/i;
const MONEY_RE = /(amount|betrag|price|preis|cost|kosten|total|summe|lohn|gehalt|salary|fee|gebuehr|gebühr)$/i;
const DATE_RE = /(date|datum|_at|_am|time|zeit|day|tag)$/i;
const extraUnique = new Set(String(args.unique || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));

// ---------- Treiber ----------
function sqliteDriver(file) {
  let db;
  try {
    process.removeAllListeners('warning');
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(file, { readOnly: true });
    return { all: (sql, ...p) => db.prepare(sql).all(...p), kind: 'sqlite' };
  } catch (_) {}
  try {
    const B = require(require.resolve('better-sqlite3', { paths: [process.cwd()] }));
    db = new B(file, { readonly: true });
    return { all: (sql, ...p) => db.prepare(sql).all(...p), kind: 'sqlite' };
  } catch (_) {}
  console.error('SQLite: Node ≥ 22.5 (node:sqlite) oder "npm i -D better-sqlite3" nötig.');
  process.exit(2);
}
function pgDriver(url) {
  const run = (sql) => {
    const out = execFileSync('psql', [url, '-X', '-A', '-q', '-t', '-v', 'ON_ERROR_STOP=1', '-c', 'SET default_transaction_read_only = on;', '-c', `SELECT coalesce(json_agg(t), '[]') FROM (${sql}) t`], { encoding: 'utf8' });
    const json = out.split('\n').filter((l) => l.trim() && l.trim() !== 'SET').join('\n');
    return JSON.parse(json || '[]');
  };
  return { all: run, kind: 'postgres' };
}

const q = (id) => '"' + String(id).replace(/"/g, '""') + '"';

(async () => {
  let D;
  if (args.sqlite) D = sqliteDriver(path.resolve(String(args.sqlite)));
  else if (args.postgres) D = pgDriver(String(args.postgres));
  else { console.error('Bitte --sqlite <datei> oder --postgres <url> angeben.'); process.exit(2); }
  const only = args.tables ? new Set(String(args.tables).split(',').map((s) => s.trim())) : null;

  // ---------- Schema einlesen (einheitliches Format) ----------
  const tables = [];
  if (D.kind === 'sqlite') {
    for (const { name } of D.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%' AND name NOT IN ('_sqlx_migrations','__diesel_schema_migrations','knex_migrations','knex_migrations_lock','migrations')")) {
      if (only && !only.has(name)) continue;
      const cols = D.all(`PRAGMA table_info(${q(name)})`).map((c) => ({ name: c.name, type: (c.type || '').toUpperCase(), notnull: !!c.notnull || c.pk > 0, pk: c.pk > 0 }));
      const fks = D.all(`PRAGMA foreign_key_list(${q(name)})`).map((f) => ({ column: f.from, refTable: f.table, refColumn: f.to || 'id' }));
      const idx = D.all(`PRAGMA index_list(${q(name)})`).map((i) => ({ unique: !!i.unique, columns: D.all(`PRAGMA index_info(${q(i.name)})`).map((c) => c.name) }));
      const sql = (D.all("SELECT sql FROM sqlite_master WHERE name=?", name)[0] || {}).sql || '';
      tables.push({ name, cols, fks, idx, withoutRowid: /WITHOUT ROWID/i.test(sql) });
    }
  } else {
    const cols = D.all(`SELECT c.table_name, c.column_name, upper(c.data_type) AS type, c.is_nullable = 'NO' AS notnull FROM information_schema.columns c JOIN information_schema.tables t ON t.table_name=c.table_name AND t.table_schema=c.table_schema WHERE c.table_schema = current_schema() AND t.table_type='BASE TABLE' ORDER BY c.table_name, c.ordinal_position`);
    const cons = D.all(`SELECT tc.table_name, tc.constraint_type, kcu.column_name, ccu.table_name AS ref_table, ccu.column_name AS ref_column, tc.constraint_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema LEFT JOIN information_schema.constraint_column_usage ccu ON tc.constraint_type='FOREIGN KEY' AND ccu.constraint_name=tc.constraint_name WHERE tc.table_schema=current_schema()`);
    const idxs = D.all(`SELECT t.relname AS table_name, ix.indisunique AS uniq, array_agg(a.attname ORDER BY a.attnum) AS cols FROM pg_index ix JOIN pg_class t ON t.oid=ix.indrelid JOIN pg_class i ON i.oid=ix.indexrelid JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum = ANY(ix.indkey) JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=current_schema() GROUP BY t.relname, i.relname, ix.indisunique`);
    for (const name of [...new Set(cols.map((c) => c.table_name))]) {
      if (only && !only.has(name)) continue;
      if (/^(_prisma_migrations|knex_migrations|knex_migrations_lock|schema_migrations|migrations|SequelizeMeta|typeorm_metadata)$/.test(name)) continue;
      const pkCols = cons.filter((c) => c.table_name === name && c.constraint_type === 'PRIMARY KEY').map((c) => c.column_name);
      tables.push({
        name,
        cols: cols.filter((c) => c.table_name === name).map((c) => ({ name: c.column_name, type: c.type, notnull: c.notnull, pk: pkCols.includes(c.column_name) })),
        fks: cons.filter((c) => c.table_name === name && c.constraint_type === 'FOREIGN KEY').map((c) => ({ column: c.column_name, refTable: c.ref_table, refColumn: c.ref_column })),
        idx: [
          ...idxs.filter((i) => i.table_name === name).map((i) => ({ unique: i.uniq, columns: Array.isArray(i.cols) ? i.cols : String(i.cols).replace(/[{}]/g, '').split(',') })),
          ...Object.values(cons.filter((c) => c.table_name === name && c.constraint_type === 'UNIQUE').reduce((m, c) => ((m[c.constraint_name] = m[c.constraint_name] || { unique: true, columns: [] }).columns.push(c.column_name), m), {})),
        ],
      });
    }
  }
  const tableNames = new Set(tables.map((t) => t.name));
  const count = (sql, ...p) => Number(Object.values(D.all(sql, ...p)[0] || { n: 0 })[0]);

  // ---------- Prüfungen ----------
  const stats = [];
  for (const t of tables) {
    const rows = count(`SELECT count(*) AS n FROM ${q(t.name)}`);
    stats.push({ tabelle: t.name, zeilen: rows, spalten: t.cols.length });
    if (!t.cols.some((c) => c.pk)) F('hoch', t.name, 'kein Primärschlüssel – Datensätze nicht eindeutig adressierbar, Duplikate möglich');

    for (const c of t.cols) {
      const isFkCol = /(_id|Id)$/.test(c.name) && !c.pk;
      const fk = t.fks.find((f) => f.column === c.name);
      // Fremdschlüssel
      if (isFkCol && !fk) {
        const base = c.name.replace(/(_id|Id)$/, '');
        const ref = [base, base + 's', base + 'es', base.replace(/y$/, 'ies')].find((n) => tableNames.has(n));
        F('hoch', t.name, `Spalte "${c.name}" verweist vermutlich auf ${ref ? `"${ref}"` : 'eine andere Tabelle'}, hat aber keinen Fremdschlüssel – verwaiste Datensätze möglich`);
        if (ref && rows) {
          const orphans = count(`SELECT count(*) AS n FROM ${q(t.name)} x WHERE x.${q(c.name)} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${q(ref)} r WHERE r.${q('id')} = x.${q(c.name)})`);
          if (orphans) F('hoch', t.name, `${orphans} Datensatz/-sätze mit "${c.name}", zu dem es in "${ref}" keinen Eintrag gibt (verwaist)`);
        }
      }
      if (fk) {
        if (!t.idx.some((i) => i.columns[0] === c.name)) F('niedrig', t.name, `Fremdschlüssel "${c.name}" ohne Index – Abfragen und Löschen in "${fk.refTable}" werden bei vielen Daten langsam`);
        if (rows && tableNames.has(fk.refTable)) {
          const orphans = count(`SELECT count(*) AS n FROM ${q(t.name)} x WHERE x.${q(c.name)} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${q(fk.refTable)} r WHERE r.${q(fk.refColumn)} = x.${q(c.name)})`);
          if (orphans) F('hoch', t.name, `${orphans} verwaiste(r) Datensatz/-sätze: "${c.name}" zeigt auf nicht vorhandene Einträge in "${fk.refTable}"${D.kind === 'sqlite' ? ' – in SQLite sind Fremdschlüssel nur aktiv, wenn die App "PRAGMA foreign_keys = ON" setzt' : ''}`);
        }
      }
      // Unique
      const wantUnique = UNIQUE_RE.test(c.name) || extraUnique.has(`${t.name}.${c.name}`.toLowerCase());
      const isUnique = c.pk || t.idx.some((i) => i.unique && i.columns.length === 1 && i.columns[0] === c.name);
      if (wantUnique && !isUnique) F('mittel', t.name, `Spalte "${c.name}" sollte eindeutig sein, hat aber keinen UNIQUE-Index`);
      if ((wantUnique || isUnique) && rows) {
        const dups = D.all(`SELECT ${q(c.name)} AS v, count(*) AS n FROM ${q(t.name)} WHERE ${q(c.name)} IS NOT NULL GROUP BY ${q(c.name)} HAVING count(*) > 1 LIMIT 5`);
        if (dups.length) F(isUnique ? 'kritisch' : 'hoch', t.name, `doppelte Werte in "${c.name}": ${dups.map((d) => `${JSON.stringify(d.v)} (${d.n}×)`).join(', ')}`);
      }
      // NULL
      if (REQUIRED_RE.test(c.name) && !c.notnull) {
        const nulls = rows ? count(`SELECT count(*) AS n FROM ${q(t.name)} WHERE ${q(c.name)} IS NULL`) : 0;
        F(nulls ? 'mittel' : 'niedrig', t.name, `Spalte "${c.name}" darf NULL sein${nulls ? ` – ${nulls} Datensatz/-sätze haben keinen Wert` : ''} (NOT NULL fehlt?)`);
      }
      // Typen
      const textType = /CHAR|TEXT|CLOB|STRING/.test(c.type) || c.type === '';
      if (NUMBER_RE.test(c.name) && textType) F('mittel', t.name, `Spalte "${c.name}" enthält Zahlen, ist aber als ${c.type || 'ohne Typ'} angelegt – Summen/Sortierung falsch ("10" < "9")`);
      if (MONEY_RE.test(c.name) && /REAL|FLOAT|DOUBLE/.test(c.type)) F('mittel', t.name, `Geldbetrag "${c.name}" als ${c.type} – Rundungsfehler; besser DECIMAL/NUMERIC oder ganze Cent`);
      if (D.kind === 'postgres' && DATE_RE.test(c.name) && textType) F('mittel', t.name, `Datum "${c.name}" als ${c.type} statt DATE/TIMESTAMP`);
      if (D.kind === 'postgres' && /TIMESTAMP WITHOUT TIME ZONE/.test(c.type) && /_at$/.test(c.name)) F('niedrig', t.name, `"${c.name}" ist TIMESTAMP ohne Zeitzone – bei Sommerzeit/Servern in anderer Zone mehrdeutig (timestamptz)`);
      if (D.kind === 'sqlite' && rows) {
        // In SQLite kann jede Spalte alles enthalten: tatsächliche Typen der Werte prüfen
        const kinds = D.all(`SELECT typeof(${q(c.name)}) AS k, count(*) AS n FROM ${q(t.name)} GROUP BY 1`).filter((k) => k.k !== 'null');
        const expected = /INT/.test(c.type) ? ['integer'] : /REAL|FLOA|DOUB|NUM|DEC/.test(c.type) ? ['real', 'integer'] : textType ? ['text'] : null;
        const wrong = expected ? kinds.filter((k) => !expected.includes(k.k)) : [];
        if (wrong.length) F('hoch', t.name, `Spalte "${c.name}" (${c.type}) enthält ${wrong.map((w) => `${w.n}× ${w.k}`).join(', ')} – Typ wird nicht erzwungen (STRICT-Tabelle oder Validierung fehlt)`);
        if (NUMBER_RE.test(c.name) && textType) {
          const notNum = count(`SELECT count(*) AS n FROM ${q(t.name)} WHERE ${q(c.name)} IS NOT NULL AND ${q(c.name)} <> '' AND trim(${q(c.name)}) GLOB '*[^0-9.,-]*'`);
          if (notNum) F('hoch', t.name, `"${c.name}": ${notNum} Wert(e) sind keine Zahl`);
        }
      }
    }
  }

  writeJson(path.join(outDir, 'db.json'), { kind: D.kind, tables, stats, findings });
  console.log(`Datenbank (${D.kind}, nur lesend): ${tables.length} Tabellen`);
  for (const s of stats) console.log(`  ${s.tabelle.padEnd(28)} ${String(s.zeilen).padStart(8)} Zeilen  ${s.spalten} Spalten`);
  const order = { kritisch: 0, hoch: 1, mittel: 2, niedrig: 3 };
  findings.sort((a, b) => order[a.schweregrad] - order[b.schweregrad]);
  console.log('');
  for (const f of findings) console.log(`  ! [${f.schweregrad}] ${f.tabelle}: ${f.msg}`);
  console.log(`\nGesamt: ${findings.length} Befunde. Details: ${path.join(outDir, 'db.json')}`);
  console.log('Nicht automatisch geprüft: Transaktionen, Löschregeln (ON DELETE), fachliche Pflichtfelder – siehe references/tests/T11-datenbank.md.');
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
