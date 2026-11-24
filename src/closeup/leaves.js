import * as T from 'three';

// A single reusable spray of leaves and twigs, painted locally and cut out by alpha.
export function leafyFringe() {
  let state = 71;
  const random = () => ((state = Math.imul(state, 1664525) + 1013904223 | 0) >>> 0) / 4294967296;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  for (let twig=0; twig<11; twig++) {
    const angle = twig * 2.4, length = 32 + random()*22;
    const dx=Math.cos(angle)*length, dy=Math.sin(angle)*length;
    ctx.strokeStyle='#7b745a'; ctx.lineWidth=1.7;ctx.beginPath();ctx.moveTo(64,64);ctx.lineTo(64+dx,64+dy);ctx.stroke();
    for (let leaf=0;leaf<18;leaf++) {
      const fraction=random(), side=(random()-.5)*(8+fraction*10);
      const x=64+dx*fraction-side*Math.sin(angle), y=64+dy*fraction+side*Math.cos(angle);
      const lum=55+random()*32;
      ctx.fillStyle=`hsl(${72+random()*16} 30% ${lum}%)`;
      ctx.beginPath();ctx.ellipse(x,y,3+random()*3,1.8+random()*1.5,angle+(random()-.5)*1.6,0,Math.PI*2);ctx.fill();
    }
  }
  const map=new T.CanvasTexture(canvas);map.colorSpace=T.SRGBColorSpace;
  const pos=[],norm=[],uv=[],indices=[];
  for(let i=0;i<78;i++){
    const a=i*2.39996, vertical=1-2*(i+.5)/78, radius=Math.sqrt(1-vertical*vertical);
    const normal=new T.Vector3(Math.cos(a)*radius,vertical,Math.sin(a)*radius);
    const center=new T.Vector3(normal.x*2,4.55+normal.y*1.9,normal.z*2);
    const side=new T.Vector3(-Math.sin(a),0,Math.cos(a)), up=new T.Vector3().crossVectors(normal,side);
    const index=pos.length/3;
    for(const [u,v] of [[0,0],[1,0],[1,1],[0,1]]){
      const p=center.clone().addScaledVector(side,(u-.5)*1.9).addScaledVector(up,(v-.5)*1.75);
      pos.push(p.x,p.y,p.z);norm.push(normal.x,normal.y,normal.z);uv.push(u,v);
    }
    indices.push(index,index+1,index+2,index,index+2,index+3);
  }
  const geom=new T.BufferGeometry();
  geom.setAttribute('position',new T.Float32BufferAttribute(pos,3));geom.setAttribute('normal',new T.Float32BufferAttribute(norm,3));geom.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geom.setIndex(indices);
  return {geom, material:new T.MeshLambertMaterial({map,alphaTest:.47,side:T.DoubleSide})};
}
