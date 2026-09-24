"""Render the actual Klipper Jinja templates and simulate their command order.
This is a software test, not a physical printer validation.
Run with Jinja2 available (it is already a Klipper dependency).
"""
import ast
import copy
import configparser
import importlib.util
import re
import shlex
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace as NS
import jinja2

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('install',ROOT/'install.py')
installer=importlib.util.module_from_spec(spec);spec.loader.exec_module(installer)
env=jinja2.Environment(block_start_string='{%',block_end_string='%}',variable_start_string='{',variable_end_string='}',undefined=jinja2.StrictUndefined)

class MacroError(Exception): pass
def fail(message): raise MacroError(message)

class Machine:
    def __init__(self, source):
        sections=installer.sections(installer.patch_homing(source))
        sections.update(installer.sections((ROOT/'integration/print_rescue.cfg').read_text()))
        self.templates={}
        for name,section in sections.items():
            if name in ['homing_override','gcode_macro g28'] or name.startswith('gcode_macro _pr_') or name.startswith('gcode_macro pr_'):
                parser=configparser.RawConfigParser(strict=False,inline_comment_prefixes=(';','#'))
                parser.read_string('[macro]\n'+'\n'.join(line.split('#',1)[0] for line in section.splitlines()))
                self.templates[name]=env.from_string(parser.get('macro','gcode'))
        self.p={
          'toolhead':NS(homed_axes='xyz',position=NS(x=100,y=1000,z=220),axis_maximum=NS(x=1045,y=1065,z=1340)),
          'gcode_move':NS(gcode_position=NS(x=100,y=1000,z=220)),
          'print_stats':NS(state='cancelled'),
          'stepper_enable':NS(steppers={k:True for k in ['stepper_z','stepper_z1','stepper_z2','stepper_z3']}),
          'output_pin _STEPPER_RESET':NS(value=1),
          'exclude_object':NS(excluded_objects=[]),
          'bed_mesh':NS(profile_name=''),
          'gcode_macro _PR_STATE':{},
          'gcode_macro preflight_state':{},
          'gcode_macro _SENSOR_VARIABLES':{},
          'gcode_macro _EQGL_VARS':{'home_x':522.5,'home_y':535.3,'home_z_hop':20,'home_z_hop_speed':25,'home_speed':200,'home_x_default':522.5,'home_y_default':535.3},
        }
        for line in sections['gcode_macro _pr_state'].splitlines():
            m=re.match(r'variable_(\w+):\s*(.*)',line)
            if m:self.p['gcode_macro _PR_STATE'][m[1]]=ast.literal_eval(m[2])
        self.trace=[];self.absolute=True;self.speed=100;self.saved={};self.inside_homing=False
    @property
    def r(self):return self.p['gcode_macro _PR_STATE']
    def run(self,command):
        tokens=shlex.split(command);name=tokens[0].upper();raw=' '.join(tokens[1:]);params={}
        for token in tokens[1:]:
            if '=' in token:k,v=token.split('=',1);params[k.upper()]=v
            else:params[token]=''
        key='gcode_macro '+name.lower()
        if name=='G28.1':
            if self.inside_homing:
                self.trace.append('NATIVE_HOME '+raw)
                if 'Z' in raw:self.p['toolhead'].position.z=0
                if 'X' in raw:self.p['toolhead'].position.x=0;self.p['gcode_move'].gcode_position.x=0
                if 'Y' in raw:self.p['toolhead'].position.y=1065;self.p['gcode_move'].gcode_position.y=1065
                return
            key='homing_override'
        if key in self.templates:
            result=self.templates[key].render(printer=self.p,params=params,rawparams=raw,action_raise_error=fail,action_respond_info=lambda _: '')
            old=self.inside_homing
            if key=='homing_override':self.inside_homing=True
            try:
                for line in result.splitlines():
                    line=line.strip()
                    if line and not line.startswith('#'):self.run(line)
            finally:self.inside_homing=old
            return
        self.trace.append(command)
        if name=='SET_GCODE_VARIABLE':self.p['gcode_macro '+params['MACRO']][params['VARIABLE']]=float(params['VALUE'])
        elif name=='SET_PIN':self.p['output_pin '+params['PIN']].value=float(params['VALUE'])
        elif name=='BED_MESH_PROFILE':self.p['bed_mesh'].profile_name=params['LOAD']
        elif name=='SAVE_GCODE_STATE':self.saved[params['NAME']]=(self.absolute,self.speed)
        elif name=='RESTORE_GCODE_STATE':self.absolute,self.speed=self.saved[params['NAME']]
        elif name=='G90':self.absolute=True
        elif name=='G91':self.absolute=False
        elif name=='M220':self.speed=float(tokens[1][1:])
        elif name in ['G0','G1']:
            for letter in ['X','Y','Z']:
                word=next((t for t in tokens[1:] if t.startswith(letter)),None)
                if word:
                    v=float(word[1:]);axis=letter.lower();pos=self.p['gcode_move'].gcode_position
                    new=v if self.absolute else getattr(pos,axis)+v
                    setattr(pos,axis,new);setattr(self.p['toolhead'].position,axis,new)

class MacroTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Integration fixture is the relevant reviewed homing sections only.
        cls.source=(ROOT/'tests/homing_fixture.cfg').read_text()
    def setUp(self):self.m=Machine(self.source)
    def prepare(self):self.m.run('PR_INSPECT Z=200.5 TOKEN=123')
    def confirm(self):self.prepare();self.m.run('PR_CONFIRM TOKEN=123')
    def test_templates_parse(self):self.assertGreater(len(self.m.templates),10)
    def test_inspection_only_moves_z_then_releases_xy(self):
        self.prepare();self.assertEqual(self.m.r['phase'],1);self.assertEqual(self.m.p['output_pin _STEPPER_RESET'].value,0)
        self.assertEqual(self.m.p['toolhead'].position.z,200.5)
        self.assertFalse(any('NATIVE_HOME' in s for s in self.m.trace));self.assertTrue(all(self.m.p['stepper_enable'].steppers.values()))
    def test_confirm_homes_only_xy_after_lifting(self):
        self.confirm();self.assertEqual(self.m.r['phase'],2);self.assertEqual(self.m.r['ready_z'],210.5)
        homes=[s for s in self.m.trace if s.startswith('NATIVE_HOME')]
        self.assertEqual(homes,['NATIVE_HOME X Y']);self.assertEqual(self.m.p['output_pin _STEPPER_RESET'].value,1)
    def test_missing_z_never_enters_original_cold_z_homing(self):
        self.prepare();self.m.p['toolhead'].homed_axes='xy';start=len(self.m.trace)
        with self.assertRaises(MacroError):self.m.run('PR_CONFIRM TOKEN=123')
        self.assertFalse(any(s.startswith(('G1','G0','NATIVE_HOME')) for s in self.m.trace[start:]))
        with self.assertRaises(MacroError):self.m.run('G28 X')
        self.assertFalse(any('NATIVE_HOME' in s for s in self.m.trace))
    def test_explicit_z_home_blocked_in_active_session(self):
        self.prepare()
        with self.assertRaises(MacroError):self.m.run('G28 Z')
        with self.assertRaises(MacroError):self.m.run('G28.1 Z')
    def test_disabled_z_motor_blocks_before_move(self):
        self.m.p['stepper_enable'].steppers['stepper_z2']=False
        with self.assertRaises(MacroError):self.prepare()
        self.assertFalse(any(s.startswith(('G0','G1')) for s in self.m.trace))
    def test_stale_file_token_rejected_before_heating(self):
        self.confirm();start=len(self.m.trace)
        with self.assertRaises(MacroError):self.m.run('PR_START TOKEN=999 LAST_Z=200.5 NEXT_Z=200.6 HOTEND=230 BED=77')
        self.assertEqual(len(self.m.trace),start)
    def test_start_and_cancel_paths(self):
        self.confirm();self.m.p['print_stats'].state='printing'
        self.m.run('PR_START TOKEN=123 LAST_Z=200.5 NEXT_Z=200.6 HOTEND=230 BED=77')
        self.assertEqual(self.m.r['phase'],3)
        self.assertIn('M109 S230.0',self.m.trace)
        with self.assertRaises(MacroError):self.m.run('PR_DISCARD')
        self.m.p['print_stats'].state='cancelled';self.m.run('PR_DISCARD');self.assertEqual(self.m.r['active'],0)
    def test_reject_z_changed_since_inspection(self):
        self.prepare();self.m.p['gcode_move'].gcode_position.z=199
        with self.assertRaises(MacroError):self.m.run('PR_CONFIRM TOKEN=123')
    def test_cancel_inspection_rehomes_xy_without_start(self):
        self.prepare();self.m.run('PR_CONFIRM TOKEN=123 CANCEL=1')
        self.assertEqual(self.m.r['active'],0);self.assertEqual(self.m.r['phase'],0)
        self.assertEqual(self.m.p['toolhead'].position.z,210.5)
        self.assertFalse(any(s.startswith('M109') for s in self.m.trace))

if __name__=='__main__':unittest.main()
