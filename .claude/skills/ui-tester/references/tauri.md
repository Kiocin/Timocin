# Tauri-Apps testen

Eine Tauri-App besteht aus einem Web-Frontend (läuft im WebView) und einem Rust-Backend, das das Frontend über `invoke()` aufruft. Es gibt drei Wege, sie zu testen. Wähle nach Betriebssystem und Ziel.

| Weg | Was wird getestet | Wo möglich | Werkzeug |
|---|---|---|---|
| **A: Frontend im Browser, Backend gemockt** | UI-Logik, Formulare, Layout, Chaos-Test | überall, auch in der Cloud und unter macOS | Playwright + Skripte dieses Skills |
| **B: Echte App, WebView2 per CDP** | alles inkl. Rust-Backend und echter Datenspeicherung | nur Windows | Playwright `connectOverCDP` + Skripte mit `--cdp` |
| **C: Echte App per tauri-driver** | alles inkl. Backend | Windows und Linux (nicht macOS) | WebdriverIO |

Zuerst die Tauri-Version bestimmen: `@tauri-apps/api` in `package.json` (1.x oder 2.x) und `src-tauri/Cargo.toml`. In `src-tauri/tauri.conf.json` stehen die Frontend-Dev-URL (v2: `build.devUrl`, v1: `build.devPath`), der `identifier` (bestimmt den Datenordner) und ob `withGlobalTauri` aktiv ist.

---

## Weg A: Frontend im Browser mit gemocktem Backend

Den Frontend-Dev-Server ohne Tauri starten (meist `npm run dev`, Vite auf Port 1420 oder 5173). Im normalen Browser fehlt die Tauri-Brücke, deshalb schlagen `invoke()`-Aufrufe fehl. Mit einem Init-Skript ersetzt du sie durch eine Attrappe, die plausible Antworten liefert und alle Aufrufe protokolliert.

1. Finde alle Backend-Befehle: `grep -rn "invoke(" src/` (bzw. das Frontend-Verzeichnis) und in Rust `#[tauri::command]`. Notiere Namen, Argumente und Rückgabetyp.
2. Baue ein Mock. Ein In-Memory-„Backend“, das Daten wirklich speichert, ist am besten, denn dann funktionieren Speichern und Lesen sinnvoll.

```js
// tauri-mock.js – als Init-Skript in den Browser laden
(() => {
  const db = { entries: [] }; // simuliertes Backend
  const handlers = {
    // Befehlsnamen und Rückgaben an die App anpassen:
    get_entries: () => db.entries,
    save_entry: ({ entry }) => { const e = { id: Date.now(), ...entry }; db.entries.push(e); return e; },
    delete_entry: ({ id }) => { db.entries = db.entries.filter((e) => e.id !== id); return null; },
  };
  window.__tauriCalls = [];
  const invoke = async (cmd, args = {}) => {
    window.__tauriCalls.push({ cmd, args });
    if (cmd.startsWith('plugin:')) return null; // Fenster-, Dialog-, Store-Plugins usw.
    const h = handlers[cmd];
    if (!h) throw new Error(`[Mock] unbekannter Tauri-Befehl: ${cmd}`);
    return JSON.parse(JSON.stringify(await h(args))); // wie echte IPC: nur serialisierbare Daten
  };

  // Tauri v2
  window.__TAURI_INTERNALS__ = window.__TAURI_INTERNALS__ || {};
  Object.assign(window.__TAURI_INTERNALS__, {
    invoke,
    transformCallback: (cb, once) => {
      const id = Math.floor(Math.random() * 1e9);
      window[`_${id}`] = (r) => { if (once) delete window[`_${id}`]; cb && cb(r); };
      return id;
    },
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    convertFileSrc: (p) => p,
  });

  // Tauri v1
  window.__TAURI_IPC__ = ({ cmd, callback, error, ...args }) => {
    const realCmd = cmd === 'tauri' ? `plugin:${args.__tauriModule}` : cmd;
    invoke(realCmd, args).then((r) => window[`_${callback}`]?.(r), (e) => window[`_${error}`]?.(String(e)));
  };
  window.__TAURI_METADATA__ = { __currentWindow: { label: 'main' }, __windows: [{ label: 'main' }] };
})();
```

3. Einbinden. Die Skripte dieses Skills laden es mit `--init-script` vor dem App-Code:

```bash
node <skill>/scripts/inventory.cjs --url http://localhost:1420 --init-script tauri-mock.js
node <skill>/scripts/monkey.cjs    --url http://localhost:1420 --init-script tauri-mock.js --steps 300
```

In eigenen Playwright-Skripten: `await context.addInitScript({ path: 'tauri-mock.js' });`

Das Mock wurde gegen `@tauri-apps/api` 1.x und 2.x geprüft (`invoke`, Fenster-API, Fehler bei unbekannten Befehlen). Leg es im Ergebnisordner ab (`ui-test-results/tauri-mock.js`), nicht im Quellcode der App.

4. Prüfen, dass das Mock zur installierten Version passt: In `node_modules/@tauri-apps/api/` die Datei `mocks.js` (v2) bzw. `tauri.js`/`core.js` ansehen und vergleichen, wie `invoke` intern aufgerufen wird. Zur Not das Mock daran anpassen. Hat das Projekt schon Vitest-/Jest-Tests mit `mockIPC` aus `@tauri-apps/api/mocks`, nutze deren Handler als Vorlage.

`window.__tauriCalls` am Ende auslesen. Daran siehst du, welche Backend-Aufrufe das Frontend mit welchen Argumenten macht. Das ist oft schon aufschlussreich (z. B. Zahl als String übergeben, doppelte Aufrufe bei Doppelklick).

**Grenze:** Weg A testet nicht das Rust-Backend, nicht die echte Speicherung und keine nativen Dialoge oder Menüs. Im Bericht unter „Nicht getestet“ vermerken.

---

## Weg B: Echte App unter Windows per CDP (WebView2)

WebView2 basiert auf Chromium und kann einen DevTools-Port öffnen. Playwright hängt sich daran an.

```powershell
# PowerShell, im Projektordner
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
npm run tauri dev        # oder die gebaute .exe aus src-tauri\target\release\ starten
```

Prüfen, ob der Port offen ist: `curl http://127.0.0.1:9222/json/version`. Dann alle Skripte mit `--cdp`:

```bash
node <skill>/scripts/inventory.cjs --cdp http://127.0.0.1:9222
node <skill>/scripts/monkey.cjs   --cdp http://127.0.0.1:9222 --steps 200
node <skill>/scripts/viewports.cjs --cdp http://127.0.0.1:9222
```

Eigene Skripte:

```js
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser.contexts()[0].pages()[0];
```

Hinweise:
- Die Skripte schließen die App beim Anhängen nicht, sie trennen nur die Verbindung.
- `setViewportSize` emuliert nur die Größe des Inhalts. Das *echte* Fenster änderst du über die Tauri-API im Frontend, wenn `withGlobalTauri: true` gesetzt und die Berechtigung erteilt ist (v2: `core:window:allow-set-size` in `src-tauri/capabilities/*.json`):
  ```js
  // v2
  await page.evaluate(async () => {
    const w = window.__TAURI__.window.getCurrentWindow();
    await w.setSize(new window.__TAURI__.dpi.LogicalSize(800, 600));
    // auch: w.maximize(), w.unmaximize(), w.minimize(), w.unminimize(), w.setFullscreen(true)
  });
  // v1: window.__TAURI__.window.appWindow.setSize(new window.__TAURI__.window.LogicalSize(800, 600))
  ```
  Ohne globale API kannst du das Fenster nicht vom Test aus steuern. Dann `setViewportSize` nutzen und den Unterschied im Bericht erwähnen.
- Native Dialoge (Datei öffnen/speichern, `dialog`-Plugin) sind keine Webseiten und blockieren den Test. Meiden (`--avoid`) oder den Benutzer bitten, sie zu bedienen.
- Der Debug-Port darf nur für Tests gesetzt sein, nicht im ausgelieferten Build.

---

## Weg C: tauri-driver (WebDriver) unter Windows/Linux

Offizieller Weg für E2E-Tests der echten App. Er nutzt WebdriverIO statt Playwright. Die Skripte dieses Skills laufen damit nicht, die Szenarien aus `szenarien.md` lassen sich aber sinngemäß übertragen.

Voraussetzungen:
- `cargo install tauri-driver --locked`
- Linux: `webkit2gtk-driver` (Debian/Ubuntu: `sudo apt install webkit2gtk-driver`), für Headless zusätzlich `xvfb`.
- Windows: `msedgedriver.exe` passend zur installierten WebView2-Version im PATH (`msedgedriver-tool` hilft beim Herunterladen).
- App bauen: `npm run tauri build -- --debug --no-bundle`

Minimale `wdio.conf.cjs` (in einem Ordner `e2e/`, dort `npm i -D @wdio/cli @wdio/local-runner @wdio/mocha-framework @wdio/spec-reporter`):

```js
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
let driver;
exports.config = {
  hostname: '127.0.0.1',
  port: 4444,
  specs: ['./specs/**/*.js'],
  maxInstances: 1,
  capabilities: [{
    maxInstances: 1,
    'tauri:options': {
      application: path.resolve(__dirname, '../src-tauri/target/debug/<app-name>' + (process.platform === 'win32' ? '.exe' : '')),
    },
  }],
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: { ui: 'bdd', timeout: 60000 },
  beforeSession: () => {
    driver = spawn(path.resolve(os.homedir(), '.cargo', 'bin', 'tauri-driver'), [], { stdio: [null, process.stdout, process.stderr] });
  },
  afterSession: () => driver && driver.kill(),
};
```

Beispiel-Spec:

```js
describe('Einträge', () => {
  it('speichert und zeigt einen Eintrag', async () => {
    await $('#name').setValue('Test aus WebDriver');
    await $('button=Speichern').click();
    await expect($('*=Test aus WebDriver')).toBeDisplayed();
  });
});
```

Start: `npx wdio run wdio.conf.cjs` (Linux headless: `xvfb-run npx wdio run wdio.conf.cjs`).

---

## Persistenz in Tauri prüfen

Tauri-Apps speichern meist im App-Datenordner (SQLite, `tauri-plugin-store`, JSON-Dateien über `fs`) statt im localStorage. Pfad nach `identifier` aus `tauri.conf.json`:

- Windows: `%APPDATA%\<identifier>\` (bzw. `%LOCALAPPDATA%\<identifier>\`)
- Linux: `~/.local/share/<identifier>/` und `~/.config/<identifier>/`
- macOS: `~/Library/Application Support/<identifier>/`

Ablauf für den Persistenztest (Weg B oder C): Daten anlegen → App vollständig beenden → neu starten → Daten prüfen. Den Inhalt der Datei bzw. Datenbank zusätzlich direkt ansehen (`sqlite3 <datei> ".tables"` und `SELECT …`), um Kodierung, Zeitzonen und Zahlenformate zu kontrollieren.

Vor dem Test fragen, ob der Datenordner echte Daten des Benutzers enthält. Dann zuerst sichern, oder die App mit einem eigenen Test-`identifier` bzw. einer Umgebungsvariable für ein anderes Datenverzeichnis starten, falls die App das unterstützt.
