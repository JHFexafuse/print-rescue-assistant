// Same-origin Moonraker client. Credentials stay in memory; no third-party service.
let apiBase='',apiKey='',status=null,profileValid=false,connected=false,requestBusy=false,pollTimer=null;
let session=null,hasModule=false,lastStatusTime=0;
function configSection(config,name){const key=Object.keys(config).find(k=>k.toLowerCase()===name.toLowerCase());return key?config[key]:null;}
function normalCode(text){return String(text??'').split(/\r?\n/).map(s=>s.split('#',1)[0].replace(/(^|\s);.*$/,'$1').replace(/\s+/g,'')).join('');}
function recoveryState(){return status?.['gcode_macro _PR_STATE']??{};}
function machineBusy(){return !!(requestBusy||Number(recoveryState().active));}
async function api(path,options={}){
  const headers={...(options.headers||{})};if(apiKey)headers['X-Api-Key']=apiKey;
  if(options.json!==undefined){headers['Content-Type']='application/json';options.body=JSON.stringify(options.json);delete options.json;}
  const response=await fetch(apiBase+path,{...options,headers,credentials:'same-origin',cache:'no-store'});
  if(!response.ok)throw new Error(`Moonraker ${response.status}: ${(await response.text()).slice(0,400)}`);
  const data=await response.json();if(data.error)throw new Error(data.error.message||JSON.stringify(data.error));return data.result;
}
async function command(script){return api('/printer/gcode/script',{method:'POST',json:{script}});}
async function poll(){
  if(!connected)return;
  const objects=['toolhead','gcode_move','print_stats','stepper_enable','extruder','heater_bed','exclude_object','bed_mesh','output_pin _STEPPER_RESET'];
  if(hasModule)objects.push('gcode_macro _PR_STATE');
  try{
    const data=await api('/printer/objects/query?'+objects.map(encodeURIComponent).join('&'));
    status=data.status;lastStatusTime=Date.now();refreshControls();
  }catch(error){lastStatusTime=0;$('connection-detail').textContent='Verbindung unterbrochen';refreshControls();}
}
function checkReady(){
  if(!connected||Date.now()-lastStatusTime>8000)return 'Keine aktuelle Druckerverbindung.';
  if(!profileValid)return 'Klipper-Modul oder Homing-Sperre fehlt bzw. stimmt nicht mit diesem Profil überein.';
  if(['printing','paused'].includes(status?.print_stats?.state))return 'Der bisherige Druckauftrag ist noch aktiv. Zuerst in Mainsail abbrechen.';
  if(status?.toolhead?.homed_axes!=='xyz')return 'XYZ-Referenz fehlt. V1 setzt eine erhaltene Referenz voraus.';
  if(['stepper_z','stepper_z1','stepper_z2','stepper_z3'].some(k=>status?.stepper_enable?.steppers?.[k]!==true))return 'Mindestens ein Z-Motor ist nicht bestromt. V1 ist gesperrt.';
  if(status?.exclude_object?.excluded_objects?.length)return 'Ausgeschlossene Objekte werden in V1 noch nicht unterstützt.';
  if(isDemo)return 'Die Demo ist nur eine Vorschau. Bitte eine echte Druckdatei öffnen.';
  if(!model?.layers[index+1])return 'Keine nächste Druckschicht ausgewählt.';
  if(model.issues.some(x=>x.blocksPlan))return 'Der G-Code enthält noch nicht unterstützte Besonderheiten.';
  const b=model.bounds,min=status.toolhead.axis_minimum,max=status.toolhead.axis_maximum;
  if(!min||!max||b.minX<min[0]||b.maxX>max[0]||b.minY<min[1]||b.maxY>max[1]||b.maxZ>max[2])return 'G-Code liegt außerhalb des Druckbereichs.';
  return '';
}
function refreshControls(){
  const state=recoveryState(),phase=Number(state.phase||0),locked=machineBusy();
  const ready=checkReady(),fresh=connected&&Date.now()-lastStatusTime<=8000;
  $('inspect').disabled=!!(ready||locked||loading||!$('free-position').checked);
  $('resume').disabled=!!(ready||requestBusy||loading||!session||![1,2].includes(phase)||Number(state.token)!==session.token||!$('material-ready').checked);
  $('inspection-cancel').hidden=!Number(state.active);
  $('inspection-cancel').disabled=!fresh||requestBusy||['printing','paused'].includes(status?.print_stats?.state)||!profileValid;
  $('inspection-cancel').textContent=phase===1?'Prüfung beenden · X/Y homen':'Reparatursitzung verwerfen';
  $('remote-files').disabled=!connected||locked;
  for(const id of ['height','seek','slider','prev','next','file-input','demo'])$(id).disabled=locked||loading;
  if(!locked&&model){$('prev').disabled=index===0;$('next').disabled=index===model.layers.length-1;}
  $('machine-status').textContent=phase===1?'X/Y sind frei. Kopf von Hand verschieben und die Höhe prüfen.':phase===2?'X/Y sind referenziert. Reparaturdatei kann gestartet werden.':phase===3?'Reparaturdruck läuft. Geschwindigkeit und Babystepping in Mainsail einstellen.':ready||'Bereit. Vor dem Absenken muss die Düse seitlich neben dem Bauteil stehen.';
  $('machine-status').classList.toggle('good',!ready||phase===1||phase===2);
}

$('connect-button').addEventListener('click',()=>{$('api-url').value=apiBase||(location.protocol.startsWith('http')?location.origin:'');$('connection-dialog').showModal();});
$('connect-close').addEventListener('click',()=>$('connection-dialog').close());
$('connect-do').addEventListener('click',async()=>{
  if(machineBusy()){$('connect-error').textContent='Verbindung während einer aktiven Prüfung nicht wechseln.';return;}
  try{
    const url=new URL($('api-url').value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Bitte eine HTTP(S)-Adresse ohne Zugangsdaten verwenden.');
    apiBase=url.origin;apiKey=$('api-key').value;profileValid=false;connected=false;
    const info=await api('/printer/info');if(info.state!=='ready')throw new Error('Klipper ist nicht bereit: '+info.state_message);
    const listed=await api('/printer/objects/list');hasModule=listed.objects.includes('gcode_macro _PR_STATE');
    const config=(await api('/printer/objects/query?configfile')).status.configfile.config;
    profileValid=hasModule&&Object.entries(PR_PROFILE.installed).every(([name,expected])=>normalCode(configSection(config,name)?.gcode)===expected)&&configSection(config,'output_pin _STEPPER_RESET')?.pin?.trim()==='y:PA1'&&configSection(config,'homing_override')?.axes?.trim()==='xyz'&&configSection(config,'gcode_macro G28')?.rename_existing?.trim()==='G28.1'&&!configSection(config,'gcode_macro M190');
    connected=true;$('connection-state').textContent=url.hostname;
    $('connection-detail').textContent=profileValid?'Druckerprofil geprüft':'Dateizugriff verfügbar · Modulinstallation erforderlich';
    if(pollTimer)clearInterval(pollTimer);await poll();pollTimer=setInterval(poll,3000);
    $('connection-dialog').close();$('connect-error').textContent='';showMessage(profileValid?'Verbindung steht. Maschinenbewegungen erfolgen über die eingebundenen Prüfschritte.':'Vorschau und Dateizugriff sind verfügbar. Bewegungen bleiben gesperrt, bis das geprüfte Modul installiert ist.');
  }catch(error){$('connect-error').textContent=error.message;connected=false;refreshControls();}
});
$('free-position').addEventListener('change',refreshControls);$('material-ready').addEventListener('change',refreshControls);
$('inspect').addEventListener('click',async()=>{
  try{
    await poll();const reason=checkReady();if(reason)throw new Error(reason);if(machineBusy())throw new Error('Eine Sitzung ist bereits aktiv.');
    requestBusy=true;refreshControls();
    const token=(crypto.getRandomValues(new Uint32Array(1))[0]&0x7fffffff)||1;
    session={token,index,fileName};
    await command(`PR_INSPECT Z=${model.layers[index].z} TOKEN=${token}`);
    await poll();if(Number(recoveryState().phase)!==1)throw new Error('Die Handprüfung wurde nicht erreicht. Druckerstatus prüfen.');
    showMessage('X/Y sind jetzt frei. Kopf vorsichtig von Hand über das Bauteil bewegen. Z bleibt bestromt.');
  }catch(error){showMessage(error.message,true);}
  finally{requestBusy=false;refreshControls();}
});
$('inspection-cancel').addEventListener('click',async()=>{
  try{
    requestBusy=true;refreshControls();await poll();const state=recoveryState();
    if(Number(state.phase)===1)await command(`PR_CONFIRM TOKEN=${Number(state.token)} CANCEL=1`);
    else if([0,2,3].includes(Number(state.phase)))await command('PR_DISCARD');
    else throw new Error('Druckauftrag zuerst in Mainsail beenden.');
    session=null;await poll();showMessage('Prüfung beendet.');
  }catch(error){showMessage(error.message,true);}
  finally{requestBusy=false;refreshControls();}
});
$('resume').addEventListener('click',async()=>{
  try{
    await poll();const reason=checkReady();if(reason)throw new Error(reason);
    const state=recoveryState();
    if(!session||session.index!==index||session.fileName!==fileName||Number(state.token)!==session.token||![1,2].includes(Number(state.phase)))throw new Error('Die bestätigte Auswahl passt nicht zur aktiven Sitzung.');
    requestBusy=true;refreshControls();showMessage('Reparaturdatei wird erzeugt und auf den Drucker übertragen …');
    const blob=await makeRepair({token:session.token,hotend:Number($('hotend').value),bed:Number($('bed').value),fileName});
    const files=await api('/server/files/list?root=gcodes');const names=new Set(files.map(x=>x.path));
    const stem=fileName.split('/').pop().replace(/\.[^.]*$/,'').replace(/[\r\n]/g,'_');let output=stem+'_REP.gcode',count=2;
    while(names.has(output))output=stem+'_REP_'+(count++)+'.gcode';
    const form=new FormData();form.append('file',blob,output);form.append('root','gcodes');form.append('print','false');
    const uploaded=await api('/server/files/upload',{method:'POST',body:form});
    const actual=uploaded.item?.path;if(actual!==output||uploaded.item?.root!=='gcodes')throw new Error('Die bestätigte Upload-Datei stimmt nicht mit der Reparaturdatei überein.');
    session.output=actual;
    if(Number(state.phase)===1){showMessage('Motoren einschalten, Abstand herstellen und X/Y referenzieren …');await command(`PR_CONFIRM TOKEN=${session.token}`);}
    await poll();if(Number(recoveryState().phase)!==2||Number(recoveryState().token)!==session.token)throw new Error('XY-Homing oder Sitzungsprüfung fehlgeschlagen.');
    await api('/printer/print/start',{method:'POST',json:{filename:actual}});
    showMessage('Reparaturdatei gestartet. Nach dem Aufheizen beginnt der Weiterdruck mit 20 %. Weitere Einstellung in Mainsail.');
    await poll();
  }catch(error){showMessage(error.message+' Es wird kein weiterer Startbefehl gesendet.',true);}
  finally{requestBusy=false;refreshControls();}
});
$('remote-files').addEventListener('click',async()=>{
  try{
    const files=(await api('/server/files/list?root=gcodes')).filter(f=>/\.(gcode|gco|gc)$/i.test(f.path)).sort((a,b)=>b.modified-a.modified);
    $('printer-files').replaceChildren();
    for(const f of files){const button=document.createElement('button');button.textContent=f.path+' · '+number(f.size/1024/1024)+' MiB';button.addEventListener('click',async()=>{
      try{
        $('files-dialog').close();showMessage('Datei wird vom Drucker geladen …');
        const headers=apiKey?{'X-Api-Key':apiKey}:{};
        const r=await fetch(apiBase+'/server/files/gcodes/'+f.path.split('/').map(encodeURIComponent).join('/'),{headers,credentials:'same-origin'});
        if(!r.ok)throw new Error('Download fehlgeschlagen: '+r.status);
        const blob=await r.blob();await openFile(new File([blob],f.path));
      }catch(error){showMessage(error.message,true);}
    });$('printer-files').append(button);}
    $('files-dialog').showModal();
  }catch(error){showMessage(error.message,true);}
});
$('files-close').addEventListener('click',()=>$('files-dialog').close());
refreshControls();
loadText(demoGcode(),'Demo · geriffeltes Gefäß',true);
