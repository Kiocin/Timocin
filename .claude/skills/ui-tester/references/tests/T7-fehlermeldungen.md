# T7 – Fehlermeldungen und Fehlerfälle

**Ziel:** Wenn etwas schiefgeht (falsche Eingabe, Server- oder Netzfehler, fehlende Rechte), sieht der Benutzer eine **klare, verständliche Meldung auf Deutsch**: was passiert ist und was er tun kann. Keine Statuscodes, kein JSON, keine Stacktraces, kein „[object Object]“, kein endloses Laden, keine weiße Seite. Eingaben bleiben erhalten.

**Werkzeuge:** Prüfung auf unverständliche Texte (`findCrypticTexts`, läuft automatisch in `forms.cjs`, `links.cjs` und `monkey.cjs`), Szenario `T7-<name>.cjs` mit simulierten Fehlern (`page.route`).

## Was ist eine gute Fehlermeldung?

| Kriterium | gut | schlecht |
|---|---|---|
| verständlich | „Bitte geben Sie die Stunden als Zahl ein, z. B. 2,5.“ | „Error 422: {"error":"invalid"}“ |
| nennt das Feld | Meldung direkt am Feld, Feld rot umrandet, `aria-invalid` | eine Sammelmeldung oben, welches Feld? |
| sagt, was zu tun ist | „Verbindung unterbrochen. Ihre Eingaben bleiben erhalten – bitte erneut speichern.“ | „Network Error“ |
| Sprache | Deutsch, Sie/Du einheitlich | englische Bibliotheksmeldungen („Request failed with status code 500“) |
| keine Interna | – | Stacktrace, SQL, Dateipfade, Server-Versionen (auch Sicherheitsproblem, T16) |
| sichtbar genug | bleibt stehen, bis behoben | Toast verschwindet nach 2 s |
| angekündigt | `role="alert"`/`aria-live` | nur Farbe |
| Erfolg vs. Fehler | „Gespeichert“ nur, wenn es wirklich gespeichert wurde | Erfolgsmeldung trotz 500 |

Die automatische Prüfung erkennt: `[object Object]`, `undefined`/`null`/`NaN` im Text, Stacktraces, Exception-Namen, rohes JSON, HTTP-Codes ohne Erklärung, englische Standardmeldungen, nicht ersetzte Platzhalter (`{{name}}`) und Übersetzungsschlüssel (`errors.form.required`). Ob eine Meldung *hilfreich* ist, entscheidest du beim Lesen.

## Vorgehen

1. Alle Meldungen sammeln, die `forms.cjs` beim leeren und falschen Speichern gesehen hat (`forms.json` → `messages`).
2. Fehlerfälle gezielt auslösen (Vorlage unten) und von jedem einen Screenshot ansehen.
3. Meldungen in eine Tabelle für den Bericht schreiben: Situation → angezeigter Text → Bewertung → Vorschlag.

## Vorlage

```js
const API = '**/api/**'; // an die App anpassen (aus inventory/Netzwerk-Log)

await check('T7 Offline speichern', async () => {
  await page.getByLabel(/name/i).fill('offline gespeichert?');
  await context.setOffline(true);
  await page.getByRole('button', { name: /speichern/i }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/T7-offline.png` });
  const kept = await page.getByLabel(/name/i).inputValue().catch(() => '');
  await context.setOffline(false);
  assert(kept === 'offline gespeichert?', 'Eingabe nach fehlgeschlagenem Speichern verloren');
});

for (const status of [500, 503, 401, 403, 409, 422]) {
  await check(`T7 Server antwortet ${status} beim Speichern`, async () => {
    await page.route(API, (r) => r.request().method() !== 'GET'
      ? r.fulfill({ status, contentType: 'application/json', body: '{"error":"Testfehler"}' })
      : r.continue());
    await page.getByRole('button', { name: /speichern/i }).click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${OUT}/T7-${status}.png` });
    await page.unroute(API);
    assert((await page.locator('body').innerText()).trim().length > 0, 'leere Seite');
    // Screenshot ansehen: verständliche Meldung? Bei 401 Weiterleitung zum Login?
  });
}

await check('T7 Kaputte Antwort (kein JSON)', async () => {
  await page.route(API, (r) => r.request().method() === 'GET' ? r.fulfill({ status: 200, body: '<html>Proxy-Fehler</html>' }) : r.continue());
  await page.reload();
  await page.waitForTimeout(1000);
  await page.unroute(API);
  assert((await page.locator('body').innerText()).trim().length > 0, 'leere Seite bei kaputter Antwort');
});

await check('T7 Langsames Netz (3 s): Ladeanzeige und Sperre gegen Doppelklick', async () => {
  await page.route(API, async (r) => { await new Promise((s) => setTimeout(s, 3000)); await r.continue(); });
  const btn = page.getByRole('button', { name: /speichern/i });
  await btn.click();
  await page.waitForTimeout(300);
  const disabled = await btn.isDisabled().catch(() => false);
  const busy = await page.locator('[aria-busy=true], [role=progressbar], .spinner, .loading').count();
  await page.screenshot({ path: `${OUT}/T7-langsam.png` });
  await page.unroute(API);
  console.log(`   → Button gesperrt: ${disabled}, Ladeanzeige: ${busy > 0}`);
});

await check('T7 Leere Daten', async () => {
  await page.route(API, (r) => r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }) : r.continue());
  await page.reload();
  await page.screenshot({ path: `${OUT}/T7-leer.png` }); // sinnvoller Leerzustand statt "undefined"/NaN?
  await page.unroute(API);
});
```

Langsames Netz für die ganze Seite (auch Skripte/Bilder) per CDP, nur Chromium:

```js
const cdp = await context.newCDPSession(page);
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 50_000, uploadThroughput: 20_000 });
```

## Weitere Fehlerfälle

- **Keine Berechtigung (403):** Als Benutzer ohne Rechte eine Admin-Seite aufrufen → verständliche Meldung statt leerer Seite?
- **Nicht gefunden:** `/eintrag/999999` → „Eintrag nicht gefunden“ mit Weg zurück?
- **Sitzung abgelaufen (401) beim Speichern:** Hinweis + Login, Eingaben bleiben erhalten?
- **Konflikt (409):** Zwei Tabs ändern denselben Datensatz (T13), verständliche Meldung?
- **Frontend-Absturz:** gibt es eine Fehlerseite (Error Boundary) statt weißer Seite?

## Typische Fehler

Endloser Spinner, weiße Seite bei 500, Fehlermeldung „[object Object]“, Formular wird trotz Fehler geleert, Erfolgsmeldung obwohl das Speichern fehlschlug, keine Wiederholungsmöglichkeit, 401 führt nicht zum Login.
