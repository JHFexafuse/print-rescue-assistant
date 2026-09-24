const $=id=>document.getElementById(id);
const viewer=new LayerViewer($('scene'));
let model=null,index=0,fileName='',isDemo=true,loading=false,task=0,worker=null;
let repairPending=null;
const number=v=>new Intl.NumberFormat('de-DE',{maximumFractionDigits:3}).format(v);
const parserSource=$('parser-source').textContent;
const workerURL=URL.createObjectURL(new Blob([parserSource+`\nlet source='',parsed=null;self.onmessage=e=>{try{if(e.data.type==='repair'){const parts=repairParts(source,parsed,e.data.index,e.data.options);self.postMessage({repair:new Blob(parts,{type:'text/plain'}),task:e.data.task});return;}source=e.data.text;parsed=parseGcode(source,p=>self.postMessage({progress:p,task:e.data.task}));self.postMessage({result:parsed,task:e.data.task},parsed.layers.map(l=>l.segments.buffer));}catch(err){self.postMessage({error:err.message,repairError:e.data.type==='repair',task:e.data.task});}};`],{type:'text/javascript'}));

function showMessage(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error);$('message').hidden=!text;}
function gcodeIssueText(issue){
  // Summary findings have no offending line, even though parsing ended at one.
  const summary=['implicit_e','no_markers','macros'].includes(issue.key);
  return (!summary&&issue.line>0?`Zeile ${number(issue.line)}: `:'')+issue.message;
}
function renderFileIssues(){
  const blocking=model.issues.filter(issue=>issue.blocksPlan);
  $('issues').replaceChildren();
  if(!model.issues.length){const li=document.createElement('li');li.textContent='Keine Besonderheiten bei der Geometrie erkannt.';$('issues').append(li);}
  for(const issue of [...blocking,...model.issues.filter(issue=>!issue.blocksPlan)]){
    const li=document.createElement('li');li.textContent=(issue.blocksPlan?'Sperre · ':'Hinweis · ')+gcodeIssueText(issue);
    li.classList.toggle('blocking',!!issue.blocksPlan);$('issues').append(li);
  }
  const count=model.issues.length,blocked=blocking.length;
  $('notes-title').textContent='Hinweise zur Datei'+(count?` (${count}${blocked?' · '+blocked+(blocked===1?' Sperre':' Sperren'):''})`:'');
  $('file-notes').open=blocked>0;
}
function renderLegend(){
  const legend=$('feature-legend');legend.replaceChildren();
  FEATURE_NAMES.forEach((name,id)=>{
    if(!model.featureCounts[id])return;
    const entry=document.createElement('span'),swatch=document.createElement('i'),label=document.createElement('span');
    swatch.style.backgroundColor=FEATURE_COLORS[id];swatch.setAttribute('aria-hidden','true');
    label.textContent=name;entry.title=`${name} · ${number(model.featureCounts[id])} Segmente`;
    entry.append(swatch,label);legend.append(entry);
  });
}
function update(){
  if(!model)return;
  const current=model.layers[index],next=model.layers[index+1];
  $('height').value=number(current.z);$('active-layer').textContent=number(index+1);
  $('layer-total').textContent='/ '+number(model.layers.length);$('z-label').textContent='Z '+number(current.z)+' mm';
  $('slider').max=model.layers.length-1;$('slider').value=index;
  $('slider').setAttribute('aria-valuetext',`Schicht ${index+1}, Z ${number(current.z)} Millimeter`);
  $('prev').disabled=index===0||loading;$('next').disabled=index===model.layers.length-1||loading;
  $('complete-summary').textContent=`Schicht ${number(index+1)} · ${number(current.z)} mm`;
  $('resume-summary').textContent=next?`Schicht ${number(index+2)} · ${number(next.z)} mm`:'Keine weitere Schicht';
  $('line-number').textContent=number(current.line);
  const count=Math.min(index,Number($('ghost-count').value));
  $('ghost-visible').textContent=count+' Schichten darunter';
  $('window-range').textContent=`Sichtfenster Z ${number(model.layers[Math.max(0,index-count)].z)}–${number(current.z)} mm`;
  $('export').disabled=loading;
  $('preview-state').textContent=isDemo?'DEMO · SYNTHETISCHE GEOMETRIE':'LOKALE DATEI · NUR VORSCHAU';
  const blocking=model.issues.some(x=>x.blocksPlan);
  $('compatibility').textContent=blocking?'Besonderheiten im G-Code – Hinweise beachten':'Schichten erkannt · Wiederanlauf noch nicht validiert';
  $('compatibility').classList.toggle('warn',blocking);
  viewer.setSelection(index,Number($('ghost-count').value),Number($('ghost-opacity').value)/100);
  if(typeof refreshControls==='function')refreshControls();
}

function fillTemperatures(){const values=model?.layers[index+1]?.before;$('hotend').value=values?.hotend??'';$('bed').value=values?.bed??'';}
function select(i){if(!model||loading||machineBusy())return;index=Math.max(0,Math.min(model.layers.length-1,Math.round(i)));$('free-position').checked=false;$('material-ready').checked=false;fillTemperatures();update();}
function seek(){
  if(!model)return;
  const raw=$('height').value.trim().replace(',','.');
  const h=raw===''?NaN:Number(raw);
  if(!Number.isFinite(h)||h<0){showMessage('Bitte eine gültige Höhe in Millimetern eingeben.',true);return;}
  const target=nearestLayer(model.layers,h);select(target);
  showMessage(`Messwert ${number(h)} mm → nächste vorhandene Schicht bei ${number(model.layers[target].z)} mm.`);
}

async function loadText(text,name,demo=false){
  if(typeof machineBusy==='function'&&machineBusy()){showMessage('Zuerst die aktive Prüfung beenden.',true);return;}
  if(worker)worker.terminate();worker=new Worker(workerURL);const id=++task;
  loading=true;$('loading').hidden=false;$('progress').textContent='G-Code wird gelesen …';
  $('file-name').textContent=name;$('export').disabled=true;$('prev').disabled=true;$('next').disabled=true;$('slider').disabled=true;
  showMessage('');
  worker.onmessage=e=>{
    if(e.data.task!==task)return;
    if('repair'in e.data||e.data.repairError){
      if(repairPending){const pending=repairPending;repairPending=null;e.data.repairError?pending.reject(new Error(e.data.error)):pending.resolve(e.data.repair);}return;
    }
    if('progress'in e.data){$('progress').textContent=`Schichten analysieren · ${e.data.progress} %`;return;}
    loading=false;$('loading').hidden=true;$('slider').disabled=false;
    if(e.data.error){showMessage(e.data.error,true);$('file-name').textContent=model?fileName:'Keine Datei';if(model)update();return;}
    model=e.data.result;fileName=name;isDemo=demo;index=demo?89:0;viewer.setModel(model);renderLegend();$('free-position').checked=false;$('material-ready').checked=false;
    $('file-stats').textContent=`${number(model.layers.length)} Schichten · ${number(model.bounds.maxZ)} mm · ${number(model.segmentCount)} Segmente`;
    renderFileIssues();
    fillTemperatures();update();
  };
  worker.onerror=()=>{loading=false;$('loading').hidden=true;showMessage('Die Vorschau konnte nicht geladen werden. Bitte die Datei erneut öffnen.',true);};
  worker.postMessage({text,task:id});
}

function makeRepair(options){
  return new Promise((resolve,reject)=>{repairPending={resolve,reject};worker.postMessage({type:'repair',index,options,task});});
}

async function openFile(file){
  if(!file)return;
  if(file.size>256*1024*1024){showMessage('Diese Vorschau unterstützt Dateien bis 256 MiB.',true);return;}
  if(/\.(?:zip|bgcode|3mf|stl)$/i.test(file.name)){showMessage('Bitte den unkomprimierten Druck-G-Code auswählen, kein ZIP, STL, 3MF oder BGCODE.',true);return;}
  try{await loadText(await file.text(),file.name,false);}catch(err){showMessage('Datei konnte nicht gelesen werden: '+err.message,true);}
}

$('file-input').addEventListener('change',e=>{openFile(e.target.files[0]);e.target.value='';});
$('demo').addEventListener('click',()=>loadText(demoGcode(),'Demo · geriffeltes Gefäß',true));
$('seek').addEventListener('click',seek);
$('height').addEventListener('keydown',e=>{if(e.key==='Enter')seek();});
$('prev').addEventListener('click',()=>select(index-1));$('next').addEventListener('click',()=>select(index+1));
$('slider').addEventListener('input',e=>select(Number(e.target.value)));
$('ghost-count').addEventListener('change',e=>{e.target.value=Math.max(0,Math.min(100,Number(e.target.value)||0));update();});
$('ghost-opacity').addEventListener('input',update);
const viewButtons=document.querySelectorAll('[data-view]');
viewButtons.forEach(button=>button.addEventListener('click',()=>{
  viewer.view(button.dataset.view);
  viewButtons.forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
}));
document.addEventListener('keydown',e=>{if(/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;if(e.key==='ArrowUp'||e.key==='ArrowRight'){e.preventDefault();select(index+1);}if(e.key==='ArrowDown'||e.key==='ArrowLeft'){e.preventDefault();select(index-1);}});
document.addEventListener('dragover',e=>{e.preventDefault();$('drop-overlay').hidden=false;});
$('drop-overlay').addEventListener('dragleave',()=>{$('drop-overlay').hidden=true;});
document.addEventListener('drop',e=>{e.preventDefault();$('drop-overlay').hidden=true;openFile(e.dataTransfer.files[0]);});
$('export').addEventListener('click',()=>{
  if(!model)return;
  const plan=selectionPlan(model,index,fileName,Number($('ghost-count').value));plan.demo=isDemo;
  const url=URL.createObjectURL(new Blob([JSON.stringify(plan,null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download=fileName.replace(/\.[^.]*$/,'').replace(/[^\w.\-]/g,'_')+'_recovery-auswahl.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
$('help-button').addEventListener('click',()=>$('help').showModal());
$('close-help').addEventListener('click',()=>$('help').close());
$('help').addEventListener('click',e=>{if(e.target===$('help'))$('help').close();});
