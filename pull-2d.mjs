import {pullProfile as profile} from './pull-profile.mjs';
import {drawMesh,area} from './mesh2d.mjs';
import {buildSmoothField} from './smooth-field.mjs';
import {createHandConstraintTracker} from './hand-continuity.mjs';
const outerTop=[61,185,40,39,37,0,267,269,270,409,291];
const outerBottom=[61,146,91,181,84,17,314,405,321,375,291];
const innerTop=[78,191,80,81,82,13,312,311,310,415,308];
const innerBottom=[78,95,88,178,87,14,317,402,318,324,308];
const oval=[10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
const fixed=[33,133,263,362,1,6];
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function lerp(a,b,t){return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};}
function handEnvelope(hand){
 const palm=Math.max(1,Math.hypot(hand[5].x-hand[17].x,hand[5].y-hand[17].y));
 const angle=Math.atan2(hand[9].y-hand[0].y,hand[9].x-hand[0].x);
 return Array.from({length:8},(_,index)=>{
  const theta=angle+index*Math.PI/4,n={x:Math.cos(theta),y:Math.sin(theta)};
  const scores=hand.map(p=>(p.x*n.x+p.y*n.y)/(palm*.18)),maximum=Math.max(...scores);
  const weights=scores.map(v=>Math.exp(v-maximum)),sum=weights.reduce((a,b)=>a+b,0);
  return {x:hand.reduce((a,p,i)=>a+p.x*weights[i],0)/sum+n.x*palm*.22,y:hand.reduce((a,p,i)=>a+p.y*weights[i],0)/sum+n.y*palm*.22};
 });
}
function visibleWeight(p,envelopes,softness){
 let weight=1;
 for(const polygon of envelopes){
  let inside=false,distance=Infinity;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
   const a=polygon[i],b=polygon[j],dx=b.x-a.x,dy=b.y-a.y;
   if((a.y>p.y)!==(b.y>p.y)&&p.x<dx*(p.y-a.y)/dy+a.x)inside=!inside;
   const t=clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/Math.max(1e-8,dx*dx+dy*dy),0,1);
   distance=Math.min(distance,Math.hypot(p.x-a.x-dx*t,p.y-a.y-dy*t));
  }
  const u=clamp(((inside?-distance:distance)/softness+1)/2,0,1);
  const visible=.025+.975*u*u*(3-2*u);
  weight=Math.min(weight,1-(1-visible)*(polygon.weight??1));
 }
 return weight;
}

export function buildPullMesh(face,hands,status,width,height){
 const left=face.eyes[0],right=face.eyes[1],origin={x:(left.x+right.x)/2,y:(left.y+right.y)/2};
 const e=Math.hypot(right.x-left.x,right.y-left.y),c=Math.cos(face.roll),s=Math.sin(face.roll);
 if(e<8||!face.landmarks)return null;
 const local=p=>({x:((p.x-origin.x)*c+(p.y-origin.y)*s)/e,y:(-(p.x-origin.x)*s+(p.y-origin.y)*c)/e});
 const world=p=>({x:origin.x+e*(p.x*c-p.y*s),y:origin.y+e*(p.x*s+p.y*c)});
 const corners=face.corners.map(local).sort((a,b)=>a.x-b.x);
 const mouthCenter={x:(corners[0].x+corners[1].x)/2,y:(corners[0].y+corners[1].y)/2};
 const chinPoint=local(face.chin);
 const cornerScale=corners.map(p=>Math.abs(p.x-mouthCenter.x)/Math.max(.01,(corners[1].x-corners[0].x)/2));
 const amount=(status.shapeAmount??status.amount??[0,0]).map(v=>clamp(v,0,1));
 const sourceGap=Math.abs(local(face.lips[1]).y-local(face.lips[0]).y);
 const aperture=Math.min(profile.maxAperture,sourceGap*1.32);
 const peak=Math.max(...amount);let points=[],targets=[],tags=[];
 const strengthAtX=x=>{
   const u=clamp((x-corners[0].x)/Math.max(.01,corners[1].x-corners[0].x),0,1);
   return amount[0]+(amount[1]-amount[0])*u*u*(3-2*u);
 };
 const envelopes=hands.map(hand=>Object.assign(handEnvelope(hand),{weight:hand.weight??1}));
 const add=(p,target,tag,confidence=1)=>{const weight=/^(lip|mouth|oval|fixed):/.test(tag)?visibleWeight(p,envelopes,e*.09):confidence;points.push({...p,weight});targets.push(target??p);tags.push(tag);};
 const mouthX=(x,side)=>{
   const half=Math.max(.01,Math.abs(corners[side].x-mouthCenter.x));
   const u=clamp(Math.abs(x-mouthCenter.x)/half,0,1);
   return x+(side?1:-1)*(profile.halfMouthWidth*cornerScale[side]-half)*u**2.7;
 };
 const lip=(ids,y,inner)=>ids.forEach(id=>{
   const p=face.landmarks[id],a=local(p),side=a.x<mouthCenter.x?0:1,t=clamp((a.x-mouthCenter.x)/Math.max(.01,Math.abs(corners[side].x-mouthCenter.x)),-1,1);
   const center=inner?profile.upperLipY+(y===0?profile.lipThickness:profile.lipThickness+aperture):profile.upperLipY+(y===0?0:aperture+2*profile.lipThickness);
   const q={x:mouthX(a.x,side),y:profile.cornerY+(center-profile.cornerY)*(1-t*t)+(corners[side].y-mouthCenter.y)*Math.abs(t)};
   add(p,world(lerp(a,q,strengthAtX(a.x))),`lip:${id}`);
 });
 lip(outerTop,0,false);lip(outerBottom.slice(1,-1),1,false);lip(innerTop,0,true);lip(innerBottom.slice(1,-1),1,true);
 // Interior samples keep the original central teeth and tongue attached to the lip contours.
 const innerCurve=ids=>ids.map(id=>local(face.landmarks[id])).sort((a,b)=>a.x-b.x);
 const top=innerCurve(innerTop),bottom=innerCurve(innerBottom);
 const curveY=(curve,x)=>{
   const i=curve.findIndex(p=>p.x>=x);if(i<=0)return curve[Math.max(i,0)].y;
   const a=curve[i-1],b=curve[i];return a.y+(b.y-a.y)*clamp((x-a.x)/(b.x-a.x),0,1);
 };
 for(const u of [-.25,0,.25]){
   const side=u<0?0:1,x=mouthCenter.x+u*Math.abs(corners[side].x-mouthCenter.x),a=curveY(top,x),b=curveY(bottom,x);
   for(const v of [.25,.5,.75]){
     const p={x,y:a+(b-a)*v},center=profile.upperLipY+profile.lipThickness+aperture*v;
     const q={x:mouthX(x,side),y:profile.cornerY+(center-profile.cornerY)*(1-u*u)+(corners[side].y-mouthCenter.y)*Math.abs(u)};
     add(world(p),world(lerp(p,q,strengthAtX(p.x))),`mouth:${u}:${v}`);
   }
 }
 const noseIds=new Set([1,2,4,5,98,327,94,19]);
 const noseShift=(profile.noseY-local(face.landmarks[1]).y)*peak;
 for(const id of fixed){const p=face.landmarks[id],a=local(p);add(p,noseIds.has(id)?world({x:a.x,y:a.y+noseShift}):p,`fixed:${id}`);}
 for(const id of oval){
  const p=face.landmarks[id],a=local(p),side=a.x<0?0:1;
  let q={...a};
  if(a.y>.25){
    const chin=local(face.chin).y,cornerY=(corners[0].y+corners[1].y)/2;
    const split=Math.max(.5,cornerY);
    if(a.y<=split){const t=clamp((a.y-.25)/(split-.25),0,1);q={x:a.x+(mouthCenter.x+Math.sign(a.x-mouthCenter.x)*(profile.cheekHalfWidth+.12)-a.x)*t,y:.25+(profile.cornerY-.25)*t};}
    else {const t=clamp((a.y-split)/(chin-split),0,1);q={x:mouthCenter.x*(1-t)+chinPoint.x*t+Math.sign(a.x-mouthCenter.x)*(profile.cheekHalfWidth+.12)*Math.pow(1-t,.72),y:profile.cornerY+(profile.chinY-profile.cornerY)*t};}
  }
  add(p,world(lerp(a,q,strengthAtX(a.x))),`oval:${id}`);
 }
 // The same corner displacement is applied to the touching hand.
 const shifts=corners.map((p,i)=>({x:(mouthCenter.x+(i?1:-1)*profile.halfMouthWidth*cornerScale[i]-p.x)*amount[i],y:(profile.cornerY-p.y)*amount[i]}));
 for(const hand of hands){
  const side=local(hand[8]).x<0?0:1,shift=shifts[side];
  const move=p=>world({x:local(p).x+shift.x,y:local(p).y+shift.y});
  for(const i of [0,5,8,17])add(hand[i],move(hand[i]),`hand:${side}:${i}`,hand.weight??1);
  for(const [i,p] of handEnvelope(hand).entries())add(p,move(p),`envelope:${side}:${i}`,(hand.weight??1)/8);
 }
 for(const q of [{x:0,y:3.2},{x:-2,y:3.5},{x:2,y:3.5}]){const p=world(q);add(p,p,'body');}
  const keep=new Set(['lip:61','lip:291','lip:0','lip:17','lip:13','lip:14','fixed:33','fixed:133','fixed:263','fixed:362','fixed:1','fixed:6','oval:10','oval:234','oval:454','oval:152']);
  const selected=tags.map((tag,i)=>({tag,i})).filter(({tag})=>tag.startsWith('lip:')||tag.startsWith('oval:')||keep.has(tag)||tag==='body'||tag.startsWith('envelope:')||/^hand:[01]:(0|5|8|17)$/.test(tag)||tag.startsWith('mouth:')).map(v=>v.i);
  const canonical=p=>{const q=local(p);return {x:q.x+4,y:q.y+2,weight:p.weight??1};};
  const project=p=>world({x:p.x-4,y:p.y-2});
  const dense=buildSmoothField(selected.map(i=>canonical(points[i])),selected.map(i=>canonical(targets[i])),8,7,{kernelRadius:.18,incrementalStages:6,step:.05,coarseStep:.25,roi:{x:3.1,y:2.5,width:1.8,height:1.3}});
  const diagnostics={...dense.diagnostics,vertices:dense.points.length,triangles:dense.triangles.length,eyeDistance:e,amount,aperture,peak};
  for(const key of ['remainingControlRmsPx','remainingControlMaxPx','meshControlRmsErrorPx','meshControlMaxErrorPx','maxDisplacement'])if(Number.isFinite(diagnostics[key]))diagnostics[key]*=e;
  return {...dense,points:dense.points.map(project),targets:dense.targets.map(project),diagnostics};
}
const geometryCache=new WeakMap();
const handTrackers=new WeakMap();
export function drawPull2d(output,source,{face,hands=[],status,timestamp}){
 const w=output.canvas.width,h=output.canvas.height;
 if(Math.max(...(status.shapeAmount??status.amount??[0,0]))<.001){output.drawImage(source,0,0);return null;}
 const a=status.shapeAmount??status.amount??[0,0],previous=geometryCache.get(output.canvas);
 const reusable=Number.isFinite(timestamp)&&previous?.timestamp===timestamp&&previous.face===face&&previous.hands===hands&&previous.w===w&&previous.h===h&&previous.amount[0]===a[0]&&previous.amount[1]===a[1];
 let stableHands=hands;
 if(!reusable&&Number.isFinite(timestamp)){
  let tracker=handTrackers.get(output.canvas);if(!tracker){tracker=createHandConstraintTracker();handTrackers.set(output.canvas,tracker);}
  stableHands=tracker.update(face,hands,timestamp,status.state);
 }
 const mesh=reusable?previous.mesh:buildPullMesh(face,stableHands,status,w,h);
 if(mesh&&Number.isFinite(timestamp))geometryCache.set(output.canvas,{timestamp,face,hands,w,h,amount:[...a],mesh});
 if(!mesh){output.drawImage(source,0,0);return null;}
 drawMesh(output,source,mesh.points,mesh.targets,mesh.triangles);
 return {...mesh.diagnostics,unified:true};
}
export function resetPull2d(canvas){geometryCache.delete(canvas);handTrackers.delete(canvas);}
