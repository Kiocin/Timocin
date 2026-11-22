# T9 – Dateien, Dialoge und Fenster

**Ziel:** Export, Import, Upload, Druck, Bestätigungsdialoge und neue Fenster funktionieren und liefern korrekte Inhalte.

**Werkzeug:** Szenario `T9-<name>.cjs`.

## Export / Download

Nicht nur prüfen, *dass* eine Datei kommt, sondern ihren *Inhalt*: Stimmen die Daten mit dem überein, was in der App steht?

```js
await check('T9 CSV-Export enthält die angelegten Daten', async () => {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /export|csv/i }).click(),
  ]);
  const file = path.join(OUT, download.suggestedFilename());
  await download.saveAs(file);
  const buf = fs.readFileSync(file);
  const text = buf.toString('utf8');
  assert(text.includes(name), 'angelegter Eintrag fehlt im Export');
  console.log(`   → BOM: ${buf[0] === 0xef}, Trennzeichen: ${text.split('\n')[0].includes(';') ? ';' : ','}, Zeilen: ${text.trim().split('\n').length}`);
  // Excel (de) erwartet meist ";" und UTF-8 mit BOM, sonst kaputte Umlaute. Summen nachrechnen.
});
```

PDF-Export: Datei speichern und mit dem Read-Tool ansehen.

## Import / Upload

```js
const input = page.locator('input[type=file]').first();
for (const f of [
  { name: 'gueltig.csv', mimeType: 'text/csv', buffer: Buffer.from('name;stunden\nImport Ä;2,5\n') },
  { name: 'leer.csv', mimeType: 'text/csv', buffer: Buffer.alloc(0) },
  { name: 'falsch.png', mimeType: 'image/png', buffer: Buffer.from('kein bild') },
  { name: 'gross.csv', mimeType: 'text/csv', buffer: Buffer.alloc(20 * 1024 * 1024, 'a') },
  { name: 'kaputt.csv', mimeType: 'text/csv', buffer: Buffer.from('"ungeschlossen;\n;;;;\n') },
]) {
  await check(`T9 Upload ${f.name}`, async () => {
    await input.setInputFiles(f);
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, `T9-upload-${f.name}.png`) });
    assert((await page.locator('body').innerText()).trim().length > 0, 'leere Seite');
  });
}
```

Bei Drag & Drop ohne `input[type=file]` das `DataTransfer`-Event per `page.evaluate` auslösen oder den versteckten Input suchen.

## Dialoge

- `confirm`/`alert`/`prompt`: `page.on('dialog', d => d.dismiss())` *und* `d.accept()`. Beide Wege müssen sauber funktionieren.
- `beforeunload` (Warnung vor ungespeicherten Änderungen): Formular ausfüllen, dann `page.close({ runBeforeUnload: true })` und prüfen, ob ein Dialog kommt.
- Eigene Modals: siehe T6 (Fokus, Escape).
- **Native Dialoge** (Tauri Datei-öffnen/-speichern) sind keine Webseiten und lassen sich nicht per Playwright bedienen. Im Mock (`plugin:dialog|open`) einen festen Pfad zurückgeben, oder den Benutzer bitten.

## Neue Fenster und Tabs

```js
const [popup] = await Promise.all([context.waitForEvent('page'), page.getByRole('link', { name: /hilfe|vorschau|drucken/i }).click()]);
await popup.waitForLoadState();
console.log(popup.url(), await popup.title());
```

Druckansicht: `await page.emulateMedia({ media: 'print' }); await page.pdf({ path: path.join(OUT, 'druck.pdf') })` (nur headless Chromium). Ansehen: Sind Navigation und Buttons ausgeblendet, passt die Tabelle auf die Seite?

## Typische Fehler

Umlaute im CSV kaputt, falsches Trennzeichen für deutsches Excel, Export enthält nur die aktuelle Seite statt aller Daten, Datumsformat im Export anders als in der App, Import akzeptiert falsche Dateien still, großer Upload friert die Seite ein, Abbrechen im Bestätigungsdialog löscht trotzdem.
