# T7 – Robustheit und Chaos (unvorhergesehenes Verhalten)

**Ziel:** Die App übersteht Benutzer, die nicht dem vorgesehenen Pfad folgen: wild klicken, doppelt klicken, mittendrin zurückgehen, neu laden, mehrere Tabs nutzen, Unsinn eintippen.

**Werkzeug:** `scripts/monkey.cjs` (zufällig, reproduzierbar) und Szenario `T7-<name>.cjs` (gezielte Störungen).

## Teil A: Monkey-Test

```bash
node <skill>/scripts/monkey.cjs --url <URL> --steps 300 --seed 1
node <skill>/scripts/monkey.cjs --url <URL> --steps 300 --seed 2
node <skill>/scripts/monkey.cjs --url <URL>/unterseite --steps 300 --seed 3
```

Mehrere kurze Läufe mit verschiedenen Seeds und Startseiten finden mehr als ein langer. Erkannt werden JS-Fehler, Konsolenfehler, fehlgeschlagene Requests, HTTP 4xx/5xx, leere Seiten (Absturz des Frontends) und XSS.

Optionen: `--avoid "regex"` meidet Elemente (Standard: Abmelden). Für gefährliche Aktionen ergänzen, z. B. `--avoid "abmelden|konto löschen|alle löschen|senden"`. `--ignore "regex"` blendet bekanntes Rauschen aus. `--no-nav` verhindert Zurück/Vor/Reload, `--no-resize` die Größenwechsel.

**Jeden Befund verifizieren:**
1. `report.md` lesen, Screenshot ansehen, die „letzten Aktionen“ nachvollziehen.
2. Mit einem kurzen Szenario gezielt nachstellen. Daraus wird die minimale Reproduktion für den Bericht.
3. Lässt er sich nicht gezielt nachstellen: Lauf mit gleichem Seed wiederholen (`reproduce`-Befehl im Bericht). Tritt er dann wieder auf, ist er reproduzierbar, sonst als „sporadisch“ kennzeichnen.

Übersprungene Aktionen (Element verdeckt oder verschwunden) sind normal. Falschmeldungen aussortieren: Browser-Erweiterungen, `favicon.ico`, Hot-Reload-Meldungen, abgebrochene Requests beim Seitenwechsel.

Ein Monkey-Lauf ohne Befund heißt nur „keine lauten Fehler“. Stille Fehler findet T2.

## Teil B: Gezielte Störungen

```js
await check('T7 Doppelklick auf Speichern erzeugt keinen Doppeleintrag', async () => {
  const v = unique('Doppel');
  await page.getByLabel(/name/i).fill(v);
  await page.getByRole('button', { name: /speichern/i }).dblclick();
  await page.waitForTimeout(1000);
  await page.reload();
  assertEqual(await page.getByText(v).count(), 1, 'Anzahl Einträge');
});
await check('T7 Schnelles Mehrfachklicken', async () => {
  const btn = page.getByRole('button', { name: /speichern|weiter|start/i }).first();
  for (let i = 0; i < 8; i++) await btn.click({ noWaitAfter: true, timeout: 500 }).catch(() => {});
});
await check('T7 Zurück-Button mitten im Formular', async () => {
  await page.getByLabel(/name/i).fill('halb ausgefüllt');
  await page.goBack();
  await page.goForward();
  // Erwartung je nach App: Warnung vor Datenverlust, Entwurf erhalten, oder zumindest kein Absturz
});
await check('T7 Reload während des Speicherns', async () => {
  await page.getByRole('button', { name: /speichern/i }).click({ noWaitAfter: true });
  await page.reload();
  // halber Eintrag? doppelter Eintrag? Fehler?
});
await check('T7 Zwei Tabs ändern denselben Datensatz', async () => {
  const b = await context.newPage();
  await b.goto(page.url());
  // in page ändern + speichern, dann in b ändern + speichern →
  // wird stillschweigend überschrieben? gibt es eine Konfliktmeldung? zeigt page den neuen Stand?
  await b.close();
});
await check('T7 Direkter Aufruf tiefer URLs', async () => {
  for (const p of ['/eintrag/999999', '/gibt-es-nicht', '/eintrag/abc']) {
    await page.goto(new URL(p, URL).href);
    assert((await page.locator('body').innerText()).trim().length > 0, `leere Seite bei ${p}`);
  }
});
await check('T7 Sitzung läuft ab', async () => {
  await context.clearCookies();
  await page.evaluate(() => { localStorage.removeItem('token'); sessionStorage.clear(); }); // Schlüssel anpassen
  await page.getByRole('button', { name: /speichern/i }).click().catch(() => {});
  // Erwartung: Hinweis + Weiterleitung zum Login, Eingaben möglichst nicht verloren
});
```

Weitere Ideen: Tab lange im Hintergrund (Timer, Laufzeitanzeige stimmt danach?), Systemuhr/Zeitzone ändern (`browser.newContext({ timezoneId: 'America/New_York' })`, Sommerzeit), Text mit Formatierung einfügen (`page.keyboard.insertText`), Browser-Sprache Englisch (`locale: 'en-US'`).

## Typische Fehler

Doppelte Einträge durch Doppelklick, weiße Seite bei unbekannter ID, Zustand nach Zurück inkonsistent, letzte Änderung gewinnt stillschweigend, Timer läuft im Hintergrund-Tab falsch, Abmeldung mitten im Speichern verliert Eingaben.
