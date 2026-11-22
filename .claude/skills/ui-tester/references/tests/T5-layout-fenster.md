# T5 – Layout und Fenstergrößen

**Ziel:** Die App ist in jeder üblichen Fenstergröße benutzbar. Nichts ragt heraus, nichts ist abgeschnitten oder verdeckt, und die Kernabläufe funktionieren auch schmal. Beim Vergrößern und Verkleinern im laufenden Betrieb geht nichts kaputt.

**Werkzeug:** `scripts/viewports.cjs` (automatisch), Szenario `T5-<name>.cjs` für Abläufe in schmaler Ansicht.

## Vorgehen

1. `node <skill>/scripts/viewports.cjs --url <URL>` für die wichtigsten Seiten ausführen. Für Desktop-Apps (Tauri) eigene Größen wählen, z. B. `--sizes 800x600,1024x768,1366x768,1920x1080,2560x1440`, plus die `minWidth`/`minHeight` aus `tauri.conf.json`.
2. **Screenshots ansehen.** Das Skript findet Überlauf und Abschneiden, aber keine überlappenden Texte, unlesbaren Kontraste oder unsinnige Anordnungen. Das sieht man nur im Bild.
3. Den wichtigsten Ablauf aus T2 bei 375×667 und bei der kleinsten Desktopgröße wiederholen (Burger-Menü, Modals, Tabellen).
4. **Wechsel im laufenden Betrieb:** Modal oder Dropdown öffnen → verkleinern → vergrößern. Bleibt es bedienbar? Gehen Eingaben verloren?
5. Zoom 200 % simulieren (WCAG 1.4.4): `deviceScaleFactor` ändert das nicht. Stattdessen die Breite halbieren (1280 → 640) oder `document.body.style.zoom = 2`.

## Vorlage

```js
for (const [w, h] of [[375, 667], [768, 1024], [1920, 1080]]) {
  await check(`T5 Kernablauf bei ${w}×${h}`, async () => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(URL);
    const burger = page.getByRole('button', { name: /menü|menu|navigation/i });
    if (await burger.isVisible().catch(() => false)) await burger.click();
    // … Ablauf aus T2 …
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert(overflow <= 1, `horizontaler Überlauf ${overflow}px`);
    await page.screenshot({ path: `${OUT}/T5-${w}x${h}.png`, fullPage: true });
  });
}

await check('T5 Modal übersteht Größenwechsel', async () => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: /neu|hinzufügen/i }).click();
  await page.getByLabel(/name/i).fill('bleibt erhalten?');
  await page.setViewportSize({ width: 375, height: 667 });
  await page.setViewportSize({ width: 1280, height: 800 });
  assertEqual(await page.getByLabel(/name/i).inputValue(), 'bleibt erhalten?', 'Eingabe nach Größenwechsel');
});
```

Echte Mobilgeräte emulieren (Touch, Pixeldichte, User-Agent): `browser.newContext({ ...require('playwright').devices['iPhone 13'] })`.

Echtes Fenster einer Tauri-App vergrößern, verkleinern, maximieren, minimieren: siehe `../tauri.md` (Weg B).

## Typische Fehler

Tabellen ohne horizontales Scrollen, feste Breiten in `px`, Modals höher als das Fenster ohne Scrollen, Burger-Menü schließt nicht, Buttons verdecken sich, Text in Buttons abgeschnitten (besonders bei langen deutschen Wörtern), Layout springt bei Größenwechsel und verliert Zustand.
