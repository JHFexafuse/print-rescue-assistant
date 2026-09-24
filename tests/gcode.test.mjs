import test from 'node:test';
import assert from 'node:assert/strict';
import {parseGcode,nearestLayer,selectionPlan,repairParts} from '../src/gcode.mjs';

const example=`M190 S77
M104 S245
PRINT_START
G21
G90
M82
G92 E0
M107
;LAYER_CHANGE
G1 Z0.6 F600
G1 X10 Y10 F4800
G1 X20 E1 F1200
G1 Y20 E2
G1 E-1 F3000
G92 E0
G1 Z1.6
G1 X10 Y10
;LAYER_CHANGE
G1 Z0.9 F600
M104 S230
M106 S128
M204 S850
G1 E3.4 F3000
G1 F2400
G1 X20 E4.4
G1 Y20 E5.4
;LAYER_CHANGE
G1 Z1 F600
G92 E0
G1 X10 Y10 F4800
G1 X20 E1 F1200
PRINT_END
`;
test('M82, G92 and retraction: Z-hop is not a printed layer',()=>{
 const m=parseGcode(example);
 assert.deepEqual(m.layers.map(x=>x.z),[.6,.9,1]);
 assert.equal(m.segmentCount,5);
 assert.equal(m.layers[1].before.e,3.4);
 assert.equal(m.layers[1].before.debt,0);
 assert.equal(m.layers[1].before.feed,2400);
 assert.equal(m.layers[1].before.hotend,230);
 assert.equal(m.layers[1].before.bed,77);
 assert.equal(m.layers[1].before.fan,128);
 assert.equal(m.layers[1].before.accel,850);
});
test('Selection is last completed layer; resume follows the actual .3/.1 spacing',()=>{
 const m=parseGcode(example);
 assert.equal(nearestLayer(m.layers,.92),1);
 assert.equal(selectionPlan(m,0,'part.gcode').resume.z,.9);
 assert.equal(selectionPlan(m,1,'part.gcode').resume.z,1);
 assert.equal(selectionPlan(m,2,'part.gcode').resume,null);
});
test('Repair reconstructs modal state at first extrusion and replaces end macro',()=>{
 const m=parseGcode(example);const [head,tail]=repairParts(example,m,0,{token:123,hotend:230,bed:77,fileName:'part.gcode'});
 assert.match(head,/LAST_Z=0.6 NEXT_Z=0.9 HOTEND=230 BED=77/);
 assert.match(head,/G1 X10 Y10 F4800\nG1 Z0.9 F300\nG92 E3.4\nG1 F2400\nM220 S20/);
 assert.match(head,/M82\nM221 S100\nM204 S850\nM106 S128/);
 assert.ok(tail.startsWith('G1 X20 E4.4'));
 assert.match(tail,/PR_FINISH/);assert.doesNotMatch(head+tail,/^PRINT_START|^G28|^FORCE_MOVE|^SET_KINEMATIC_POSITION/m);
});
test('Relative E and compact numeric words produce correct geometry',()=>{
 const m=parseGcode('G90\nM83\nG1X0Y0Z.2\n;LAYER_CHANGE\nG1X10E1\nG1Y10E1\n;LAYER_CHANGE\nG1Z.4\nG1X0E1');
 assert.equal(m.segmentCount,3);assert.deepEqual(m.layers.map(l=>l.z),[.2,.4]);assert.equal(m.layers[1].before.relativeE,true);
});
test('Closed arcs are tessellated and counted as deposition',()=>{
 const m=parseGcode('G90\nM83\nG1 X10 Y0 Z.2\n;LAYER_CHANGE\nG2 X10 Y0 I-10 J0 E10');
 assert.equal(m.layers.length,1);assert.ok(m.segmentCount>30);assert.ok(Math.abs(m.bounds.minX+10)<.02);assert.ok(m.bounds.maxY>9.9);
});
test('Sequential objects, unknown commands and lost coordinate assumptions block repair',()=>{
 const descending=parseGcode(example.replace('G1 Z1 F600','G1 Z0.4 F600'));
 assert.ok(descending.issues.some(x=>x.key==='descending_layers'));
 const unsafe=parseGcode(example.replace('G1 Y20 E5.4','G1 Y20 E5.4\nG28 Z'));
 assert.throws(()=>repairParts(example,unsafe,0,{token:1,hotend:230,bed:77}),/nicht unterstützte/);
 const restart=parseGcode(example.replace('G1 Y20 E5.4','G1 Y20 E5.4\nPRINT_START'));
 assert.throws(()=>repairParts(example,restart,0,{token:1,hotend:230,bed:77}),/nicht unterstützte/);
});
test('Empty files, binary files, invalid temperatures and last-layer resume rejected',()=>{
 assert.throws(()=>parseGcode('G90\nG1 X1'),/Keine gedruckten/);
 assert.throws(()=>parseGcode('binary\0file'),/Text-G-Code/);
 const m=parseGcode(example);
 assert.throws(()=>repairParts(example,m,2,{token:1,hotend:230,bed:77}),/kein Weiterdruck/);
 assert.throws(()=>repairParts(example,m,0,{token:1,hotend:NaN,bed:77}),/Temperaturen/);
});
test('Selection retains original line and offset including CRLF',()=>{
 const input=example.replaceAll('\n','\r\n'),m=parseGcode(input);
 assert.equal(input.slice(m.layers[1].offset).split('\r\n')[0],'G1 X20 E4.4');
 assert.equal(input.slice(0,m.layers[1].offset).split('\n').length,m.layers[1].line);
});
