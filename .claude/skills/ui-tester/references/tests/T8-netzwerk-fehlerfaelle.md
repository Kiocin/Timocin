# T8 – Netzwerk und Fehlerfälle

**Ziel:** Wenn Server oder Netz versagen, bleibt die App verständlich und verliert keine Eingaben. Es gibt eine Ladeanzeige, eine klare Meldung und die Möglichkeit, es erneut zu versuchen, statt endlosem Drehen oder einer weißen Seite.

**Werkzeug:** Szenario `T8-<name>.cjs`. Playwright fängt Requests ab und manipuliert sie (`page.route`), ohne dass der Server verändert werden muss.

Nur relevant, wenn die App über das Netz lädt oder speichert. Bei Tauri: Backend-Fehler über das Mock simulieren (der Handler wirft einen Fehler, siehe `../tauri.md`).

## Vorlage

```js
const API = '**/api/**'; // an die App anpassen (aus inventory/Netzwerk-Log)

await check('T8 Offline speichern', async () => {
  await page.getByLabel(/name/i).fill('offline gespeichert?');
  await context.setOffline(true);
  await page.getByRole('button', { name: /speichern/i }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/T8-offline.png` });
  const kept = await page.getByLabel(/name/i).inputValue().catch(() => '');
  await context.setOffline(false);
  assert(kept === 'offline gespeichert?', 'Eingabe nach fehlgeschlagenem Speichern verloren');
});

for (const status of [500, 503, 401, 403, 409, 422]) {
  await check(`T8 Server antwortet ${status} beim Speichern`, async () => {
    await page.route(API, (r) => r.request().method() !== 'GET'
      ? r.fulfill({ status, contentType: 'application/json', body: '{"error":"Testfehler"}' })
      : r.continue());
    await page.getByRole('button', { name: /speichern/i }).click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${OUT}/T8-${status}.png` });
    await page.unroute(API);
    assert((await page.locator('body').innerText()).trim().length > 0, 'leere Seite');
    // Screenshot ansehen: verständliche Meldung? Bei 401 Weiterleitung zum Login?
  });
}

await check('T8 Kaputte Antwort (kein JSON)', async () => {
  await page.route(API, (r) => r.request().method() === 'GET' ? r.fulfill({ status: 200, body: '<html>Proxy-Fehler</html>' }) : r.continue());
  await page.reload();
  await page.waitForTimeout(1000);
  await page.unroute(API);
  assert((await page.locator('body').innerText()).trim().length > 0, 'leere Seite bei kaputter Antwort');
});

await check('T8 Langsames Netz (3 s): Ladeanzeige und Sperre gegen Doppelklick', async () => {
  await page.route(API, async (r) => { await new Promise((s) => setTimeout(s, 3000)); await r.continue(); });
  const btn = page.getByRole('button', { name: /speichern/i });
  await btn.click();
  await page.waitForTimeout(300);
  const disabled = await btn.isDisabled().catch(() => false);
  const busy = await page.locator('[aria-busy=true], [role=progressbar], .spinner, .loading').count();
  await page.screenshot({ path: `${OUT}/T8-langsam.png` });
  await page.unroute(API);
  console.log(`   → Button gesperrt: ${disabled}, Ladeanzeige: ${busy > 0}`);
});

await check('T8 Leere Daten', async () => {
  await page.route(API, (r) => r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }) : r.continue());
  await page.reload();
  await page.screenshot({ path: `${OUT}/T8-leer.png` }); // sinnvoller Leerzustand statt "undefined"/NaN?
  await page.unroute(API);
});
```

Langsames Netz für die ganze Seite (auch Skripte/Bilder) per CDP, nur Chromium:

```js
const cdp = await context.newCDPSession(page);
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 50_000, uploadThroughput: 20_000 });
```

## Typische Fehler

Endloser Spinner, weiße Seite bei 500, Fehlermeldung „[object Object]“, Formular wird trotz Fehler geleert, Erfolgsmeldung obwohl das Speichern fehlschlug, keine Wiederholungsmöglichkeit, 401 führt nicht zum Login.
