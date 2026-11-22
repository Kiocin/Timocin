# T16 – Security

**Ziel:** Keine bekannten Schwachstellen in den verwendeten Bibliotheken (npm, Rust/Cargo), sichere Konfiguration der App (Header, Cookies, Tauri-Berechtigungen), keine Geheimnisse im Code, und die häufigsten Angriffswege (XSS, fehlende Rechteprüfung, verratene Interna) sind geschlossen.

**Werkzeuge:** `scripts/security.cjs`, dazu die Sicherheitsprüfungen aus T4 (XSS/Eingaben), T12 (Auth/Rechte) und T13 (Monkey mit XSS-Köder).

## Schwachstellen-Datenbanken: was wird abgefragt?

| Quelle | Inhalt | Wie |
|---|---|---|
| **CVE** (cve.org, Suche in der **NVD** nvd.nist.gov) | weltweite Nummerierung von Schwachstellen (CVE-2024-12345) mit Bewertung nach **CVSS** (0–10) | wird über die anderen Quellen mit abgefragt |
| **GitHub Advisory Database** (github.com/advisories) | Schwachstellen in npm-, Cargo-, PyPI-… Paketen, mit CVE-Nummer, betroffenen Versionen und Fix-Version (GHSA-Kennung) | `npm audit`, `pnpm audit`, `yarn audit` nutzen diese Datenbank |
| **OSV.dev** (Google) | offene Sammeldatenbank: GitHub Advisories + RustSec + NVD + weitere, maschinenlesbar | `security.cjs` fragt `api.osv.dev` für `package-lock.json` und `Cargo.lock` ab; Alternative: `npx osv-scanner --lockfile=package-lock.json` |
| **RustSec** (rustsec.org) | Schwachstellen in Rust-Crates (Tauri-Backend) | `cargo audit` (`cargo install cargo-audit`) |

Schweregrad nach CVSS: 9,0–10 kritisch · 7,0–8,9 hoch · 4,0–6,9 mittel · 0,1–3,9 niedrig.

## Automatisch

```bash
node <skill>/scripts/security.cjs --project .                       # Abhängigkeiten, Tauri-Konfiguration, Geheimnisse
node <skill>/scripts/security.cjs --project . --url http://localhost:5173   # + Header, Cookies, Speicher, Source-Maps
```

| Bereich | Was geprüft wird |
|---|---|
| Abhängigkeiten | npm/pnpm/yarn audit + OSV (npm und crates.io) + cargo audit; je Fund: Paket, Version, CVE/GHSA, CVSS, Fix-Version, direkt/indirekt |
| Header | Content-Security-Policy, Schutz vor Einbettung (X-Frame-Options/frame-ancestors), nosniff, HSTS, Referrer-Policy, Server-/Framework-Version sichtbar |
| CORS | `Access-Control-Allow-Origin: *` (mit Credentials) |
| Cookies | Sitzungs-Cookies ohne HttpOnly/Secure/SameSite |
| Browser-Speicher | Tokens/Passwörter im localStorage/sessionStorage |
| Source-Maps | öffentlich abrufbar (Quellcode einsehbar) |
| Tauri | CSP fehlt/zu offen, v1-allowlist `all`, Shell-Ausführung, weiter Dateisystem-Zugriff, Remote-IPC, `withGlobalTauri` |
| Geheimnisse | eingecheckte `.env`, private Schlüssel, Tokens (GitHub, AWS, Stripe, OpenAI …), DB-URLs mit Passwort, Passwörter im Code |

Header-Befunde gegen den lokalen Dev-Server sind nur Hinweise. Entscheidend ist die Produktionskonfiguration (Reverse Proxy, Hosting).

## Abhängigkeiten bewerten

Nicht jeder Fund ist gleich dringend:
1. **Direkt oder indirekt?** Indirekte Abhängigkeiten werden über das Update des direkten Pakets behoben (Fix-Hinweis nennt es).
2. **Laufzeit oder nur Entwicklung?** Schwachstellen in Build-Tools (`devDependencies`) betreffen die ausgelieferte App meist nicht: `npm audit --omit=dev` zeigt nur Produktionspakete.
3. **Wird die betroffene Funktion genutzt?** z. B. lodash `_.template` mit Benutzereingaben, minimist nur in CLI-Skripten.
4. **Fix verfügbar?** `npm audit fix` (kompatibel) vs. Major-Update (Änderungen nötig, testen!) vs. kein Fix (Alternative suchen, Risiko dokumentieren).

Im Bericht/Issue: Paket, Version, CVE + Link, CVSS, betroffen ja/nein mit Begründung, empfohlene Version, Aufwand.

Regelmäßig automatisch: **Dependabot** bzw. **Renovate** im Repository aktivieren (`.github/dependabot.yml`), dann meldet GitHub neue Schwachstellen selbst.

## Manuell / Szenario

- **XSS:** Köder aus T4 in jedes Textfeld, alle Stellen ansehen, an denen der Wert erscheint (auch Export, PDF, E-Mail-Vorschau).
- **Rechte:** T12 mit zwei Rollen; IDs in URLs austauschen (fremde Daten?); Admin-URLs als Mitarbeiter.
- **Login:** Fehlversuche begrenzt (Rate-Limit/Sperre)? Fehlermeldung verrät nicht, ob der Benutzer existiert? Passwort-Regeln? Abmelden macht das Token wirklich ungültig (alten Token weiterverwenden)?
- **CSRF:** Bei Cookie-Login: schreibende Requests ohne CSRF-Token/SameSite von fremder Seite möglich?
- **Uploads:** Dateityp serverseitig geprüft? `.html`/`.svg` mit Skript hochladen und aufrufen.
- **Fehlerantworten:** keine Stacktraces/SQL (T12 meldet das).
- **DSGVO** (bei Zeiterfassung relevant): personenbezogene Daten nur für Berechtigte sichtbar, Export/Löschung eines Mitarbeiters möglich, keine Daten in URLs/Logs.

## Sicherheitsbefunde melden

Sicherheitslücken **nicht als öffentliches Issue** anlegen, wenn das Repository öffentlich ist, sondern als **private Security Advisory** (GitHub → Security → Advisories → New draft security advisory) oder direkt an den Verantwortlichen. `issues.cjs` überspringt Sicherheitsbefunde, außer mit `--include-security` (nur für private Repositories). Gefundene Geheimnisse nie im Klartext in Issues/Berichte schreiben, nur Datei und Zeile. Und: Ein eingechecktes Geheimnis gilt als kompromittiert. Es reicht nicht, es zu löschen, es muss **erneuert** werden.

Dies ersetzt keinen professionellen Penetrationstest. Bei sensiblen Daten (Personal-/Gehaltsdaten) einen beauftragen.
