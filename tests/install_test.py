"""Exercise installations and ZIP-to-Git migration in disposable directories.
No printer or network access. Run with Python 3.9+ and Git installed.
"""
import contextlib
import importlib.util
import io
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


class InstallTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.repo = self.base/'print-rescue'
        self.config = self.base/'printer_data/config'
        self.web = self.base/'mainsail'
        for path in (self.repo/'integration', self.config, self.web): path.mkdir(parents=True)
        for name in ('install.py', '.gitignore', 'index.html', 'integration/profile.json', 'integration/print_rescue.cfg', 'integration/mainsail-embed.js'):
            shutil.copy2(ROOT/name, self.repo/name)
        self.git('init', '-b', 'main')
        self.git('config', 'user.name', 'PrintRescue Test')
        self.git('config', 'user.email', 'test@example.invalid')
        self.git('remote', 'add', 'origin', 'https://github.com/example/print-rescue.git')
        self.git('add', '.')
        self.git('commit', '-m', 'Initial fixture')
        self.git('tag', 'v0.1.1')
        spec = importlib.util.spec_from_file_location('fixture_installer', self.repo/'install.py')
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        (self.config/'06_macros.cfg').write_bytes((ROOT/'tests/homing_fixture.cfg').read_bytes())
        (self.config/'03_steppers.cfg').write_text('[output_pin _STEPPER_RESET]\npin: y:PA1\n')
        (self.config/'printer.cfg').write_text('[include 06_macros.cfg]\n\n#*# <---------------------- SAVE_CONFIG ---------------------->\n#*# test\n')
        (self.config/'moonraker.conf').write_text('[server]\nport: 7125\n\n[update_manager mainsail-config]\ntype: git_repo\n')
        self.mainsail_html = '<!doctype html><html><body><div id="app"></div><script src="/assets/mainsail.js"></script></body></html>'
        (self.web/'index.html').write_text(self.mainsail_html)

    def git(self, *args):
        return subprocess.run(['git', '-C', str(self.repo), *args], check=True, capture_output=True, text=True, timeout=15).stdout.strip()

    def install(self, **kwargs):
        with contextlib.redirect_stdout(io.StringIO()):
            self.module.install(self.config, self.web, **kwargs)

    def snapshot(self):
        return {str(path.relative_to(self.base)): ('link', os.readlink(path)) if path.is_symlink() else ('file', path.read_bytes())
                for root in (self.config, self.web) for path in root.rglob('*') if path.is_file() or path.is_symlink()}

    def test_dry_run_has_no_writes(self):
        before = self.snapshot()
        self.install(git_updates=True, dry_run=True)
        self.assertEqual(self.snapshot(), before)

    def test_zip_migration_preserves_existing_files_and_links(self):
        self.install()
        previous_macro = (self.config/'print_rescue.cfg').read_bytes()
        (self.config/'.theme').mkdir()
        other = {'title': 'Werkstatt', 'href': 'https://example.invalid/', 'position': 5}
        (self.config/'.theme/navi.json').write_text(json.dumps([other]))
        self.install(git_updates=True)
        self.assertEqual((self.config/'print_rescue.cfg').resolve(), self.repo/'integration/print_rescue.cfg')
        self.assertEqual((self.web/'print-rescue/index.html').resolve(), self.repo/'index.html')
        self.assertEqual((self.web/'index.html').read_text(), self.mainsail_html)
        navi = json.loads((self.config/'.theme/navi.json').read_text())
        self.assertEqual(navi[0], other)
        self.assertEqual(navi[1]['href'], '/print-rescue/')
        updater = (self.config/'print_rescue_updates.conf').read_text()
        for value in ('managed_services: klipper', 'primary_branch: main', 'channel: dev', str(self.repo)):
            self.assertIn(value, updater)
        self.assertIn('[update_manager mainsail-config]', (self.config/'moonraker.conf').read_text())
        printer = (self.config/'printer.cfg').read_text()
        self.assertLess(printer.index('[include print_rescue.cfg]'), printer.index('#*# <'))
        backups = sorted(self.config.glob('print-rescue-backup-*'))
        self.assertEqual((backups[-1]/'print_rescue.cfg').read_bytes(), previous_macro)
        self.assertEqual(self.git('status', '--porcelain'), '')
        # A new checkout's bytes are immediately used, rather than stale copies.
        (self.repo/'index.html').write_text('<h1>Version from next commit</h1>')
        (self.repo/'integration/print_rescue.cfg').write_bytes(previous_macro+b'\n# next commit\n')
        self.git('add', '.')
        self.git('commit', '-m', 'Simulated update')
        self.assertIn('next commit', (self.web/'print-rescue/index.html').read_text())
        self.assertIn('# next commit', (self.config/'print_rescue.cfg').read_text())

    def test_repeat_install_does_not_duplicate_entries(self):
        self.install(git_updates=True)
        self.install(git_updates=True)
        self.assertEqual((self.config/'moonraker.conf').read_text().count('[include print_rescue_updates.conf]'), 1)
        self.assertEqual((self.config/'printer.cfg').read_text().count('[include print_rescue.cfg]'), 1)
        self.assertEqual(len(json.loads((self.config/'.theme/navi.json').read_text())), 1)
        self.assertEqual((self.config/'06_macros.cfg').read_text().count('# PRINT_RESCUE_Z_GUARD_V1'), 1)
        self.assertEqual(self.git('status', '--porcelain'), '')

    def test_master_branch_is_respected(self):
        self.git('branch', '-m', 'master')
        self.install(git_updates=True)
        self.assertIn('primary_branch: master', (self.config/'print_rescue_updates.conf').read_text())

    def test_invalid_navigation_stops_before_writing_configs(self):
        (self.config/'.theme').mkdir()
        (self.config/'.theme/navi.json').write_text('{invalid json')
        before = self.snapshot()
        with self.assertRaises(ValueError): self.install(git_updates=True)
        self.assertEqual(self.snapshot(), before)

    def test_dirty_repository_or_missing_tag_does_not_modify_installation(self):
        before = self.snapshot()
        (self.repo/'index.html').write_text('local change')
        with self.assertRaisesRegex(ValueError, 'lokale Änderungen'): self.install(git_updates=True)
        self.assertEqual(self.snapshot(), before)
        self.git('restore', 'index.html')
        self.git('tag', '-d', 'v0.1.1')
        with self.assertRaisesRegex(ValueError, 'Versionstag'): self.install(git_updates=True)
        self.assertEqual(self.snapshot(), before)

    def test_existing_update_section_not_duplicated(self):
        path = self.config/'moonraker.conf'
        path.write_text(path.read_text()+'\n[update_manager print_rescue]\ntype: git_repo\n')
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, 'schon direkt'): self.install(git_updates=True)
        self.assertEqual(self.snapshot(), before)

    def test_partial_write_failure_restores_original_files(self):
        self.install()
        before = self.snapshot()
        original_write = self.module.write_atomic
        writes = 0
        def fail_once(*args, **kwargs):
            nonlocal writes
            writes += 1
            if writes == 5: raise OSError('simulated disk error')
            return original_write(*args, **kwargs)
        with patch.object(self.module, 'write_atomic', side_effect=fail_once):
            with self.assertRaisesRegex(OSError, 'simulated'): self.install(git_updates=True)
        # Newly created backup is expected; all actual installation files match.
        after = self.snapshot()
        relevant = lambda snapshot: {key: value for key, value in snapshot.items() if 'print-rescue-backup-' not in key}
        self.assertEqual(relevant(after), relevant(before))
        self.assertFalse((self.config/'print_rescue.cfg').is_symlink())

    def test_credentials_in_remote_are_rejected_without_printing_them(self):
        self.git('remote', 'set-url', 'origin', 'https://private-test-token@github.com/example/print-rescue.git')
        before = self.snapshot()
        with self.assertRaises(ValueError) as error: self.install(git_updates=True)
        self.assertNotIn('private-test-token', str(error.exception))
        self.assertEqual(self.snapshot(), before)

    def test_ui_embedding_keeps_printer_configs_and_navigation_customizations(self):
        self.install(git_updates=True)
        names = ('06_macros.cfg', '03_steppers.cfg', 'printer.cfg', 'print_rescue.cfg', 'moonraker.conf', 'print_rescue_updates.conf')
        before = {name: (self.config/name).read_bytes() for name in names}
        navi_path = self.config/'.theme/navi.json'
        other = {'title': 'Werkstatt', 'href': 'https://example.invalid/', 'target': '_blank'}
        custom = {'title': 'Meine Rettung', 'href': '/print-rescue/', 'target': '_blank', 'icon': 'custom-icon', 'position': 42}
        navi_path.write_text(json.dumps([other, custom]))
        (self.web/'index.html.gz').write_bytes(b'old compressed HTML')
        (self.web/'index.html.br').write_bytes(b'old brotli HTML')
        snapshot = self.snapshot()
        self.install(ui_only=True, mainsail_embed=True, dry_run=True)
        self.assertEqual(self.snapshot(), snapshot)
        self.install(ui_only=True, mainsail_embed=True)
        self.assertEqual({name: (self.config/name).read_bytes() for name in names}, before)
        self.assertTrue((self.config/'print_rescue.cfg').is_symlink())
        self.assertEqual((self.web/'print-rescue/mainsail-embed.js').resolve(), self.repo/'integration/mainsail-embed.js')
        html = (self.web/'index.html').read_text()
        self.assertIn('src="/assets/mainsail.js"', html)
        self.assertEqual(html.count('id="print-rescue-loader"'), 1)
        self.assertLess(html.index('id="print-rescue-loader"'), html.index('</body>'))
        self.assertEqual(json.loads(navi_path.read_text()), [other, {**custom, 'target': '_self'}])
        self.assertFalse((self.web/'index.html.gz').exists())
        self.assertFalse((self.web/'index.html.br').exists())
        backup = sorted(self.config.glob('print-rescue-backup-*'))[-1]
        self.assertEqual((backup/'web/mainsail-index.html').read_text(), self.mainsail_html)
        self.assertEqual((backup/'web/mainsail-index.html.gz').read_bytes(), b'old compressed HTML')
        self.assertEqual((backup/'web/mainsail-index.html.br').read_bytes(), b'old brotli HTML')
        self.assertEqual(self.git('status', '--porcelain'), '')
        self.install(ui_only=True, mainsail_embed=True)
        self.assertEqual((self.web/'index.html').read_text(), html)
        # Simulate Mainsail replacing its own HTML and clearing the loader.
        (self.web/'index.html').write_text(self.mainsail_html)
        shutil.rmtree(self.web/'print-rescue')
        self.install(ui_only=True, mainsail_embed=True)
        self.assertEqual((self.web/'index.html').read_text(), html)
        self.assertTrue((self.web/'print-rescue/mainsail-embed.js').is_file())
        self.assertEqual((self.web/'print-rescue/index.html').resolve(), self.repo/'index.html')

    def test_full_embedding_and_ui_only_zip_mode(self):
        self.install(mainsail_embed=True)
        self.assertFalse((self.web/'print-rescue/mainsail-embed.js').is_symlink())
        self.install(ui_only=True, mainsail_embed=True)
        self.assertEqual((self.web/'print-rescue/mainsail-embed.js').read_bytes(), (self.repo/'integration/mainsail-embed.js').read_bytes())
        self.assertEqual((self.web/'index.html').read_text().count('id="print-rescue-loader"'), 1)

    def test_unsupported_html_or_partial_marker_aborts_before_changes(self):
        self.install()
        for html in ('<body>Not Mainsail</body>', '<div id="app"></div>', self.mainsail_html+'<!-- PRINT_RESCUE_EMBED_BEGIN -->'):
            (self.web/'index.html').write_text(html)
            before = self.snapshot()
            with self.assertRaises(ValueError): self.install(ui_only=True, mainsail_embed=True)
            self.assertEqual(self.snapshot(), before)

    def test_ui_only_requires_existing_installation_and_cannot_change_updater(self):
        before = self.snapshot()
        for kwargs in ({'ui_only': True}, {'ui_only': True, 'mainsail_embed': True},
                       {'ui_only': True, 'mainsail_embed': True, 'git_updates': True}):
            with self.assertRaises(ValueError): self.install(**kwargs)
            self.assertEqual(self.snapshot(), before)

    def test_failed_embedding_restores_mainsail_and_compressed_variants(self):
        self.install(git_updates=True)
        (self.web/'index.html.gz').write_bytes(b'gzip original')
        (self.web/'index.html.br').write_bytes(b'brotli original')
        before = self.snapshot()
        original_write = self.module.write_atomic
        failed = False
        def fail_once(path, kind, *args, **kwargs):
            nonlocal failed
            if path.name == 'index.html.br' and kind == 'delete' and not failed:
                failed = True
                raise OSError('simulated disk error')
            return original_write(path, kind, *args, **kwargs)
        with patch.object(self.module, 'write_atomic', side_effect=fail_once):
            with self.assertRaisesRegex(OSError, 'simulated'): self.install(ui_only=True, mainsail_embed=True)
        relevant = lambda snapshot: {key: value for key, value in snapshot.items() if 'print-rescue-backup-' not in key}
        self.assertEqual(relevant(self.snapshot()), relevant(before))

    def test_service_worker_refreshes_only_the_mainsail_html_revision(self):
        self.install()
        path = self.web/'sw.js'
        variants = ('{url:"index.html",revision:"old-123"}', '{"revision":"old-123","url":"/index.html"}',
                    "{'url':'index.html','revision':'old-123'}")
        for entry in variants:
            original = 'precacheAndRoute(['+entry+', {url:"assets/app.js",revision:"retain"}]);'
            path.write_text(original)
            self.install(ui_only=True, mainsail_embed=True)
            updated = path.read_text()
            self.assertNotIn('old-123', updated)
            self.assertIn('{url:"assets/app.js",revision:"retain"}', updated)
            self.install(ui_only=True, mainsail_embed=True)
            self.assertEqual(path.read_text(), updated)
        path.write_text('An unknown service worker')
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, 'Cache-Format'): self.install(ui_only=True, mainsail_embed=True)
        self.assertEqual(self.snapshot(), before)


if __name__ == '__main__': unittest.main()
