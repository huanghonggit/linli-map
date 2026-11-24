import * as T from 'three';

// Draw local names onto their mapped road segments, with a maximum of four nearby labels.
export function createRoadLabels(anchors, ground) {
  const group = new T.Group();
  const slots = Array.from({length: 4}, () => {
    const canvas = document.createElement('canvas');
    canvas.width = 384; canvas.height = 80;
    const map = new T.CanvasTexture(canvas); map.colorSpace = T.SRGBColorSpace;
    const geometry = new T.PlaneGeometry(1,1); geometry.rotateX(-Math.PI/2);
    const material = new T.MeshBasicMaterial({map, transparent:true, depthWrite:false});
    const mesh = new T.Mesh(geometry, material);
    mesh.renderOrder = 2; group.add(mesh);
    return {mesh,canvas,map};
  });
  let previous = '';
  function update(x,z) {
    const key = `${Math.round(x/30)},${Math.round(z/30)}`;
    if (previous === key) return;
    previous = key;
    const nearby = anchors.map(anchor=>({anchor, d:Math.hypot(anchor[1]-x,anchor[2]-z)}))
      .filter(p=>p.d<230).sort((a,b)=>a.d-b.d);
    const selected = [];
    for (const {anchor} of nearby) {
      if (selected.some(b=>b[0]===anchor[0] || Math.hypot(b[1]-anchor[1],b[2]-anchor[2])<35)) continue;
      selected.push(anchor);
      if (selected.length===slots.length) break;
    }
    slots.forEach(({mesh,canvas,map},i)=>{
      mesh.visible = Boolean(selected[i]);
      if (!mesh.visible) return;
      const [name, px,pz,angle] = selected[i];
      if (mesh.name!==name) {
        const ctx=canvas.getContext('2d'); ctx.clearRect(0,0,384,80);
        ctx.font='bold 50px system-ui'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.lineWidth=6; ctx.strokeStyle='#35423e'; ctx.strokeText(name,192,40,366);
        ctx.fillStyle='#fff9e4'; ctx.fillText(name,192,40,366); map.needsUpdate=true; mesh.name=name;
      }
      mesh.position.set(px,ground(px,pz)+.42,pz);
      mesh.scale.set(13,1,2.75); mesh.rotation.y = -angle + (Math.cos(angle)<0 ? Math.PI : 0);
    });
  }
  return {group,update};
}
