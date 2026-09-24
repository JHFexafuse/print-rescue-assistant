# Änderungen

## 0.1.4 – 24.09.2026 – Testversion

- Bei einer G-Code-Sperre steht der konkrete Grund mit betroffener Zeile direkt über „Höhe anfahren“. Dateiweite Befunde werden ohne irreführende Zeilennummer angezeigt.
- „Hinweise zur Datei“ öffnet sich bei Sperren automatisch, zeigt sperrende Befunde zuerst und kennzeichnet reine Hinweise getrennt.
- Die unterstützten Befehle und die Freigabebedingungen bleiben unverändert. Ein zusätzlicher Oberflächentest prüft Sperren trotz gesetzter Bestätigung sowie die Freigabe bei reinen Hinweisen. Insgesamt 45 Softwaretests bestanden.

## 0.1.3 – 24.09.2026 – Testversion

- Bedienoberfläche mit Mainsail-ähnlichen Panels, 48-px-Kopfzeilen, kompakten Schaltflächen und Eingabefeldern.
- Eingebettete Ansicht übernimmt Akzentfarbe, Hell-/Dunkelmodus, Panelhintergründe und Schrift aus Mainsail; lokale Roboto-Dateien werden auf demselben Drucker verwendet. Theme-Wechsel erhält Datei, Layerauswahl und Prüfsitzung.
- Eigenständige 3D-Vorschau im PrusaSlicer-Stil: grauer Hintergrundverlauf, Merkmalsfarben aus PrusaSlicer 2.9.4, einklappbare Legende und dezente Pfadkonturen. Die 30 unteren Ghost-Schichten bleiben erhalten.
- Separate Vorschaufarben unter anderem für massive Füllung, Deckfläche, Brücken, Überhänge und Stützschnittstellen. Die Farbzuordnung verändert weder Geometrie noch Wiederanlaufbefehle.
- 44 Softwaretests bestanden. Klipper-Makros und Druckersteuerung unverändert. Visuelle Abnahme auf dem Zielsystem steht aus.

## 0.1.2 – 24.09.2026 – Testversion

- Optionale Einbettung im Mainsail-Inhaltsbereich mit `--mainsail-embed`. Seitenleiste und Kopfleiste bleiben verfügbar; „Druck retten“ öffnet keinen zusätzlichen Tab.
- Wechsel zwischen Mainsail und PrintRescue erhält die geladene Datei, Layerauswahl und Prüfsitzung im selben eingebetteten Fenster.
- `--mainsail-embed --ui-only` ergänzt eine bestehende Installation ohne Änderung der Klipper-/Moonraker-Konfiguration und ohne Diensteneustart.
- Gesicherte, wiederholbare Ergänzung der Mainsail-Startseite; Aktualisierung ihres Service-Worker-Cache-Eintrags und Behandlung komprimierter Webdateien. Nach Mainsail-Updates lässt sich die Einbettung mit demselben UI-Befehl wiederherstellen.
- Verbindungsvorbelegung verwendet im eingebetteten Fenster die Mainsail-Adresse. Der Bediener verbindet weiterhin ausdrücklich.
- 42 Softwaretests bestanden. Wiederanlaufmakros und Reparatur-G-Code-Logik unverändert. Darstellung und Bedienung auf dem echten Mainsail-System stehen noch zur Prüfung aus.

## 0.1.1 – 24.09.2026 – Testversion

- Git-Installation über `install.py --git-updates` für `JHFexafuse/print-rescue-assistant`.
- Eigener Moonraker-Eintrag `print_rescue` mit `type: git_repo` und `managed_services: klipper`. Updates werden in Mainsail vom Bediener ausgelöst; danach startet Moonraker Klipper neu.
- Die Oberfläche und die PrintRescue-Makros werden mit dem Git-Checkout verknüpft, damit ein Update tatsächlich die verwendeten Dateien aktualisiert.
- Mainsail-Menüeintrag „Druck retten“; vorhandene Navigation bleibt erhalten.
- Installer sichert alle betroffenen Dateien und stellt sie bei einem Schreibfehler wieder her.
- Migration von der ZIP-Installation ohne Änderungen an der Wiederanlauflogik.
- GitHub Actions prüft den Quellcode, die erzeugte Browserdatei und alle 30 Softwaretests. Neue Versionsnummern erhalten nach erfolgreicher Prüfung auf `main` automatisch einen Git-Tag.

Ein Update über eine echte Moonraker-Instanz und der praktische Druckertest stehen noch aus.

## 0.1.0 – 24.09.2026 – Testversion

Erste Schichtvorschau, G-Code-Reparatur und geführte Wiederaufnahme für das geprüfte Printwars-Druckerprofil. Softwaretests bestanden; praktischer Test am Drucker steht aus.
