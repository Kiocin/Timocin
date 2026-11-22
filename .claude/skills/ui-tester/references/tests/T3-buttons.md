# T3 – Buttons

**Ziel:** Jeder Button tut etwas, und zwar das, was seine Beschriftung verspricht. Er ist verständlich beschriftet, groß genug und sieht aus wie die anderen Buttons seiner Art.

**Werkzeuge:** `scripts/buttons.cjs`, danach Szenario für die fachliche Wirkung.

## Automatisch

```bash
node <skill>/scripts/buttons.cjs --url <URL> --pages /berichte,/einstellungen
node <skill>/scripts/buttons.cjs --url <URL> --viewport 375x667      # mobile Ansicht: andere Buttons, Mindestgröße 44px
```

Jeder Button wird **einzeln in frischem Zustand** geklickt (Seite neu geladen). Gemessen wird, ob danach etwas passiert: DOM-Änderung, Navigation, Request, Dialog, neues Fenster, Download. Gemeldet werden:

| Prüfung | Befund |
|---|---|
| Funktion | „Klick ohne erkennbare Wirkung“, „nicht klickbar“ (verdeckt, außerhalb), JS-Fehler beim Klick |
| Beschriftung | keine Beschriftung; nur Symbol (🗑, ✎, ×) ohne `aria-label`; nichtssagend („OK“, „Hier“, „Weiter“ ohne Kontext); englisch in deutscher Oberfläche; gleiche Beschriftung mehrfach |
| Größe | kleiner als 24×24 px (WCAG 2.5.8), auf Touch-Geräten < 44×44 px |
| Einheitlichkeit | Buttons einer Reihe mit unterschiedlicher Höhe oder Schrift |

**Riskante Buttons** (Löschen, Abmelden, Senden, Bezahlen, Zurücksetzen) werden standardmäßig *nicht* geklickt, nur Beschriftung und Größe geprüft. Mit `--all` werden auch sie geklickt (nur Testumgebung). Löschen wird ohnehin in T10 gezielt getestet.

## Was das Skript nicht weiß

„Etwas passiert“ heißt nicht „das Richtige passiert“. Prüfe die wichtigsten Buttons im Szenario mit echter Erwartung:

| Button | Erwartung prüfen |
|---|---|
| Speichern | Daten wirklich gespeichert (T10), Erfolgsmeldung, Dialog schließt |
| Abbrechen | Änderungen verworfen, nichts gespeichert, ggf. Rückfrage bei ungespeicherten Änderungen |
| Löschen | Rückfrage, danach weg; „Abbrechen“ in der Rückfrage löscht nicht |
| Export | Datei kommt und hat den richtigen Inhalt (T14) |
| Zurück/Schließen | richtiger Zielort, kein Datenverlust ohne Warnung |
| Deaktivierte Buttons | wirklich nicht auslösbar (auch per Tastatur: Fokus + Enter), und erkennbar warum deaktiviert |
| Doppelklick | keine doppelte Aktion (T13) |

```js
await check('T3 Abbrechen verwirft Änderungen', async () => {
  await page.getByRole('button', { name: /bearbeiten/i }).first().click();
  const feld = page.getByLabel(/name/i);
  const vorher = await feld.inputValue();
  await feld.fill('NICHT SPEICHERN');
  await page.getByRole('button', { name: /abbrechen/i }).click();
  await page.reload();
  assertEqual(await page.getByText('NICHT SPEICHERN').count(), 0, 'abgebrochene Änderung gespeichert');
});
await check('T3 Deaktivierter Button nicht per Tastatur auslösbar', async () => {
  const b = page.getByRole('button', { name: /speichern/i });
  if (await b.isDisabled()) { await b.focus().catch(() => {}); await page.keyboard.press('Enter'); /* … prüfen, dass nichts passiert … */ }
});
```

Außerdem: Ladezustand. Während eine Aktion läuft, sollte der Button gesperrt sein oder einen Spinner zeigen (mit langsamem Netz testen, T7).

## Typische Fehler

„Abbrechen“ ohne Funktion oder speichert trotzdem, Icon-Buttons ohne Namen, Klickfläche nur das Icon statt des ganzen Buttons, Buttons in Tabellenzeilen zu klein, uneinheitliche Primär-/Sekundär-Buttons, deaktivierte Buttons ohne Erklärung, Button reagiert erst beim zweiten Klick (Fokus-/Blur-Probleme).
