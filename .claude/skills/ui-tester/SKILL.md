---
name: ui-tester
description: Testet Web- und Tauri-Apps wie echte Benutzer mit Playwright, in 16 Testarten. Layout (Überlagerungen, abgeschnittene Texte, Dropdowns, Sidebar), Buttons, Formulare (Pflichtfelder, Formate, Datumsfelder in Safari), Navigation, Tabellen (fixierte Bereiche), Fehlermeldungen, Design, Barrierefreiheit, CRUD, Datenbank (PK/FK/Unique/NULL/Transaktionen), API (Statuscodes, Auth, Rechte), Chaos-/Monkey-Test, Performance und Security (CVE-Prüfung von npm/Cargo). Verifizierte Fehler werden als GitHub-Issues angelegt. Verwende den Skill, wenn jemand eine App, ein Frontend, eine API oder eine Tauri-/Electron-App testen, durchklicken, auf Fehler, Barrierefreiheit, Layout, Performance oder Sicherheitslücken prüfen oder einen QA-/Testbericht möchte, auch ohne Playwright zu nennen. Also for "test my web app", "QA", "monkey test", "check API", "npm audit", "file bugs as issues".
---

# UI-Tester für Web- und Tauri-Apps

Ziel: Die Anwendung so benutzen und prüfen, wie Menschen sie benutzen, ordentlich *und* unordentlich, und dabei Fehler finden, die Unit-Tests nicht sehen. Jeder verifizierte Fehler endet als nachvollziehbares GitHub-Issue.

Es gibt zwei Arten von Fehlern, und sie brauchen verschiedene Werkzeuge:
- **Laute Fehler** (Exceptions, 500er, weiße Seite, XSS, kaputte Links) melden sich selbst. Die Skripte finden sie zuverlässig.
- **Stille Fehler** (falscher Wert gespeichert, Summe falsch, Sidebar verdeckt Inhalt, unverständliche Meldung) fallen nur auf, wenn man das Ergebnis mit einer Erwartung vergleicht. Deshalb gibt es zu jeder Testart neben dem Skript auch Szenarien und den Blick auf die Screenshots. Ein Skript ohne Befund heißt nicht „alles ok“.

## Testarten

| ID | Testart | Kernfragen | Skript | Anleitung |
|---|---|---|---|---|
| **T1** | Erkundung | Welche Seiten, Abläufe, Daten, Risiken? Testlandkarte, Prüfkriterien (HICCUPS) | `inventory.cjs` | `references/tests/T1-erkundung.md` |
| **T2** | Layout | Überlagerungen? Dropdowns zu schmal? Texte/Tabellen abgeschnitten? Sidebar ein-/ausklappen, Größe ändern, verschieben? Fenstergrößen? | `layout.cjs`, `viewports.cjs` | `…/T2-layout.md` |
| **T3** | Buttons | Funktionieren alle? Richtig beschriftet? Richtige Größe, einheitlich? | `buttons.cjs` | `…/T3-buttons.md` |
| **T4** | Formulare | Ausfüllbar? Pflichtfelder gekennzeichnet und mit Logik + Meldung? Formate (Datum, Zahl, Dropdown)? Datumsfeld-Größe in Safari? Schutz vor Falscheingaben? | `forms.cjs` | `…/T4-formulare.md` |
| **T5** | Navigation | Funktionieren alle Menüs und Links? Sprungmarken? Geschützte Seiten? | `links.cjs` | `…/T5-navigation.md` |
| **T6** | Tabellen | Korrekte Darstellung, Überschneidungen, fixierte Bereiche oben und links, Formate, Sortierung/Summen | `tables.cjs` | `…/T6-tabellen.md` |
| **T7** | Fehlermeldungen | Klar, verständlich, deutsch, am Feld? Verhalten bei Server-/Netzfehlern? | Szenario (+ automatische Prüfung auf kryptische Texte in T4/T5/T13) | `…/T7-fehlermeldungen.md` |
| **T8** | Design | Passen Farben, Schriftarten, Schriftgrößen, Abstände, Größen? | `design.cjs` | `…/T8-design.md` |
| **T9** | Barrierefreiheit | WCAG 2.2 AA (axe-core), Tastatur, Fokus, Screenreader-Namen | `a11y.cjs` | `…/T9-barrierefreiheit.md` |
| **T10** | CRUD und Persistenz | Richtig gespeichert, richtig zurückgegeben, Änderungen übernommen? Darf gelöscht/geändert werden? Daten nach Reload/Neustart da? | Szenario (+ `api.cjs --write`) | `…/T10-crud-persistenz.md` |
| **T11** | Datenbank | Primär-/Fremdschlüssel, Unique, NULL, Datentypen, Beziehungen, verwaiste Daten, Transaktionen | `db.cjs` | `…/T11-datenbank.md` |
| **T12** | API | GET/POST/PUT/PATCH/DELETE, Statuscodes, Daten, Validierung, Authentifizierung, Berechtigungen, fehlende Parameter, Serverfehler | `api.cjs` | `…/T12-api.md` |
| **T13** | Robustheit und Chaos | Unvorhergesehene Klicks und Eingaben, Doppelklick, Zurück, Reload, zwei Tabs | `monkey.cjs` | `…/T13-robustheit-chaos.md` |
| **T14** | Dateien und Dialoge | Export-Inhalt, Import/Upload, Bestätigungsdialoge, Popups, Druck | Szenario | `…/T14-dateien-dialoge.md` |
| **T15** | Performance | Ladezeiten (Core Web Vitals), Datenmenge, große Datenmengen, Speicherlecks, Lasttest | `perf.cjs` | `…/T15-performance.md` |
| **T16** | Security | Abhängigkeiten gegen CVE-Datenbanken (npm audit, OSV, cargo audit), Header, Cookies, Tauri-Rechte, Geheimnisse | `security.cjs` | `…/T16-security.md` |

Querschnitt: `references/tauri.md` (Tauri-Apps: Mock, WebView2/CDP, tauri-driver) · `references/github-issues.md` (Befunde als Issues).

**Auswahl:** Nennt der Benutzer bestimmte Bereiche („prüf die Tabellen“, „nur Security“), führe nur diese aus, plus eine kurze T1-Erkundung zur Orientierung. Bei „teste die App“ ohne Einschränkung: T1, danach alle Testarten, die laut Testlandkarte zutreffen. Sag kurz, welche du durchführst und welche du weglässt (z. B. „T11 entfällt: kein Datenbankzugang“). Lies die Anleitung einer Testart, bevor du sie durchführst. Dort stehen Vorgehen, Vorlagen und typische Fehler.

## Werkzeuge

Alle Skripte liegen in `scripts/` neben dieser Datei. Führe sie **im Projektordner** aus, damit sie dessen `node_modules` finden. Voraussetzungen: Node ≥ 18, Playwright (`npm i -D playwright && npx playwright install chromium`), für T9 `npm i -D axe-core`, für Safari `npx playwright install webkit`.

| Skript | Zweck |
|---|---|
| `run.cjs --url U [--tests T2,T4] [--browsers chromium,webkit] [--szenarien dir]` | führt mehrere Testarten aus, schreibt `uebersicht.md` + `alle-befunde.json`; reicht Optionen an die Einzelskripte durch |
| `inventory.cjs` · `layout.cjs` · `viewports.cjs` · `buttons.cjs` · `forms.cjs` · `links.cjs` · `tables.cjs` · `design.cjs` · `a11y.cjs` · `monkey.cjs` · `perf.cjs` | Oberfläche (je Testart, siehe Tabelle) |
| `api.cjs --base B --spec/--calls/--endpoints … --auth "…" [--auth2 …] [--write]` | API-Test |
| `db.cjs --sqlite datei \| --postgres URL` | Datenbankschema und -qualität, nur lesend |
| `security.cjs [--project .] [--url U]` | Abhängigkeiten (CVE), Header, Cookies, Tauri, Geheimnisse |
| `issues.cjs --befunde befunde.json --repo OWNER/REPO [--create]` | GitHub-Issues aus verifizierten Befunden |
| `assets/szenario-vorlage.cjs` | Vorlage für gezielte Szenarien (`check()`, `assert()`, `assertEqual()`, Screenshots, JSON-Ergebnis) |

Gemeinsame Optionen der Oberflächen-Skripte: `--url`, `--pages /a,/b`, `--out <ordner>`, `--viewport 1280x800`, `--browser chromium|webkit|firefox`, `--device "iPhone 13"`, `--headed`, `--storage-state <datei>` (eingeloggt), `--init-script <datei>` (z. B. Tauri-Mock), `--cdp <endpoint>` (laufende App, z. B. Tauri unter Windows), `--header "Authorization: Bearer …"`, `--locale`, `--timezone`, `--ignore <regex>`.

Ergebnisse liegen in `./ui-test-results/`. Schlage vor, den Ordner in die `.gitignore` aufzunehmen. Szenarien als `ui-test-results/szenarien/T<n>-<name>.cjs` ablegen, das Präfix ordnet sie in der Übersicht zu.

## Browser und Geräte

Darstellungsfehler sind oft browserspezifisch, besonders **Safari**: Datumsfelder, Sticky-Elemente, Flexbox-Lücken, Schriftdarstellung. Die Oberflächen-Testarten T2, T3, T4, T6, T8 und T9 deshalb in **Chromium und WebKit** ausführen: `run.cjs --browsers chromium,webkit`. Firefox (`firefox`) bei Formularen mit Datum/Zeit ergänzen. Mobile Ansicht: `--device "iPhone 13"` oder `--viewport 375x667`. WebKit in Playwright entspricht Safari weitgehend, aber nicht vollständig. Kritische Safari-Befunde möglichst auf einem echten Mac/iPhone bestätigen lassen.

## Ablauf

### 1. Vorbereiten

- `package.json`, README, Routen, ggf. `src-tauri/tauri.conf.json`, `.env.example`, `docker-compose.yml`, Migrationen und OpenAPI-Datei ansehen.
- App starten, falls sie nicht läuft (Dev-Server im Hintergrund, warten bis der Port antwortet). Für T15 besser den Produktions-Build.
- **Tauri:** `references/tauri.md` lesen.
- **Login:** einmal per Playwright anmelden, `context.storageState({ path: 'ui-test-results/auth.json' })`, dann `--storage-state`. Für T12 zwei Testzugänge mit unterschiedlichen Rollen. Zugangsdaten nur vom Benutzer oder aus Seed-/Testdaten des Projekts, nie raten.

**Sicherheit und Daten:** Die Tests legen Daten an, ändern und löschen sie, klicken zufällig und senden ungültige Anfragen. **Nur gegen lokale oder ausdrückliche Testumgebungen.** Zeigt eine URL oder Datenbank auf Produktion oder echte Personendaten, vorher fragen. E-Mail-Versand, Zahlungen und externe Aktionen per `--avoid` meiden oder Testmodus bestätigen lassen. `db.cjs` öffnet nur lesend, `api.cjs` schreibt nur mit `--write` und nur eigene Testdatensätze.

### 2. Testarten durchführen

Mit T1 beginnen. Dann der automatische Teil:

```bash
node <skill>/scripts/run.cjs --url <URL> --browsers chromium,webkit --pages /berichte,/einstellungen \
     --api-base <API> --calls … --auth "Authorization: Bearer <token>" --sqlite <db> --project .
```

Danach je Testart die Anleitung lesen, die **Screenshots ansehen** (Read-Tool) und Szenarien für das schreiben, was Skripte nicht wissen können (fachliche Regeln, richtige Werte, Fehlermeldungstexte). Szenarien laufen mit `--szenarien ui-test-results/szenarien` in der Übersicht mit. Arbeite in kleinen Schritten. Ein Blick auf einen Screenshot spart oft lange Fehlersuche.

### 3. Befunde verifizieren

`alle-befunde.json` enthält **Rohbefunde**. Vor Bericht und Issue:
1. Screenshot und Kontext ansehen. Ist es wirklich ein Fehler der App? Falschmeldungen aussortieren: Dev-Server-Header, `favicon.ico`, Hot-Reload, Erweiterungen, gewollte Designentscheidungen.
2. Mit einem kurzen gezielten Skript nachstellen. Daraus werden die Reproduktionsschritte.
3. Nicht nachstellbar → Monkey mit gleichem Seed wiederholen. Sonst „sporadisch“ kennzeichnen.
4. Zusammenfassen: eine Ursache = ein Befund, mit allen Fundstellen (z. B. `page-error` + `blank-page` = ein Absturz; gleiches CSS-Problem in 4 Formularen = ein Befund).
5. Ursache im Quellcode suchen (Stacktrace → Datei:Zeile, Komponente, SQL), wenn es schnell geht.
6. Schweregrad festlegen (Tabelle in `references/github-issues.md`).

### 4. Bericht

`ui-test-results/BERICHT.md` schreiben und im Chat zusammenfassen:

```markdown
# Testbericht <App> – <Datum>

## Zusammenfassung
<2–4 Sätze: was getestet wurde (Testarten, Browser), wie viele Fehler, die schlimmsten zuerst>

| Testart | Ergebnis | Fehler (kritisch/hoch/mittel/niedrig) | Issues |
|---|---|---|---|
| T2 Layout | 3 Befunde | 0/1/2/0 | #41 #42 #43 |
| … | | | |
| T11 Datenbank | nicht durchgeführt (kein DB-Zugang) | – | – |

## Testlandkarte (aus T1)
## Gefundene Fehler
### F1 <Titel> — T4 · hoch · #41
Wo · Schritte · Erwartet · Tatsächlich · Beleg · Ursache/Lösungsidee
## Getestet ohne Befund
## Nicht getestet (mit Grund)
```

### 5. GitHub-Issues

Der Benutzer möchte Fehler als **GitHub-Issues**, damit sie abgearbeitet werden können. Ablauf in `references/github-issues.md`:
1. Verifizierte Befunde in `ui-test-results/befunde.json` (Beschreibung, Schritte, erwartet, tatsächlich, Screenshots, Schweregrad, Umgebung).
2. `issues.cjs` erzeugt die Entwürfe. Dem Benutzer die Liste zeigen und **einmal bestätigen lassen**, bevor Issues angelegt werden.
3. Screenshots über einen Evidence-Branch verlinken (Push vorher abstimmen) oder manuell anhängen.
4. Anlegen mit `--create` (gh) oder dem GitHub-MCP-Werkzeug. Duplikate werden vermieden.
5. **Sicherheitslücken nicht als öffentliches Issue**, sondern als private Security Advisory, außer bei privaten Repositories nach Rückfrage.

Behebe Fehler nicht ungefragt, aber biete es an. Schlag vor, die wertvollsten Szenarien als dauerhafte Tests ins Projekt zu übernehmen (z. B. `tests/e2e/` mit `@playwright/test`), damit jeder gefundene Fehler zum Regressionstest wird.

## Hinweise

- Robuste Selektoren: `getByRole('button', { name: 'Speichern' })`, `getByLabel('Stunden')`, `data-testid`. Keine generierten CSS-Klassen.
- Auf Zustände warten (`locator.waitFor()`, `waitForResponse`), nicht mit festen Pausen.
- Läuft die Sitzung in einer Cloud-Umgebung ohne Zugriff auf die App oder Datenbank des Benutzers (z. B. native Tauri-App auf seinem Windows-Rechner, Firmen-Datenbank), sag das klar und teste, was geht. Was nicht ging, gehört in „Nicht getestet“.
