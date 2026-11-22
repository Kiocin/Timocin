# T1 – Erkundung

**Ziel:** Die App kennenlernen, bevor du testest: Welche Seiten, Abläufe, Daten und Risiken gibt es? Ergebnis ist eine Testlandkarte, aus der du ableitest, welche Testarten T2–T9 wie tief nötig sind. Bei der Erkundung fallen außerdem oft schon die ersten Fehler auf.

**Werkzeug:** `scripts/inventory.cjs`, Screenshots ansehen, Quellcode lesen.

## Vorgehen

1. `node <skill>/scripts/inventory.cjs --url <URL> --crawl 5` ausführen und die Screenshots mit dem Read-Tool ansehen.
2. Im Code die Routen und Datenquellen nachsehen (Router-Konfiguration, API-Aufrufe, `invoke()` bei Tauri, localStorage/IndexedDB-Zugriffe).
3. Eine **Testlandkarte** schreiben (kommt in den Bericht):

```markdown
| Bereich / Ablauf | Daten (wo gespeichert) | Risiko | Testarten |
|---|---|---|---|
| Zeiteintrag anlegen/bearbeiten | API /api/entries → DB | hoch (Kernfunktion) | T2 T3 T4 T7 |
| Einstellungen | localStorage "settings" | mittel | T2 T3 |
| CSV-Export | Download | mittel | T9 |
| Dashboard | nur lesen | niedrig | T5 T6 |
```

Risiko hoch = Kernablauf, Geld, Daten anderer, schwer rückgängig zu machen, oft geändert.

4. Für jeden Bereich mit hohem Risiko eine **Mission** in einem Satz formulieren:
   *„Erkunde **[Bereich]** mit **[Daten/Mitteln]**, um **[gesuchte Information]** herauszufinden.“*
   Beispiel: „Erkunde das Anlegen von Zeiteinträgen mit Grenzwerten bei Dauer und Datum, um herauszufinden, ob ungültige Einträge gespeichert werden.“
   Eine Mission gibt dir eine Richtung und lässt trotzdem Raum, Auffälligkeiten nachzugehen. „Teste die App“ ist zu vage.

## Prüfkriterien: Woran erkenne ich einen Fehler? (HICCUPS)

Viele Fehler werfen keine Exception. Ob etwas falsch ist, erkennst du nur am Vergleich mit einer Erwartung. Diese Blickwinkel helfen, solche Erwartungen zu finden. Sie sind keine Checkliste, sondern Denkwerkzeuge. Geh sie bei jedem Bereich kurz durch:

| | Kriterium | Frage |
|---|---|---|
| **H** | Historie | Verhält es sich wie vorher? (Git-Historie, ältere Version, Changelog) |
| **I** | Image | Passt es zum Qualitätsanspruch? Wirkt es fertig, oder sind Texte abgeschnitten, Platzhalter sichtbar, Ladezustände ohne Ende? |
| **C** | Vergleichbares | Wie machen es ähnliche Apps? (Strg+S speichert, Esc schließt, Doppelklick öffnet) |
| **C** | Zusagen | Hält es, was README, Hilfetexte, Beschriftungen und Tooltips versprechen? („Export als CSV“ → ist es wirklich CSV und öffnet in Excel richtig?) |
| **U** | Benutzererwartung | Würde ein normaler Benutzer verstehen, was passiert? Wird er vor Datenverlust gewarnt? |
| **P** | Produkt | Ist es in sich stimmig? Gleiche Begriffe, gleiche Datumsformate, gleiche Fehlermeldungsart überall? |
| **S** | Standards | WCAG (→ T6), Tastaturkonventionen, deutsches Zahlen-/Datumsformat, DSGVO-relevante Daten |
| **F** | Vertrautheit | Findet sich jemand ohne Erklärung zurecht? |
| **E** | Erklärbarkeit | Kannst du das Verhalten erklären? Wenn nicht, ist es wahrscheinlich ein Fehler. |
| **W** | Echte Welt | Andere Zeitzone, Sommerzeitwechsel, langer Name, langsames Netz, kleiner Bildschirm |

(Nach Michael Bolton / James Bach, Rapid Software Testing.)

Notiere jede Beobachtung sofort mit Schritten, Screenshot und welchem Kriterium sie widerspricht. Das wird später die Begründung im Bericht („Widerspricht der Beschriftung ‚Stunden‘: 2,5 wird als 25 gespeichert“).

## Ergebnis

- Testlandkarte und Missionen
- Liste der stabilen Selektoren für die Szenarien (`data-testid`, Rollen + Namen, Labels)
- Erste Auffälligkeiten
