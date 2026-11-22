# Fehler als GitHub-Issues dokumentieren

Jeder **verifizierte** Fehler wird ein Issue, damit das Team ihn abarbeiten kann. Jedes Issue enthält Beschreibung, Schritte zum Reproduzieren, erwartetes und tatsächliches Ergebnis, Screenshot (wenn möglich), Schweregrad und Umgebung.

## Ablauf

1. **Verifizieren** (SKILL.md, Schritt 3): nur nachgestellte, echte Fehler. Rohbefunde der Skripte sind keine Issues.
2. **Zusammenfassen:** ein Issue pro Ursache, nicht pro Symptom. „Datumsfeld in 4 Formularen zu niedrig (gleiches CSS)“ ist *ein* Issue mit allen Fundstellen. Ein Absturz, der als `page-error` und `blank-page` gemeldet wurde, ist ebenfalls *ein* Issue.
3. **`ui-test-results/befunde.json` schreiben** (Format unten).
4. **Vorschau erzeugen:** `node <skill>/scripts/issues.cjs --befunde ui-test-results/befunde.json --repo OWNER/REPO`. Die Entwürfe liegen dann in `ui-test-results/issues/*.md`.
5. **Dem Benutzer die Liste zeigen** (Titel + Schweregrad) und **einmal fragen**, ob die Issues angelegt werden sollen. Issues sind für das ganze Team sichtbar und lösen Benachrichtigungen aus. Sicherheitsbefunde gesondert ansprechen (siehe unten).
6. **Screenshots hochladen** (optional, siehe unten), dann Vorschau mit `--evidence-base` neu erzeugen.
7. **Anlegen:** mit `gh` → `issues.cjs … --create`; ohne `gh` → GitHub-MCP-Werkzeug (siehe unten).
8. **Issue-Nummern im Bericht** (`BERICHT.md`) bei den Befunden eintragen.

## Format `befunde.json`

```json
{
  "umgebung": { "url": "http://localhost:5173", "browser": "Chromium 1.63 / WebKit", "viewport": "1280×800", "commit": "a1b2c3d", "version": "1.4.0" },
  "befunde": [
    {
      "id": "F1",
      "testart": "T4",
      "schweregrad": "hoch",
      "titel": "Datumsfeld in Safari niedriger als die übrigen Felder",
      "wo": "Zeiterfassung → Neuer Eintrag, Feld „Datum“ (src/components/EntryForm.vue)",
      "beschreibung": "In Safari ist das Datumsfeld 24 px hoch, alle anderen Felder 36 px. Die Formularzeile wirkt verrutscht.",
      "schritte": ["App in Safari öffnen", "„Neuer Eintrag“ klicken", "Formular betrachten"],
      "erwartet": "Alle Felder 36 px hoch und bündig.",
      "tatsaechlich": "Datumsfeld 24 px hoch, Text vertikal versetzt.",
      "screenshots": ["T4-formulare/form-0-ausgefuellt.png"],
      "belege": ["forms.cjs --browser webkit: \"Datum\" (date) ist 24px hoch, die anderen Felder 36px"],
      "ursache": "input[type=date] ohne -webkit-appearance: none; Höhe wird von WebKit bestimmt.",
      "loesung": "input[type=date] { -webkit-appearance: none; height: var(--input-height); }",
      "begruendung": "betrifft jeden Safari-Nutzer bei jeder Zeiterfassung (optional; sonst Standardtext)",
      "reproduktion": "node scripts/forms.cjs --url … --browser webkit",
      "labels": ["safari"],
      "umgebung": { "browser": "WebKit (Safari)" }
    }
  ]
}
```

Pflichtfelder: `titel`, `testart` (T1–T16), `schweregrad` (`kritisch` | `hoch` | `mittel` | `niedrig`), `beschreibung`, `schritte`, `erwartet`, `tatsaechlich`. **Screenshot-Pfade sind relativ zur `befunde.json`.** `umgebung` im Befund ergänzt bzw. überschreibt die allgemeine Umgebung.

**Titel:** kurz und konkret, was falsch ist, nicht was getestet wurde. Gut: „Feld ‚Stunden‘ akzeptiert Buchstaben und speichert sie“. Schlecht: „Fehler im Formular“. Das Skript stellt `[T4]` voran.

**Schritte:** so, dass jemand ohne Vorwissen den Fehler in 2 Minuten sieht: Startpunkt (URL, Benutzerrolle), konkrete Eingabewerte, welcher Button. Ist der Fehler nur per Skript reproduzierbar (Monkey-Seed), den Befehl in `reproduktion` angeben.

## Schweregrad

| Grad | Wann | Beispiele |
|---|---|---|
| **kritisch** | Datenverlust, Sicherheitslücke, Absturz/Blockade im Kernablauf, falsche Abrechnungsdaten | Löschen ohne Login, gespeicherte Stunden werden verfälscht, Speichern unmöglich |
| **hoch** | Kernfunktion falsch oder für eine Benutzergruppe nicht bedienbar | Pflichtfeld wird nicht geprüft, Safari-Nutzer können Datum nicht wählen, Kernablauf nicht per Tastatur |
| **mittel** | Nebenfunktion falsch, deutlich störend, Workaround vorhanden | Sortierung falsch, Sidebar überdeckt Inhalt, kryptische Fehlermeldung |
| **niedrig** | kosmetisch, geringe Auswirkung | uneinheitliche Abstände, krumme Schriftgröße, fehlender Tooltip |

Die Begründung (`begruendung`) sagt, *wen* es *wie oft* trifft. Das hilft beim Priorisieren.

## Labels

`issues.cjs` vergibt: `bug`, `schweregrad: <grad>` (farbig), `test: T4 Formulare`, bei T16 `security`, plus eigene `labels` und `--extra-label`. Mit `--create` werden fehlende Labels vorher angelegt.

## Screenshots ins Issue bringen

Die GitHub-API kann keine Bilder an Issues anhängen. Zwei Wege:

**A) Evidence-Branch (empfohlen, automatisch):** Screenshots in einen eigenen Branch ohne Code legen und verlinken. Der Arbeitsbranch bleibt unberührt.

```bash
# einmalig: leeren Branch anlegen (Git ≥ 2.42), sonst: git worktree add ../ui-evidence ui-test-evidence
git worktree add --orphan -b ui-test-evidence ../ui-evidence
mkdir -p ../ui-evidence/2026-11-22 && cp ui-test-results/issues/evidence/* ../ui-evidence/2026-11-22/
git -C ../ui-evidence add . && git -C ../ui-evidence commit -m "UI-Test-Screenshots 2026-11-22"
git -C ../ui-evidence push -u origin ui-test-evidence
node <skill>/scripts/issues.cjs --befunde ui-test-results/befunde.json --repo OWNER/REPO \
     --evidence-base https://github.com/OWNER/REPO/blob/ui-test-evidence/2026-11-22
```

Einen neuen Branch zu pushen vorher mit dem Benutzer abstimmen. In privaten Repositories sehen nur Berechtigte die Bilder, das ist gewollt. Screenshots dürfen keine echten Personen-/Kundendaten zeigen.

**B) Manuell:** Issues ohne Bilder anlegen (Platzhalter „Screenshot … noch nicht hochgeladen“), der Benutzer zieht die Dateien aus `ui-test-results/issues/evidence/` per Drag & Drop ins Issue.

## Anlegen

**Mit gh CLI** (lokal meist vorhanden):
```bash
node <skill>/scripts/issues.cjs --befunde ui-test-results/befunde.json --repo OWNER/REPO --create [--milestone "Sprint 12"] [--assignee name]
```
Das Skript sucht vorher nach offenen Issues mit gleichem Titel und legt keine Duplikate an. Die Ergebnisse stehen in `issues/created.json`.

**Ohne gh** (z. B. Cloud-Sitzung): `ui-test-results/issues/issues.json` lesen und für jeden Eintrag
1. Duplikat suchen: GitHub-MCP `list_issues`/`search_issues` bzw. `gh api -X GET search/issues -f q='repo:OWNER/REPO is:open in:title "<Titel>"'`
2. anlegen: GitHub-MCP `issue_write` (method `create`) mit `title`, `body` (aus `issues.json`) und `labels`.

## Sicherheitsbefunde (T16)

- **Öffentliches Repository:** nie als Issue. Stattdessen GitHub → Security → Advisories → „New draft security advisory“ (privat), oder direkt an die verantwortliche Person. `issues.cjs` überspringt sie standardmäßig.
- **Privates Repository:** nach Rückfrage mit `--include-security` als Issue möglich.
- Gefundene Geheimnisse (Passwörter, Tokens) **nie im Klartext** in Issues oder Berichte schreiben, nur Datei und Zeile. Darauf hinweisen, dass das Geheimnis erneuert werden muss.
