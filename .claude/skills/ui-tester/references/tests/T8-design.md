# T8 – Design

**Ziel:** Farben, Schriftarten, Schriftgrößen, Abstände und Größen passen zusammen und folgen einem erkennbaren System bzw. dem Styleguide. Gleiche Dinge sehen gleich aus.

**Werkzeuge:** `scripts/design.cjs` (sammelt alle berechneten Stile und findet Ausreißer), Screenshots, ggf. Styleguide/Design-Datei des Projekts.

## Automatisch

```bash
node <skill>/scripts/design.cjs --url <URL> --pages /berichte,/einstellungen,/projekte
node <skill>/scripts/design.cjs --url <URL> --grid 8      # wenn das Projekt ein 8px-Raster nutzt
```

Ausgabe: eine **Design-Übersicht** (verwendete Schriftarten, Schriftgrößen, Textfarben, häufigste Abstände) und Befunde:

| Prüfung | Befund |
|---|---|
| Schriftart | Schrift, die nur vereinzelt vorkommt (z. B. ein Button in Times New Roman); mehr als 3 Schriftarten |
| Schriftgröße | mehr als 8 Größen; krumme Größen (15,5 px); sehr kleine Schrift (< 12 px) |
| Zeilenabstand | zu eng bei mehrzeiligem Text |
| Farbe | fast gleiche, aber nicht identische Farben (#333 ≈ #343434) – Zeichen für fehlende Farbvariablen; viele Textfarben; Buttons in vielen Farben |
| Abstand | viele Abstände außerhalb des Rasters (4 px/8 px); sehr viele verschiedene Abstandswerte |
| Ecken | viele verschiedene Eckenradien |
| Komponenten | Buttons/Eingabefelder in vielen Varianten (Höhe, Schrift, Radius) |

Kontraste prüft T9 (axe-core).

## Mit dem Auge

Ob etwas „passt“, ist teilweise Geschmack. Bewerte deshalb anhand **nachvollziehbarer Maßstäbe** und begründe im Bericht:

1. **Styleguide vorhanden?** Suche im Projekt nach Design-Tokens (`tailwind.config.*`, `theme.ts`, CSS-Variablen `--color-*`, `variables.scss`, Figma-Links in der README). Wenn ja: Abweichungen davon sind Befunde („Button nutzt #e91e63, Primärfarbe laut Theme ist #1976d2“).
2. **Konsistenz innerhalb der App:** Gleiche Elemente (Primär-Buttons, Seitentitel, Karten, Formulare) auf verschiedenen Seiten nebeneinander vergleichen. Screenshots mehrerer Seiten ansehen.
3. **Hierarchie:** Ist erkennbar, was Überschrift, was wichtig, was Primäraktion ist? Gibt es genau eine Primäraktion pro Ansicht?
4. **Ausrichtung und Raster:** Linke Kanten von Labels, Feldern und Buttons auf einer Linie? Gleichmäßige Abstände zwischen Abschnitten?
5. **Zustände:** Hover, Fokus, deaktiviert, Fehler, Laden sehen überall gleich aus?
6. **Dunkelmodus** (falls vorgesehen): `page.emulateMedia({ colorScheme: 'dark' })`. Alles lesbar? Bilder/Logos sichtbar?

```js
for (const scheme of ['light', 'dark']) {
  await page.emulateMedia({ colorScheme: scheme });
  await page.screenshot({ path: `${OUT}/T8-${scheme}.png`, fullPage: true });
}
```

Formuliere Design-Befunde konkret und messbar: nicht „sieht unruhig aus“, sondern „4 verschiedene Button-Höhen (20/21/32/36 px) in der Formularleiste, Styleguide sieht 36 px vor“. Schweregrad meist *niedrig*, *mittel* wenn Lesbarkeit oder Bedienung leidet.

## Typische Fehler

Einzelne Komponenten mit Browser-Standardschrift (Buttons, Datumsfelder, Selects erben die Schrift nicht: `font: inherit` fehlt), hart codierte Farben statt Variablen, krumme Abstände aus Pixel-Schubsen, Datumsfeld in Monospace-Schrift, Icons in unterschiedlichen Stilen/Größen, uneinheitliche Großschreibung in Buttons.
