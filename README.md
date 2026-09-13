# Timocin

Ein modernes Zeiterfassung-System für kleine und mittelständische Unternehmen.

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Status](https://img.shields.io/badge/status-active-brightgreen)

## 📋 Inhaltsverzeichnis

- [Über das Projekt](#über-das-projekt)
- [Features](#features)
- [Installation](#installation)
- [Verwendung](#verwendung)
- [Konfiguration](#konfiguration)
- [Dokumentation](#dokumentation)
- [Beitragen](#beitragen)
- [Lizenz](#lizenz)
- [Kontakt](#kontakt)

## 🎯 Über das Projekt

Timocin ist eine umfassende Zeiterfassungslösung, die speziell für kleine und mittelständische Unternehmen (KMU) entwickelt wurde. Das System ermöglicht es Unternehmen, Arbeitszeiten effizient zu verwalten, Projekte zu tracken und die Produktivität zu überwachen.

### Warum Timocin?

- ✅ Benutzerfreundliche Oberfläche
- ✅ Kosteneffizient für KMU
- ✅ Skalierbar und flexibel
- ✅ Deutsche Dokumentation und Support
- ✅ Datensicherheit und Compliance (DSGVO-konform)

## ✨ Features

### Kern-Features

- **Zeiterfassung**: Einfache Start/Stop-Funktionalität für Zeitmessung
- **Projektmanagement**: Organisieren Sie Arbeiten in Projekten und Aufgaben
- **Benutzerprofile**: Multi-User-Support mit Rollenbasierten Zugriff
- **Reportings**: Umfangreiche Berichte und Statistiken
- **Mobile Support**: Responsive Design für mobile Geräte
- **Integrationen**: API für Drittanwendungen

### Weitere Funktionen

- Arbeitszeiterfassung mit Timer
- Projektbasierte Zeitzuteilung
- Automatische Pausenerkennung
- Zeitstempelexport (CSV, PDF)
- Teamübersicht und Statistiken
- Admin-Dashboard

## 🚀 Installation

### Voraussetzungen

- Node.js >= 14.x
- npm >= 6.x (oder yarn)
- Docker (optional)

### Schnellstart

1. **Repository klonen:**

```bash
git clone https://github.com/Kiocin/Timocin.git
cd Timocin
```

2. **Abhängigkeiten installieren:**

```bash
npm install
```

3. **Umgebungsvariablen setzen:**

```bash
cp .env.example .env
# Bearbeiten Sie die .env Datei mit Ihren Einstellungen
```

4. **Datenbank initialisieren:**

```bash
npm run db:migrate
```

5. **Anwendung starten:**

```bash
npm start
```

Die Anwendung ist nun unter `http://localhost:3000` verfügbar.

### Docker Installation

```bash
docker-compose up -d
```

## 📖 Verwendung

### Erste Schritte

1. Melden Sie sich an oder erstellen Sie ein neues Konto
2. Erstellen Sie ein neues Projekt
3. Starten Sie eine Zeitmessung durch Klick auf "Start"
4. Stoppen Sie die Zeitmessung, wenn die Arbeit abgeschlossen ist

### Benutzerrollen

- **Admin**: Vollständiger Zugriff auf alle Funktionen
- **Manager**: Verwaltung von Teams und Projekten
- **Mitarbeiter**: Zeiterfassung und eigene Daten

## ⚙️ Konfiguration

### Umgebungsvariablen

```env
# Datenbank
DATABASE_URL=postgresql://user:password@localhost:5432/timocin

# Server
PORT=3000
NODE_ENV=production

# Authentifizierung
JWT_SECRET=your-secret-key
SESSION_TIMEOUT=3600

# E-Mail
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=user@example.com
SMTP_PASS=password
```

### Datenbanksetup

```bash
npm run db:setup
npm run db:seed  # Optional: Testdaten laden
```

## 📚 Dokumentation

Vollständige Dokumentation finden Sie unter [/docs](./docs):

- [API-Dokumentation](./docs/API.md)
- [Benutzerhandbuch](./docs/USER_GUIDE.md)
- [Admin-Handbuch](./docs/ADMIN_GUIDE.md)
- [Entwickler-Dokumentation](./docs/DEVELOPER.md)
- [FAQ](./docs/FAQ.md)

## 🤝 Beitragen

Wir freuen uns über Beiträge! Bitte beachten Sie folgende Richtlinien:

1. **Fork** das Repository
2. Erstellen Sie einen **Feature Branch** (`git checkout -b feature/AmazingFeature`)
3. **Committen** Sie Ihre Änderungen (`git commit -m 'Add some AmazingFeature'`)
4. **Pushen** Sie zum Branch (`git push origin feature/AmazingFeature`)
5. Öffnen Sie einen **Pull Request**

### Codierrichtlinien

- Verwenden Sie Prettier für Code-Formatierung
- ESLint für Linting
- Schreiben Sie aussagekräftige Commit-Nachrichten
- Fügen Sie Tests für neue Features hinzu

```bash
npm run lint
npm run format
npm test
```

## 📝 Lizenz

Dieses Projekt ist unter der [MIT License](LICENSE) lizenziert.

## 📧 Kontakt

- **Projekt-Ersteller**: Kiocin
- **GitHub**: [Kiocin](https://github.com/Kiocin)
- **Issues**: [GitHub Issues](https://github.com/Kiocin/Timocin/issues)

---

**Hinweis**: Dieses ist ein Template-README. Bitte personalisieren Sie die Informationen entsprechend Ihrem Projekt.


Test
