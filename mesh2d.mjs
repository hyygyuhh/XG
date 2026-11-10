// Delaunay triangles in the source image keep camera samples tied to mesh vertices.
export function triangulate(points) {
  const n=points.length, xs=points.map(p=>p.x),ys=points.map(p=>p.y);
  const cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2;
  const span=Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys),1)*32;
  const p=points.concat([{x:cx-span,y:cy-span},{x:cx+span,y:cy-span},{x:cx,y:cy+span}]);
  const circle=(a,b,c)=>{
    const A=p[a],B=p[b],C=p[c],d=2*(A.x*(B.y-C.y)+B.x*(C.y-A.y)+C.x*(A.y-B.y));
    if(Math.abs(d)<1e-7)return null;
    const aa=A.x*A.x+A.y*A.y,bb=B.x*B.x+B.y*B.y,cc=C.x*C.x+C.y*C.y;
    const x=(aa*(B.y-C.y)+bb*(C.y-A.y)+cc*(A.y-B.y))/d;
    const y=(aa*(C.x-B.x)+bb*(A.x-C.x)+cc*(B.x-A.x))/d;
    return {v:[a,b,c],x,y,r:(A.x-x)**2+(A.y-y)**2};
  };
  let tris=[circle(n,n+1,n+2)];
  for(let i=0;i<n;i++){
    const edges=new Map(),keep=[];
    for(const t of tris){
      if((p[i].x-t.x)**2+(p[i].y-t.y)**2>t.r+1e-6){keep.push(t);continue;}
      for(let k=0;k<3;k++){const a=t.v[k],b=t.v[(k+1)%3],key=a<b?`${a},${b}`:`${b},${a}`;
        if(edges.has(key))edges.delete(key);else edges.set(key,[a,b]);}
    }
    for(const [a,b] of edges.values()){const t=circle(a,b,i);if(t)keep.push(t);}
    tris=keep;
  }
  return tris.filter(t=>t.v.every(i=>i<n)).map(t=>t.v);
}
export const area=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const renderers=new WeakMap();
export function warmMesh(output,source){
  if(renderers.has(output.canvas))return;
  const w=output.canvas.width,h=output.canvas.height,points=[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
  drawMesh(output,source,points,points,[[0,1,2],[0,2,3]]);
  renderers.get(output.canvas).gl.finish();
}
export function drawMesh(output,source,points,targets,triangles){
  let r=renderers.get(output.canvas);
  if(!r){
    const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2',{alpha:true,preserveDrawingBuffer:true});
    if(!gl)throw new Error('此设备无法运行 WebGL2 特效');
    const vs=`#version 300 es\nin vec2 position;in vec2 texcoord;in float opacity;out vec2 uv;out float coverage;void main(){uv=texcoord;coverage=opacity;gl_Position=vec4(position,0,1);}`;
    const fs=`#version 300 es\nprecision highp float;uniform sampler2D frame;in vec2 uv;in float coverage;out vec4 color;void main(){vec4 sampleColor=texture(frame,uv);color=vec4(sampleColor.rgb*sampleColor.a*coverage,sampleColor.a*coverage);}`;
    const shader=(kind,code)=>{const s=gl.createShader(kind);gl.shaderSource(s,code);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
    const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vs));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fs));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    const pos=gl.getAttribLocation(program,'position'),uv=gl.getAttribLocation(program,'texcoord'),opacity=gl.getAttribLocation(program,'opacity');gl.enableVertexAttribArray(pos);gl.enableVertexAttribArray(uv);gl.enableVertexAttribArray(opacity);gl.vertexAttribPointer(pos,2,gl.FLOAT,false,20,0);gl.vertexAttribPointer(uv,2,gl.FLOAT,false,20,8);gl.vertexAttribPointer(opacity,1,gl.FLOAT,false,20,16);
    const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    r={canvas,gl,program,buffer};renderers.set(output.canvas,r);
  }
  const {gl,canvas,program,buffer}=r,w=output.canvas.width,h=output.canvas.height;
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
  const data=new Float32Array(triangles.length*15);let at=0;
  for(const triangle of triangles)for(const i of triangle){const p=points[i],q=targets[i];data.set([q.x/w*2-1,1-q.y/h*2,p.x/w,p.y/h,p.alpha??1],at);at+=5;}
  gl.viewport(0,0,w,h);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.useProgram(program);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);gl.drawArrays(gl.TRIANGLES,0,triangles.length*3);output.drawImage(canvas,0,0);
}
