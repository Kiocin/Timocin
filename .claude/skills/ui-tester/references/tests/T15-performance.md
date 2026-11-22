# T15 – Performance

**Ziel:** Seiten laden schnell, reagieren ohne Verzögerung auf Eingaben, bleiben bei großen Datenmengen bedienbar und laufen über längere Nutzung stabil (kein Speicherleck). Der Server hält die erwartete Last aus.

**Werkzeuge:** `scripts/perf.cjs` (Browser-Sicht), `api.cjs` (Antwortzeiten), Lasttest mit `autocannon` oder `k6` (Server-Sicht).

## 1. Ladezeiten und Datenmenge (Browser)

```bash
node <skill>/scripts/perf.cjs --url <URL> --pages /berichte,/projekte --runs 3
node <skill>/scripts/perf.cjs --url <URL> --throttle            # langsames Netz + 4× langsamere CPU
node <skill>/scripts/perf.cjs --url <URL> --leak                # Speicherleck bei wiederholter Navigation
```

| Messwert | gut | schlecht | Bedeutung |
|---|---|---|---|
| TTFB | ≤ 0,8 s | > 1,8 s | Server-Antwortzeit für die Seite |
| FCP | ≤ 1,8 s | > 3 s | erster sichtbarer Inhalt |
| LCP | ≤ 2,5 s | > 4 s | Hauptinhalt sichtbar |
| CLS | ≤ 0,1 | > 0,25 | Layout springt beim Laden |
| Blockierte Zeit (TBT) | ≤ 200 ms | > 600 ms | Seite reagiert nicht auf Klicks |

Außerdem: Requests, übertragene Datenmenge (JS/CSS/Bilder), größte Dateien, nicht komprimierte Dateien, übergroße Bilder, langsame API-Aufrufe beim Laden, Anzahl DOM-Elemente, Speicherwachstum.

Lokale Messungen gegen den Dev-Server sind nicht repräsentativ: unminifiziert, kein CDN, keine Latenz. Für belastbare Zahlen den **Produktions-Build** testen (`npm run build && npm run preview`) und `--throttle` nutzen.

## 2. Reaktionszeit bei Interaktionen (Szenario)

```js
await check('T15 Speichern reagiert schnell', async () => {
  const t0 = Date.now();
  await page.getByRole('button', { name: /speichern/i }).click();
  await page.getByText(/gespeichert/i).waitFor();
  const ms = Date.now() - t0;
  console.log(`   → ${ms} ms`);
  assert(ms < 1000, `Speichern dauert ${ms} ms`);
});
await check('T15 Filter in großer Liste', async () => {
  const t0 = Date.now();
  await page.getByPlaceholder(/suchen|filter/i).fill('Projekt');
  await page.waitForLoadState('networkidle');
  console.log(`   → ${Date.now() - t0} ms`);
});
```

## 3. Große Datenmengen

Viele Testdaten anlegen (Seed-Skript des Projekts, `npm run db:seed`, oder per API in einer Schleife), z. B. 10.000 Einträge, 500 Projekte, und dann prüfen:
- Lädt die Liste noch flüssig? Gibt es Seitenaufteilung/Virtualisierung? (`perf.cjs` meldet > 3000 DOM-Elemente)
- Liefert die API ohne `limit` alles auf einmal? (`GET /api/entries` mit 10.000 Datensätzen → Größe/Zeit messen)
- Berichte/Summen über ein Jahr: Zeit?
- Datenbank: fehlende Indizes auf Such-/Filter-/Fremdschlüsselspalten (T11). In PostgreSQL mit `EXPLAIN ANALYZE <langsame Abfrage>` prüfen; ein `Seq Scan` auf großen Tabellen ist ein Hinweis.

## 4. Lasttest (Server)

Nur gegen Test-/Staging-Server, nie gegen Produktion ohne Absprache.

```bash
# autocannon (Node): 50 gleichzeitige Verbindungen, 30 Sekunden
npx autocannon -c 50 -d 30 -H "Authorization: Bearer <token>" http://localhost:3000/api/entries

# k6 (https://k6.io): realistischer Ablauf mit Login, Liste, Speichern
k6 run --vus 20 --duration 1m lasttest.js
```

```js
// lasttest.js (k6)
import http from 'k6/http';
import { check, sleep } from 'k6';
export const options = { thresholds: { http_req_duration: ['p(95)<800'], http_req_failed: ['rate<0.01'] } };
export default function () {
  const r = http.get('http://localhost:3000/api/entries', { headers: { Authorization: 'Bearer <token>' } });
  check(r, { 'status 200': (x) => x.status === 200 });
  sleep(1);
}
```

Auswerten: Antwortzeit p95/p99, Fehlerrate, ab welcher Last steigt die Zeit sprunghaft? Gleichzeitig Server-CPU/RAM und DB-Verbindungen beobachten. Für eine KMU-Zeiterfassung realistisch: Anzahl Mitarbeiter × 2 gleichzeitige Anfragen zu Spitzenzeiten (morgens Start, abends Stopp).

## Typische Fehler

Ganze Tabelle ohne Paginierung, fehlende DB-Indizes, N+1-Abfragen (pro Zeile eine Anfrage, im Netzwerk-Log sichtbar), riesige JS-Bundles ohne Code-Splitting, Bilder in Originalgröße, keine Kompression, synchrone Berechnungen blockieren die Oberfläche, Event-Listener/Intervalle werden beim Seitenwechsel nicht entfernt (Speicherleck).
