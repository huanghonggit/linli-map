import * as T from "three";

export const LIGHTING_PRESETS = {
  day: {
    id: "day",
    label: "晴日实景",
    sunDir: new T.Vector3(-0.56, 0.73, 0.39).normalize(),
    sunColor: new T.Color("#fff7e8"),
    skyZenith: new T.Color("#5c90c9"),
    skyHorizon: new T.Color("#cde0ec"),
    groundBounce: new T.Color("#8b8d7e"),
    fogColor: new T.Color("#c8dbe6"),
    fogDensity: 0.000048,
    sunStrength: 0.42,
    ambientStrength: 0.74,
  },
  golden: {
    id: "golden",
    label: "暖阳黄昏",
    sunDir: new T.Vector3(-0.78, 0.36, 0.51).normalize(),
    sunColor: new T.Color("#ffcf92"),
    skyZenith: new T.Color("#496ea0"),
    skyHorizon: new T.Color("#e8c8a5"),
    groundBounce: new T.Color("#8e7b6a"),
    fogColor: new T.Color("#dec7ad"),
    fogDensity: 0.000055,
    sunStrength: 0.55,
    ambientStrength: 0.64,
  },
  clear: {
    id: "clear",
    label: "柔和清晰",
    sunDir: new T.Vector3(-0.35, 0.88, 0.32).normalize(),
    sunColor: new T.Color("#ffffff"),
    skyZenith: new T.Color("#7ea5c4"),
    skyHorizon: new T.Color("#d8e3e8"),
    groundBounce: new T.Color("#9b9e95"),
    fogColor: new T.Color("#d3e0e5"),
    fogDensity: 0.000032,
    sunStrength: 0.28,
    ambientStrength: 0.84,
  },
};

export function createAtmosphereUniforms(presetKey = "day") {
  const p = LIGHTING_PRESETS[presetKey] || LIGHTING_PRESETS.day;
  return {
    sunDir: { value: p.sunDir.clone() },
    sunColor: { value: p.sunColor.clone() },
    skyZenith: { value: p.skyZenith.clone() },
    skyHorizon: { value: p.skyHorizon.clone() },
    groundBounce: { value: p.groundBounce.clone() },
    fogColor: { value: p.fogColor.clone() },
    fogDensity: { value: p.fogDensity },
    sunStrength: { value: p.sunStrength },
    ambientStrength: { value: p.ambientStrength },
  };
}

export function applyLightingPreset(uniforms, presetKey) {
  const p = LIGHTING_PRESETS[presetKey] || LIGHTING_PRESETS.day;
  uniforms.sunDir.value.copy(p.sunDir);
  uniforms.sunColor.value.copy(p.sunColor);
  uniforms.skyZenith.value.copy(p.skyZenith);
  uniforms.skyHorizon.value.copy(p.skyHorizon);
  uniforms.groundBounce.value.copy(p.groundBounce);
  uniforms.fogColor.value.copy(p.fogColor);
  uniforms.fogDensity.value = p.fogDensity;
  uniforms.sunStrength.value = p.sunStrength;
  uniforms.ambientStrength.value = p.ambientStrength;
  return p;
}

export function createSkyDome(uniforms, radius = 62000) {
  const geo = new T.SphereGeometry(radius, 32, 20);
  const mat = new T.ShaderMaterial({
    uniforms: {
      sunDir: uniforms.sunDir,
      sunColor: uniforms.sunColor,
      skyZenith: uniforms.skyZenith,
      skyHorizon: uniforms.skyHorizon,
    },
    side: T.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 sunDir;
      uniform vec3 sunColor;
      uniform vec3 skyZenith;
      uniform vec3 skyHorizon;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        // Rayleigh vertical gradient + warm horizon scattering band
        vec3 sky = mix(skyHorizon, skyZenith, pow(h, 0.56));
        float sunAmt = max(dot(d, normalize(sunDir)), 0.0);
        sky += sunColor * (pow(sunAmt, 10.0) * 0.16 + pow(sunAmt, 140.0) * 0.45);
        // Subtle lower haze below horizon so steep pans never expose a sharp seam
        if (d.y < 0.0) {
          sky = mix(skyHorizon, skyHorizon * 0.86, clamp(-d.y * 4.0, 0.0, 1.0));
        }
        gl_FragColor = vec4(sky, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new T.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

const COMMON_GLSL = `
  float hash12(vec2 p) {
    vec3 h = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    h += dot(h, h.yzx + 33.33);
    return fract((h.x + h.y) * h.z);
  }
  float stripeAA(float x, float period, float width) {
    float aa = max(fwidth(x), 0.006);
    float dist = abs(fract(x / period + 0.5) - 0.5) * period;
    float edge = 1.0 - smoothstep(width * 0.5 - aa, width * 0.5 + aa, dist);
    return edge * (1.0 - smoothstep(period * 0.28, period * 0.78, aa));
  }
  vec3 sampleSatellite(
    vec2 xz,
    float halfWidth,
    sampler2D baseMap,
    sampler2D prevDetailMap,
    vec4 prevDetailRect,
    sampler2D detailMap,
    vec4 detailRect
  ) {
    vec2 uv = xz / (2.0 * halfWidth) + 0.5;
    vec3 col = texture2D(baseMap, clamp(uv, 0.001, 0.999)).rgb;
    if (prevDetailRect.z > 0.0) {
      vec2 qp = (xz - prevDetailRect.xy) / prevDetailRect.zw;
      if (all(greaterThanEqual(qp, vec2(0.0))) && all(lessThanEqual(qp, vec2(1.0)))) {
        vec4 prevHi = texture2D(prevDetailMap, qp);
        vec2 edge = smoothstep(vec2(0.0), vec2(0.05), qp) * smoothstep(vec2(0.0), vec2(0.05), 1.0 - qp);
        col = mix(col, prevHi.rgb, prevHi.a * edge.x * edge.y);
      }
    }
    if (detailRect.z > 0.0) {
      vec2 q = (xz - detailRect.xy) / detailRect.zw;
      if (all(greaterThanEqual(q, vec2(0.0))) && all(lessThanEqual(q, vec2(1.0)))) {
        vec4 hi = texture2D(detailMap, q);
        vec2 edge = smoothstep(vec2(0.0), vec2(0.045), q) * smoothstep(vec2(0.0), vec2(0.045), 1.0 - q);
        col = mix(col, hi.rgb, hi.a * edge.x * edge.y);
      }
    }
    return col;
  }
  vec3 applyAtmosphere(vec3 col, float dist, float y, vec3 fogColor, float fogDensity, vec3 viewDir, vec3 sunDir, vec3 sunColor) {
    float effDist = max(0.0, dist - 850.0);
    float heightFactor = exp(-max(0.0, y) * 0.0015);
    float fogAmt = 1.0 - exp(-effDist * fogDensity * heightFactor);
    fogAmt = clamp(fogAmt, 0.0, 0.72);
    float sunGlow = pow(max(dot(-viewDir, normalize(sunDir)), 0.0), 6.0) * 0.14;
    vec3 horizonMix = mix(fogColor, sunColor, sunGlow);
    return mix(col, horizonMix, fogAmt);
  }
`;

export function createRealisticTerrainMaterial(uniforms) {
  return new T.ShaderMaterial({
    uniforms,
    side: T.FrontSide,
    vertexShader: `
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      void main() {
        vWorldPos = position;
        vNormal = normalize(normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D baseMap;
      uniform sampler2D prevDetailMap;
      uniform vec4 prevDetailRect;
      uniform sampler2D detailMap;
      uniform vec4 detailRect;
      uniform float halfWidth;
      uniform vec3 sunDir;
      uniform vec3 sunColor;
      uniform vec3 skyHorizon;
      uniform vec3 fogColor;
      uniform float fogDensity;
      uniform float sunStrength;
      uniform float ambientStrength;
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      ${COMMON_GLSL}
      void main() {
        vec3 col = sampleSatellite(
          vWorldPos.xz,
          halfWidth,
          baseMap,
          prevDetailMap,
          prevDetailRect,
          detailMap,
          detailRect
        );
        vec3 N = normalize(vNormal);
        vec3 L = normalize(sunDir);
        vec3 V = normalize(cameraPosition - vWorldPos);
        float dist = length(cameraPosition - vWorldPos);

        // Subtle topographic hillshading brings hills & embankments to life without darkening flat streets.
        float ndl = dot(N, L);
        float slope = 1.0 - clamp(N.y, 0.0, 1.0);
        float shade = mix(1.0, ambientStrength + sunStrength * (0.5 + 0.5 * ndl), clamp(slope * 4.5 + 0.18, 0.0, 1.0));
        vec3 tint = mix(vec3(0.95, 0.98, 1.03), mix(vec3(1.0), sunColor, 0.35), clamp(ndl * 0.5 + 0.5, 0.0, 1.0));
        col *= shade * tint;

        // Subtle micro-texture grain when zoomed closely into ground imagery.
        float closeBlend = 1.0 - smoothstep(140.0, 460.0, dist);
        if (closeBlend > 0.01) {
          float micro = (hash12(floor(vWorldPos.xz * 2.2)) - 0.5) * 0.045 * closeBlend;
          col *= (1.0 + micro);
        }

        // Gentle water specular glint on flat lakes & rivers without amplifying imagery seam differences.
        float waterMask = smoothstep(0.015, 0.08, (col.b + col.g * 0.5) - col.r * 1.45)
          * (1.0 - smoothstep(0.18, 0.34, max(col.r, max(col.g, col.b))))
          * smoothstep(0.992, 0.9995, N.y);
        if (waterMask > 0.02) {
          vec3 rippleN = normalize(vec3(
            (hash12(floor(vWorldPos.xz * 0.32)) - 0.5) * 0.04,
            1.0,
            (hash12(floor(vWorldPos.xz * 0.32 + 17.3)) - 0.5) * 0.04
          ));
          float fresnel = pow(1.0 - max(dot(V, rippleN), 0.0), 3.6);
          vec3 H = normalize(L + V);
          float spec = pow(max(dot(rippleN, H), 0.0), 72.0) * 0.24;
          col = mix(col, mix(col, skyHorizon * 0.65, fresnel * 0.28) + sunColor * spec, waterMask * 0.55);
        }

        // Gentle contrast & vibrance boost to match natural daytime outdoor vision.
        float lum = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(vec3(lum), col, 1.08);
        col = applyAtmosphere(col, dist, vWorldPos.y, fogColor, fogDensity, V, L, sunColor);

        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

export function createRealisticBuildingMaterial(uniforms) {
  return new T.ShaderMaterial({
    uniforms,
    side: T.DoubleSide,
    vertexShader: `
      attribute vec2 limits;
      varying vec3 vWorldPos;
      varying vec2 vLimits;
      void main() {
        vWorldPos = position;
        vLimits = limits;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D baseMap;
      uniform sampler2D prevDetailMap;
      uniform vec4 prevDetailRect;
      uniform sampler2D detailMap;
      uniform vec4 detailRect;
      uniform float halfWidth;
      uniform vec3 sunDir;
      uniform vec3 sunColor;
      uniform vec3 skyZenith;
      uniform vec3 skyHorizon;
      uniform vec3 groundBounce;
      uniform vec3 fogColor;
      uniform float fogDensity;
      uniform float sunStrength;
      uniform float ambientStrength;
      varying vec3 vWorldPos;
      varying vec2 vLimits;
      ${COMMON_GLSL}
      void main() {
        vec3 satCol = sampleSatellite(
          vWorldPos.xz,
          halfWidth,
          baseMap,
          prevDetailMap,
          prevDetailRect,
          detailMap,
          detailRect
        );
        vec3 N = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
        if (!gl_FrontFacing) N = -N;
        vec3 L = normalize(sunDir);
        vec3 V = normalize(cameraPosition - vWorldPos);
        float dist = length(cameraPosition - vWorldPos);

        float baseH = vLimits.x;
        float roofH = vLimits.y;
        float totalH = max(roofH - baseH, 2.5);
        float relY = clamp(vWorldPos.y - baseH, 0.0, totalH);
        float ndl = max(dot(N, L), 0.0);
        float hemi = 0.5 + 0.5 * N.y;
        vec3 envLight = mix(groundBounce, skyHorizon, hemi) * ambientStrength;
        vec3 directLight = sunColor * ndl * (sunStrength * 1.45);

        vec3 col;
        if (abs(N.y) > 0.38) {
          // Flat or pitched roof: fuse authentic satellite roof coloration with architectural texture & lighting.
          bool pitched = abs(N.y) < 0.88;
          if (pitched) {
            float tileLines = stripeAA(vWorldPos.x + vWorldPos.z, 0.75, 0.06);
            vec3 clayRoof = mix(satCol, vec3(0.46, 0.27, 0.21), 0.42);
            clayRoof *= (1.0 - 0.14 * tileLines);
            col = clayRoof * (envLight * 0.92 + directLight * 1.15);
          } else {
            float roofGrid = max(stripeAA(vWorldPos.x, 4.5, 0.05), stripeAA(vWorldPos.z, 4.5, 0.05));
            float detailFade = 1.0 - smoothstep(260.0, 900.0, dist);
            vec3 roofBase = mix(satCol, satCol * 0.92 + vec3(0.06, 0.062, 0.065), 0.22);
            roofBase *= (1.0 - 0.09 * roofGrid * detailFade);
            col = roofBase * (envLight + directLight * 0.92);
          }
        } else {
          // Architectural procedural facade tailored by real building height & satellite wall-tone cue.
          vec2 tangent = normalize(vec2(N.z, -N.x));
          if (tangent.x < -0.001 || (abs(tangent.x) < 0.001 && tangent.y < 0.0)) tangent = -tangent;
          float u = dot(vWorldPos.xz, tangent);
          float bldSeed = hash12(floor(vec2(baseH * 1.7, totalH * 3.1) + floor(vWorldPos.xz / 28.0)));

          float isTower = smoothstep(42.0, 68.0, totalH);
          float isMidRise = smoothstep(14.0, 24.0, totalH) * (1.0 - isTower);

          // Floor-to-floor spacing (3.4m commercial towers, 3.05m residential)
          float floorHeight = mix(3.05, 3.55, isTower);
          float floors = max(1.0, floor(totalH / floorHeight + 0.5));
          float v = relY * floors / totalH;
          float bayWidth = mix(3.1, 2.4, isTower);
          vec2 bay = vec2(u / bayWidth, v);
          vec2 f = fract(bay);
          vec2 aa = clamp(fwidth(bay), vec2(0.003), vec2(0.18));

          // Fade fine windows smoothly at far range to avoid moire shimmer.
          float lod = 1.0 - smoothstep(650.0, 2200.0, dist);

          // Wall base palette derived from natural Chinese urban facades + subtle satellite tint harmonization
          vec3 lowTone = mix(vec3(0.76, 0.72, 0.65), vec3(0.68, 0.63, 0.57), bldSeed);
          vec3 midTone = mix(vec3(0.80, 0.78, 0.73), vec3(0.71, 0.72, 0.70), bldSeed);
          vec3 towerTone = mix(vec3(0.45, 0.52, 0.58), vec3(0.32, 0.39, 0.46), bldSeed);
          vec3 wallBase = mix(mix(lowTone, midTone, isMidRise), towerTone, isTower);
          wallBase = mix(wallBase, satCol * 1.08 + vec3(0.18), 0.16);

          // Ground-floor podium / street-level shopfront band (0..3.7m)
          float podium = 1.0 - smoothstep(3.2, 3.9, relY);
          vec3 podiumCol = mix(vec3(0.34, 0.33, 0.31), vec3(0.46, 0.43, 0.39), bldSeed);
          wallBase = mix(wallBase, podiumCol, podium * 0.72);

          // Horizontal slab / balcony banding
          float slabShadow = stripeAA(v + 0.03, 1.0, mix(0.08, 0.12, isTower));
          wallBase *= (1.0 - 0.17 * slabShadow * lod);

          // Window opening geometry
          vec2 winMin = mix(vec2(0.18, 0.24), vec2(0.07, 0.14), isTower);
          vec2 winMax = mix(vec2(0.82, 0.84), vec2(0.93, 0.90), isTower);
          vec2 opening = smoothstep(winMin - aa, winMin + aa, f) * (1.0 - smoothstep(winMax - aa, winMax + aa, f));
          float winMask = opening.x * opening.y
            * (1.0 - smoothstep(totalH - 0.55, totalH - 0.2, relY))
            * smoothstep(0.65, 1.35, relY)
            * lod;

          // Glass color with sky reflection, subtle interior variation & specular sun glint
          float cellVar = hash12(floor(bay) + floor(bldSeed * 19.0));
          float fresnel = pow(1.0 - max(dot(V, N), 0.0), 2.5);
          vec3 skyRefl = mix(skyHorizon, skyZenith, clamp(f.y * 0.7 + 0.2, 0.0, 1.0));
          vec3 interior = mix(vec3(0.11, 0.16, 0.20), vec3(0.28, 0.33, 0.35), cellVar);
          vec3 glassCol = mix(interior, skyRefl * 0.78, mix(0.38, 0.68, isTower) + fresnel * 0.25);
          // Upper curtain / blinds shade inside window
          glassCol *= mix(1.0, 0.58, smoothstep(0.72, 0.86, f.y));
          // Mullion frame
          float mullion = max(stripeAA(u - bayWidth * 0.5, bayWidth, 0.07), stripeAA(v - 0.56, 1.0, 0.03));
          glassCol = mix(glassCol, vec3(0.32, 0.35, 0.36), mullion * 0.7);

          vec3 albedo = mix(wallBase, glassCol, winMask);
          // Roof parapet coping band along the top 0.45m of wall
          float parapet = 1.0 - smoothstep(0.22, 0.48, totalH - relY);
          albedo = mix(albedo, vec3(0.62, 0.63, 0.61), parapet * 0.55);

          // Ground contact ambient occlusion anchors buildings realistically onto streets
          float groundAO = mix(0.66, 1.0, smoothstep(0.0, 3.8, relY));
          // Vertical orientation shading & solar specular on glass
          vec3 H = normalize(L + V);
          float glassSpec = pow(max(dot(N, H), 0.0), 42.0) * winMask * mix(0.22, 0.65, isTower);

          col = albedo * (envLight + directLight) * groundAO + sunColor * glassSpec;
        }

        col = applyAtmosphere(col, dist, vWorldPos.y, fogColor, fogDensity, V, L, sunColor);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}
