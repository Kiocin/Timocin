# T11 – Datenbank

**Ziel:** Das Datenbankschema schützt die Daten. Jede Tabelle hat einen Primärschlüssel, Beziehungen sind als Fremdschlüssel abgesichert, eindeutige Werte sind wirklich eindeutig, Pflichtwerte können nicht NULL sein, die Datentypen passen. Zusammengehörende Änderungen laufen in Transaktionen, sodass nichts halb gespeichert wird.

**Werkzeuge:** `scripts/db.cjs` (Schema + Datenqualität, **nur lesend**), SQL-Abfragen unten, Szenario für Transaktionen.

## Zugang finden

- Verbindung: `.env`/`.env.local` (`DATABASE_URL`), `docker-compose.yml`, `prisma/schema.prisma`, `knexfile`, `ormconfig`, `drizzle.config.*`, Tauri: `src-tauri/src/**` (`sqlx`, `rusqlite`, `tauri-plugin-sql`) und App-Datenordner (`../tauri.md`).
- **Nie gegen Produktion.** Lokale/Test-Datenbank verwenden. Gibt es nur Produktion, nur mit ausdrücklicher Zustimmung und nur lesend (das Skript öffnet ohnehin read-only).
- Schema auch aus dem Code lesen: Migrationen (`migrations/`, `prisma/migrations`) zeigen, was beabsichtigt war. Abweichungen zwischen Migration und echter DB sind selbst ein Befund.

## Automatisch

```bash
node <skill>/scripts/db.cjs --sqlite pfad/zur/app.db
node <skill>/scripts/db.cjs --postgres "postgresql://user:pass@localhost:5432/timocin" --unique "projects.name,users.personalnummer"
```

| Prüfung | Befund |
|---|---|
| Primärschlüssel | Tabelle ohne PK |
| Fremdschlüssel | `*_id`-Spalte ohne FK-Constraint; FK ohne Index |
| Verwaiste Datensätze | Verweise auf nicht existierende Eltern (mit und ohne FK). In SQLite sind FKs nur aktiv, wenn die App `PRAGMA foreign_keys = ON` setzt; im Code suchen! |
| Eindeutigkeit | Spalten wie `email`, `username`, `personalnummer`, `kuerzel` ohne UNIQUE; **tatsächliche Duplikate** (mit `--unique tabelle.spalte` eigene Regeln) |
| NULL | `name`, `email`, `status`, `created_at` … dürfen NULL sein / sind NULL |
| Datentypen | Zahlen als TEXT/VARCHAR, Geld als FLOAT/DOUBLE, Datum als TEXT, `timestamp` ohne Zeitzone; SQLite: Werte passen nicht zum deklarierten Typ |

Welche Spalten fachlich eindeutig oder Pflicht sind, weiß das Skript nur aus Namen. Ergänze mit `--unique` und prüfe die Liste gegen die Fachlogik (z. B. „Projektname je Kunde eindeutig“ → zusammengesetzter UNIQUE-Index).

## Beziehungen und Löschregeln prüfen

Für jede Beziehung klären: **Was soll passieren, wenn der Elterndatensatz gelöscht wird?**
- `RESTRICT`: Löschen verhindern (Projekt mit Zeiteinträgen nicht löschbar), dann aber mit verständlicher Meldung in der Oberfläche (T7)
- `CASCADE`: Kinder mitlöschen (gewollt? Datenverlust!)
- `SET NULL`: Verweis leeren (Spalte muss NULL erlauben)

```sql
-- PostgreSQL: Löschregeln aller Fremdschlüssel
SELECT tc.table_name, kcu.column_name, ccu.table_name AS verweist_auf, rc.delete_rule, rc.update_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY';
-- SQLite: PRAGMA foreign_key_list(tabelle);  → Spalte on_delete
-- SQLite: PRAGMA foreign_key_check;          → alle verwaisten Datensätze
-- MySQL:  SELECT * FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE();
```

Dann über die Oberfläche/API testen (T10): Elterndatensatz löschen und prüfen, was mit den Kindern passiert.

## Constraints wirklich auslösen (nur Test-DB!)

Die Prüfung oben liest das Schema. Ob die Constraints greifen, zeigt erst ein Schreibversuch. In einer **Test-Datenbank** innerhalb einer Transaktion, die zurückgerollt wird:

```sql
BEGIN;
INSERT INTO users (email, name) VALUES ('doppelt@test.de', 'A'), ('doppelt@test.de', 'B');   -- erwartet: unique violation
ROLLBACK;
BEGIN;
INSERT INTO time_entries (user_id, project_id, hours) VALUES (1, 999999, 2);                -- erwartet: foreign key violation
ROLLBACK;
BEGIN;
INSERT INTO time_entries (user_id, project_id, hours) VALUES (1, 1, NULL);                  -- erwartet: not-null violation (falls Pflicht)
ROLLBACK;
```

Gleiche Fälle auch über die API (T12): Kommt dann ein verständlicher 409/422 oder ein 500 mit SQL-Fehlertext?

## Transaktionen

Eine Transaktion soll sicherstellen: **ganz oder gar nicht**. Kandidaten sind Aktionen, die mehrere Datensätze schreiben, z. B. Rechnung mit Positionen, Umbuchen von Zeiten zwischen Projekten, Monatsabschluss, Import mehrerer Zeilen, Anlegen eines Benutzers mit Rollen.

1. **Im Code suchen:** `BEGIN`, `transaction(`, `$transaction`, `knex.transaction`, `sequelize.transaction`, `db.transaction`, `tx.commit`, Rust `begin()`/`commit()`. Mehrere `INSERT`/`UPDATE` in einer Funktion **ohne** Transaktion sind ein Befund.
2. **Fehler mitten in der Aktion auslösen** und prüfen, ob Teile gespeichert wurden:
   - Import/Mehrfachanlage mit einem ungültigen Datensatz in der Mitte → danach dürfen **keine** Zeilen aus diesem Import in der DB sein
   - Constraint im zweiten Schritt verletzen (z. B. doppelter Wert)
   - Verbindung während der Aktion trennen (Server stoppen, `page.route` abbrechen) – nur Test-DB
3. **Gleichzeitigkeit:** Zwei Anfragen gleichzeitig (z. B. letzte freie Ressource buchen, Zähler erhöhen). Ergebnis korrekt?

```js
await check('T11 Import ist atomar', async () => {
  const vorher = await (await page.request.get(`${URL}/api/entries`)).json();
  const r = await page.request.post(`${URL}/api/entries/import`, { data: { rows: [{ name: 'A', hours: 1 }, { name: '', hours: 'x' }, { name: 'C', hours: 2 }] } });
  const nachher = await (await page.request.get(`${URL}/api/entries`)).json();
  assert(!r.ok() || nachher.length === vorher.length + 3, 'Import meldet Erfolg, aber nicht alle Zeilen da');
  if (!r.ok()) assertEqual(nachher.length, vorher.length, 'Import fehlgeschlagen, aber Teile gespeichert (keine Transaktion)');
});
await check('T11 Gleichzeitige Änderungen', async () => {
  const reqs = Array.from({ length: 10 }, () => page.request.post(`${URL}/api/counter/increment`));
  await Promise.all(reqs);
  // erwarteten Zählerstand prüfen – "Lost Updates" zeigen fehlende Sperren/Transaktionen
});
```

## Typische Fehler

E-Mail ohne UNIQUE (doppelte Benutzer), `*_id` ohne Fremdschlüssel (verwaiste Zeiteinträge), SQLite ohne `PRAGMA foreign_keys = ON`, Stunden als TEXT, Geld als FLOAT, Zeitstempel ohne Zeitzone, Import ohne Transaktion (halb importiert), CASCADE löscht unbemerkt abhängige Daten, Constraint-Verletzung führt zu 500 mit SQL-Text statt verständlicher Meldung.
