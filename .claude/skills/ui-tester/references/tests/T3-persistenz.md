# T3 – Persistenz (bleiben Daten erhalten?)

**Ziel:** Gespeicherte Daten überstehen Neuladen, neuen Tab, neue Sitzung und bei Desktop-Apps den Neustart, und zwar unverändert. Außerdem: Die App verkraftet alte oder kaputte gespeicherte Daten.

**Werkzeug:** Szenario `T3-<name>.cjs`, `inventory.cjs` (zeigt, welche Speicher genutzt werden).

## Was prüfen

1. **Reload:** Daten nach `page.reload()` noch da und gleich.
2. **Neuer Tab:** gleiche Daten in einem zweiten Tab, ohne Neuladen des ersten.
3. **Neue Sitzung mit Login** (`storageState`): Daten noch da.
4. **Neue Sitzung ohne Browser-Speicher:** zeigt, ob Daten wirklich auf dem Server liegen oder nur lokal im Browser. Beides kann gewollt sein, sollte aber bewusst sein.
5. **Kaputter/alter Speicherzustand:** ungültiges JSON, fehlende Felder, alte Datenstruktur → die App darf nicht weiß werden.
6. **Tauri/Desktop:** App beenden, neu starten, Daten prüfen; Datei bzw. Datenbank direkt ansehen (siehe `../tauri.md`).

## Vorlage

```js
const name = unique('Persistenz');
// … Eintrag anlegen wie in T2 …

await check('Daten überleben Reload', async () => {
  await page.reload();
  await page.getByText(name).waitFor({ timeout: 5000 });
});
await check('Daten im zweiten Tab sichtbar', async () => {
  const tab2 = await context.newPage();
  await tab2.goto(URL);
  await tab2.getByText(name).waitFor({ timeout: 5000 });
  await tab2.close();
});
await check('Daten in neuer Sitzung mit gleichem Login', async () => {
  const ctx2 = await browser.newContext({ storageState: await context.storageState() });
  const p2 = await ctx2.newPage();
  await p2.goto(URL);
  await p2.getByText(name).waitFor({ timeout: 5000 });
  await ctx2.close();
});
await check('Kaputter localStorage führt nicht zum Absturz', async () => {
  const keys = await page.evaluate(() => Object.keys(localStorage));
  const backup = await page.evaluate(() => JSON.stringify(localStorage));
  for (const k of keys) await page.evaluate((k) => localStorage.setItem(k, '{kaputt'), k);
  await page.reload();
  const text = (await page.locator('body').innerText()).trim();
  await page.evaluate((b) => { localStorage.clear(); Object.entries(JSON.parse(b)).forEach(([k, v]) => localStorage.setItem(k, v)); }, backup);
  assert(text.length > 0, 'Seite bleibt leer bei kaputtem localStorage');
});
```

Speicher direkt auslesen:

```js
const storage = await page.evaluate(async () => ({
  local: Object.fromEntries(Object.entries(localStorage)),
  session: Object.fromEntries(Object.entries(sessionStorage)),
  idb: (await indexedDB.databases?.()) || [],
}));

// IndexedDB-Store lesen
const rows = await page.evaluate(({ db, store }) => new Promise((resolve, reject) => {
  const req = indexedDB.open(db);
  req.onsuccess = () => {
    const all = req.result.transaction(store, 'readonly').objectStore(store).getAll();
    all.onsuccess = () => resolve(all.result);
    all.onerror = () => reject(all.error);
  };
  req.onerror = () => reject(req.error);
}), { db: 'meineDb', store: 'eintraege' });
```

## Typische Fehler

Nur im State gespeichert, nicht persistiert. Speichern erst beim Verlassen der Seite (geht beim Schließen verloren). Datum nach Reload als String statt Date (Rechenfehler). Neuere App-Version kann alte Daten nicht lesen. Nach Reload sind Filter/Sortierung weg (kann gewollt sein, nachfragen).
