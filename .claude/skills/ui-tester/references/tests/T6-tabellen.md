# T6 – Tabellen

**Ziel:** Tabellen werden vollständig und lesbar dargestellt. Spalten passen zu ihren Köpfen, nichts überschneidet sich, und fixierte Bereiche (Kopfzeile oben, erste Spalte links) bleiben beim Scrollen korrekt stehen, ohne dass Inhalt durchscheint oder verrutscht. Sortieren, Filtern und Blättern liefern richtige Ergebnisse.

**Werkzeuge:** `scripts/tables.cjs` (Darstellung + fixierte Bereiche), Szenario für Sortieren/Filtern/Blättern.

## Automatisch

```bash
node <skill>/scripts/tables.cjs --url <URL> --pages /berichte,/auswertung
node <skill>/scripts/tables.cjs --url <URL> --viewport 1024x768     # schmaleres Fenster: mehr Scrollen
node <skill>/scripts/tables.cjs --url <URL> --browser webkit        # Sticky verhält sich in Safari teils anders
```

| Prüfung | Befund |
|---|---|
| Struktur | Zeilen mit anderer Zellenzahl als der Kopf; keine Kopfzeile; leere Spaltenköpfe |
| Abgeschnitten | Zellen mit verstecktem Text (mit/ohne Tooltip) |
| Formate | Zahlen nicht rechtsbündig, uneinheitliche Nachkommastellen, Dezimalpunkt statt Komma, gemischte oder ISO-/US-Datumsformate |
| **Fixierte Kopfzeile** | bleibt nach dem Scrollen nicht oben; hat keinen Hintergrund (Inhalt scheint durch); wird von Zellen überdeckt (z-index) |
| **Fixierte erste Spalte** | nur Kopf- oder nur Datenzellen fixiert → verrutscht gegeneinander; nach horizontalem Scrollen stehen Kopf und Daten an unterschiedlicher Stelle |
| **Eckzelle** (oben links) | wird beim Scrollen in beide Richtungen von anderen Kopfzellen überdeckt |
| Hinweise | viele Zeilen ohne fixierte Kopfzeile, breite Tabelle ohne fixierte erste Spalte, > 300 Zeilen ohne Seitenaufteilung |

Das Skript scrollt jede Tabelle 120 px nach unten und 250 px nach rechts und speichert Screenshots **vor und nach dem Scrollen**. Sieh dir die „gescrollt“-Bilder an: Überschneidungen von Kopf- und Datenzellen sind dort sofort sichtbar.

Tabellen aus Bibliotheken (AG Grid, MUI DataGrid, TanStack, Handsontable) bestehen oft aus `div`s mit `role=grid`. Struktur und Abschneiden werden erkannt, die Sticky-Messung nur bei echten `<table>`-Elementen. Bei Grids die Screenshots besonders genau ansehen.

## Szenario: Sortieren, Filtern, Blättern, Summen

```js
await check('T6 Sortierung nach Datum stimmt', async () => {
  await page.getByRole('columnheader', { name: /datum/i }).click();
  const werte = await page.locator('tbody tr td:nth-child(2)').allInnerTexts();
  const toDate = (s) => { const [d, m, y] = s.split('.'); return new Date(`${y}-${m}-${d}`).getTime(); };
  const sortiert = [...werte].sort((a, b) => toDate(a) - toDate(b));
  assertEqual(werte.join('|'), sortiert.join('|'), 'Sortierung'); // Achtung: Text-Sortierung von "10.01." vor "9.01." ist ein typischer Fehler
});
await check('T6 Summe in Fußzeile stimmt', async () => {
  const zahlen = (await page.locator('tbody td.stunden').allInnerTexts()).map((t) => parseFloat(t.replace('.', '').replace(',', '.')));
  const summe = zahlen.reduce((a, b) => a + b, 0);
  const angezeigt = parseFloat((await page.locator('tfoot td.stunden').innerText()).replace(',', '.'));
  assert(Math.abs(summe - angezeigt) < 0.01, `Summe ${angezeigt}, nachgerechnet ${summe}`);
});
```

Weitere: Filter + Blättern (Seite 2 bei aktivem Filter?), Sortierung bleibt nach Reload/Zurück?, leere Tabelle zeigt Hinweis statt nichts, sehr lange Zellinhalte, Spaltenbreite per Ziehen ändern (falls vorgesehen), Zeilen-Aktionen (Bearbeiten/Löschen) treffen die richtige Zeile (nach Sortierung!).

## Typische Fehler

Sticky-Kopf ohne Hintergrund, nur Kopfzelle der ersten Spalte fixiert, Eckzelle mit zu niedrigem z-index, Text-Sortierung von Zahlen/Daten, Summe nur über die aktuelle Seite, Aktion nach Sortierung trifft falsche Zeile, Tabelle ohne horizontales Scrollen schneidet Spalten ab.
