# T9 – Barrierefreiheit und Tastaturbedienung

**Ziel:** Die App ist ohne Maus, mit Screenreader und mit Vergrößerung bedienbar, nach WCAG 2.2 Stufe AA. Das betrifft nicht nur Menschen mit Behinderung: Tastaturbedienung und klare Beschriftungen helfen allen, und fehlende Namen machen auch automatisierte Tests unzuverlässig.

**Werkzeug:** `scripts/a11y.cjs` (axe-core + Tastatur-Check), danach manuelle Prüfung.

## Automatisch

```bash
npm i -D axe-core        # einmalig im Projekt, falls nicht vorhanden
node <skill>/scripts/a11y.cjs --url <URL> --pages /einstellungen,/berichte
```

- **axe-core** prüft u. a. fehlende Beschriftungen, Kontraste, fehlende `lang`-Angabe, falsche ARIA-Rollen, zu kleine Klickziele, Überschriftenstruktur.
- **Tastatur-Check:** geht mit Tab durch die Seite und meldet Elemente ohne sichtbaren Fokus, Fokus auf versteckten Elementen, Elemente ohne Namen und Tastaturfallen.
- Läuft auch gegen Tauri-Apps (`--cdp` oder `--init-script` mit Mock).

Schweregrade von axe: *critical* → kritisch, *serious* → hoch, *moderate* → mittel, *minor* → niedrig. Die Einträge „manuell zu prüfen“ (`incomplete`) ansehen, oft sind das Kontraste auf Hintergrundbildern.

**Wichtig:** Automatische Tests finden nur etwa ein Drittel der Probleme. Null axe-Befunde heißt nicht barrierefrei.

## Manuell (mit Playwright, Szenario `T9-<name>.cjs`)

| Prüfung | Wie |
|---|---|
| Kernablauf nur mit Tastatur | Ablauf aus T10 nur mit `Tab`, `Shift+Tab`, `Enter`, `Space`, Pfeiltasten. Geht alles? |
| Dialoge | Öffnen → Fokus im Dialog? `Escape` schließt? Fokus kehrt danach zum auslösenden Button zurück? Tab bleibt im Dialog? |
| Fehlermeldungen | Mit dem Feld verknüpft (`aria-describedby`) und angekündigt (`role=alert` / `aria-live`)? |
| Reihenfolge | Tab-Reihenfolge entspricht der sichtbaren Reihenfolge? (Ausgabe von `a11y.json` → `keyboard.stops`) |
| Namen | `page.accessibility.snapshot()` bzw. `locator.ariaSnapshot()` zeigt, was ein Screenreader vorliest. Icons ohne Text brauchen `aria-label`. |
| Vergrößerung | Siehe T2 (200 %). Kein Inhalt darf verschwinden. |
| Bewegung | `page.emulateMedia({ reducedMotion: 'reduce' })` → Animationen aus? |
| Farbe | `page.emulateMedia({ colorScheme: 'dark' })` und `forcedColors: 'active'` → noch lesbar? |

```js
await check('T9 Dialog: Escape schließt und Fokus kehrt zurück', async () => {
  const opener = page.getByRole('button', { name: /neu|hinzufügen/i });
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  assert(await dialog.evaluate((d) => d.contains(document.activeElement)), 'Fokus ist nicht im Dialog');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert(await opener.evaluate((el) => el === document.activeElement), 'Fokus kehrt nicht zum Auslöser zurück');
});

console.log(await page.locator('main').ariaSnapshot()); // was ein Screenreader sieht
```

## Typische Fehler

Icon-Buttons ohne Namen, Platzhalter statt Label, `div` mit `onclick` (nicht per Tastatur erreichbar), `outline: none` ohne Ersatz, Dialog ohne Fokusfalle, Fehlermeldungen nur farblich, zu geringer Kontrast bei grauem Text, fehlendes `lang="de"`.
