# Vorlagen für gezielte Szenarien

Bausteine für Playwright-Skripte. Passe Selektoren und Texte an die App an (Ergebnis von `inventory.cjs`). Die Vorlagen sind eigenständige Node-Skripte (`.cjs`). Hat das Projekt schon `@playwright/test`, schreib stattdessen eine Spec mit `test()`/`expect()`. Die Logik bleibt gleich.

## Inhalt
1. Grundgerüst mit Fehlersammlung
2. Daten speichern und lesen (CRUD)
3. Persistenz: Reload, neuer Tab, neuer Browser
4. Browser-Speicher direkt prüfen
5. Validierung und Grenzwerte
6. Fenstergröße und mobile Ansicht
7. Unordentliches Verhalten: Doppelklick, Zurück, zwei Tabs
8. Netzwerkprobleme simulieren
9. Dialoge, Downloads, Uploads, neue Fenster
10. Tastaturbedienung

---

## 1. Grundgerüst

```js
// szenario-<name>.cjs – im Projektordner ausführen: node szenario-<name>.cjs
const { chromium } = require('playwright');
const URL = process.env.APP_URL || 'http://localhost:5173';
const OUT = 'ui-test-results/szenarien';
require('fs').mkdirSync(OUT, { recursive: true });

const results = [];
const errors = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`✔ ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: e.message.split('\n')[0] });
    console.log(`✘ ${name}: ${e.message.split('\n')[0]}`);
    await page.screenshot({ path: `${OUT}/${name.replace(/\W+/g, '_')}.png` }).catch(() => {});
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

let browser, context, page;
(async () => {
  browser = await chromium.launch(); // { headless: false } zum Zuschauen
  context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  page.on('response', (r) => r.status() >= 500 && errors.push(`HTTP ${r.status()} ${r.url()}`));
  await page.goto(URL);

  // … Szenarien hier …

  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} ok`);
  if (errors.length) console.log('Fehler während der Szenarien:\n  ' + [...new Set(errors)].join('\n  '));
  await browser.close();
})();
```

Warten: `await page.getByText('Gespeichert').waitFor()` oder `await locator.waitFor({ state: 'visible' })` statt fester Pausen. Für Werte: `await locator.inputValue()`, `await locator.innerText()`, `await locator.count()`.

## 2. Daten speichern und lesen (CRUD)

Der wichtigste Test: Kommt genau das wieder heraus, was hineingegeben wurde? Verwende eindeutige Werte (Zeitstempel), damit du den Eintrag sicher wiederfindest, und Sonderzeichen, weil Kodierungsfehler häufig sind.

```js
const unique = `Test ${Date.now()} Ümlaut & <b>`;
await check('Anlegen', async () => {
  await page.getByRole('button', { name: /neu|hinzufügen|anlegen/i }).click();
  await page.getByLabel(/name|titel/i).fill(unique);
  await page.getByLabel(/stunden|dauer/i).fill('2,5');
  await page.getByRole('button', { name: /speichern/i }).click();
  await page.getByText(unique).waitFor({ timeout: 5000 });
});
await check('Angezeigte Werte stimmen', async () => {
  const row = page.locator('tr, li, [role=row]').filter({ hasText: unique });
  assert((await row.count()) === 1, `erwartet 1 Eintrag, gefunden ${await row.count()}`);
  const text = await row.innerText();
  assert(/2[,.]5/.test(text), `Stunden falsch angezeigt: "${text}"`);
});
await check('Bearbeiten', async () => {
  await page.locator('tr, li').filter({ hasText: unique }).getByRole('button', { name: /bearbeiten|edit/i }).click();
  await page.getByLabel(/name|titel/i).fill(unique + ' geändert');
  await page.getByRole('button', { name: /speichern/i }).click();
  await page.getByText(unique + ' geändert').waitFor();
});
await check('Löschen', async () => {
  page.once('dialog', (d) => d.accept());
  await page.locator('tr, li').filter({ hasText: unique }).getByRole('button', { name: /löschen|entfernen|delete/i }).click();
  await page.getByText(unique).waitFor({ state: 'detached', timeout: 5000 });
});
```

Wenn die App über eine API speichert, prüfe zusätzlich die Antwort:

```js
const [res] = await Promise.all([
  page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\//.test(r.url())),
  page.getByRole('button', { name: /speichern/i }).click(),
]);
assert(res.ok(), `Speichern-API antwortet ${res.status()}`);
const body = await res.json().catch(() => null); // gespeicherte Werte mit Eingabe vergleichen
```

## 3. Persistenz

```js
await check('Daten überleben Reload', async () => {
  await page.reload();
  await page.getByText(unique).waitFor({ timeout: 5000 });
});
await check('Daten in neuem Tab sichtbar', async () => {
  const tab2 = await context.newPage();
  await tab2.goto(URL);
  await tab2.getByText(unique).waitFor({ timeout: 5000 });
  await tab2.close();
});
await check('Daten in neuem Browser (gleiches Login)', async () => {
  const state = await context.storageState(); // Cookies + localStorage
  const ctx2 = await browser.newContext({ storageState: state });
  const p2 = await ctx2.newPage();
  await p2.goto(URL);
  await p2.getByText(unique).waitFor({ timeout: 5000 });
  await ctx2.close();
});
```

Bei Server-Daten zeigt nur der neue Kontext *ohne* storageState, ob die Daten wirklich auf dem Server liegen oder nur im Browser. Bei Tauri: App beenden und neu starten (siehe `tauri.md`).

## 4. Browser-Speicher direkt prüfen

```js
const storage = await page.evaluate(async () => ({
  local: Object.fromEntries(Object.entries(localStorage)),
  session: Object.fromEntries(Object.entries(sessionStorage)),
  idb: (await indexedDB.databases?.()) || [],
}));
console.log(JSON.stringify(storage, null, 2));
```

IndexedDB-Inhalt eines Stores lesen:

```js
const rows = await page.evaluate(({ db, store }) => new Promise((resolve, reject) => {
  const req = indexedDB.open(db);
  req.onsuccess = () => {
    const tx = req.result.transaction(store, 'readonly');
    const all = tx.objectStore(store).getAll();
    all.onsuccess = () => resolve(all.result);
    all.onerror = () => reject(all.error);
  };
  req.onerror = () => reject(req.error);
}), { db: 'meineDb', store: 'eintraege' });
```

Kaputten Speicherzustand testen (alte Version, manuell verändert): `localStorage.setItem('key', '{kaputt')` und neu laden. Die App sollte nicht weiß werden.

## 5. Validierung und Grenzwerte

```js
const cases = [
  { feld: /stunden/i, wert: '', erwartet: 'Fehlermeldung oder Standardwert' },
  { feld: /stunden/i, wert: '-5' },
  { feld: /stunden/i, wert: '25' },          // mehr als ein Tag
  { feld: /stunden/i, wert: '1e309' },
  { feld: /name/i, wert: 'x'.repeat(5000) },
  { feld: /name/i, wert: '   ' },
  { feld: /datum/i, wert: '2026-02-30' },
];
for (const c of cases) {
  await check(`Validierung ${c.feld} = ${JSON.stringify(c.wert.slice(0, 20))}`, async () => {
    await page.goto(URL);
    const f = page.getByLabel(c.feld);
    await f.fill(c.wert).catch(async () => { await f.click(); await page.keyboard.type(c.wert); });
    await page.getByRole('button', { name: /speichern/i }).click();
    await page.waitForTimeout(300);
    const invalid = await f.evaluate((el) => el.validity && !el.validity.valid);
    const msg = await page.locator('[role=alert], .error, .invalid-feedback, [aria-invalid=true]').count();
    console.log(`   → HTML-Validierung: ${invalid ? 'blockiert' : 'nein'}, sichtbare Meldungen: ${msg}`);
    // Entscheidend: kein Absturz und kein unsinniger Eintrag in der Liste
  });
}
```

Prüfe danach, ob ungültige Werte trotzdem gespeichert wurden. Das ist ein stiller Fehler.

## 6. Fenstergröße und mobile Ansicht

```js
for (const [w, h] of [[375, 667], [768, 1024], [1920, 1080]]) {
  await check(`Kernablauf bei ${w}×${h}`, async () => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(URL);
    // Navigation ggf. über Burger-Menü
    const burger = page.getByRole('button', { name: /menü|menu|navigation/i });
    if (await burger.isVisible().catch(() => false)) await burger.click();
    // … Ablauf aus Abschnitt 2 …
    await page.screenshot({ path: `${OUT}/ablauf-${w}x${h}.png`, fullPage: true });
  });
}
```

Echte Geräte emulieren (Touch, Pixeldichte, User-Agent):

```js
const { devices } = require('playwright');
const mobile = await browser.newContext({ ...devices['iPhone 13'] });
```

Fenster während der Arbeit verkleinern und wieder vergrößern: Ein offenes Modal oder Dropdown sollte erhalten bleiben und erreichbar sein.

## 7. Unordentliches Verhalten

```js
await check('Doppelklick auf Speichern erzeugt keinen Doppeleintrag', async () => {
  const v = `Doppel ${Date.now()}`;
  await page.getByLabel(/name/i).fill(v);
  await page.getByRole('button', { name: /speichern/i }).dblclick();
  await page.waitForTimeout(1000);
  await page.reload();
  const n = await page.getByText(v).count();
  assert(n === 1, `${n} Einträge statt 1`);
});
await check('Zurück-Button mitten im Formular', async () => {
  await page.getByLabel(/name/i).fill('halb ausgefüllt');
  await page.goBack();
  await page.goForward();
  // Erwartung je nach App: Warnung vor Datenverlust, Entwurf erhalten, oder zumindest kein Absturz
});
await check('Zwei Tabs bearbeiten denselben Datensatz', async () => {
  const a = page, b = await context.newPage();
  await b.goto(page.url());
  // in a ändern + speichern, dann in b ändern + speichern → wird a überschrieben? Gibt es eine Konfliktmeldung?
  await b.close();
});
await check('Reload während des Speicherns', async () => {
  await page.getByRole('button', { name: /speichern/i }).click({ noWaitAfter: true });
  await page.reload();
  // Halber Eintrag? Doppelter Eintrag? Fehler?
});
```

## 8. Netzwerkprobleme

```js
await check('Offline speichern', async () => {
  await context.setOffline(true);
  await page.getByRole('button', { name: /speichern/i }).click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/offline.png` }); // verständliche Meldung? Daten noch im Formular?
  await context.setOffline(false);
});
await check('Server-Fehler 500', async () => {
  await page.route('**/api/**', (r) => (r.request().method() !== 'GET' ? r.fulfill({ status: 500, body: '{"error":"boom"}' }) : r.continue()));
  await page.getByRole('button', { name: /speichern/i }).click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/server-500.png` });
  await page.unroute('**/api/**');
});
await check('Langsames Netz (3 s Verzögerung)', async () => {
  await page.route('**/api/**', async (r) => { await new Promise((s) => setTimeout(s, 3000)); await r.continue(); });
  await page.getByRole('button', { name: /speichern/i }).click();
  // Ladeanzeige sichtbar? Button gesperrt gegen Doppelklick?
  await page.screenshot({ path: `${OUT}/langsam.png` });
  await page.unroute('**/api/**');
});
```

## 9. Dialoge, Downloads, Uploads, neue Fenster

```js
page.on('dialog', (d) => { console.log(`Dialog: ${d.message()}`); d.dismiss(); }); // auch "Abbrechen" testen!

const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /export|csv|pdf/i }).click()]);
const file = `${OUT}/${download.suggestedFilename()}`;
await download.saveAs(file); // Inhalt lesen und mit den angelegten Daten vergleichen (Umlaute, Trennzeichen, Summen)

await page.getByLabel(/datei|upload|import/i).setInputFiles({ name: 'test.csv', mimeType: 'text/csv', buffer: Buffer.from('a;b\n1;2\n') });
// auch: leere Datei, falscher Typ, sehr große Datei

const [popup] = await Promise.all([context.waitForEvent('page'), page.getByRole('link', { name: /hilfe/i }).click()]);
await popup.waitForLoadState();
```

## 10. Tastaturbedienung

```js
await page.goto(URL);
for (let i = 0; i < 25; i++) {
  await page.keyboard.press('Tab');
  const f = await page.evaluate(() => {
    const el = document.activeElement;
    const r = el.getBoundingClientRect();
    return `${el.tagName.toLowerCase()} "${(el.innerText || el.getAttribute('aria-label') || el.name || '').trim().slice(0, 30)}" sichtbar=${r.width > 0 && r.bottom > 0 && r.top < innerHeight}`;
  });
  console.log(`Tab ${i + 1}: ${f}`);
}
// Escape schließt Modals? Enter sendet Formulare ab? Fokus springt nach dem Schließen eines Dialogs sinnvoll zurück?
```
