#!/usr/bin/env python3
"""Install the reviewed static UI and minimal Klipper integration; no restart."""
import argparse
import datetime
import hashlib
import json
import re
import shutil
import os
import stat
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent

def git_update_settings(root):
    def git(*args):
        result = subprocess.run(['git', '-C', str(root), *args], capture_output=True, text=True, timeout=15)
        if result.returncode:
            raise ValueError('Git-Installation benötigt einen vollständigen Clone auf einem lokalen Branch mit origin und Versionstag.')
        return result.stdout.strip()
    if Path(git('rev-parse', '--show-toplevel')).resolve() != root:
        raise ValueError('PrintRescue muss im Hauptordner seines eigenen Git-Repositories liegen.')
    branch = git('symbolic-ref', '--short', 'HEAD')
    if branch not in ('main', 'master'):
        raise ValueError('Für den Update-Manager bitte den main- oder master-Branch auschecken.')
    origin = git('remote', 'get-url', 'origin')
    if not re.fullmatch(r'(?:https://github\.com/|git@github\.com:)[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:\.git)?', origin):
        raise ValueError('origin muss eine GitHub-HTTPS- oder SSH-Adresse ohne eingebettete Zugangsdaten sein.')
    tags = git('tag', '--merged', 'HEAD').splitlines()
    if not any(re.fullmatch(r'v\d+\.\d+\.\d+', tag) for tag in tags):
        raise ValueError('Ein erreichbarer Versionstag wie v0.1.1 fehlt. Moonraker benötigt ihn zur Versionsanzeige.')
    if git('status', '--porcelain', '--untracked-files=normal'):
        raise ValueError('Der Git-Checkout enthält lokale Änderungen. Vor der Update-Einrichtung sichern und bereinigen.')
    if any(c in str(root) for c in '\n\r#;'):
        raise ValueError('Der Repository-Pfad enthält Zeichen, die Moonraker als Kommentar interpretieren könnte.')
    return '\n'.join([
        '# Managed by PrintRescue installer.',
        '# Updates per Update-Knopf; Klipper wird anschließend neu gestartet.',
        '[update_manager print_rescue]', 'type: git_repo', 'channel: dev',
        'primary_branch: '+branch, 'path: '+str(root), 'origin: '+origin,
        'managed_services: klipper', 'info_tags:', '    desc=PrintRescue', ''
    ])

def navigation_text(path, embedded=False):
    entries = json.loads(path.read_text()) if path.exists() else []
    if not isinstance(entries, list) or any(not isinstance(entry, dict) for entry in entries):
        raise ValueError('Die vorhandene .theme/navi.json ist keine Liste von Navigationseinträgen.')
    matches = [entry for entry in entries if entry.get('href') == '/print-rescue/']
    if not matches:
        entries.append({'title': 'Druck retten', 'href': '/print-rescue/', 'target': '_self' if embedded else '_blank', 'position': 65})
    elif embedded:
        for entry in matches: entry['target'] = '_self'
    return json.dumps(entries, ensure_ascii=False, indent=2)+'\n'

def embedded_mainsail_html(text):
    begin, end = '<!-- PRINT_RESCUE_EMBED_BEGIN -->', '<!-- PRINT_RESCUE_EMBED_END -->'
    if begin in text or end in text:
        if text.count(begin) != 1 or text.count(end) != 1 or text.index(begin) > text.index(end):
            raise ValueError('Unvollständige PrintRescue-Einbettung in der Mainsail-index.html. Keine Änderung vorgenommen.')
        text = re.sub(re.escape(begin)+r'[\s\S]*?'+re.escape(end)+r'\n?', '', text, count=1)
    if len(re.findall(r'</body\s*>', text, re.I)) != 1 or not re.search(r'\bid\s*=\s*[\"\']app[\"\']', text):
        raise ValueError('Die index.html entspricht keiner unterstützten Mainsail-Webseite (app/body fehlt).')
    block = begin+'\n<script id="print-rescue-loader" src="/print-rescue/mainsail-embed.js" defer></script>\n'+end+'\n'
    return re.sub(r'</body\s*>', lambda match: block+match[0], text, count=1, flags=re.I)

def embedding_changes(web_root, linked):
    html = embedded_mainsail_html((web_root/'index.html').read_text(encoding='utf-8'))
    source = ROOT/'integration/mainsail-embed.js'
    changes = [
        (web_root/'index.html', 'web/mainsail-index.html', 'bytes', html.encode()),
        (web_root/'print-rescue/mainsail-embed.js', 'web/mainsail-embed.js', 'link' if linked else 'bytes',
         source if linked else source.read_bytes()),
    ]
    # nginx may prefer a precompressed copy over the edited HTML. Back up and
    # remove only those generated variants, letting nginx serve/compress HTML.
    generated = ['index.html']
    worker = web_root/'sw.js'
    if worker.exists():
        # Workbox precaches Mainsail's index.html. Give only that entry a new
        # revision so a service-worker update fetches the amended HTML.
        original = worker.read_text(encoding='utf-8')
        entry = r'\{\s*(?:[\"\']url[\"\']|url)\s*:\s*[\"\']/?index\.html[\"\']\s*,\s*(?:[\"\']revision[\"\']|revision)\s*:\s*([\"\'])[A-Za-z0-9_-]+\1\s*\}|\{\s*(?:[\"\']revision[\"\']|revision)\s*:\s*([\"\'])[A-Za-z0-9_-]+\2\s*,\s*(?:[\"\']url[\"\']|url)\s*:\s*[\"\']/?index\.html[\"\']\s*\}'
        revision = hashlib.sha256(html.encode()).hexdigest()[:32]
        replacement = json.dumps({'url': 'index.html', 'revision': revision}, separators=(',', ':'))
        patched, count = re.subn(entry, lambda match: replacement, original)
        if count != 1:
            raise ValueError('Mainsail-sw.js hat ein unbekanntes Cache-Format. Einbettung nicht installiert; diese Datei zuerst prüfen lassen.')
        changes.append((worker, 'web/mainsail-sw.js', 'bytes', patched.encode()))
        generated.append('sw.js')
    for name in generated:
        for extension in ('.gz', '.br'):
            path = web_root/(name+extension)
            if path.exists() or path.is_symlink():
                changes.append((path, 'web/mainsail-'+name+extension, 'delete', None))
    return changes

def write_atomic(path, kind, value, mode=0o644):
    if kind == 'delete':
        path.unlink(missing_ok=True)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.print-rescue-', dir=path.parent)
    temporary = Path(name)
    try:
        os.close(fd)
        if kind == 'link':
            temporary.unlink()
            temporary.symlink_to(value)
        else:
            temporary.write_bytes(value)
            temporary.chmod(mode)
        temporary.replace(path)
    finally:
        if temporary.exists() or temporary.is_symlink(): temporary.unlink()

def apply_changes(changes, backup):
    snapshots = []
    for path, relative, kind, value in changes:
        if path.is_symlink():
            previous = ('link', os.readlink(path), 0o644)
        elif path.exists():
            if not path.is_file(): raise ValueError(f'Ziel ist keine Datei: {path}')
            previous = ('bytes', path.read_bytes(), stat.S_IMODE(path.stat().st_mode))
        else:
            previous = None
        snapshots.append((path, relative, previous))
    backup.mkdir()
    for path, relative, previous in snapshots:
        if previous is not None:
            destination = backup/relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            # Materialize existing symlinks too: the backup retains the old bytes.
            if path.exists(): shutil.copy2(path, destination)
    (backup/'manifest.json').write_text(json.dumps([
        {'path': str(path), 'backup': relative, 'existed': old is not None,
         'symlink': old[1] if old and old[0] == 'link' else None}
        for path, relative, old in snapshots
    ], ensure_ascii=False, indent=2)+'\n')
    applied = []
    try:
        for (path, relative, kind, value), (_, _, previous) in zip(changes, snapshots):
            applied.append((path, previous))
            mode = previous[2] if previous and previous[0] == 'bytes' else 0o644
            write_atomic(path, kind, value, mode)
    except Exception:
        for path, previous in reversed(applied):
            if previous is None:
                path.unlink(missing_ok=True)
            else:
                write_atomic(path, *previous)
        raise

def normalize(code):
    # Match Klipper's '#' stripping and ConfigParser's whitespace-prefixed
    # inline ';' comments before comparing the live macro with the profile.
    cleaned = [re.sub(r'(^|\s);.*$', r'\1', line.split('#',1)[0]) for line in code.splitlines()]
    return ''.join(re.sub(r'\s+', '', line) for line in cleaned)

def sections(text):
    out = {}
    current = None
    for line in text.splitlines():
        match = re.match(r'^\[([^]]+)\]\s*$', line)
        if match:
            current = match[1].lower()
            out[current] = []
        elif current:
            out[current].append(line)
    return {k:'\n'.join(v) for k,v in out.items()}

def gcode(section):
    match = re.search(r'^gcode\s*[:=]\s*\n([\s\S]*)', section, re.M)
    if not match:
        raise ValueError('Makro ohne gcode-Abschnitt')
    # Sections supplied here end at the next section header.
    return match[1]

def patch_homing(text):
    marker = '    # PRINT_RESCUE_Z_GUARD_V1'
    if marker in text:
        return text
    needle = '    {% set do_z   = all_ax or want_z or z_cold %}'
    if text.count(needle) != 1:
        raise ValueError('Homing-Override weicht von der geprüften Konfiguration ab.')
    guard = '''
    # PRINT_RESCUE_Z_GUARD_V1
    {% if 'gcode_macro _PR_STATE' in printer %}
        {% if printer['gcode_macro _PR_STATE'].active|int == 1 and do_z %}
            {action_raise_error("Print Rescue: Z-Homing ist waehrend einer Reparatursitzung gesperrt. Z-Referenz muss erhalten sein.")}
        {% endif %}
    {% endif %}
'''
    return text.replace(needle, needle + '\n' + guard, 1)

def finish_installation(changes, config_dir, web_root, dry_run):
    for path, relative, kind, value in changes:
        base = web_root if relative.startswith('web/') else config_dir
        if not path.parent.resolve().is_relative_to(base):
            raise ValueError(f'Zielordner führt über einen Symlink aus dem Installationsordner heraus: {path.parent}')
        if path.exists() and path.is_dir(): raise ValueError(f'Ziel ist ein Ordner: {path}')
    if dry_run:
        print('Prüfung erfolgreich. --dry-run: keine Dateien geändert.')
        return
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S-%f')
    backup = config_dir/('print-rescue-backup-'+stamp)
    apply_changes(changes, backup)
    print('Sicherung:', backup)

def install_ui(config_dir, web_root, dry_run):
    target = web_root/'print-rescue/index.html'
    macro = config_dir/'print_rescue.cfg'
    if not macro.is_file():
        raise ValueError('--ui-only benötigt eine vorhandene PrintRescue-Installation. Zuerst die Erstinstallation durchführen.')
    linked = target.is_symlink() if target.exists() else macro.is_symlink()
    if (target.is_symlink() and target.resolve() != ROOT/'index.html') or (linked and macro.is_symlink() and macro.resolve() != ROOT/'integration/print_rescue.cfg'):
        raise ValueError('Die vorhandene Oberfläche verweist auf einen anderen Checkout. Dessen install.py verwenden.')
    navi = config_dir/'.theme/navi.json'
    changes = [
        (target, 'web/index.html', 'link' if linked else 'bytes', ROOT/'index.html' if linked else (ROOT/'index.html').read_bytes()),
        (navi, '.theme/navi.json', 'bytes', navigation_text(navi, embedded=True).encode()),
        *embedding_changes(web_root, linked),
    ]
    print('Nur Oberfläche: PrintRescue einbetten und Mainsail-Menü anpassen.')
    finish_installation(changes, config_dir, web_root, dry_run)
    if not dry_run:
        print('Installiert. Mainsail im Browser vollständig neu laden (Strg+F5).')
        print('Keine Klipper-/Moonraker-Konfiguration geändert; kein Diensteneustart erforderlich oder ausgeführt.')

def install(config_dir, web_root, dry_run=False, git_updates=False, mainsail_link=False, mainsail_embed=False, ui_only=False):
    config_dir = config_dir.expanduser().resolve()
    web_root = web_root.expanduser().resolve()
    if not web_root.is_dir() or not (web_root/'index.html').is_file():
        raise ValueError('--web-root muss auf den vorhandenen Mainsail-Webordner mit index.html zeigen.')
    if ui_only:
        if not mainsail_embed or git_updates or mainsail_link:
            raise ValueError('--ui-only zusammen mit --mainsail-embed verwenden; --git-updates und --mainsail-link weglassen.')
        return install_ui(config_dir, web_root, dry_run)
    macros_path, printer_path = config_dir/'06_macros.cfg', config_dir/'printer.cfg'
    if not macros_path.is_file() or not printer_path.is_file():
        raise ValueError('printer.cfg und 06_macros.cfg müssen im Konfigurationsordner vorhanden sein.')
    profile = json.loads((ROOT/'integration/profile.json').read_text())
    macros = macros_path.read_text()
    sections_now = sections(macros)
    if not re.search(r'^axes:\s*xyz\s*$',sections_now.get('homing_override',''),re.M):
        raise ValueError('homing_override muss wie im geprüften Profil axes: xyz verwenden.')
    if not re.search(r'^rename_existing:\s*G28\.1\s*$',sections_now.get('gcode_macro g28',''),re.M):
        raise ValueError('Der G28-Wrapper muss wie im geprüften Profil G28.1 verwenden.')
    for name in ['homing_override', 'gcode_macro g28']:
        expected = {profile['original'][name], profile['installed'][name]}
        if normalize(gcode(sections_now.get(name,''))) not in expected:
            raise ValueError(f'{name} stimmt nicht mit dem geprüften Profil überein. Keine Änderung vorgenommen.')
    steppers = sections((config_dir/'03_steppers.cfg').read_text())
    reset = steppers.get('output_pin _stepper_reset','')
    if not re.search(r'^pin:\s*y:PA1\s*$', reset, re.M):
        raise ValueError('Reset-Pin stimmt nicht mit dem geprüften Profil überein.')
    printer = printer_path.read_text()
    include = '[include print_rescue.cfg]'
    if include not in printer:
        save_idx = printer.find('#*# <---------------------- SAVE_CONFIG')
        if save_idx >= 0:
            printer = printer[:save_idx] + include + '\n\n' + printer[save_idx:]
        else:
            printer = printer.rstrip() + '\n\n' + include + '\n'
    patched = patch_homing(macros)
    target = web_root/'print-rescue'
    changes = [
        (macros_path, '06_macros.cfg', 'bytes', patched.encode()),
        (printer_path, 'printer.cfg', 'bytes', printer.encode()),
        (config_dir/'print_rescue.cfg', 'print_rescue.cfg', 'link' if git_updates else 'bytes',
         ROOT/'integration/print_rescue.cfg' if git_updates else (ROOT/'integration/print_rescue.cfg').read_bytes()),
        (target/'index.html', 'web/index.html', 'link' if git_updates else 'bytes',
         ROOT/'index.html' if git_updates else (ROOT/'index.html').read_bytes()),
    ]
    if git_updates:
        if ROOT.is_relative_to(config_dir) or ROOT.is_relative_to(web_root) or config_dir.is_relative_to(ROOT) or web_root.is_relative_to(ROOT):
            raise ValueError('Git-Checkout, Druckerkonfiguration und Mainsail-Webordner müssen getrennte Ordner sein.')
        update_text = git_update_settings(ROOT)
        moonraker_path = config_dir/'moonraker.conf'
        moonraker_text = moonraker_path.read_text()
        if re.search(r'^\s*\[update_manager\s+print_rescue\]\s*$', moonraker_text, re.M | re.I):
            raise ValueError('print_rescue ist schon direkt in moonraker.conf definiert. Den bestehenden Eintrag zuerst zusammenführen.')
        update_path = config_dir/'print_rescue_updates.conf'
        if update_path.exists() and not update_path.read_text().startswith('# Managed by PrintRescue installer.\n'):
            raise ValueError('Die vorhandene print_rescue_updates.conf wird nicht von diesem Installer verwaltet.')
        update_include = '[include print_rescue_updates.conf]'
        if not re.search(r'^\s*\[include\s+print_rescue_updates\.conf\]\s*(?:[#;].*)?$', moonraker_text, re.M):
            moonraker_text = moonraker_text.rstrip()+'\n\n'+update_include+'\n'
        changes += [
            (moonraker_path, 'moonraker.conf', 'bytes', moonraker_text.encode()),
            (update_path, 'print_rescue_updates.conf', 'bytes', update_text.encode()),
        ]
    if mainsail_link or git_updates or mainsail_embed:
        navi_path = config_dir/'.theme/navi.json'
        changes.append((navi_path, '.theme/navi.json', 'bytes', navigation_text(navi_path, mainsail_embed).encode()))
    if mainsail_embed: changes += embedding_changes(web_root, git_updates)
    print('Zielkonfiguration:', config_dir)
    print('Weboberfläche:', target/'index.html')
    print('Änderungen: Homing-Sperre, separates print_rescue.cfg, ein Include, Unterordner print-rescue.')
    if git_updates: print('Git-Modus: verknüpfte Makros/Oberfläche, Moonraker-Update-Eintrag mit managed_services: klipper.')
    if mainsail_link or git_updates or mainsail_embed: print('Mainsail-Menü: Druck retten (vorhandene Einträge bleiben erhalten).')
    if mainsail_embed: print('Mainsail-Einbettung: Loader in index.html ergänzen; eventuell vorhandene komprimierte index.html-Kopien sichern und entfernen.')
    finish_installation(changes, config_dir, web_root, dry_run)
    if dry_run: return
    print('Installiert. Kein Drucker-Neustart wurde ausgeführt.')
    print('Klipper RESTART nur bei freiem Druckbett und ohne laufenden Druck ausführen.')
    if git_updates: print('Zur ersten Registrierung anschließend Moonraker neu starten. Spätere Updates erfolgen über Mainsail.')
    print('Danach: http://<Druckeradresse>/print-rescue/')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config-dir', type=Path, required=True)
    parser.add_argument('--web-root', type=Path, required=True)
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--git-updates', action='store_true', help='Git-Checkout verknüpfen und Moonraker-Update-Manager samt Mainsail-Menü einrichten.')
    parser.add_argument('--mainsail-link', action='store_true', help='Auch im ZIP-Modus einen Mainsail-Menüeintrag ergänzen.')
    parser.add_argument('--mainsail-embed', action='store_true', help='PrintRescue im Mainsail-Inhaltsbereich öffnen (ergänzt die Mainsail-index.html).')
    parser.add_argument('--ui-only', action='store_true', help='Mit --mainsail-embed nur die bestehende Oberfläche aktualisieren; keine Klipper-/Moonraker-Konfiguration ändern.')
    args = parser.parse_args()
    try: install(args.config_dir,args.web_root,args.dry_run,args.git_updates,args.mainsail_link,args.mainsail_embed,args.ui_only)
    except (OSError,ValueError,KeyError,subprocess.SubprocessError) as error: parser.exit(1, str(error)+'\n')
