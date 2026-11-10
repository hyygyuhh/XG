const clamp = x => Math.max(0, Math.min(1, x));
export function createPullController() {
  let state='waiting', baseline, neutral, contactAt, lostAt, releaseAt, held=[0,0], aperture=0, last=-Infinity, scale;
  return {update(face,hands,now) {
    if(state==='done')return {state,amount:[0,0],shapeAmount:[0,0],opening:0};
    if(now<last)return {state,amount:held,shapeAmount:held,opening:aperture};
    const dt=Math.min(100,now-last);last=now;
    if(face && !scale)scale=face.width;
    const width=face?.eyes ? Math.hypot(face.eyes[1].x-face.eyes[0].x,face.eyes[1].y-face.eyes[0].y)*2 : scale;
    const local=p=>({x:((p.x-face.mouth.x)*Math.cos(face.roll)+(p.y-face.mouth.y)*Math.sin(face.roll))/width,
      y:(-(p.x-face.mouth.x)*Math.sin(face.roll)+(p.y-face.mouth.y)*Math.cos(face.roll))/width});
    let tips,visibleDetached=false;
    if(face?.corners && width>=24 && hands.length===2){
      tips=hands.map(h=>local(h[8])).sort((a,b)=>a.x-b.x);
      visibleDetached=tips.every(p=>Math.abs(p.y)>.3 || Math.abs(p.x)>1.2);
      if(tips.some(p=>Math.abs(p.y)>.26 || Math.abs(p.x)>1) || tips[0].x>=-.05 || tips[1].x<=.05)tips=null;
    }
    if(state==='waiting'){
      if (face?.corners && !neutral) neutral=face.corners.map(local).sort((a,b)=>a.x-b.x).map(p=>p.x);
      const corners=tips&&face.corners.map(local).sort((a,b)=>a.x-b.x);
      if(tips&&tips.every((p,i)=>Math.hypot(p.x-corners[i].x,p.y-corners[i].y)<.18)){
        contactAt??=now;
        if(now-contactAt>=60){baseline=neutral ?? tips.map(p=>p.x);state='contact';}
      }else contactAt=undefined;
    }
    if(['contact','pulling','release'].includes(state)){
      if(tips){
        if(state==='release'){const fade=1-clamp((now-releaseAt)/220);held=held.map(v=>v*fade);aperture*=fade;}
        lostAt=undefined;releaseAt=undefined;
        const contact=tips.map(p=>{const t=clamp((.26-Math.abs(p.y))/.12);return t*t*(3-2*t);});
        const contactAmount=Math.max(...contact);
        const open=(face.lips?clamp((Math.hypot(face.lips[0].x-face.lips[1].x,face.lips[0].y-face.lips[1].y)/width-.025)/.15):0)*contactAmount;
        const target=tips.map((p,i)=>clamp(((i?1:-1)*(p.x-baseline[i])-.005)/.14)*contactAmount);
        const alpha=1-Math.exp(-dt/35);
        held=held.map((v,i)=>v+(target[i]-v)*alpha);
        aperture += (open-aperture)*alpha;
        state=Math.max(...held)>.04 || aperture>.08?'pulling':'contact';
      }else{
        lostAt??=now;
        if((visibleDetached||now-lostAt>200) && state!=='release'){state='release';releaseAt=now;}
      }
    }
    const fade=state==='release'?1-clamp((now-releaseAt)/220):1;
    if(state==='release'&&fade===0)state='done';
    return {state,amount:held.map(v=>v*fade),shapeAmount:held.map(v=>Math.max(v,aperture)*fade),opening:aperture*fade};
  }};
}

