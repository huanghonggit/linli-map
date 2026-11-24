import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { facadeMaterial, groundMaterial, prepareFacade, roadMaterial } from './materials.js';
import { createRoadLabels } from './roadLabels.js';
import { leafyFringe } from './leaves.js';
import groundUrl from './ground-cover.webp?url';
import canopyUrl from './canopy.bin?url';

function roadSurface(ways, widths, extraWidth, elevation, ground, material) {
  const positions = [], indices = [];
  for (const [roadIndex, way] of ways.entries()) {
    const width = widths[roadIndex] + extraWidth;
    const points = [way[0]];
    for (let i = 1; i < way.length; i++) {
      const [x,z] = way[i-1], [endX,endZ] = way[i];
      const steps = Math.ceil(Math.hypot(endX-x,endZ-z)/15);
      for (let j=1;j<=steps;j++) points.push([x+(endX-x)*j/steps,z+(endZ-z)*j/steps]);
    }
    for (let i=0;i<points.length;i++) {
      const before = points[Math.max(0,i-1)], after = points[Math.min(i+1,points.length-1)];
      const dx = after[0]-before[0], dz = after[1]-before[1], d = Math.hypot(dx,dz) || 1;
      const index = positions.length / 3;
      for (const side of [-.5,.5]) {
        const x=points[i][0]-side*width*dz/d, z=points[i][1]+side*width*dx/d;
        positions.push(x,ground(x,z)+elevation,z);
      }
      if (i) indices.push(index-2,index-1,index,index,index-1,index+1);
    }
  }
  const geo=new T.BufferGeometry();
  geo.setAttribute('position',new T.Float32BufferAttribute(positions,3));
  geo.setIndex(indices); geo.computeVertexNormals();
  const mesh=new T.Mesh(geo,material); mesh.receiveShadow=true;
  return mesh;
}

// One shared, irregular crown with lobes, vertex tint and smooth leaf masses.
function crownShape() {
  const lobes = [[0,4.6,0,1.85,2.25],[1,3.8,.45,1.5,1.55],[-.95,4.05,.6,1.4,1.72],[-.35,3.84,-1.05,1.54,1.68],[.65,5.22,-.42,1.32,1.68]];
  const parts = lobes.map(([x,y,z,r,h], k) => {
    const geo=new T.IcosahedronGeometry(1,2), pos=geo.attributes.position;
    const colors=[];
    for(let i=0;i<pos.count;i++) {
      const a=pos.getX(i), b=pos.getY(i), c=pos.getZ(i);
      const wave=.09*Math.sin(9*a+3*c+k)*Math.cos(7*c-5*b)+.05*Math.sin(16*b+5*a);
      pos.setXYZ(i,x+a*r*(1+wave),y+b*h*(1+wave),z+c*r*(1+wave));
      const tone=.85+b*.16+wave;
      colors.push(tone*.87,tone,tone*.72);
    }
    geo.setAttribute('color',new T.Float32BufferAttribute(colors,3));
    return geo;
  });
  const merged=mergeGeometries(parts); parts.forEach(part=>part.dispose());
  return merged;
}
function plantings(coords, ground) {
  const limit=420, group=new T.Group();
  const wood=new T.MeshStandardMaterial({color:0x72634e,roughness:1});
  const leaves=new T.MeshStandardMaterial({vertexColors:true,color:0xffffff,roughness:.97});
  const trunk=new T.InstancedMesh(new T.CylinderGeometry(.13,.24,3.4,7).translate(0,1.7,0),wood,limit);
  const crown=new T.InstancedMesh(crownShape(),leaves,limit);
  const transform=new T.Object3D(), tint=new T.Color();
  const foliage=leafyFringe();
  const fringe=new T.InstancedMesh(foliage.geom,foliage.material,100);
  group.add(trunk,crown,fringe);
  for(const batch of group.children){batch.count=0; batch.castShadow=true;batch.receiveShadow=true;batch.frustumCulled=false;}
  fringe.castShadow=false;
  let sector='';
  function update(x,z) {
    const key=Math.round(x/26)+','+Math.round(z/26);
    if(sector===key)return;
    sector=key;
    const near=[];
    for(let i=0;i<coords.length;i+=2){
      const dx=coords[i]-x,dz=coords[i+1]-z,d=dx*dx+dz*dz;
      if(d<240*240) near.push([d,coords[i],coords[i+1]]);
    }
    near.sort((a,b)=>a[0]-b[0]);
    crown.count=trunk.count=Math.min(near.length,limit);
    fringe.count=Math.min(near.filter(p=>p[0]<85*85).length,100);
    for(let i=0;i<crown.count;i++){
      const [,px,pz]=near[i], seed=Math.abs(Math.sin(px*12.9898+pz*78.233)*43758.5453)%1;
      transform.position.set(px,ground(px,pz)-.1,pz); transform.rotation.y=seed*6.28;
      transform.scale.set(.82+seed*.58,.89+seed*.52,.87+seed*.48);transform.updateMatrix();
      trunk.setMatrixAt(i,transform.matrix);crown.setMatrixAt(i,transform.matrix);
      tint.setHSL(.228+seed*.038,.26+seed*.12,.32+seed*.10,T.SRGBColorSpace);crown.setColorAt(i,tint);
      if(i<fringe.count){fringe.setMatrixAt(i,transform.matrix);fringe.setColorAt(i,tint.clone().multiplyScalar(1.6));}
    }
    trunk.instanceMatrix.needsUpdate=crown.instanceMatrix.needsUpdate=true;
    fringe.instanceMatrix.needsUpdate=true;
    if(fringe.instanceColor)fringe.instanceColor.needsUpdate=true;
    if(crown.instanceColor)crown.instanceColor.needsUpdate=true;
  }
  return {group,update};
}
export async function createCloseScene({scene,renderer,surface,buildings,ground,signal,data}) {
  const [imageResp,treeResp]=await Promise.all([fetch(groundUrl,{signal}),fetch(canopyUrl,{signal})]);
  if(!imageResp.ok||!treeResp.ok)throw Error('近景资料暂未载入');
  const [bitmap,trees]=await Promise.all([imageResp.blob().then(blob=>createImageBitmap(blob)),treeResp.arrayBuffer()]);
  if(signal.aborted){bitmap.close();throw new DOMException('Aborted','AbortError');}
  const cover=new T.Texture(bitmap);cover.flipY=false;cover.needsUpdate=true;
  const modelFloor=groundMaterial(cover),modelWalls=facadeMaterial(),originalFloor=surface.material;
  const originalWall=buildings.userData.wall;
  const group=new T.Group();group.visible=false;scene.add(group);
  const sky=new T.HemisphereLight(0xf2f7ff,0xc4ae86,1.32);
  const sun=new T.DirectionalLight(0xffedd1,2.32);
  sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);
  Object.assign(sun.shadow.camera,{left:-120,right:120,top:120,bottom:-120,near:5,far:540});
  sun.shadow.camera.updateProjectionMatrix();sun.shadow.bias=-.00045;sun.shadow.normalBias=.18;
  const plants=plantings(new Int16Array(trees),ground);
  const labels=createRoadLabels(data.labels,ground);
  group.add(sky,sun,sun.target,plants.group,labels.group);
  const curb=new T.MeshStandardMaterial({color:0xbcb8ac,side:T.DoubleSide});
  group.add(roadSurface(data.streets,data.streetWidths,.45,.12,ground,curb),roadSurface(data.streets,data.streetWidths,0,.19,ground,roadMaterial(false)),roadSurface(data.paths,data.pathWidths,0,.23,ground,roadMaterial(true)));
  const originalSky=scene.background;
  let enabled=false;
  function building(mesh){if(enabled){prepareFacade(mesh.geometry);mesh.material=modelWalls;mesh.castShadow=mesh.receiveShadow=true;}}
  function update(on,target){
    if(on!==enabled){
      enabled=on;group.visible=on;surface.receiveShadow=on;
      renderer.shadowMap.enabled=on;renderer.shadowMap.autoUpdate=false;
      surface.material=on?modelFloor:originalFloor;
      scene.background=on?new T.Color(0xdce8e5):originalSky;
      for(const mesh of buildings.children){
        if(on)building(mesh);
        else{mesh.material=originalWall;mesh.castShadow=mesh.receiveShadow=false;}
      }
    }
    if(on){
      labels.update(target.x,target.z);
      plants.update(target.x,target.z);sun.target.position.copy(target);
      sun.position.copy(target).add(new T.Vector3(-95,155,80));
      renderer.shadowMap.needsUpdate=true;
    }
  }
  function dispose(){
    scene.remove(group);const materials=new Set([modelFloor,modelWalls]);
    group.traverse(obj=>{if(obj.geometry)obj.geometry.dispose();if(obj.material)materials.add(obj.material);if(obj.isInstancedMesh)obj.dispose();});
    materials.forEach(m=>{m.map?.dispose();m.dispose();});sun.shadow.dispose();cover.dispose();bitmap.close();
  }
  return {update,building,dispose};
}
