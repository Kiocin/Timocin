---
name: ui-tester
description: Testet Webanwendungen und Tauri-Desktop-Apps wie ein echter Benutzer im Browser – mit Playwright. Klickt Buttons, füllt Formulare, speichert und liest Daten, prüft ob Daten nach Neuladen erhalten bleiben, ändert die Fenstergröße, und klickt im Chaos-/Monkey-Test auch unvorhergesehene Dinge mit fiesen Eingaben. Liefert einen Bericht mit reproduzierbaren Fehlern und Screenshots. Verwende diesen Skill immer, wenn der Benutzer eine Web-App, ein Frontend, eine SPA (React, Vue, Svelte, Angular …) oder eine Tauri-/Electron-App „testen“, „durchklicken“, „ausprobieren“, „auf Fehler prüfen“, „kaputt machen“, „E2E testen“, „UI testen“ oder „Benutzer simulieren“ möchte – auch wenn er Playwright oder den Skill nicht ausdrücklich nennt. Also use for requests like "test my web app", "click through the UI", "monkey test", "fuzz the frontend", "check responsive layout", "does saving data work".
---

# UI-Tester für Web- und Tauri-Apps

Ziel: Die Anwendung so benutzen, wie Menschen es tun – ordentlich *und* unordentlich – und dabei Fehler finden, die Unit-Tests nicht sehen. Am Ende steht ein Bericht, mit dem der Entwickler jeden Fehler nachvollziehen kann.

Zwei Arten von Fehlern gibt es, und sie brauchen verschiedene Werkzeuge:

- **Abstürze und laute Fehler** (JS-Exceptions, 500er, weiße Seite, XSS): findet der Monkey-Test zuverlässig, weil sie sich selbst melden.
- **Stille Fehler** (falscher Wert gespeichert, Daten nach Reload weg, Summe falsch, Layout kaputt): melden sich nicht. Die findest nur du mit gezielten Szenarien, in denen du *prüfst*, ob das Ergebnis stimmt. Ein Monkey-Test ohne Absturz heißt deshalb nicht „alles ok“.

Plane darum immer beides ein.

## Werkzeuge im Skill

Alle Skripte liegen in `scripts/` neben dieser Datei und laufen mit Node. Sie brauchen Playwright (`require('playwright')` oder `@playwright/test`); fehlt es: `npm i -D playwright && npx playwright install chromium`. Alle akzeptieren `--url`, `--out <ordner>`, `--viewport 1280x800`, `--headed`, `--storage-state <datei>` (eingeloggter Zustand), `--init-script <datei>` (JS vor dem App-Code laden, z. B. ein Tauri-Mock) und `--cdp <endpoint>` (an laufende App anhängen, z. B. Tauri unter Windows).

| Skript | Zweck |
|---|---|
| `inventory.cjs --url U [--crawl N]` | Bestandsaufnahme: alle Bedienelemente mit Text/Label/Selektor, Formulare mit Validierungsregeln, interne Links, localStorage/sessionStorage/IndexedDB/Cookies, Tauri-Erkennung, Screenshot. Mit `--crawl` werden N weitere interne Seiten besucht. |
| `monkey.cjs --url U [--steps 200] [--seed S]` | Chaos-Test: zufällige Klicks, Doppel- und Mehrfachklicks, fiese Eingaben (leer, sehr lang, Emoji, Umlaute, HTML, SQL, negative Zahlen, ungültige Daten), Tasten, Scrollen, Fenstergrößen, Zurück/Vor/Reload, Dialoge. Erkennt JS-Fehler, Konsolenfehler, fehlgeschlagene Requests, HTTP 4xx/5xx, leere Seiten und XSS (harmloser Köder). Gleicher Seed → gleicher Ablauf. Optionen: `--avoid "regex"` (Elemente meiden, Standard: Abmelden/Logout), `--ignore "regex"` (Fehlermeldungen ignorieren), `--no-resize`, `--no-nav`, `--allow-external`, `--minutes`. |
| `viewports.cjs --url U [--sizes 320x568,…]` | Fenstergrößen: Screenshot je Größe, horizontaler Überlauf, Elemente außerhalb, abgeschnittene Texte, zu kleine Touch-Ziele. |

Ergebnisse landen standardmäßig in `./ui-test-results/<art>-<zeit>/` im aktuellen Verzeichnis. Schlage vor, `ui-test-results/` in die `.gitignore` aufzunehmen.

## Ablauf

### 1. App verstehen und starten

- Lies `package.json` (Skripte `dev`, `start`, `preview`), bei Tauri zusätzlich `src-tauri/tauri.conf.json` (Frontend-URL `devUrl`/`devPath`, `identifier`, Tauri-Version). Kurz README/Routen ansehen, damit du die wichtigsten Abläufe kennst (z. B. „Zeit erfassen → speichern → in Liste sehen → exportieren“).
- Läuft die App schon (der Benutzer nennt eine URL)? Dann nutze sie. Sonst starte den Dev-Server im Hintergrund und warte, bis der Port antwortet (`curl -s -o /dev/null -w "%{http_code}" URL`).
- **Tauri-App?** Lies `references/tauri.md` – dort steht, welcher der drei Wege (Browser mit gemocktem Backend, echte App per CDP unter Windows, tauri-driver) passt und wie.
- **Login nötig?** Melde dich einmal per Playwright an und speichere den Zustand mit `context.storageState({ path: 'auth.json' })`; dann allen Skripten `--storage-state auth.json` mitgeben. Zugangsdaten nur vom Benutzer oder aus Seed-/Testdaten des Projekts, nie raten.

**Sicherheit:** Die Tests legen Daten an, ändern und löschen sie, und klicken zufällig herum. Teste deshalb nur gegen lokale oder ausdrückliche Test-Umgebungen. Zeigt die URL auf Produktion oder echte Kundendaten, frag vorher nach. Wenn die App E-Mails, Zahlungen oder externe APIs auslöst, frag nach, ob diese im Testmodus laufen, oder setze `--avoid` auf die entsprechenden Buttons.

### 2. Erkunden

`node <skill>/scripts/inventory.cjs --url <URL> --crawl 5` ausführen und Screenshots ansehen (mit dem Read-Tool kannst du PNGs betrachten). Daraus ableiten:
- Welche Formulare/Abläufe speichern Daten? Wo landen sie (localStorage, IndexedDB, Server-API, Tauri-Backend)?
- Welche Selektoren sind stabil (`data-testid`, `id`, `name`, Rollen + Namen)?
- Was sind die 3–6 wichtigsten Benutzerabläufe?

### 3. Gezielte Szenarien

Schreib für die wichtigsten Abläufe ein Playwright-Skript (oder eine `@playwright/test`-Spec, falls das Projekt schon Playwright-Tests hat) und führe es aus. Vorlagen für alle typischen Fälle stehen in `references/szenarien.md`. Lies die Datei, wenn du das erste Szenario schreibst. Abdecken:

1. **Daten speichern und lesen (CRUD):** anlegen → in der Liste/Detailansicht prüfen, dass *genau* die eingegebenen Werte angezeigt werden → bearbeiten → löschen → wirklich weg.
2. **Persistenz:** nach dem Speichern neu laden, neuen Tab öffnen, bei Tauri die App neu starten – sind die Daten noch da und unverändert?
3. **Validierung und Grenzwerte:** Pflichtfelder leer, zu lang, negative/Komma-Zahlen, ungültige Daten, Umlaute/Emoji. Erwartung: verständliche Fehlermeldung, kein Absturz, nichts Kaputtes gespeichert.
4. **Fenster:** `viewports.cjs` laufen lassen und Screenshots ansehen. Zusätzlich die Abläufe aus 1. in einer schmalen Größe (z. B. 375×667) wiederholen, weil Menüs dort oft anders funktionieren (Burger-Menü).
5. **Unordentliches Verhalten:** Doppelklick auf Speichern (doppelte Einträge?), Zurück-Button mitten im Formular, Reload während des Speicherns, zwei Tabs bearbeiten denselben Datensatz, Netzwerk weg oder langsam (`page.route`, `context.setOffline`).

Prüfe in jedem Schritt mit echten Erwartungen (`expect(...).toHaveText(...)` oder eigene Vergleiche), nicht nur, ob kein Fehler geworfen wurde.

### 4. Chaos-Test

`node <skill>/scripts/monkey.cjs --url <URL> --steps 300` – bei mehreren Seiten auch auf Unterseiten starten. Zwei bis drei Läufe mit unterschiedlichen Seeds finden deutlich mehr als ein langer. Den Seed jedes Laufs notieren.

Danach jedes gemeldete Problem **verifizieren**, bevor es in den Bericht kommt: `report.md` und den Screenshot ansehen, die „letzten Aktionen“ nachvollziehen, und den Fehler mit einem kurzen gezielten Skript nachstellen. So entsteht eine minimale Reproduktion („Feld Stunden leer lassen → Speichern → Seite neu laden → TypeError“). Was sich nicht reproduzieren lässt, als „sporadisch“ kennzeichnen. Übersprungene Aktionen (Element verdeckt/verschwunden) sind normal und kein Fehler.

Typische Falschmeldungen aussortieren: Fehler von Browser-Erweiterungen, `favicon.ico`-404, Hot-Reload-Meldungen des Dev-Servers, abgebrochene Requests beim Seitenwechsel. Wiederkehrendes Rauschen mit `--ignore` ausblenden.

### 5. Bericht

Schreib den Bericht in `ui-test-results/BERICHT.md` und fasse ihn im Chat zusammen. Struktur:

```markdown
# UI-Testbericht <App> – <Datum>

## Zusammenfassung
<2–4 Sätze: was getestet wurde, wie viele Fehler, die schlimmsten zuerst>

## Gefundene Fehler
### 1. <kurzer Titel> — Schweregrad: kritisch | hoch | mittel | niedrig
- **Wo:** <Seite / Komponente / ggf. Datei:Zeile aus dem Stacktrace>
- **Schritte zum Nachstellen:** 1. … 2. … 3. …
- **Erwartet:** …  **Tatsächlich:** …
- **Beleg:** Screenshot `…png`, Fehlermeldung, Monkey-Seed
- **Vermutete Ursache / Lösungsidee:** (wenn der Quellcode es hergibt)

## Getestet ohne Befund
<Liste der Abläufe und Größen, die funktioniert haben – damit klar ist, was abgedeckt ist>

## Nicht getestet
<z. B. Zahlungen, E-Mail-Versand, native Dialoge – mit Grund>
```

Schweregrad: *kritisch* = Datenverlust, Absturz in einem Kernablauf, Sicherheitslücke; *hoch* = Kernfunktion falsch; *mittel* = Nebenfunktion falsch oder Layout unbenutzbar; *niedrig* = kosmetisch.

Behebe Fehler nicht ungefragt im Code. Biete es an. Bietet sich an, die Szenarien als dauerhafte Tests im Projekt abzulegen (z. B. `tests/e2e/`), schlag das ebenfalls vor.

## Hinweise

- Arbeite in kleinen Schritten und sieh dir Screenshots an, statt blind lange Skripte zu schreiben. Ein Blick zeigt oft, dass ein Modal im Weg ist oder die Seite anders aussieht als gedacht.
- Bevorzuge robuste Selektoren: `getByRole('button', { name: 'Speichern' })`, `getByLabel('Stunden')`, `data-testid`. CSS-Klassen von Frameworks (`.css-1x2y3z`) ändern sich.
- Warte auf Zustände (`expect(locator).toBeVisible()`, `waitForResponse`), nicht mit festen `waitForTimeout`-Pausen, sonst werden Tests wackelig.
- Läuft die Sitzung in einer Cloud-Umgebung ohne Zugriff auf die App des Benutzers (z. B. eine native Tauri-App auf seinem Windows-Rechner), sag das klar und teste, was geht: das Frontend im Browser mit gemocktem Backend (siehe `references/tauri.md`).
