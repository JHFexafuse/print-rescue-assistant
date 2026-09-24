# PrintRescue Assistant 0.1.3 – Printwars

Erste installierbare Testversion für die am 24.09.2026 bereitgestellte Konfiguration.
Sie vereinfacht die Wiederaufnahme eines beschädigten Drucks bei **erhaltener Z-Referenz**.
Der private Voron ist kein Bestandteil dieses Druckerprofils.

## Was enthalten ist

- Dreh- und zoombare G-Code-Vorschau mit Millimetereingabe und schrittweisem Layerwechsel.
- Ausgewählte Schicht farbig; standardmäßig 30 darunterliegende Schichten verblasst.
- Anzeige der letzten vollständigen Schicht und der nächsten tatsächlich vorhandenen Druckebene.
- Lokale Dateien öffnen oder vorhandene Druckdateien über Moonraker laden.
- Geführte Handprüfung mit dem vorhandenen Pin `_STEPPER_RESET`: nur X/Y werden freigegeben.
- Nach Bestätigung: X/Y bestromen, Z um 10 mm anheben, über das geprüfte `G28 X` X/Y homen.
- Erzeugen und Hochladen einer `_REP.gcode`, anschließend Start bei 20 % über `M220 S20`.
- Temperaturen, Lüfter, Beschleunigung, Flow, Extrusionsmodus, E-Zähler und Anfangsposition werden am Schnitt rekonstruiert.
- Originaldatei bleibt erhalten. Bereits vorhandene Reparaturdateien erhalten bei weiteren Versuchen eine Nummer.
- Z-Homing wird durch eine Ergänzung im bestehenden Homing-Override während der Reparatursitzung gesperrt.
- Veraltete Reparaturdateien benötigen eine neue, passende Prüfsitzung; ein einfaches späteres Starten der Datei reicht nicht.

Die Oberfläche ist unter `/print-rescue/` erreichbar. Ab Version 0.1.2 kann sie über
`--mainsail-embed` zusätzlich im Inhaltsbereich von Mainsail eingebettet werden.
Seitenleiste und Kopfleiste bleiben dabei erreichbar. Beim Wechsel zu Mainsail und
zurück bleiben geladene Datei, Layerauswahl und Prüfsitzung im Browser erhalten.
Es werden keine Cloud-Dienste oder zusätzlichen laufenden Hintergrunddienste benötigt.

### Gestaltung ab 0.1.3

Die Bedienoberfläche orientiert sich an Mainsails kompakten Panels, Kopfzeilen, Schaltflächen und Eingabefeldern. Eingebettet übernimmt sie die aktuelle Akzentfarbe, Hell-/Dunkelmodus, Panelhintergründe und Schriftfamilie aus Mainsail. Die vorhandenen Roboto-Schriften werden vom selben Drucker geladen. Ein Theme-Wechsel lädt die Vorschau nicht neu; Datei, Layerauswahl und Prüfsitzung bleiben erhalten.

Die **3D-Vorschau bleibt unser eigener Viewer**. Ihr Aussehen orientiert sich an PrusaSlicer 2.9.4: grauer Hintergrundverlauf, farbige Druckpfade und eine einklappbare Merkmalslegende im Vorschaufenster. Außenkontur, Kontur, Füllung, massive/obere massive Füllung, Brücken, Stützen und Stützschnittstellen werden getrennt eingefärbt. Die Legende zeigt nur Merkmale aus der geladenen Datei. Die darunterliegenden Schichten bleiben zur Orientierung grau verblasst; standardmäßig sind es weiterhin 30. Die Pfade werden als Linien dargestellt, nicht als PrusaSlicers vollständige Volumengeometrie.

Farbreferenz: [PrusaSlicer-Merkmalsfarben](https://github.com/prusa3d/PrusaSlicer/blob/version_2.9.4/src/libvgcode/src/ViewerImpl.cpp) und [3D-Hintergrund](https://github.com/prusa3d/PrusaSlicer/blob/version_2.9.4/src/slic3r/GUI/GLCanvas3D.cpp). Mainsails eigener G-Code-Viewer wird nicht verwendet.

## GitHub und Updates über Mainsail

Die Installation als Git-Checkout ist für die Weiterentwicklung vorgesehen. Moonraker zeigt **PrintRescue** im Update-Manager an. Mit dem Update-Knopf werden neue Commits geladen und anschließend Klipper neu gestartet, genau wie beim Eintrag `mainsail-config` mit `managed_services: klipper`.

`enable_auto_refresh` in Moonraker betrifft die Suche nach Updates; diese Einrichtung installiert keine Updates selbstständig. Durch den Klipper-Neustart geht die Positionsreferenz verloren. Deshalb den Update-Knopf nur zwischen Druckaufträgen verwenden, bevor ein zu rettendes Teil auf dem Bett steht.

Der Installer verknüpft diese Dateien:

| Installierte Datei | Quelle im Git-Checkout |
| --- | --- |
| `<Mainsail-Webordner>/print-rescue/index.html` | `index.html` |
| `<Konfigurationsordner>/print_rescue.cfg` | `integration/print_rescue.cfg` |
| `<Mainsail-Webordner>/print-rescue/mainsail-embed.js` (bei Einbettung) | `integration/mainsail-embed.js` |

Die Homepage von Mainsail, die übrige Druckerkonfiguration und das bestehende Homing-Makro liegen weiterhin außerhalb des Repositories. Die optionale Einbettung ergänzt einen markierten Loader in Mainsails `index.html` und aktualisiert gegebenenfalls deren Cache-Eintrag in `sw.js`. Die Homing-Sperre wird einmalig beim Installieren ergänzt. Falls eine spätere Version Änderungen an dieser Sperre benötigt, muss sie als ausdrücklicher Migrationsschritt dokumentiert werden; ein `git pull` schreibt keine fremden Konfigurationsdateien um.

### Repository und Versionen

Quellcode und Updates: [JHFexafuse/print-rescue-assistant](https://github.com/JHFexafuse/print-rescue-assistant). Der Entwicklungsstand liegt auf `main`.

Das Repository braucht einen Branch `main` oder `master`, einen Remote `origin` und mindestens einen erreichbaren Versionstag im Format `vX.Y.Z`. Das fertig gebaute `index.html` gehört mit ins Repository; auf dem Drucker ist kein Node.js-Build nötig.

Das Repository enthält die Projektdateien und das zum Abgleich erforderliche Integrationsprofil. Vollständige Druckerkonfigurationen, G-Code-Druckaufträge und Zugangsdaten gehören nicht hinein.

Das öffentliche Repository lässt sich auf dem Drucker ohne GitHub-Zugangsdaten lesen.

### Auf dem Drucker einrichten oder von der ZIP-Version umstellen

Voraussetzung: Git und Python 3.9 oder neuer auf dem Klipper-Rechner. Die Erstinstallation und die Umstellung bei freiem Druckbett durchführen. Die Pfade `~/printer_data/config` und `~/mainsail` müssen zu deiner Installation passen:

```bash
git clone https://github.com/JHFexafuse/print-rescue-assistant.git ~/print-rescue
cd ~/print-rescue
python3 install.py --config-dir ~/printer_data/config --web-root ~/mainsail --git-updates --mainsail-embed --dry-run
```

Bei erfolgreicher Prüfung:

```bash
python3 install.py --config-dir ~/printer_data/config --web-root ~/mainsail --git-updates --mainsail-embed
```

Der Git-Modus funktioniert auch nach der bisherigen ZIP-Installation. Vorhandene Dateien werden gesichert und durch die Verknüpfungen ersetzt. Der Installer ergänzt außerdem:

- `print_rescue_updates.conf` samt Include in `moonraker.conf`, mit tatsächlichem Git-Pfad, Remote und Branch.
- „Druck retten“ in `.theme/navi.json`; vorhandene Links bleiben erhalten.
- Mit `--mainsail-embed`: Einbettung innerhalb Mainsails; ohne diese Option öffnet eine neue Installation einen separaten Tab.

Danach einmal **Moonraker neu starten** (zum Einlesen des neuen Update-Eintrags) und **Klipper neu starten** (zum Laden der Makros), zum Beispiel über Mainsails Dienstesteuerung. Der Installer führt selbst keine Diensteneustarts aus. Mainsail anschließend neu laden.

Der erzeugte Eintrag entspricht diesem Muster:

```ini
[update_manager print_rescue]
type: git_repo
channel: dev
primary_branch: main
path: ~/print-rescue
origin: https://github.com/JHFexafuse/print-rescue-assistant.git
managed_services: klipper
```

`channel: dev` verwendet für die gemeinsame Testphase die Commits des eingestellten Branches. Es bedeutet keine automatische Installation. Bei einem Repository mit `master` übernimmt der Installer `primary_branch: master`.

### Bestehende Installation in Mainsail einbetten

Den laufenden Test bzw. die Handprüfung erst abschließen, bevor die Browserseite neu geladen wird. Für die Oberflächenupdates von 0.1.1/0.1.2 auf 0.1.3 ist **kein Diensteneustart** nötig. Den normalen Moonraker-Update-Knopf während eines Drucks oder einer Rettung nicht verwenden: Der konfigurierte Eintrag würde Klipper neu starten.

Auf dem Klipper-Rechner, mit den bisherigen Installationspfaden:

```bash
cd ~/print-rescue
git pull --ff-only
python3 install.py --config-dir ~/printer_data/config --web-root ~/mainsail --mainsail-embed --ui-only --dry-run
python3 install.py --config-dir ~/printer_data/config --web-root ~/mainsail --mainsail-embed --ui-only
```

Danach Mainsail mit **Strg+F5** vollständig neu laden. „Druck retten“ öffnet nun im Inhaltsbereich. „Zurück zu Mainsail“ oder ein Mainsail-Menüpunkt blendet die Rettungsansicht aus, ohne sie zu entladen. Ein erneuter Klick auf „Druck retten“ zeigt dieselbe Sitzung. Ein vollständiges Neuladen des Browserfensters verwirft weiterhin die lokale Dateiauswahl.

`--ui-only` ändert ausschließlich Webdateien und `.theme/navi.json`; Druckermakros, Homing-Sperre und Moonraker-Konfiguration bleiben erhalten. Vorhandene Git-Verknüpfungen werden beibehalten. Der Installer sichert auch Mainsails ursprüngliche Startseite. Falls Nginx komprimierte Kopien von `index.html` oder `sw.js` vorhält, werden diese gesichert und entfernt, damit die aktualisierten Dateien ausgeliefert werden.

Bei HTTPS/PWA aktualisiert der Installer den HTML-Cache-Eintrag in Mainsails Workbox-Service-Worker. Gegebenenfalls nach dessen Aktualisierung nochmals neu laden. Die eingebettete Oberfläche wird als normale Datei geladen; Mainsails Routen-Cache kann sie dadurch nicht durch sein Dashboard ersetzen. Ein unbekanntes Service-Worker-Format stoppt die Installation vor Schreibzugriffen.

Dies ist eine lokale Ergänzung für die Mainsail-2.x-Struktur, keine offizielle Mainsail-Plugin-Schnittstelle. Ein **Mainsail-Update kann den Loader und den Zusatzordner überschreiben**. Danach denselben `--mainsail-embed --ui-only`-Befehl wieder ausführen; dabei sind keine Klipper- oder Moonraker-Neustarts nötig. Normale PrintRescue-Updates laden die verknüpfte Oberfläche und den Loader aus dem Checkout.

Ist die Einbettung aus 0.1.2 bereits eingerichtet und weiterhin vorhanden, reicht für das Designupdate auf 0.1.3 `git -C ~/print-rescue pull --ff-only` mit anschließendem vollständigem Neuladen von Mainsail. Der UI-Installer muss dann nicht erneut ausgeführt werden.

### Spätere Updates

1. In Mainsail unter **Maschine → Update-Manager** nach Updates suchen und **PrintRescue aktualisieren** anklicken.
2. Moonraker lädt die neue Version und startet Klipper neu.
3. Mainsail bzw. den separaten PrintRescue-Tab vollständig neu laden. Versionsnummer, Meldungen und Änderungen in `CHANGELOG.md` prüfen.

Ein bereits offener Browser-Tab verwendet bis zum Neuladen seinen bisherigen Programmstand. Die Oberfläche prüft beim Verbinden, ob die geladenen Makros zum eingebauten Profil passen. Ein erkannter Unterschied sperrt Bewegungen.

Änderungen im Git-Checkout werden von Moonraker als lokale Änderungen behandelt. Persönliche Konfigurationen deshalb außerhalb des Checkouts belassen. Die Einbettung nach einem Mainsail-Update gegebenenfalls mit dem oben beschriebenen UI-Befehl wiederherstellen.

### Entwicklung und Versionsstände

Vor einem Commit Änderungen testen und die Browserdatei neu bauen:

```bash
python3 build.py
node --test tests/gcode.test.mjs tests/ui.test.mjs tests/embed.test.mjs
python3 tests/install_test.py
python3 tests/macros_test.py
```

Für den letzten Test ist Jinja2 erforderlich, nur als Entwicklungsabhängigkeit. `VERSION` und `CHANGELOG.md` zusammen pflegen. GitHub Actions führt bei Pushes und Pull Requests die Softwaretests aus und prüft, dass `index.html` dem Quellcode entspricht. Nach einem erfolgreichen Push auf `main` legt ein weiterer Job den Tag aus `VERSION` an, falls er noch nicht existiert. Bestehende Tags werden nicht verschoben. Ein Tag identifiziert einen Stand; er ist allein noch keine Zusage, dass die Testversion produktionsreif ist.

## Mainsail-Menü bei ZIP-Installation

Auch ohne Git kann der Installer mit `--mainsail-link` den Seitenleisteneintrag ergänzen oder mit `--mainsail-embed` die eingebettete Ansicht einrichten. Die Git-Installation enthält den Menüeintrag bereits.

## Zuerst ohne Installation ansehen

`index.html` auf den PC herunterladen und in Chrome, Edge oder Firefox öffnen.
Die Demo startet automatisch. Über **Datei öffnen** den eigenen Text-G-Code laden.
Ohne Verbindung und passendes installiertes Druckerprofil bleiben die Bewegungsschaltflächen gesperrt.

Die mitgelieferte Demo ist eine synthetische Vorschau. Sie wird nicht an den Drucker übertragen.
Die Funktion **Auswahl protokollieren** lädt ein JSON-Protokoll, keine ausführbare Reparaturdatei.

## Erstinstallation

**Die Erstinstallation benötigt anschließend einen Klipper-Neustart. Deshalb bei freiem Druckbett installieren, bevor ein zu rettender Druck auf dem Bett steht. Ein Neustart würde dessen erhaltene Referenz verwerfen.**

ZIP auf den Klipper-Rechner kopieren und entpacken. Als den Benutzer arbeiten, dem die Druckerkonfiguration und Mainsail gehören.
`~/printer_data/config` und `~/mainsail` sind Beispiele; die tatsächlichen Ordner müssen stimmen.

```bash
unzip PrintRescue_v0.1.1_GitHub.zip
cd PrintRescue_v0.1.1

python3 install.py \
  --config-dir ~/printer_data/config \
  --web-root ~/mainsail \
  --dry-run
```

Der Probelauf vergleicht das Homing und den Reset-Pin mit dem geprüften Profil. Bei Abweichungen bleibt die Konfiguration unangetastet.
Ist die Prüfung erfolgreich, installieren:

```bash
python3 install.py \
  --config-dir ~/printer_data/config \
  --web-root ~/mainsail
```

Der Installer sichert vorhandene Dateien in `print-rescue-backup-<Zeitpunkt>` im Konfigurationsordner.
Er ergänzt `print_rescue.cfg`, ein Include vor dem SAVE_CONFIG-Block sowie die Homing-Sperre in `06_macros.cfg`.
Die Webseite wird als Unterordner `print-rescue` abgelegt. Die vorhandene Mainsail-Startseite wird nicht ersetzt.
Der Installer startet Klipper nicht selbst neu.

Danach bei freiem Druckbett in Mainsail:

```gcode
RESTART
```

Öffnen: `http://<Druckeradresse>/print-rescue/`. **Drucker verbinden** wählen und dieselbe Basisadresse wie für Mainsail eintragen.
Falls Moonraker einen API-Schlüssel benötigt, diesen ausschließlich in der Oberfläche eintragen. Er wird nur im Arbeitsspeicher gehalten.
Die Oberfläche vergleicht die installierten Makros mit dem Profil, bevor Bewegungen verfügbar werden.

Wenn der Mainsail-Webordner nicht bekannt ist, zuerst die dortige Nginx-Konfiguration prüfen. Keine pauschalen Zugriffsrechte oder CORS-Freigaben ändern.
Ein lokales `file://`-Fenster kann abhängig von Moonrakers CORS-Einstellungen keinen Druckerzugriff bekommen; die Installation unter derselben Webadresse vermeidet diesen zusätzlichen Fall.

## Ablauf am Drucker

1. Fehlerursache beheben, Filamentförderung prüfen und sicherstellen, dass das Teil weiterhin fest sitzt und die Gantry ausgerichtet ist.
2. Alten Auftrag in Mainsail abbrechen. V1 setzt voraus, dass danach XYZ als gehomt gelten und alle vier Z-Motoren bestromt sind.
3. Original-G-Code auswählen. Zollstockmaß eingeben und die **letzte vollständig gedruckte Schicht** bestimmen.
4. Düse in Mainsail an eine freie XY-Position neben das Bauteil bringen. Der senkrechte Weg zur gewählten Höhe muss frei sein.
5. **Höhe anfahren · X/Y freigeben** betätigen. Das gespeicherte PETG-Mesh wird geladen; es findet keine Bettabtastung statt. Nach der Z-Fahrt schaltet der Reset-Pin nur X/Y ab.
6. Kopf von Hand über das Bauteil verschieben und die Höhe beurteilen. Z bleibt bestromt. Wenn die Auswahl nicht passt, mit **Prüfung beenden · X/Y homen** zurückkehren und eine andere Schicht wählen.
7. Temperaturen kontrollieren. **Höhe passt · mit 20 % starten** erzeugt zuerst die Reparaturdatei und lädt sie hoch. Anschließend werden X/Y referenziert und die Datei gestartet.
8. Nach dem Aufheizen beginnt der Druck bei 20 %. Geschwindigkeit und Babystepping bei Bedarf in Mainsail einstellen.

Das automatisierte XY-Homing erfolgt mit Abstand zum Bauteil. Auch dieser Fahrweg muss frei von Gegenständen sein, die über die geprüfte Höhe hinausragen.
Das Mesh und vorhandene Koordinatenoffsets werden nicht neu kalibriert. Die Software erkennt keine mechanisch abgesackte oder schiefstehende Gantry allein anhand des Klipper-Homing-Flags.

## Verhalten bei Unterbrechungen

- Geht die Verbindung während der Handprüfung verloren, werden keine weiteren automatischen Fahrbefehle ausgelöst. Die Z-Motoren bleiben durch diesen Assistenten unverändert bestromt.
- Die Sitzung liegt in Klipper. Nach erneutem Verbinden kann die Prüfung beendet werden. Zum Weiterdrucken ist eine neue passende Prüfung erforderlich, wenn der Browser seine Dateiauswahl verloren hat.
- `PR_UNLOCK_XY` schaltet ausschließlich den Reset-Pin wieder auf 1 und führt keine Bewegung aus. Nach einer Handbewegung sind X/Y weiterhin neu zu referenzieren; die Sitzungssperre bleibt deshalb aktiv.
- Scheitert der Upload, erfolgt kein Homing und kein Start. Scheitert das Homing, erfolgt kein Start. Bei einem unklaren Netzwerkfehler den tatsächlichen Druckerstatus in Mainsail kontrollieren.
- Nach Abbruch eines Reparaturdrucks kann die Sitzung bei weiterhin gültiger Referenz in der Oberfläche verworfen und neu vorbereitet werden.
- Firmware-Neustart, abgeschaltete Z-Motoren oder verlorene Z-Referenz sperren V1. Es wird weder `SET_KINEMATIC_POSITION` noch `FORCE_MOVE` als Ersatz benutzt.

## Grenzen der ersten Version

- Geprüft am gelieferten PrusaSlicer-2.9.4-G-Code `OBI_3_Gesicht.gcode` und dem gelieferten Druckerprofil. Weitere Slicer-/Druckerprofile müssen anhand ihrer Dateien geprüft werden.
- Ein Extruder, planare Schichten. Die Unterstützung von Stützen auf Zwischenhöhen ist enthalten.
- Werkzeugwechsel, Firmware-Retract, nichtplanare/Spiral-Drucke, sequenzieller Objektdruck und unerkannte Befehle verhindern die Reparaturfreigabe.
- Bereits ausgeschlossene Objekte werden in V1 nicht übernommen; dieser Zustand sperrt die Freigabe.
- Die Originalmakros `PRINT_END` und `PARK` bleiben für das normale Druckende in Verwendung. `PRINT_START` wird durch den eigenen Reparaturstart ersetzt.
- Der vorhandene PETG-Mesh-Name ist Bestandteil dieses konkreten Profils. Änderungen am Profil müssen vor Verwendung abgestimmt werden.
- Kein automatisches Priming am Bauteil: funktionsfähige, vorbereitete Filamentförderung bestätigt der Bediener.
- Text-G-Code bis 256 MiB und 12 Millionen Vorschausegmente. Große Dateien werden im Browser analysiert, nicht auf dem Raspberry Pi.
- Ein Mainsail-Update kann den Loader und den Zusatzordner entfernen. Die Einbettung dann mit `--mainsail-embed --ui-only` wiederherstellen. Nicht für Mainsails extern gehostete Oberfläche `my.mainsail.xyz` vorgesehen; Mainsail und PrintRescue müssen auf derselben Drucker-Webadresse liegen.
- Physischer Wiederanlauf und visuelle Darstellung in einem echten Browser wurden hier noch nicht am Zielsystem getestet. Dies ist eine **Testversion**, keine bereits im Produktionsbetrieb abgenommene Erweiterung.

V2 ist für den Wiederanlauf nach Abschaltung vorgesehen: kontrollierte manuelle Z-Referenz sowie individuelles Ausrichten der vier Z-Motoren. Diese Funktionen sind in V1 absichtlich nicht enthalten.

## Durchgeführte Softwareprüfungen

- Gesamte Beispieldatei analysiert: 157.300.435 Bytes, 6.712.951 Zeilen, 2.154 Schichten, maximale Druckhöhe 456,6 mm.
- 3.817.504 Extrusionssegmente für die Vorschau erkannt; reine Fahrwege und Z-Hops erzeugen keine zusätzlichen Schichten.
- Beispiel-Schnitt: Schicht 1000 bei 200,5 mm → Schicht 1001 bei 200,6 mm, Düse 230 °C, Bett 77 °C.
- Unabhängiges Nachrechnen der ersten 30 Extrusionsbewegungen nach diesem Schnitt: XYZ, Extrusionsdifferenzen und Vorschub stimmen mit dem Original überein.
- Parser-Tests: absolute/relative Extrusion, Retract/G92, Z-Hop, wechselnde Höhen, Bögen, unbekannte Befehle, ungültige Eingaben und CRLF-Dateien.
- Klipper-Jinja-Vorlagen mit Klipper-kompatibler Syntax gerendert; Ablauf mit einem simulierten Maschinenzustand geprüft: XY-Freigabe, Anheben, ausschließlich XY-Homing, fehlende Z-Referenz, ausgeschalteter Z-Motor, abweichender Token, Abbruch.
- Bedienlogik mit simuliertem DOM und Moonraker geprüft, einschließlich Reihenfolge Upload → Bestätigung/Homing → Druckstart.
- Installationsprüfung mit Konfigurationskopien: Probelauf, Sicherungen, wiederholte Installation, Include-Reihenfolge und unveränderte übrige Dateien.
- Version 0.1.1: neun zusätzliche Installationstests für ZIP-zu-Git-Migration, unveränderte Mainsail-Startseite, vorhandene Menüpunkte, Dateiverknüpfungen nach einem simulierten Git-Update, Branch-Auswahl, ungültige Eingaben und Wiederherstellung nach Schreibfehler. Insgesamt 30 automatisierte Tests bestanden.
- Version 0.1.2: sechs Tests der Einbettung mit simuliertem DOM und sechs zusätzliche Installer-Tests. Geprüft werden Navigation, Erhalt derselben eingebetteten Sitzung, Abstand zu Seitenleiste/Kopfleiste, Verbindungsverlust, Ladefehler, reine UI-Installation ohne Änderung der Druckerkonfiguration, Cache-Anpassung und Wiederherstellung nach Schreibfehler. Die Verbindungsvorbelegung innerhalb der eingebetteten Seite ist ebenfalls geprüft. Insgesamt 42 automatisierte Tests bestanden.
- Version 0.1.3: Theme-Wechsel bei erhaltener eingebetteter Sitzung sowie getrennte Prusa-Merkmale bei unveränderter Geometrie und identischem Reparatur-G-Code geprüft. Die Legende wird im bestehenden Oberflächentest mitgeprüft. Insgesamt 44 automatisierte Tests bestanden. Ein visueller Vergleich im echten Mainsail-Browser steht weiter aus.

Die Cloud-Browserumgebung hat den Zugriff auf die lokale HTML-Datei gesperrt. Deshalb wurde kein erfolgreicher visueller Browsercheck behauptet. Die DOM-Prüfungen ersetzen diesen nicht.

## Entwicklung

`index.html` ist eine eigenständige Datei. Quelltexte und die beim Bauen eingebettete `style.css` liegen in `src/`; Klipper-Integration und Profil in `integration/`.
Die Erstellung benötigt nur Python 3:

```bash
python3 build.py
```

Tests benötigen Node.js und für die Jinja-Prüfung zusätzlich Jinja2:

```bash
node --test tests/gcode.test.mjs tests/ui.test.mjs tests/embed.test.mjs
python3 tests/install_test.py
python3 tests/macros_test.py
```

## Rückbau

Nur die Mainsail-Einbettung entfernen: Den Block zwischen `PRINT_RESCUE_EMBED_BEGIN` und `PRINT_RESCUE_EMBED_END` aus Mainsails `index.html` entfernen, `print-rescue/mainsail-embed.js` löschen und beim PrintRescue-Eintrag in `.theme/navi.json` wieder `"target": "_blank"` setzen. Bei installiertem Service Worker die zusammengehörigen Mainsail-Dateien `index.html` und `sw.js` aus derselben Sicherung wiederherstellen, sofern zwischenzeitlich kein Mainsail-Update stattgefunden hat; andernfalls die aktuelle Originalversion von Mainsail wieder einspielen. Dann den Browser vollständig neu laden. Dies benötigt keinen Klipper-Neustart.

Bei freiem Druckbett aus der ausgegebenen Sicherung `printer.cfg` und `06_macros.cfg` wiederherstellen. Danach Klipper neu starten.
Wenn inzwischen andere Konfigurationsänderungen erfolgt sind, nicht die gesamte Sicherung darüberkopieren, sondern nur das Include und den mit `PRINT_RESCUE_Z_GUARD_V1` markierten Block entfernen.
`print_rescue.cfg` und der Web-Unterordner `print-rescue` können anschließend entfernt werden.

Nach einer Git-Installation zusätzlich das Include für `print_rescue_updates.conf` aus `moonraker.conf` und den PrintRescue-Link aus `.theme/navi.json` entfernen. Moonraker neu starten. Den Git-Checkout erst entfernen, wenn keine aktiven Verknüpfungen mehr auf ihn zeigen. Die Sicherung enthält die vorherigen Dateiinhalte und ein `manifest.json` mit Zielpfaden und ursprünglichen Verknüpfungen.

## Verwendete Schnittstellen

- [Klipper G-Codes](https://www.klipper3d.org/G-Codes.html)
- [Klipper Status](https://www.klipper3d.org/Status_Reference.html)
- [Klipper Makros](https://www.klipper3d.org/Command_Templates.html)
- [Moonraker Dateiverwaltung](https://moonraker.readthedocs.io/en/latest/external_api/file_manager/)
- [Moonraker Druckersteuerung](https://moonraker.readthedocs.io/en/latest/external_api/printer/)
- [Moonraker Git-Updates](https://moonraker.readthedocs.io/en/latest/configuration/#git-repo-configuration)
- [Mainsail Navigation](https://docs.mainsail.xyz/features/custom-themes/custom-navigation/)
