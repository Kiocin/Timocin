# T2 – Funktion und Daten (Speichern, Lesen, Ändern, Löschen)

**Ziel:** Die Kernabläufe funktionieren, und es kommt genau das wieder heraus, was hineingegeben wurde. Das ist die wichtigste Testart, weil stille Datenfehler (falscher Wert, falsche Zuordnung, Rundung) sonst niemand bemerkt.

**Werkzeug:** Szenario auf Basis von `assets/szenario-vorlage.cjs`, Datei `T2-<ablauf>.cjs`.

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
