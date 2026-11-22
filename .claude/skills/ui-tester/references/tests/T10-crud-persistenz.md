# T10 – CRUD und Persistenz (Speichern, Lesen, Ändern, Löschen, Erhalt der Daten)

**Ziel:** Die Kernabläufe funktionieren, und es kommt genau das wieder heraus, was hineingegeben wurde. Das ist die wichtigste Testart, weil stille Datenfehler (falscher Wert, falsche Zuordnung, Rundung) sonst niemand bemerkt.

**Werkzeuge:** Szenario auf Basis von `assets/szenario-vorlage.cjs`, Datei `T10-<ablauf>.cjs` (über die Oberfläche). Ergänzend: `api.cjs --write` (CRUD-Rundlauf direkt an der API, T12) und `db.cjs` (was wirklich in der Datenbank steht, T11).

**Drei Ebenen vergleichen:** Was der Benutzer eingibt → was die API zurückgibt → was in der Datenbank steht → was die Oberfläche danach anzeigt. Weichen zwei Ebenen ab, ist es ein Fehler, z. B. Zeitzone, Rundung, abgeschnittener Text oder falsches Feld.

**Fachliche Regeln klären (fragen, wenn nicht dokumentiert):**
- *Dürfen Datensätze überhaupt gelöscht werden?* Oft gilt: nur eigene, nur ohne abhängige Daten (Projekt mit Zeiteinträgen?), nur von Admins, oder nur „archivieren“ statt löschen. Testen: Löschen mit abhängigen Daten. Wird verhindert, kaskadiert oder bleiben verwaiste Einträge (T11)?
- *Dürfen bestimmte Felder geändert werden?* ID, Ersteller, Erstellungsdatum, abgerechnete/freigegebene Einträge, Einträge abgeschlossener Monate. Testen über die Oberfläche (ist das Feld gesperrt?) **und** direkt an der API (T12 prüft ID/Erstellungsdatum automatisch). Eine gesperrte Oberfläche reicht nicht, wenn die API die Änderung trotzdem annimmt.

## Was prüfen

- **Anlegen:** Eintrag erscheint in Liste und Detailansicht, mit *allen* eingegebenen Feldern exakt richtig (Text, Zahl, Datum, Auswahl, Checkbox).
- **Lesen:** Liste, Detail, Suche, Filter und Sortierung zeigen denselben Datensatz konsistent. Summen und Zähler stimmen.
- **Ändern:** Nur das geänderte Feld ändert sich, nicht auch andere Einträge.
- **Löschen:** wirklich weg (auch nach Reload), Bestätigungsdialog auch mit „Abbrechen“ testen, andere Einträge unberührt.
- **Abgeleitete Werte:** Summen, Dauer aus Start/Ende, Statistiken mit einem selbst nachgerechneten Wert vergleichen.

Verwende eindeutige Werte (`unique()`), damit du den Eintrag sicher wiederfindest, und Umlaute/Sonderzeichen, weil Kodierungsfehler häufig sind.

## Vorlage

```js
const name = unique('Eintrag Ümlaut &');
await check('Anlegen', async () => {
  await page.getByRole('button', { name: /neu|hinzufügen|anlegen/i }).click();
  await page.getByLabel(/name|titel/i).fill(name);
  await page.getByLabel(/stunden|dauer/i).fill('2,5');
  await page.getByRole('button', { name: /speichern/i }).click();
  await page.getByText(name).waitFor({ timeout: 5000 });
});
await check('Angezeigte Werte stimmen exakt', async () => {
  const row = page.locator('tr, li, [role=row]').filter({ hasText: name });
  assertEqual(await row.count(), 1, 'Anzahl Einträge');
  const text = await row.innerText();
  assert(/2[,.]5/.test(text), `Stunden falsch angezeigt: "${text}"`);
});
await check('Ändern betrifft nur diesen Eintrag', async () => {
  const before = await page.locator('tr, li, [role=row]').count();
  await page.locator('tr, li').filter({ hasText: name }).getByRole('button', { name: /bearbeiten|edit/i }).click();
  await page.getByLabel(/name|titel/i).fill(name + ' geändert');
  await page.getByRole('button', { name: /speichern/i }).click();
  await page.getByText(name + ' geändert').waitFor();
  assertEqual(await page.locator('tr, li, [role=row]').count(), before, 'Anzahl Zeilen nach Ändern');
});
await check('Löschen abbrechen behält Eintrag', async () => {
  page.once('dialog', (d) => d.dismiss());
  await page.locator('tr, li').filter({ hasText: name }).getByRole('button', { name: /löschen|entfernen/i }).click();
  await page.waitForTimeout(300);
  assertEqual(await page.getByText(name + ' geändert').count(), 1, 'Eintrag nach Abbrechen');
});
await check('Löschen entfernt Eintrag', async () => {
  page.once('dialog', (d) => d.accept());
  await page.locator('tr, li').filter({ hasText: name }).getByRole('button', { name: /löschen|entfernen/i }).click();
  await page.getByText(name).waitFor({ state: 'detached', timeout: 5000 });
});
```

Speichert die App über eine API, prüfe zusätzlich, was wirklich gesendet und zurückgegeben wird:

```js
const [res] = await Promise.all([
  page.waitForResponse((r) => r.request().method() !== 'GET' && /\/api\//.test(r.url())),
  page.getByRole('button', { name: /speichern/i }).click(),
]);
assert(res.ok(), `Speichern-API antwortet ${res.status()}`);
const sent = res.request().postDataJSON?.();
const body = await res.json().catch(() => null);
// sent/body mit den Eingaben vergleichen: Zahl als String? Datum in UTC verschoben? Feld fehlt?
```

Bei Tauri mit Mock (siehe `tauri.md`): `await page.evaluate(() => window.__tauriCalls)` zeigt, mit welchen Argumenten das Backend aufgerufen wurde.

## Typische Fehler

Komma/Punkt bei Dezimalzahlen, Datum um einen Tag verschoben (Zeitzone), HTML-Escaping doppelt oder gar nicht, Liste aktualisiert sich nach dem Speichern nicht, beim Bearbeiten wird ein neuer Eintrag angelegt, Löschen trifft den falschen Eintrag (Index statt ID).

---

## Teil B: Persistenz – bleiben Daten erhalten?

**Ziel:** Gespeicherte Daten überstehen Neuladen, neuen Tab, neue Sitzung und bei Desktop-Apps den Neustart, und zwar unverändert. Außerdem: Die App verkraftet alte oder kaputte gespeicherte Daten.

**Werkzeug:** Szenario `T10-<name>.cjs`, `inventory.cjs` (zeigt, welche Speicher genutzt werden).

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
// … Eintrag anlegen wie in T10 …

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
