export class LayerViewer {
  constructor(canvas) {
    this.canvas=canvas; this.ctx=canvas.getContext('2d'); this.yaw=-.65; this.pitch=.8;
    this.zoom=1; this.pan={x:0,y:0}; this.ghost=30; this.opacity=.18; this.index=0;
    this.pointers=new Map(); this.frame=null; this.model=null;
    new ResizeObserver(()=>this.resize()).observe(canvas);
    canvas.addEventListener('contextmenu',e=>e.preventDefault());
    canvas.addEventListener('pointerdown',e=>{
      canvas.setPointerCapture(e.pointerId); this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      this.drag={x:e.clientX,y:e.clientY,pan:e.shiftKey||e.button===2};
    });
    canvas.addEventListener('pointermove',e=>{
      if(!this.pointers.has(e.pointerId))return;
      const before=[...this.pointers.values()];
      this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      const after=[...this.pointers.values()];
      if(before.length===2) {
        const dist=p=>Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);
        const old=dist(before); if(old>0)this.zoom=Math.max(.15,Math.min(15,this.zoom*dist(after)/old));
      } else {
        const dx=e.clientX-this.drag.x,dy=e.clientY-this.drag.y;
        if(this.drag.pan){this.pan.x+=dx;this.pan.y+=dy;}
        else{this.yaw+=dx*.009;this.pitch=Math.max(.03,Math.min(Math.PI/2, this.pitch+dy*.006));}
      }
      this.drag.x=e.clientX;this.drag.y=e.clientY;this.requestDraw();
    });
    const up=e=>{this.pointers.delete(e.pointerId);const point=[...this.pointers.values()][0];this.drag=point?{...point,pan:false}:null;};
    canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',up);
    canvas.addEventListener('wheel',e=>{e.preventDefault();this.zoom=Math.max(.15,Math.min(15,this.zoom*Math.exp(-e.deltaY*.001)));this.requestDraw();},{passive:false});
    this.resize();
  }
  resize(){
    const rect=this.canvas.getBoundingClientRect();this.w=rect.width;this.h=rect.height;
    this.dpr=Math.min(2,window.devicePixelRatio||1);
    this.canvas.width=Math.round(this.w*this.dpr);this.canvas.height=Math.round(this.h*this.dpr);this.requestDraw();
  }
  setModel(model){this.model=model;this.zoom=1;this.pan={x:0,y:0};this.requestDraw();}
  setSelection(index,ghost,opacity){this.index=index;this.ghost=ghost;this.opacity=opacity;this.requestDraw();}
  view(kind){
    this.zoom=1;this.pan={x:0,y:0};
    if(kind==='top'){this.yaw=0;this.pitch=Math.PI/2;}
    else if(kind==='front'){this.yaw=0;this.pitch=.04;}
    else{this.yaw=-.65;this.pitch=.8;}
    this.requestDraw();
  }
  requestDraw(){if(!this.frame)this.frame=requestAnimationFrame(()=>{this.frame=null;this.draw();});}
  draw(){
    const c=this.ctx,w=this.w,h=this.h;c.setTransform(this.dpr,0,0,this.dpr,0,0);c.clearRect(0,0,w,h);
    if(!this.model||w<1||h<1)return;
    const {bounds:b,layers}=this.model;
    const first=Math.max(0,this.index-this.ghost),last=layers[this.index];if(!last)return;
    const lo=layers[first].z,hi=last.z,cx=(b.minX+b.maxX)/2,cy=(b.minY+b.maxY)/2,cz=(lo+hi)/2;
    const span=Math.max(b.maxX-b.minX,b.maxY-b.minY,hi-lo,1);
    const unit=Math.min(w/(span*1.6),h/(span*.95+hi-lo))*.8*this.zoom;
    const cos=Math.cos(this.yaw),sin=Math.sin(this.yaw),cp=Math.cos(this.pitch),sp=Math.sin(this.pitch);
    const project=(x,y,z)=>{
      const px=x-cx,py=y-cy,pz=z-cz;
      return [w/2+this.pan.x+(px*cos-py*sin)*unit,h/2+this.pan.y+(px*sin+py*cos)*sp*unit-pz*cp*unit];
    };
    const line=(a,b)=>{const p=project(...a),q=project(...b);c.moveTo(...p);c.lineTo(...q);};
    // This plane marks the bottom of the displayed layer window, not the bed.
    const margin=span*.1,gminX=b.minX-margin,gmaxX=b.maxX+margin,gminY=b.minY-margin,gmaxY=b.maxY+margin;
    const step=Math.pow(10,Math.floor(Math.log10(span/8)));const grid=step*(span/step>30?5:span/step>15?2:1);
    c.lineWidth=1;c.strokeStyle='rgba(156,177,192,.075)';c.beginPath();
    for(let x=Math.ceil(gminX/grid)*grid;x<=gmaxX;x+=grid)line([x,gminY,lo],[x,gmaxY,lo]);
    for(let y=Math.ceil(gminY/grid)*grid;y<=gmaxY;y+=grid)line([gminX,y,lo],[gmaxX,y,lo]);c.stroke();
    let ghostSegments=0;for(let i=first;i<this.index;i++)ghostSegments+=layers[i].count;
    const stride=Math.max(1,Math.ceil(ghostSegments/220000));
    for(let i=first;i<this.index;i++){
      const a=layers[i].segments;
      c.strokeStyle=`rgba(123,165,181,${this.opacity*(.55+.45*(i-first+1)/Math.max(1,this.index-first))})`;
      c.lineWidth=.8;c.beginPath();
      for(let j=0;j<a.length;j+=7*stride)line([a[j],a[j+1],a[j+2]],[a[j+3],a[j+4],a[j+5]]);c.stroke();
    }
    const a=last.segments;
    for(let kind=0;kind<6;kind++){
      c.strokeStyle=FEATURE_COLORS[kind];c.lineWidth=1.65;c.lineCap='round';c.beginPath();
      for(let j=0;j<a.length;j+=7)if(a[j+6]===kind)line([a[j],a[j+1],a[j+2]],[a[j+3],a[j+4],a[j+5]]);c.stroke();
    }
    // Axis orientation independent of the object scale.
    const axisOrigin=[48,h-55],axisLength=26;
    const vectors=[['X','#ec8c8c',cos,sin*sp],['Y','#72d1ac',-sin,cos*sp],['Z','#91bafa',0,-cp]];
    c.font='11px ui-monospace,monospace';c.lineWidth=1.8;
    for(const[label,color,x,y]of vectors){c.strokeStyle=color;c.fillStyle=color;c.beginPath();c.moveTo(...axisOrigin);c.lineTo(axisOrigin[0]+x*axisLength,axisOrigin[1]+y*axisLength);c.stroke();c.fillText(label,axisOrigin[0]+x*(axisLength+12)-3,axisOrigin[1]+y*(axisLength+12)+4);}
  }
}
