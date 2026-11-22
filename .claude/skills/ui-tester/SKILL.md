---
name: ui-tester
description: Testet Webanwendungen und Tauri-Desktop-Apps wie ein echter Benutzer im Browser – mit Playwright, gegliedert in Testarten. Erkundung, Speichern/Lesen von Daten, Persistenz nach Neuladen oder Neustart, Eingabevalidierung und XSS, Layout und Fenstergrößen, Barrierefreiheit (axe-core, Tastatur), Chaos-/Monkey-Test mit zufälligen und unvorhergesehenen Klicks, Netzwerkfehler, Export/Import und Dialoge. Liefert einen Bericht mit reproduzierbaren Fehlern und Screenshots. Verwende diesen Skill immer, wenn der Benutzer eine Web-App, ein Frontend, eine SPA (React, Vue, Svelte, Angular …) oder eine Tauri-/Electron-App „testen“, „durchklicken“, „ausprobieren“, „auf Fehler prüfen“, „kaputt machen“, „E2E testen“, „UI testen“, „Benutzer simulieren“, auf Barrierefreiheit oder responsives Layout prüfen möchte, auch ohne Playwright zu nennen. Also use for "test my web app", "click through the UI", "monkey test", "fuzz the frontend", "accessibility check", "check responsive layout", "does saving data work".
---

# UI-Tester für Web- und Tauri-Apps

Ziel: Die Anwendung so benutzen, wie Menschen es tun, ordentlich *und* unordentlich, und dabei Fehler finden, die Unit-Tests nicht sehen. Am Ende steht ein Bericht, mit dem der Entwickler jeden Fehler nachvollziehen kann.

Es gibt zwei Arten von Fehlern, und sie brauchen verschiedene Werkzeuge:

- **Laute Fehler** (JS-Exceptions, 500er, weiße Seite, XSS) melden sich selbst. Die automatischen Skripte finden sie zuverlässig.
- **Stille Fehler** (falscher Wert gespeichert, Daten nach Reload weg, Summe falsch, Layout kaputt) melden sich nicht. Sie fallen nur auf, wenn ein Szenario das Ergebnis mit einer konkreten Erwartung vergleicht. Ein Monkey-Test ohne Absturz heißt deshalb nicht „alles ok“.

Darum ist der Skill in **Testarten** gegliedert. Jede prüft eine Sache gründlich und hat eine eigene Anleitung.

## Testarten

| ID | Testart | Was wird geprüft | Werkzeug | Anleitung |
|---|---|---|---|---|
| **T1** | Erkundung | Seiten, Abläufe, Datenspeicher, Risiken. Ergebnis: Testlandkarte | `inventory.cjs` + Prüfkriterien (HICCUPS) | `references/tests/T1-erkundung.md` |
| **T2** | Funktion und Daten | Anlegen, Lesen, Ändern, Löschen: kommt exakt das Eingegebene heraus? Summen? | Szenario | `references/tests/T2-funktion-daten.md` |
| **T3** | Persistenz | Daten nach Reload, neuem Tab, neuer Sitzung, App-Neustart; kaputter Speicher | Szenario | `references/tests/T3-persistenz.md` |
| **T4** | Eingaben und Sicherheit | Pflichtfelder, Grenzwerte, Zahlen-/Datumsformate, XSS, fremde IDs, Validierung an der API | Szenario | `references/tests/T4-eingaben-sicherheit.md` |
| **T5** | Layout und Fenster | Fenstergrößen 280 px–2560 px, Überlauf, Abschneiden, Größenwechsel im Betrieb | `viewports.cjs` + Szenario | `references/tests/T5-layout-fenster.md` |
| **T6** | Barrierefreiheit | WCAG 2.2 AA mit axe-core, Tab-Reihenfolge, sichtbarer Fokus, Dialoge, Screenreader-Namen | `a11y.cjs` + Szenario | `references/tests/T6-barrierefreiheit.md` |
| **T7** | Robustheit und Chaos | Zufällige, unvorhergesehene Klicks und Eingaben; Doppelklick, Zurück, Reload, zwei Tabs | `monkey.cjs` + Szenario | `references/tests/T7-robustheit-chaos.md` |
| **T8** | Netzwerk und Fehlerfälle | Offline, 500/401/409, kaputte und leere Antworten, langsames Netz | Szenario | `references/tests/T8-netzwerk-fehlerfaelle.md` |
| **T9** | Dateien und Dialoge | Export-Inhalt (CSV/PDF), Import/Upload, Bestätigungsdialoge, Popups, Druck | Szenario | `references/tests/T9-dateien-dialoge.md` |

**Auswahl:** Nennt der Benutzer bestimmte Testarten („nur Barrierefreiheit“, „prüf mal das Layout“), führe nur diese aus (T1 kurz zur Orientierung ist fast immer sinnvoll). Bei „teste die App“ ohne Einschränkung: T1, danach die Testarten, die laut Testlandkarte relevant sind. T8 entfällt z. B. bei Apps ohne Netzwerk, T9 ohne Export/Upload. Sag kurz, welche Testarten du durchführst und welche du weglässt, und warum.

Lies die Anleitung einer Testart, bevor du sie durchführst. Dort stehen Vorgehen, Vorlagen und typische Fehler.

## Werkzeuge

Die Skripte liegen in `scripts/` neben dieser Datei und laufen mit Node. Sie brauchen Playwright (`require('playwright')` oder `@playwright/test`), falls nicht vorhanden: `npm i -D playwright && npx playwright install chromium`. Für T6 zusätzlich `npm i -D axe-core`. Führe sie im Projektordner aus, damit sie dessen `node_modules` finden.

| Skript | Testart | Kurz |
|---|---|---|
| `run.cjs --url U [--tests T1,T5,T6,T7] [--szenarien ordner]` | alle | Führt die gewählten Testarten nacheinander aus und schreibt `uebersicht.md`. Mit `--szenarien` laufen auch alle `T*.cjs`-Szenarien des Ordners mit. Weitere Optionen werden an die Einzelskripte durchgereicht (`--seeds`, `--steps`, `--sizes`, `--pages`, `--crawl`, `--avoid` …). |
| `inventory.cjs --url U [--crawl N]` | T1 | Bedienelemente mit Text/Label/Selektor, Formulare mit Regeln, Links, Speicher, Tauri-Erkennung, Screenshot |
| `viewports.cjs --url U [--sizes 375x667,…]` | T5 | Screenshot je Größe, Überlauf, Elemente außerhalb, abgeschnittene Texte, kleine Touch-Ziele |
| `a11y.cjs --url U [--pages /a,/b] [--level wcag22aa]` | T6 | axe-core-Regeln und Tastatur-Check (Fokus sichtbar, Fallen, Namen) |
| `monkey.cjs --url U [--steps 200] [--seed S] [--avoid regex]` | T7 | Zufällige Aktionen mit fiesen Eingaben, reproduzierbar per Seed. Meldet JS-/HTTP-Fehler, leere Seiten, XSS |
| `assets/szenario-vorlage.cjs` | T2–T9 | Vorlage für gezielte Szenarien mit `check()`, `assert()`, `assertEqual()`, Fehlersammlung, Screenshots, JSON-Ergebnis |

Gemeinsame Optionen aller Skripte: `--out <ordner>`, `--viewport 1280x800`, `--headed`, `--storage-state <datei>` (eingeloggter Zustand), `--init-script <datei>` (JS vor dem App-Code, z. B. Tauri-Mock), `--cdp <endpoint>` (an laufende App anhängen, z. B. Tauri unter Windows), `--ignore <regex>` (bekannte Fehlermeldungen ausblenden).

Ergebnisse landen in `./ui-test-results/`. Schlage vor, den Ordner in die `.gitignore` aufzunehmen. Szenarien als `ui-test-results/szenarien/T<n>-<name>.cjs` ablegen. Das Präfix ordnet sie in der Übersicht der Testart zu.

## Ablauf

### 1. Vorbereiten

- `package.json` lesen (Skripte `dev`, `start`, `preview`), bei Tauri zusätzlich `src-tauri/tauri.conf.json`. README und Routen kurz ansehen.
- App starten, falls sie nicht läuft: Dev-Server im Hintergrund, warten bis der Port antwortet (`curl -s -o /dev/null -w "%{http_code}" URL`).
- **Tauri-App:** `references/tauri.md` lesen. Dort steht, welcher Weg passt: Frontend mit gemocktem Backend (überall), echte App per CDP (Windows) oder tauri-driver (Windows/Linux).
- **Login nötig:** einmal per Playwright anmelden, `context.storageState({ path: 'ui-test-results/auth.json' })`, dann `--storage-state` bzw. `STORAGE_STATE` nutzen. Zugangsdaten nur vom Benutzer oder aus den Seed-/Testdaten des Projekts, nie raten.

**Sicherheit:** Die Tests legen Daten an, ändern und löschen sie, und klicken zufällig. Nur gegen lokale oder ausdrückliche Testumgebungen testen. Zeigt die URL auf Produktion oder echte Kundendaten, vorher fragen. Löst die App E-Mails, Zahlungen oder externe Aktionen aus, nachfragen, ob ein Testmodus aktiv ist, und die Buttons per `--avoid` meiden.

### 2. Testarten durchführen

Mit T1 beginnen, dann die ausgewählten Testarten. Für den schnellen automatischen Teil:

```bash
node <skill>/scripts/run.cjs --url <URL> --tests T1,T5,T6,T7 --seeds 3 --steps 300
```

Danach die Szenarien für T2, T3, T4, T8, T9 (und die manuellen Teile von T5–T7) aus der Vorlage schreiben, in `ui-test-results/szenarien/` ablegen und alles gemeinsam ausführen:

```bash
node <skill>/scripts/run.cjs --url <URL> --tests T1,T5,T6,T7 --szenarien ui-test-results/szenarien
```

Arbeite in kleinen Schritten und sieh dir Screenshots an (Read-Tool), statt blind lange Skripte zu schreiben. Ein Blick zeigt oft, dass ein Modal im Weg ist oder die Seite anders aussieht als gedacht. Prüfe in Szenarien mit echten Erwartungen (`assertEqual(angezeigt, eingegeben)`), nicht nur, ob kein Fehler geworfen wurde.

### 3. Befunde verifizieren

Automatische Befunde sind Rohdaten. Bevor einer in den Bericht kommt:
1. Screenshot und Kontext ansehen. Ist es wirklich ein Fehler der App? Falschmeldungen aussortieren: Browser-Erweiterungen, `favicon.ico`, Hot-Reload-Meldungen, abgebrochene Requests beim Seitenwechsel.
2. Mit einem kurzen gezielten Skript nachstellen. So entsteht eine minimale Reproduktion.
3. Nicht nachstellbar → Monkey mit gleichem Seed wiederholen. Sonst als „sporadisch“ kennzeichnen.
4. Doppelte zusammenfassen: Ein Absturz meldet sich oft als `page-error` *und* `blank-page`.
5. Im Quellcode nach der Ursache sehen (Stacktrace → Datei:Zeile), wenn es schnell geht.

### 4. Bericht

`ui-test-results/BERICHT.md` schreiben und im Chat zusammenfassen. Gliederung nach Testarten:

```markdown
# UI-Testbericht <App> – <Datum>

## Zusammenfassung
<2–4 Sätze: was getestet wurde, wie viele Fehler, die schlimmsten zuerst>

| Testart | Ergebnis | Fehler (kritisch/hoch/mittel/niedrig) |
|---|---|---|
| T1 Erkundung | Testlandkarte erstellt | – |
| T2 Funktion und Daten | 7/8 Prüfungen ok | 0/1/0/0 |
| … | | |
| T8 Netzwerk | nicht durchgeführt (App ohne Server) | – |

## Testlandkarte
<aus T1>

## Gefundene Fehler
### F1 <kurzer Titel> — T2 · Schweregrad: hoch
- **Wo:** <Seite / Komponente / Datei:Zeile>
- **Schritte zum Nachstellen:** 1. … 2. … 3. …
- **Erwartet:** …  **Tatsächlich:** …
- **Widerspricht:** <Prüfkriterium aus T1, z. B. „Zusage: Feld heißt ‚Stunden‘, 2,5 wird als 25 gespeichert“>
- **Beleg:** Screenshot `…png`, Fehlermeldung, Monkey-Seed
- **Vermutete Ursache / Lösungsidee:** (wenn der Quellcode es hergibt)

## Getestet ohne Befund
<je Testart: was geprüft wurde und funktioniert hat>

## Nicht getestet
<z. B. Zahlungen, native Dialoge, Screenreader manuell – mit Grund>
```

Schweregrad: *kritisch* = Datenverlust, Sicherheitslücke, Absturz im Kernablauf; *hoch* = Kernfunktion falsch, Kernablauf nicht per Tastatur bedienbar; *mittel* = Nebenfunktion falsch, Layout in einer üblichen Größe unbenutzbar; *niedrig* = kosmetisch.

Behebe Fehler nicht ungefragt, aber biete es an. Schlag außerdem vor, die wertvollsten Szenarien als dauerhafte Tests ins Projekt zu übernehmen (z. B. `tests/e2e/` mit `@playwright/test`). So wird jeder gefundene Fehler zum Regressionstest.

## Hinweise

- Robuste Selektoren: `getByRole('button', { name: 'Speichern' })`, `getByLabel('Stunden')`, `data-testid`. Generierte CSS-Klassen (`.css-1x2y3z`) ändern sich.
- Auf Zustände warten (`locator.waitFor()`, `waitForResponse`), nicht mit festen Pausen, sonst werden Tests wackelig. Kurze Pausen nur, wo nichts Beobachtbares passiert.
- Läuft die Sitzung in einer Cloud-Umgebung ohne Zugriff auf die App des Benutzers (z. B. eine native Tauri-App auf seinem Windows-Rechner), sag das klar und teste, was geht: das Frontend im Browser mit gemocktem Backend (`references/tauri.md`, Weg A).
