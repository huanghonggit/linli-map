import * as T from 'three';

// Varying distances are in local metres, so details remain crisp through zoom and rotation.
const detailFunctions = `
  varying vec3 localPoint;
  float noiseCell(vec2 p) {
    vec3 h=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));
    h+=dot(h,h.yzx+33.33);
    return fract((h.x+h.y)*h.z);
  }
  float stripe(float x,float period,float width) {
    float aa=max(fwidth(x),.005);
    return (1.-smoothstep(width*.5-aa,width*.5+aa,abs(fract(x/period+.5)-.5)*period))*(1.-smoothstep(period*.25,period*.8,aa));
  }
`;
function surface(color, finish, body, uniforms = {}) {
  const material = new T.MeshStandardMaterial({color, roughness: .85, flatShading: true, side:T.DoubleSide});
  material.customProgramCacheKey = () => finish;
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    const building = finish === 'facades';
    shader.vertexShader = 'varying vec3 localPoint;\n' + (building ? 'attribute vec2 limits; varying vec2 limitsHere;\n' : '') + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nlocalPoint=position;'+(building ? 'limitsHere=limits;' : ''));
    shader.fragmentShader = detailFunctions + (building ? 'varying vec2 limitsHere;\n' : '') + (finish === 'ground' ? 'uniform sampler2D groundCover;\n' : '') + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + body);
  };
  return material;
}
export function facadeMaterial() {
  return surface(0xffffff, 'facades', `
    vec3 n=normalize(cross(dFdx(localPoint),dFdy(localPoint)));
    float h=max(limitsHere.y-limitsHere.x,.5), y=clamp(localPoint.y-limitsHere.x,0.,h);
    if(abs(n.y)>.68){
      float seam=max(stripe(localPoint.x,3.2,.035),stripe(localPoint.z,4.6,.035));
      diffuseColor.rgb=mix(vec3(.34,.36,.35),vec3(.23,.25,.25),seam);
    }else{
      vec2 tangent=normalize(vec2(n.z,-n.x));
      if(tangent.x<-.001 || (abs(tangent.x)<.001 && tangent.y<0.)) tangent=-tangent;
      float u=dot(localPoint.xz,tangent);
      float floors=max(1.,floor(h/3.05+.5)), v=y*floors/h;
      vec2 bay=vec2(u/3.12,v), f=fract(bay);
      vec2 aa=clamp(fwidth(bay),vec2(.002),vec2(.13));
      vec2 opening=smoothstep(vec2(.16,.26)-aa,vec2(.16,.26)+aa,f)*(1.-smoothstep(vec2(.84,.85)-aa,vec2(.84,.85)+aa,f));
      float window=opening.x*opening.y*(1.-smoothstep(h-.35,h-.17,y))*smoothstep(.55,1.1,y);
      float variation=noiseCell(floor(bay));
      vec3 plaster=mix(vec3(.65,.57,.45),vec3(.82,.76,.65),smoothstep(0.,4.,y));
      plaster*=1.-.15*stripe(v+.025,1.,.065);
      vec3 glass=mix(vec3(.067,.13,.16),vec3(.30,.43,.47),f.y*.55+variation*.45);
      glass*=mix(1.,.45,smoothstep(.77,.85,f.y));
      float frame=max(stripe(u-1.56,3.12,.075),stripe(v-.64,1.,.025));
      glass=mix(glass,vec3(.37,.38,.35),frame);
      diffuseColor.rgb=mix(plaster,glass,window);
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.56,.58,.54),1.-smoothstep(.19,.32,h-y));
    }
  `);
}
export function groundMaterial(texture) {
  return surface(0xffffff, 'ground', `
    vec2 p=localPoint.xz;
    vec3 land=texture2D(groundCover,p/10800.+.5).rgb;
    vec2 scaled=p*2.7;
    vec2 cell=floor(scaled), blend=fract(scaled); blend=blend*blend*(3.-2.*blend);
    float grain=mix(mix(noiseCell(cell),noiseCell(cell+vec2(1.,0.)),blend.x),mix(noiseCell(cell+vec2(0.,1.)),noiseCell(cell+1.),blend.x),blend.y)-.5;
    float speckle=(noiseCell(floor(p*16.))-.5)*(1.-smoothstep(.035,.12,max(fwidth(p.x),fwidth(p.y))));
    vec3 stone=mix(vec3(.42,.40,.34),vec3(.59,.56,.48),land.b);
    vec3 grass=mix(vec3(.105,.193,.072),vec3(.32,.414,.178),land.b);
    vec3 ground=mix(stone,grass,smoothstep(.065,.46,land.r));
    diffuseColor.rgb=mix(ground,vec3(.105,.245,.24),land.g)*(1.+.18*grain+.12*speckle);
  `,{groundCover:{value:texture}});
}
export function roadMaterial(path) {
  return surface(0xffffff,path?'footpaths':'roads',path ? `
    vec2 p=localPoint.xz; float seam=max(stripe(p.x,.9,.025),stripe(p.y,.6,.025));
    diffuseColor.rgb=mix(vec3(.56,.50,.40),vec3(.37,.35,.29),seam);
  ` : `
    vec2 p=localPoint.xz; float grain=(noiseCell(floor(p*8.))-.5)*(1.-smoothstep(.06,.19,max(fwidth(p.x),fwidth(p.y))));
    diffuseColor.rgb=vec3(.22,.239,.242)*(1.+.13*grain);
  `);
}

// Pair vertical endpoints using the two real vertices on a wall triangle's upright edge.
export function prepareFacade(geo) {
  if (geo.hasAttribute('limits')) return;
  const pos=geo.attributes.position, ids=geo.index.array;
  const bounds=new Float32Array(pos.count*2);
  for(let i=0;i<ids.length;i+=3){
    for(let k=0;k<3;k++){
      const a=ids[i+k],b=ids[i+(k+1)%3];
      if(pos.getX(a)!==pos.getX(b)||pos.getZ(a)!==pos.getZ(b)||pos.getY(a)===pos.getY(b))continue;
      const lo=Math.min(pos.getY(a),pos.getY(b)),hi=Math.max(pos.getY(a),pos.getY(b));
      bounds[a*2]=bounds[b*2]=lo;
      bounds[a*2+1]=bounds[b*2+1]=hi;
    }
  }
  geo.setAttribute('limits',new T.BufferAttribute(bounds,2));
  geo.computeVertexNormals();
}
