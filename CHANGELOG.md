# Änderungen

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
