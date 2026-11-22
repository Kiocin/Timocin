# T2 – Layout und Positionierung

**Ziel:** Alle Elemente stehen richtig: nichts überlagert sich, nichts ist abgeschnitten, Dropdowns sind breit genug für ihre Texte, Tabellen passen oder lassen sich scrollen. Die Sidebar lässt sich sauber ein- und ausklappen, und falls vorgesehen, in der Größe ändern und verschieben. Das alles gilt in jeder üblichen Fenstergröße.

**Werkzeuge:** `scripts/layout.cjs` (Positionierung + Sidebar), `scripts/viewports.cjs` (Größen-Sweep mit Screenshots), danach Screenshots ansehen.

## Automatisch

```bash
node <skill>/scripts/layout.cjs --url <URL> --sizes 1920x1080,1280x800,1024x768,375x667 --pages /berichte,/einstellungen
node <skill>/scripts/viewports.cjs --url <URL>
```

`layout.cjs` meldet:

| Prüfung | Wie gemessen |
|---|---|
| **Verdeckte Elemente** (Buttons, Links, Felder, Überschriften, Zellen) | 15 Messpunkte je Element; liegt an ≥ 15 % ein fremdes Element obenauf, wird es mit Anteil und Verursacher gemeldet (z. B. Toast über Überschrift, Sticky-Header über Formular) |
| **Overlays** | ein Element verdeckt > 15 andere → offenes Modal/Cookie-Banner? Erst schließen, dann erneut prüfen |
| **Dropdowns zu schmal** | Textbreite der längsten Option (mit der echten Schrift gemessen) vs. Breite des `<select>`; auch eigene Dropdowns (`role=option`) |
| **Texte abgeschnitten** | `overflow: hidden`/`text-overflow: ellipsis` mit verstecktem Inhalt; Text, der aus Buttons/Zellen herausragt; ob ein Tooltip den vollen Text zeigt |
| **Tabellen abgeschnitten** | Tabelle breiter als ihr sichtbarer Bereich, ohne dass man scrollen kann |
| **Sidebar** | erkennt Sidebar, Umschalt-Button, Ziehgriff (Cursor `col-resize`) und Verschiebegriff (Cursor `move`/`grab`) und prüft: |
| | – Einklappen: ändert sich die Breite? zieht der Inhalt nach oder bleibt eine Lücke / liegt Inhalt darunter? |
| | – erneut Ausklappen: wieder exakt der Ausgangszustand? 6× schnell klicken: Zustand stabil? |
| | – `aria-expanded` am Umschalt-Button (Screenreader) |
| | – Breiter ziehen: zieht der Inhalt nach? Überlauf? Mindest- und Maximalbreite vorhanden? Wird die Breite nach Reload behalten (gewollt?) |
| | – Verschieben (falls vorgesehen): bewegt sie sich, bleibt der Inhalt bedienbar? |

Screenshots je Zustand: `*-sidebar-start.png`, `-eingeklappt`, `-breiter`, `-minimal`, `-maximal`.

## Mit dem Auge

Automatische Prüfungen finden keine schiefe Ausrichtung, ungleichmäßige Abstände oder unglückliche Umbrüche. Sieh dir deshalb **jeden Screenshot** an (Read-Tool). Achte besonders auf:
- Elemente, die bündig stehen sollten (Labels, Felder, Buttons einer Reihe)
- Umbrüche langer deutscher Wörter in Buttons, Spaltenköpfen, Menüs
- Leere Flächen, die nach Fehler aussehen (z. B. Lücke nach dem Einklappen der Sidebar)
- Hover- und Fokuszustände: Tooltip/Dropdown-Menü öffnen und Screenshot machen, denn Menüs werden oft vom Fensterrand oder von `overflow: hidden` abgeschnitten

```js
await page.getByRole('button', { name: 'Aktionen' }).click();               // Menü öffnen
await page.screenshot({ path: `${OUT}/T2-menue-offen.png` });
const menu = await page.getByRole('menu').boundingBox();
const vp = page.viewportSize();
assert(menu.x + menu.width <= vp.width && menu.y + menu.height <= vp.height, 'Menü ragt aus dem Fenster');
```

## Fenstergrößen

1. `viewports.cjs` für die wichtigsten Seiten. Für Desktop-Apps (Tauri) eigene Größen, z. B. `--sizes 800x600,1024x768,1366x768,1920x1080,2560x1440`, plus `minWidth`/`minHeight` aus `tauri.conf.json`.
2. Den wichtigsten Ablauf aus T10 bei 375×667 und bei der kleinsten Desktopgröße wiederholen (Burger-Menü, Modals, Tabellen).
3. **Wechsel im laufenden Betrieb:** Modal oder Dropdown öffnen → verkleinern → vergrößern. Bleibt es bedienbar? Gehen Eingaben verloren?
4. Zoom 200 % (WCAG 1.4.4): Breite halbieren (1280 → 640) oder `document.body.style.zoom = 2`.

```js
await check('T2 Modal übersteht Größenwechsel', async () => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: /neu|hinzufügen/i }).click();
  await page.getByLabel(/name/i).fill('bleibt erhalten?');
  await page.setViewportSize({ width: 375, height: 667 });
  await page.setViewportSize({ width: 1280, height: 800 });
  assertEqual(await page.getByLabel(/name/i).inputValue(), 'bleibt erhalten?', 'Eingabe nach Größenwechsel');
});
```

Echte Mobilgeräte: `--device "iPhone 13"` bzw. `browser.newContext({ ...devices['iPhone 13'] })`. Safari: `--browser webkit` (siehe SKILL.md, Browser). Echtes Tauri-Fenster vergrößern/verkleinern/maximieren: `../tauri.md` (Weg B).

## Typische Fehler

Toasts/Sticky-Header verdecken Inhalt, Sidebar schiebt sich über den Inhalt oder hinterlässt eine Lücke, feste Breiten in `px`, Dropdown zeigt nur „Projekt Lan…“, Menüs am rechten Rand abgeschnitten, Tabellen ohne horizontales Scrollen, Modals höher als das Fenster, Burger-Menü schließt nicht, Layout springt bei Größenwechsel und verliert Zustand.
