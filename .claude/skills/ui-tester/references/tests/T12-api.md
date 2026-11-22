# T12 – API

**Ziel:** Jede Schnittstelle (GET, POST, PUT, PATCH, DELETE) antwortet mit dem richtigen Statuscode und den richtigen Daten. Ungültige Daten werden abgelehnt (400/422 statt 201 oder 500), ohne Login gibt es 401, ohne Recht 403. Fehlende Parameter, unbekannte IDs und Serverfehler liefern verständliche Antworten ohne interne Details.

**Werkzeuge:** `scripts/api.cjs`, Szenario für fachliche Regeln, ggf. vorhandene API-Tests des Projekts.

## Endpunkte finden

In dieser Reihenfolge:
1. **OpenAPI/Swagger** im Projekt (`openapi.json|yaml`, `swagger.*`, `/api-docs`, `/swagger.json`, NestJS/FastAPI generieren sie oft automatisch) → `--spec`
2. **Beobachtete Aufrufe** aus dem Monkey-Test (T13) → `--calls ui-test-results/…/T13-chaos-seed1/report.json`
3. **Routen im Code** (`app.get(`, `router.post(`, `@Get(`, `Route::`, Next.js `app/api/**/route.ts`, Tauri `#[tauri::command]`) → `--endpoints "GET /api/x, POST /api/x, …"`

## Automatisch

```bash
# nur lesend + Auth-Proben (ändert keine vorhandenen Daten)
node <skill>/scripts/api.cjs --base http://localhost:3000 --spec openapi.json --auth "Authorization: Bearer <token>"
# mit CRUD-Rundlauf (legt eigene Testdatensätze an und löscht sie wieder) – nur Testumgebung
node <skill>/scripts/api.cjs --base … --calls …/report.json --auth "Authorization: Bearer <admin>" --auth2 "Authorization: Bearer <mitarbeiter>" --write
```

Token besorgen: per Login-Request (`POST /api/login`) mit Testzugang, oder aus `ui-test-results/auth.json` (Cookie: `--auth "Cookie: session=…"`).

| Bereich | Was geprüft wird |
|---|---|
| Lesen | Liste → 200 + JSON; vorhandene ID → 200 und richtige ID; unbekannte ID → **404** (nicht 200 mit `null`, nicht 500); ungültige ID „abc“ → kein 500 |
| Authentifizierung | jeder Endpunkt ohne Login und mit ungültigem Token → **401**. Schreibende Proben nur mit nicht existierender ID bzw. kaputtem Body, damit bei einer Lücke nichts kaputtgeht |
| Berechtigungen | zweiter Benutzer mit weniger Rechten (`--auth2`) → **403** bei schreibenden Endpunkten |
| CRUD (`--write`) | anlegen → 201, Antwort enthält gesendete Werte + ID; lesen → identisch; ändern → übernommen; löschen → danach 404; zweites Löschen kein 500 |
| Geschützte Felder | ID und Erstellungsdatum per PUT/PATCH änderbar? |
| Validierung | leerer Body, kaputtes JSON, jedes Feld fehlend, falsche Typen, 10.000 Zeichen, negative Zahlen → **400/422**, nicht 201 oder 500 |
| Methoden | nicht vorgesehene Methode → **405**, nicht 500 oder 200 |
| Fehlerantworten | JSON mit Meldung; keine Stacktraces, SQL-Texte, Dateipfade (→ auch T16) |
| Antwortzeit | > 1000 ms (`--slow`) |

Ohne OpenAPI kennt das Skript die Pflichtfelder nicht. Meldungen „ohne Feld angenommen – Pflicht laut Fachlogik?“ gegen die Fachlogik prüfen.

## Erwartete Statuscodes (Kurzreferenz)

| Situation | Code |
|---|---|
| gelesen / geändert | 200 (oder 204 ohne Inhalt) |
| angelegt | 201 + `Location`/ID |
| gelöscht | 204 (oder 200) |
| ungültige Eingabe / fehlender Parameter | 400 oder 422 mit Feldfehlern |
| nicht angemeldet / Token ungültig oder abgelaufen | 401 |
| angemeldet, aber keine Berechtigung | 403 (oder 404, um Existenz zu verbergen) |
| unbekannte ID / Route | 404 |
| Methode nicht erlaubt | 405 |
| Konflikt (Duplikat, veraltete Version) | 409 |
| zu groß | 413 |
| zu viele Anfragen | 429 |
| interner Fehler | 500, nur bei echten Fehlern und ohne Details |

## Szenario: was das Skript nicht kann

```js
await check('T12 Mitarbeiter sieht nur eigene Einträge', async () => {
  const r = await page.request.get(`${API}/entries`, { headers: { Authorization: `Bearer ${TOKEN_MITARBEITER}` } });
  const data = await r.json();
  assert(data.every((e) => e.user_id === MEINE_ID), 'fremde Einträge sichtbar');
});
await check('T12 Fremden Eintrag per ID abrufen', async () => {
  const r = await page.request.get(`${API}/entries/${FREMDE_ID}`, { headers: { Authorization: `Bearer ${TOKEN_MITARBEITER}` } });
  assert([403, 404].includes(r.status()), `fremder Eintrag lesbar: ${r.status()}`);
});
await check('T12 Abgelaufenes Token', async () => { /* Token mit exp in der Vergangenheit → 401 */ });
await check('T12 Paginierung/Filter', async () => { /* ?page=2&limit=10, ?limit=100000, ?sort=unbekannt → sinnvolle Antwort, kein 500 */ });
```

Weitere: Serverfehler simulieren (DB stoppen in der Testumgebung → 503/500 mit allgemeiner Meldung, Frontend zeigt verständlichen Hinweis, T7), Rate-Limit bei Login (viele Fehlversuche → 429), Content-Type falsch (`text/plain` an JSON-Endpunkt → 415/400).

## Typische Fehler

`200 null` statt 404, fehlende Validierung (Typen, Längen, negative Werte), 500 bei kaputtem JSON, DELETE ohne Login, Rechte nur in der Oberfläche geprüft, ID per PUT änderbar, Stacktrace in Fehlerantwort, 500 statt 405, Liste ohne Limit (Performance, T15).
