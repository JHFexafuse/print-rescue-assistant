// Print Rescue: dependency-free, read-only G-code geometry parser.
// No G-code from a file is ever executed or sent to a printer.
// Feature-type palette from PrusaSlicer 2.9.4, libvgcode/ViewerImpl.cpp.
// The first six IDs remain compatible with the original preview data format.
export const FEATURE_NAMES = ['Außenkontur', 'Kontur', 'Füllung', 'Obere massive Füllung', 'Stützmaterial', 'Unbekannt',
  'Massive Füllung', 'Brückenfüllung', 'Stützmaterial-Schnittstelle', 'Überhangkontur', 'Lückenfüllung', 'Schürze / Rand', 'Bügeln', 'Reinigungsturm', 'Benutzerdefiniert'];
export const FEATURE_COLORS = ['#ff7d38', '#ffe64d', '#b03029', '#f04040', '#00ff00', '#e6b3b3',
  '#9654cc', '#4d80ba', '#008000', '#1f1fff', '#ffffff', '#00876e', '#ff8c69', '#b3e3ab', '#5ed194'];
const EPS = 0.0001;

export function featureId(name) {
  const s = name.toLowerCase().replace(/[_-]+/g, ' ');
  if (/support.*(?:interface|roof|floor)/.test(s)) return 8;
  if (/support/.test(s)) return 4;
  if (/overhang/.test(s)) return 9;
  if (/bridge/.test(s)) return 7;
  if (/gap/.test(s)) return 10;
  if (/skirt|brim/.test(s)) return 11;
  if (/iron/.test(s)) return 12;
  if (/wipe tower|prime tower/.test(s)) return 13;
  if (/top/.test(s)) return 3;
  if (/bottom|solid|skin/.test(s)) return 6;
  if (/outer|external|wall-outer/.test(s)) return 0;
  if (/inner|perimeter|wall-inner/.test(s)) return 1;
  if (/infill|fill/.test(s)) return 2;
  if (/custom/.test(s)) return 14;
  return 5;
}

export function nearestLayer(layers, height) {
  if (!Number.isFinite(height) || !layers.length) return -1;
  let index = 0, distance = Infinity;
  for (let i = 0; i < layers.length; i++) {
    const d = Math.abs(layers[i].z - height);
    if (d < distance - 1e-7) { index = i; distance = d; }
  }
  return index;
}

export function selectionPlan(model, index, fileName, ghostCount = 30) {
  const current = model.layers[index];
  if (!current) throw new Error('Keine gültige Schicht ausgewählt.');
  const next = model.layers[index + 1];
  return {
    format: 'print-rescue-selection', version: 1, fileName,
    interpretation: 'selected_layer_is_last_fully_printed',
    lastComplete: { layer: index + 1, z: current.z, firstExtrusionLine: current.line },
    resume: next ? { layer: index + 2, z: next.z, firstExtrusionLine: next.line } : null,
    ghostLayers: ghostCount, initialSpeedPercent: 20,
    zReferenceRequired: true, zHomingAllowed: false,
    reconstructionAfterPowerOff: false,
    suitableForRecoveryPlanning: !!next && !model.issues.some(x => x.blocksPlan),
    issues: model.issues,
    note: 'Auswahlprotokoll; keine ausführbare Reparaturdatei und keine Bewegungsfreigabe.'
  };
}

function arcPoints(a, b, words, clockwise) {
  let cx, cy;
  if ('I' in words || 'J' in words) {
    cx = a.x + (words.I || 0); cy = a.y + (words.J || 0);
  } else if ('R' in words) {
    const dx = b.x - a.x, dy = b.y - a.y, chord = Math.hypot(dx, dy);
    const radius = Math.abs(words.R);
    if (chord < EPS || chord > radius * 2 + EPS) throw new Error('Ungültiger R-Bogen');
    const h = Math.sqrt(Math.max(0, radius * radius - chord * chord / 4));
    const side = (clockwise ? -1 : 1) * (words.R < 0 ? -1 : 1);
    cx = (a.x + b.x) / 2 - side * dy * h / chord;
    cy = (a.y + b.y) / 2 + side * dx * h / chord;
  } else throw new Error('Bogen ohne Mittelpunkt oder Radius');
  const radius = Math.hypot(a.x - cx, a.y - cy);
  if (radius < EPS || Math.abs(Math.hypot(b.x - cx, b.y - cy) - radius) > Math.max(.05, radius * .001)) {
    throw new Error('Widersprüchliche Bogenkoordinaten');
  }
  const start = Math.atan2(a.y - cy, a.x - cx);
  let sweep = Math.atan2(b.y - cy, b.x - cx) - start;
  if (clockwise) { while (sweep >= -1e-9) sweep -= Math.PI * 2; }
  else { while (sweep <= 1e-9) sweep += Math.PI * 2; }
  const count = Math.min(4096, Math.max(2, Math.ceil(Math.abs(sweep) / .065), Math.ceil(radius * Math.abs(sweep) / 1.5)));
  const out = [];
  for (let i = 1; i <= count; i++) {
    const t = i / count, angle = start + sweep * t;
    out.push(i === count ? b : { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle), z: a.z + (b.z - a.z) * t });
  }
  return out;
}

export function parseGcode(text, progress = () => {}, maxSegments = 12000000) {
  if (typeof text !== 'string' || text.includes('\0')) throw new Error('Bitte unkomprimierten Text-G-Code öffnen (.gcode, .gco oder .gc).');
  const hasMarkers = /(?:^|\n)\s*;\s*(?:LAYER_CHANGE\b|CHANGE_LAYER\b|BEFORE_LAYER_CHANGE\b|LAYER\s*:\s*-?\d)/i.test(text);
  let inModel = !hasMarkers, feature = 5, pos = 0, lineNo = 0, segmentCount = 0;
  let x = 0, y = 0, z = 0, e = 0, abs = true, relativeE = false, scale = 1, plane = 17;
  let motion = 'G1', debt = 0, xyzKnown = {x:false,y:false,z:false};
  let feed=0, hotend=null, bed=null, fan=0, accel=1000, flow=100, objectStart='', before=null, lineOffset=0;
  const objectDefinitions=[];
  let active = null, lastZ = null, explicitE = false;
  const layers = [], issues = [], issueKeys = new Set(), unknown = new Map();
  const featureCounts = new Array(FEATURE_NAMES.length).fill(0);
  const bounds = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
  function issue(key, message, blocksPlan = true) {
    if (!issueKeys.has(key)) { issues.push({ key, message, line: lineNo, blocksPlan }); issueKeys.add(key); }
  }
  function add(a, b) {
    if (++segmentCount > maxSegments) throw new Error('Die Datei enthält mehr als 12 Millionen Liniensegmente.');
    if (!active || Math.abs(active.z - b.z) > EPS) {
      if(active)active.segments=new Float32Array(active.segments);
      if (lastZ !== null && b.z < lastZ - EPS) issue('descending_layers', 'Die Druckhöhe fällt zwischen gedruckten Schichten. Sequenzieller Objektdruck wird für den Wiederanlauf noch nicht unterstützt.');
      active = { z: b.z, line: lineNo, offset:lineOffset, before:{...before}, segments: [], count: 0 };
      layers.push(active); lastZ = b.z;
      if (layers.length > 25000) throw new Error('Mehr als 25.000 Druckebenen erkannt. Möglicherweise Spiral- oder nichtplanarer G-Code.');
    }
    active.segments.push(a.x,a.y,a.z,b.x,b.y,b.z,feature); active.count++; featureCounts[feature]++;
    for (const p of [a,b]) {
      bounds.minX=Math.min(bounds.minX,p.x); bounds.maxX=Math.max(bounds.maxX,p.x);
      bounds.minY=Math.min(bounds.minY,p.y); bounds.maxY=Math.max(bounds.maxY,p.y);
      bounds.minZ=Math.min(bounds.minZ,p.z); bounds.maxZ=Math.max(bounds.maxZ,p.z);
    }
  }
  while (pos < text.length) {
    lineOffset=pos;
    let end = text.indexOf('\n', pos); if (end < 0) end = text.length;
    const raw = text.slice(pos, end).trim(); pos = end + 1; lineNo++;
    if (lineNo % 50000 === 0) progress(Math.min(99, Math.round(pos / text.length * 100)));
    if (/^;\s*(?:LAYER_CHANGE\b|CHANGE_LAYER\b|BEFORE_LAYER_CHANGE\b|LAYER\s*:\s*-?\d)/i.test(raw)) inModel = true;
    const kind = raw.match(/^;\s*(?:TYPE|FEATURE)\s*:\s*(.*)/i);
    if (kind) feature = featureId(kind[1]);
    let code = raw.split(';', 1)[0].replace(/\([^)]*\)/g, '').trim().toUpperCase();
    if (!code) continue;
    if(/^N\d/.test(code)||code.includes('*'))issue('numbered_code','Zeilennummern oder Prüfsummen werden für die Reparatur noch nicht unterstützt.');
    code = code.replace(/^N\d+\s*/, '').split('*', 1)[0].trim();
    let match = code.match(/^([GM]\d+(?:\.\d+)?)/), command;
    if (match) command = match[1].replace(/^([GM])0+(\d)/, '$1$2');
    else if (/^[XYZEF][-+\d.]/.test(code)) command = motion;
    else command = (code.match(/^[A-Z_][A-Z_0-9.]*/) || [''])[0];
    const words = {};
    if (/^[GM]\d/.test(command)) {
      const tail = match ? code.slice(match[0].length) : code;
      for (const m of tail.matchAll(/([A-Z])\s*([-+]?(?:\d+(?:\.\d*)?|\.\d+))/g)) words[m[1]] = Number(m[2]);
    }
    if (command === 'G90') { abs = true; continue; }
    if (command === 'G91') { abs = false; continue; }
    if (command === 'M82') { relativeE = false; explicitE = true; continue; }
    if (command === 'M83') { relativeE = true; explicitE = true; continue; }
    if (command === 'M104'||command==='M109') {if('S'in words)hotend=words.S;continue;}
    if (command === 'M140'||command==='M190') {if('S'in words)bed=words.S;continue;}
    if (command === 'M106') {if(words.P && words.P!==0)issue('fan_channel','Mehrere Lüfterkanäle werden für den Wiederanlauf noch nicht unterstützt.');fan=words.S??255;continue;}
    if (command === 'M107') {fan=0;continue;}
    if (command === 'M204') {accel=words.S??Math.min(words.P??Infinity,words.T??Infinity);continue;}
    if (command === 'M221') {flow=words.S??100;continue;}
    if (command === 'PRINT_START') {if(inModel)issue('start_inside_model','PRINT_START innerhalb des Druckabschnitts ist für Reparaturdateien gesperrt.');abs=true;flow=100;continue;}
    if (command === 'EXCLUDE_OBJECT_DEFINE') {objectDefinitions.push(raw.split(';')[0].trim());continue;}
    if (command === 'EXCLUDE_OBJECT_START') {objectStart=raw.split(';')[0].trim();continue;}
    if (command === 'EXCLUDE_OBJECT_END') {objectStart='';continue;}
    if (command === 'G20') { scale = 25.4; issue('inch_units','Zoll-Einheiten erkannt; Vorschau in Millimetern. Wiederanlauf noch nicht freigegeben.'); continue; }
    if (command === 'G21') { scale = 1; continue; }
    if (['G17','G18','G19'].includes(command)) { plane = Number(command.slice(1)); continue; }
    if (command === 'G90.1') { issue('arc_centers','Absolute Bogenmittelpunkte werden nicht unterstützt.'); continue; }
    if (command === 'G92') {
      if ('E' in words) e = words.E * scale;
      if (['X','Y','Z'].some(k=>k in words)) issue('xyz_origin','G92 verschiebt XYZ-Koordinaten. Diese Vorschau ist dafür nicht freigegeben.');
      continue;
    }
    if (/^T\d+$/.test(command)) issue('tools','Werkzeugauswahl erkannt; Werkzeugmakros sind für dieses Profil noch nicht geprüft.');
    if (command === 'G10' || command === 'G11') issue('fw_retraction','Firmware-Retract erkannt. Der Extrusionszustand muss für die Reparatur gesondert rekonstruiert werden.');
    if (!['G0','G1','G2','G3'].includes(command)) {
      if(inModel && command && !['G4','G91.1','M73','M117','M118','M400','M220','SET_PRINT_STATS_INFO','PRINT_END'].includes(command) && command!=='T0') {
        issue('unsupported_'+command,'Befehl '+command+' im Druckabschnitt wird für Reparaturdateien noch nicht unterstützt.');
      }
      if (command && !/^(?:[GM]\d|T0$)/.test(command)) unknown.set(command, (unknown.get(command)||0)+1);
      continue;
    }
    motion = command;
    before={x,y,z,e,abs,relativeE,feed,hotend,bed,fan,accel,flow,objectStart,debt};
    if('F'in words)feed=words.F*scale;
    const old = {x,y,z};
    const next = {x,y,z};
    for (const key of ['x','y','z']) if (key.toUpperCase() in words) {
      next[key] = (abs ? 0 : next[key]) + words[key.toUpperCase()] * scale;
      xyzKnown[key] = true;
    }
    const targetE = 'E' in words ? ((abs && !relativeE) ? words.E * scale : e + words.E * scale) : e;
    const deltaE = targetE - e; e = targetE;
    const previousDebt = debt;
    if (deltaE < 0) debt -= deltaE; else debt = Math.max(0, debt - deltaE);
    const deposits = deltaE - previousDebt > 1e-6;
    const isArc = command === 'G2' || command === 'G3';
    const travelsXY = Math.hypot(next.x-x,next.y-y) > EPS || isArc;
    if (deposits && travelsXY && inModel) {
      if (!Object.values(xyzKnown).every(Boolean)) issue('unknown_position','Extrusion vor vollständiger XYZ-Positionierung erkannt. Vorschau kann unvollständig sein.');
      if (Math.abs(next.z-z)>EPS) issue('nonplanar','Extrusion mit gleichzeitig veränderter Z-Höhe erkannt. Spiral-/nichtplanarer Wiederanlauf ist noch nicht unterstützt.');
      if (isArc) {
        if (plane !== 17) issue('arc_plane','Bögen außerhalb der XY-Ebene werden in dieser Vorschau ausgelassen.');
        else {
          try {
            const arcWords={...words}; for(const k of ['I','J','R']) if(k in arcWords) arcWords[k]*=scale;
            let previous=old;
            for(const p of arcPoints(old,next,arcWords,command==='G2')) {add(previous,p); previous=p;}
          } catch(err) {issue('invalid_arc', 'Ein Bogen konnte nicht dargestellt werden: '+err.message);}
        }
      } else add(old,next);
    }
    ({x,y,z}=next);
  }
  if (!layers.length) throw new Error('Keine gedruckten Schichten erkannt. Benötigt wird G-Code mit XYZ-Bewegungen und Extrusion.');
  if (!explicitE) issue('implicit_e','Kein M82/M83 gefunden. Für die Vorschau wurde der Klipper-Standard angenommen; Extrusionsmodus vor Reparatur prüfen.');
  if (!hasMarkers) issue('no_markers','Keine bekannten Schichtkommentare gefunden. Schichten wurden aus Extrusionshöhen erkannt; Anfahr-/Purgelinien können enthalten sein.',false);
  if (unknown.size) issue('macros','Makros in der Datei: '+[...unknown.keys()].slice(0,10).join(', ')+'. Ihre Bewegungen sind nicht Bestandteil der Vorschau.',false);
  if(active)active.segments=new Float32Array(active.segments);
  progress(100);
  return {layers,bounds,segmentCount,lineCount:lineNo,hasMarkers,issues,objectDefinitions,featureCounts};
}

export function repairParts(source,model,index,options) {
  const last=model.layers[index],next=model.layers[index+1];
  if(!last||!next)throw new Error('Nach der ausgewählten Schicht ist kein Weiterdruck vorhanden.');
  if(model.issues.some(x=>x.blocksPlan))throw new Error('Diese Datei enthält noch nicht unterstützte Befehle oder Geometrie.');
  const s=next.before;
  if(!s.abs)throw new Error('Relative XYZ-Bewegungen an der Schnittstelle werden noch nicht unterstützt.');
  if(s.debt>0.001)throw new Error('An der Schnittstelle ist noch Retract aktiv. Diese Schnittstelle ist noch nicht unterstützt.');
  if(!(s.feed>0))throw new Error('Keine gültige Bewegungsgeschwindigkeit an der Schnittstelle.');
  const token=Number(options.token),hotend=Number(options.hotend),bed=Number(options.bed);
  if(!Number.isSafeInteger(token)||token<1||token>2147483647)throw new Error('Ungültige Sitzung.');
  if(!Number.isFinite(hotend)||hotend<140||hotend>315||!Number.isFinite(bed)||bed<0||bed>105)throw new Error('Temperaturen außerhalb des freigegebenen Profils (Düse 140–315 °C, Bett 0–105 °C).');
  const fmt=n=>Number(n.toFixed(6));
  const h=[
    '; Print Rescue 0.1 – Reparaturdatei, nur mit aktiver Prüfsitzung startbar',
    '; Quelle: '+String(options.fileName||'').replace(/[\r\n]/g,' '),
    `; Letzte vollständige Schicht: ${index+1}, Z=${fmt(last.z)}`,
    `; Weiterdruck: Schicht ${index+2}, Z=${fmt(next.z)}`,
    `PR_START TOKEN=${token} LAST_Z=${fmt(last.z)} NEXT_Z=${fmt(next.z)} HOTEND=${hotend} BED=${bed}`,
    'G21','G90',s.relativeE?'M83':'M82',`M221 S${fmt(s.flow)}`,`M204 S${fmt(s.accel)}`,`M106 S${fmt(s.fan)}`,'M220 S20',
    'EXCLUDE_OBJECT_DEFINE RESET=1',...model.objectDefinitions,
    `SET_PRINT_STATS_INFO TOTAL_LAYER=${model.layers.length} CURRENT_LAYER=${index+2}`,
    `G1 X${fmt(s.x)} Y${fmt(s.y)} F4800`,
    `G1 Z${fmt(s.z)} F300`,
    `G92 E${fmt(s.e)}`,`G1 F${fmt(s.feed)}`,
    'M220 S20',
    ...(s.objectStart?[s.objectStart]:[]),
    '; --- Original ab erster Extrusionsbewegung der nächsten Schicht ---'
  ];
  const tail=source.slice(next.offset)
    .replace(/^\s*M220\s+[^\r\n]*/gmi,'; Print Rescue: automatischen Geschwindigkeits-Override entfernt')
    .replace(/^\s*PRINT_END\s*(?:;[^\r\n]*)?$/gm,'PR_FINISH');
  if(!/^PR_FINISH\s*$/m.test(tail))throw new Error('Das erwartete PRINT_END fehlt. Endsequenz muss zuerst geprüft werden.');
  return [h.join('\n')+'\n',tail];
}

export function demoGcode() {
  // Synthetic inspection object: fluted vessel with a changing waist and shoulder.
  // This text exists only inside the preview; it is not a printer test file.
  const out=['; Print Rescue Vorschau-Demo, synthetisch','G90','M83'];
  for(let layer=1;layer<=150;layer++) {
    const z=layer*.5, t=layer/150;
    const radius=34+12*Math.sin(t*Math.PI*1.65)+5*Math.cos(t*Math.PI*4);
    out.push(';LAYER_CHANGE', ';Z:'+z.toFixed(3), 'G1 Z'+z.toFixed(3)+' F600');
    for(let wall=0;wall<3;wall++) {
      out.push(';TYPE:'+(wall===0?'Outer wall':'Inner wall'));
      const r=radius-wall*1.1;
      for(let n=0;n<=160;n++) {
        const angle=n/160*Math.PI*2;
        const wave=1.8*Math.cos(angle*12+t*4);
        const px=100+(r+wave)*Math.cos(angle), py=100+(r+wave)*Math.sin(angle);
        out.push('G1 X'+px.toFixed(4)+' Y'+py.toFixed(4)+(n?' E0.08 F2400':' F9000'));
      }
    }
  }
  return out.join('\n');
}
