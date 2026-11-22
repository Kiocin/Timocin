# T4 – Eingaben, Validierung und Sicherheit

**Ziel:** Ungültige, extreme und bösartige Eingaben werden verständlich abgewiesen oder sicher verarbeitet. Kein Absturz, kein unsinniger Datensatz, keine ausgeführten Skripte.

**Werkzeug:** Szenario `T4-<formular>.cjs`. Der Monkey-Test (T7) streut fiese Eingaben zufällig und erkennt XSS mit einem harmlosen Köder. T4 prüft *systematisch* jedes wichtige Feld.

## Was prüfen

Für jedes Eingabefeld, das gespeichert wird (aus `inventory.json`, dort stehen auch `required`, `min`, `max`, `maxlength`, `pattern`):

| Art | Werte |
|---|---|
| Leer / nur Leerzeichen | `''`, `'   '` |
| Grenzen | `min-1`, `min`, `max`, `max+1`, `maxlength` und `maxlength+1` Zeichen |
| Zahlen | `-1`, `0`, `2,5` (deutsches Komma), `2.5`, `1e309`, `999999999999`, `00012` |
| Datum/Zeit | `2026-02-30`, `2026-02-29`, `1900-01-01`, `9999-12-31`, Sommerzeitwechsel (`2026-03-29T02:30`), Ende vor Beginn |
| Text | 5000 Zeichen, Umlaute/ß, Emoji, Zeilenumbrüche, RTL-Zeichen, Anführungszeichen `O'Brien "x"` |
| Injection | `<img src="data:x" onerror="window.__xss=1">`, `"><svg onload="window.__xss=1">`, `'; DROP TABLE x;--`, `{{7*7}}`, `${7*7}` |

Erwartung je Fall festlegen: abgewiesen mit Meldung, korrigiert (z. B. getrimmt), oder exakt so gespeichert und *als Text* angezeigt.

## Vorlage

```js
const cases = [
  ['Stunden', ''], ['Stunden', '-1'], ['Stunden', '25'], ['Stunden', '2,5'], ['Stunden', '1e309'],
  ['Name', '   '], ['Name', 'x'.repeat(5000)], ['Name', '<img src="data:x" onerror="window.__xss=1">'],
  ['Datum', '2026-02-30'],
];
for (const [feld, wert] of cases) {
  await check(`T4 ${feld} = ${JSON.stringify(wert.slice(0, 25))}`, async () => {
    await page.goto(URL);
    await page.evaluate(() => delete window.__xss);
    const f = page.getByLabel(new RegExp(feld, 'i'));
    await f.fill(wert).catch(async () => { await f.click(); await page.keyboard.type(wert); });
    await page.getByRole('button', { name: /speichern/i }).click();
    await page.waitForTimeout(400);

    assert(!(await page.evaluate(() => window.__xss)), 'Eingabe wurde als HTML/JS ausgeführt (XSS)');
    assert((await page.locator('body').innerText()).trim().length > 0, 'Seite nach Eingabe leer');
    const blocked = await f.evaluate((el) => el.validity && !el.validity.valid);
    const msg = await page.locator('[role=alert], .error, .invalid-feedback, [aria-invalid=true]').count();
    console.log(`   → HTML-Validierung blockiert: ${blocked}, sichtbare Meldungen: ${msg}`);
  });
}
// Danach: Liste prüfen – wurde trotz Meldung etwas Ungültiges gespeichert? (stiller Fehler)
```

Gibt es eine API, auch direkt an der Oberfläche vorbei testen. Die Validierung im Browser lässt sich umgehen:

```js
const r = await page.request.post(`${URL}/api/entries`, { data: { name: '', hours: -5 } });
console.log(r.status(), await r.text()); // 4xx erwartet, nicht 200 und nicht 500
```

## Sicherheit am Rand

- **XSS:** Köder in alle Textfelder, dann *alle* Stellen ansehen, wo der Wert erscheint (Liste, Detail, Titel, Tooltip, Export, Toast).
- **Fremde Daten:** IDs in der URL ändern (`/eintrag/5` → `/eintrag/6`): Sieht man Daten anderer Benutzer?
- **Rollen:** Admin-Seiten als normaler Benutzer direkt per URL aufrufen.
- **Sensible Daten:** Passwörter/Tokens im localStorage, in URLs oder in Konsolenausgaben?

Das ersetzt keinen Sicherheitstest, findet aber die häufigsten Lücken. Nur in der eigenen Testumgebung durchführen.

## Typische Fehler

Validierung nur im Frontend. Fehlermeldung erscheint, aber der Wert wird trotzdem gespeichert. `2,5` wird zu `25` oder `NaN`. Langer Text sprengt das Layout. Leerzeichen-Namen gelten als gültig. `innerHTML`/`v-html`/`dangerouslySetInnerHTML` mit Benutzereingaben.
