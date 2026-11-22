# T5 – Navigation

**Ziel:** Alle Menüs, Untermenüs und Links funktionieren. Jedes Ziel existiert und zeigt sinnvollen Inhalt. Der Benutzer weiß, wo er ist, und kommt zurück.

**Werkzeuge:** `scripts/links.cjs`, danach kurzer manueller Durchgang.

## Automatisch

```bash
node <skill>/scripts/links.cjs --url <URL> --max-pages 50
node <skill>/scripts/links.cjs --url <URL> --external          # auch externe Links prüfen
node <skill>/scripts/links.cjs --url <URL> --storage-state ui-test-results/auth.json   # Bereich nach Login
```

Das Skript besucht alle internen Seiten (bis `--max-pages`), öffnet Menüs (`aria-haspopup`, `aria-expanded`, Hover-Menüs in `nav`) und meldet:

| Prüfung | Befund |
|---|---|
| Linkziel | HTTP 404/500, Seite leer, Seite zeigt „nicht gefunden“ (SPAs liefern dafür oft 200), JS-Fehler, unverständlicher Text |
| Sprungmarken | `#abschnitt` existiert nicht auf der Seite |
| Menüs | Menü öffnet sich nicht (keine neuen Einträge, `aria-expanded` bleibt false) |
| Links ohne Ziel | `href="#"`/`javascript:` – meist ein Button, der als Link gebaut ist (Tastatur/Screenreader!) |
| Beschriftung | Link ohne Text/`aria-label` |
| Sicherheit | externer Link mit `target=_blank` ohne `rel="noopener"` |

Abmelden- und Löschen-Links werden nicht besucht (`--avoid`).

## Manuell / Szenario

| Prüfung | Wie |
|---|---|
| Aktiver Menüpunkt | Ist auf jeder Seite der aktuelle Menüpunkt markiert (`aria-current="page"`)? |
| Zurück-Button | Browser-Zurück führt zur vorherigen Ansicht, nicht aus der App heraus; Filter/Tab bleiben erhalten? |
| Direktaufruf / Reload | Jede URL direkt aufrufen und neu laden. SPA-Routen dürfen nicht 404 liefern (Server-Fallback auf index.html) |
| Lesezeichen/Teilen | Detailseiten haben eigene URLs (nicht alles unter `/`) |
| Breadcrumbs | Stimmen und sind klickbar |
| Geschützte Seiten | Ohne Login → Weiterleitung zum Login und danach **zurück zur ursprünglichen Seite** |
| Rollen | Menüpunkte, die ein Benutzer nicht darf, sind ausgeblendet **und** per URL gesperrt (T12/T16) |
| Mobil | Burger-Menü öffnet/schließt, schließt nach Klick auf einen Eintrag, Esc schließt |
| Tastatur | Menü mit Tab/Pfeiltasten bedienbar (T9) |

```js
await check('T5 Geschützte Seite leitet nach Login zurück', async () => {
  const ctx = await browser.newContext();              // ohne Login
  const p = await ctx.newPage();
  await p.goto(new URL('/berichte', URL).href);
  assert(/login|anmeld/i.test(p.url()), `keine Weiterleitung zum Login: ${p.url()}`);
  // … anmelden …
  // assert(p.url().includes('/berichte'), 'nach Login nicht zur ursprünglichen Seite zurück');
  await ctx.close();
});
```

## Typische Fehler

Tote Links nach Umbenennungen, SPA-Routen liefern bei Reload 404, Menüpunkt für Rolle ausgeblendet, aber per URL erreichbar, Sprungmarken auf entfernte Abschnitte, Burger-Menü bleibt nach Navigation offen, aktiver Menüpunkt falsch markiert.
