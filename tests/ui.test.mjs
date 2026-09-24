// Unit harness for the actual HTML script with a minimal DOM and simulated
// Moonraker. This is deliberately not labelled as a rendered browser test.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const parser=html.match(/id="parser-source">([\s\S]*?)<\/script>/)[1];
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const fixture=`M190 S77
M104 S245
PRINT_START
G90
M82
G92 E0
;LAYER_CHANGE
G1 X10 Y10 Z0.6 F600
G1 X20 E1 F1200
;LAYER_CHANGE
M104 S230
G1 X10 Z0.9 F4800
G1 F2400
G1 X20 E2
;LAYER_CHANGE
G1 X10 Z1.0
G1 X20 E3
PRINT_END
`;
class Element{
 constructor(id){this.id=id;this.textContent='';this.value='';this.disabled=false;this.hidden=false;this.checked=false;this.listeners={};this.children=[];this.tagName='DIV';this.dataset={};this.style={};this.classList={toggle(){},add(){},remove(){}};}
 addEventListener(event,fn){(this.listeners[event]??=[]).push(fn);}
 async emit(event,props={}){if(this.disabled&&event==='click')return;for(const fn of this.listeners[event]||[])await fn({target:this,preventDefault(){},...props});}
 getBoundingClientRect(){return{width:950,height:570};}
 getContext(){return new Proxy({}, {get:()=>()=>{},set:()=>true});}
 setAttribute(){}setPointerCapture(){}append(...el){this.children.push(...el);}replaceChildren(){this.children=[];}
 showModal(){this.hidden=false;}close(){this.hidden=true;}click(){return this.emit('click');}
}
async function waitUntil(fn){for(let i=0;i<250;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw new Error('UI condition timed out');}
async function createApp(){
 const elements=new Map();
 for(const tag of html.matchAll(/<\w+\b[^>]*\bid="([^"]+)"[^>]*>/g)){
  const el=new Element(tag[1]);el.value=tag[0].match(/\bvalue="([^"]*)"/)?.[1]??'';el.tagName=tag[0].match(/^<(\w+)/)[1].toUpperCase();el.disabled=/\bdisabled\b/.test(tag[0]);el.hidden=/\bhidden\b/.test(tag[0]);elements.set(tag[1],el);
 }
 elements.get('parser-source').textContent=parser;
 const buttons=['iso','top','front'].map(v=>{const el=new Element('view-'+v);el.dataset.view=v;return el;});
 const doc={baseURI:'file:///index.html',getElementById:id=>elements.get(id),querySelectorAll:()=>buttons,addEventListener(){},createElement:()=>new Element('generated')};
 const blobs=new Map();let bid=0;
 class TestURL extends URL{static createObjectURL(blob){const id='blob:test-'+(++bid);blobs.set(id,blob);return id;}static revokeObjectURL(id){blobs.delete(id);}}
 class Worker{
  constructor(url){this.code=blobs.get(url).text();this.dead=false;}
  async postMessage(data){
   if(!this.context){this.context=vm.createContext({Blob,Float32Array,console,self:{postMessage:(value,transfer)=>{const payload=structuredClone(value,{transfer:transfer||[]});setImmediate(()=>{if(!this.dead)this.onmessage?.({data:payload});});}}});vm.runInContext(await this.code,this.context);}
   this.context.self.onmessage({data});
  }
  terminate(){this.dead=true;}
 }
 const requests=[],state={version:1,phase:0,active:0,token:0};
 const status={toolhead:{homed_axes:'xyz',axis_minimum:[0,0,-30],axis_maximum:[1045,1065,1340]},print_stats:{state:'cancelled'},stepper_enable:{steppers:{stepper_z:true,stepper_z1:true,stepper_z2:true,stepper_z3:true}},exclude_object:{excluded_objects:[]},'gcode_macro _PR_STATE':state};
 const profile=JSON.parse(fs.readFileSync(new URL('../integration/profile.json',import.meta.url)));
 const config=Object.fromEntries(Object.entries(profile.installed).map(([k,v])=>[k,{gcode:v}]));config['output_pin _STEPPER_RESET']={pin:'y:PA1'};
 config.homing_override.axes='xyz';config['gcode_macro g28'].rename_existing='G28.1';
 let uploaded='';
 const fetch=async(url,opts={})=>{
  requests.push({url,opts});const path=new URL(url).pathname;let result;
  if(path==='/printer/info')result={state:'ready'};
  else if(path==='/printer/objects/list')result={objects:['gcode_macro _PR_STATE']};
  else if(path==='/printer/objects/query')result=String(url).endsWith('?configfile')?{status:{configfile:{config}}}:{status:structuredClone(status)};
  else if(path==='/server/files/list')result=[];
  else if(path==='/printer/gcode/script'){
   const command=JSON.parse(opts.body).script;
   if(command.startsWith('PR_INSPECT')){state.phase=1;state.active=1;state.token=Number(command.match(/TOKEN=(\d+)/)[1]);}
   else if(command.startsWith('PR_CONFIRM'))state.phase=2;
   result='ok';
  }else if(path==='/server/files/upload'){
   const file=opts.body.get('file');uploaded=await file.text();result={item:{root:'gcodes',path:file.name}};
  }else if(path==='/printer/print/start'){state.phase=3;status.print_stats.state='printing';result='ok';}
  else throw new Error('Unexpected API '+url);
  return{ok:true,json:async()=>({result})};
 };
 const context=vm.createContext({document:doc,window:{devicePixelRatio:1},location:{protocol:'file:',origin:'null'},Worker,Blob,URL:TestURL,FormData,File,crypto:webcrypto,Intl,console,fetch,ResizeObserver:class{observe(){}},requestAnimationFrame:fn=>setImmediate(fn),setTimeout,clearTimeout,setInterval:()=>1,clearInterval(){}});
 vm.runInContext(script,context);
 await waitUntil(()=>elements.get('active-layer').textContent!=='');
 return{elements,context,requests,status,config,state,uploaded:()=>uploaded,run:code=>vm.runInContext(code,context)};
}

test('Page boots, demo has 30 ghost layers, decimal comma search and stepping work',async()=>{
 const a=await createApp();assert.equal(a.elements.get('ghost-count').value,'30');assert.equal(a.elements.get('active-layer').textContent,'90');
 a.elements.get('height').value='30,1';await a.elements.get('seek').emit('click');
 assert.equal(a.elements.get('active-layer').textContent,'60');
 await a.elements.get('next').emit('click');assert.equal(a.elements.get('active-layer').textContent,'61');
 assert.equal(a.elements.get('inspect').disabled,true);assert.equal(a.requests.length,0);
 assert.equal(a.elements.get('feature-legend').children.length,2);
 assert.equal(a.elements.get('feature-legend').children[0].children[1].textContent,'Außenkontur');
 // srcdoc has about:srcdoc as its location but inherits the Mainsail base URI.
 a.run("document.baseURI='http://printer.test/console'; location.protocol='about:'; location.origin='null';");
 await a.elements.get('connect-button').emit('click');
 assert.equal(a.elements.get('api-url').value,'http://printer.test');
 assert.equal(a.requests.length,0);
});
test('Real file → verify profile → inspect → repair upload → XY home → print at 20%',async()=>{
 const a=await createApp();a.context.fixture=fixture;await a.run("loadText(fixture,'part.gcode',false)");await waitUntil(()=>a.elements.get('file-stats').textContent.startsWith('3 Schichten'));
 assert.equal(a.elements.get('hotend').value,230);assert.equal(a.elements.get('bed').value,77);
 a.elements.get('api-url').value='http://test-printer';await a.elements.get('connect-do').emit('click');
 assert.equal(a.run('profileValid'),true);
 a.elements.get('free-position').checked=true;await a.elements.get('free-position').emit('change');
 assert.equal(a.elements.get('inspect').disabled,false);await a.elements.get('inspect').emit('click');
 assert.equal(a.state.phase,1);assert.equal(a.elements.get('slider').disabled,true);
 a.elements.get('material-ready').checked=true;await a.elements.get('material-ready').emit('change');
 assert.equal(a.elements.get('resume').disabled,false);await a.elements.get('resume').emit('click');
 assert.equal(a.state.phase,3);
 assert.match(a.uploaded(),/M220 S20/);assert.match(a.uploaded(),/G92 E1/);
 const path=a.requests.map(r=>new URL(r.url).pathname);
 assert.ok(path.indexOf('/server/files/upload')<path.lastIndexOf('/printer/gcode/script'));
 assert.ok(path.lastIndexOf('/printer/gcode/script')<path.indexOf('/printer/print/start'));
 const commands=a.requests.filter(r=>r.opts.body&&typeof r.opts.body==='string'&&new URL(r.url).pathname==='/printer/gcode/script').map(r=>JSON.parse(r.opts.body).script);
 assert.equal(commands.length,2);assert.ok(commands[0].startsWith('PR_INSPECT'));assert.ok(commands[1].startsWith('PR_CONFIRM'));
});
test('Missing Z reference disables inspection; changed homing template prevents motion',async()=>{
 const a=await createApp();a.context.fixture=fixture;await a.run("loadText(fixture,'part.gcode',false)");await waitUntil(()=>a.elements.get('file-stats').textContent.startsWith('3 Schichten'));
 a.elements.get('api-url').value='http://test-printer';await a.elements.get('connect-do').emit('click');
 a.status.toolhead.homed_axes='xy';await a.run('poll()');a.elements.get('free-position').checked=true;await a.elements.get('free-position').emit('change');
 assert.equal(a.elements.get('inspect').disabled,true);
 a.status.toolhead.homed_axes='xyz';a.config.homing_override.gcode+='G28 Z';await a.elements.get('connect-do').emit('click');
 assert.equal(a.run('profileValid'),false);assert.equal(a.elements.get('inspect').disabled,true);
 assert.equal(a.requests.filter(r=>new URL(r.url).pathname==='/printer/gcode/script').length,0);
});
