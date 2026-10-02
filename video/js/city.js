// Procedural night city: a harbour skyline that grows out of a network,
// robotaxi traffic on the streets and UAV corridors in the air.
// Every visual is a pure function of time (uTime), so any frame can be
// rendered on demand for frame-accurate video capture.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mulberry32, clamp, lerp, smooth, prog, easeInOutCubic } from './util.js';

const PITCH = 24;          // block pitch (block + road)
const ROAD = 6;            // road width
const HALF = 22;           // blocks from -HALF .. HALF-1 in each direction
const CORE = 360;          // radius of the dense city
const CBD = new THREE.Vector2(-30, -40);

// Waterfront along the south edge. Mirrored in GLSL (ground shader).
const shore = (x) => 150 + 26 * Math.sin(x * 0.011 + 0.6) + 12 * Math.sin(x * 0.029 + 2.1);
const SHORE_GLSL = `float shore(float x){ return 150.0 + 26.0*sin(x*0.011+0.6) + 12.0*sin(x*0.029+2.1); }`;

const HASH_GLSL = `
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }`;

const FOG_GLSL = `
float fogFactor(float d){ float f = d*uFogDensity; return 1.0 - exp(-f*f); }`;

// Sky colour as a function of view direction; also used as the fog colour so
// distant ground melts into the horizon without a seam.
const SKY_GLSL = `
uniform vec3 uZenith, uHorizon, uGlow, uGlowDir;
vec3 skyCol(vec3 d){
  float h = d.y;
  vec3 c = mix(uHorizon, uZenith, smoothstep(0.0, 0.42, max(h, 0.0)));
  float az = max(dot(normalize(vec3(d.x, 0.0, d.z) + 1e-5), uGlowDir), 0.0);
  c += uGlow * pow(az, 4.0) * exp(-abs(h) * 9.0) * 0.38;
  return c;
}`;

const col = (hex) => new THREE.Color(hex);

export class City {
  constructor(canvas, { width = 1920, height = 1080, pixelRatio = 1 } = {}) {
    this.width = width;
    this.height = height;
    const renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(48, width / height, 1, 9000);
    this.rng = mulberry32(20270801);

    this.u = {
      uTime: { value: 0 },
      uFog: { value: col('#17223a') },
      uFogDensity: { value: 0.00105 },
      uPR: { value: pixelRatio * (height / 1080) },
      uZenith: { value: col('#050a14') },
      uHorizon: { value: col('#1a2640') },
      uGlow: { value: col('#b8693d') },
      uGlowDir: { value: new THREE.Vector3(-0.55, 0, -0.83).normalize() },
    };

    this.buildSky();
    this.buildStars();
    this.buildGround();
    this.buildBuildings();
    this.buildRoads();
    this.buildTraffic();
    this.buildNetwork();
    this.buildDrones();
    this.buildCameraPath();

    const rt = new THREE.WebGLRenderTarget(width * pixelRatio, height * pixelRatio, {
      type: THREE.HalfFloatType, samples: 4,
    });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.7, 0.35, 0.32);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  // ───────────────────────────────────────────────────────────── sky
  buildSky() {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { ...this.u },
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `
        varying vec3 vDir;
        ${SKY_GLSL}
        void main(){ gl_FragColor = vec4(skyCol(normalize(vDir)), 1.0); }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 32, 16), mat);
    this.sky.renderOrder = -2;
    this.scene.add(this.sky);
  }

  buildStars() {
    const rng = mulberry32(77);
    const n = 520, pos = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const th = rng() * Math.PI * 2, y = 0.12 + Math.pow(rng(), 0.7) * 0.88;
      const r = Math.sqrt(1 - y * y);
      pos.set([Math.cos(th) * r * 4500, y * 4500, Math.sin(th) * r * 4500], i * 3);
      seed[i] = rng();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: this.u.uTime, uPR: this.u.uPR },
      vertexShader: `
        attribute float aSeed; uniform float uTime, uPR; varying float vA;
        void main(){
          vA = (0.25 + 0.55*aSeed) * (0.75 + 0.25*sin(uTime*1.3 + aSeed*40.0));
          gl_PointSize = (1.2 + 1.6*aSeed) * uPR;
          gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);
        }`,
      fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord-0.5); gl_FragColor = vec4(vec3(0.75,0.82,1.0)*vA*smoothstep(0.5,0.1,d), 1.0); }`,
    });
    this.stars = new THREE.Points(g, mat);
    this.stars.renderOrder = -1;
    this.scene.add(this.stars);
  }

  // ─────────────────────────────────────────────────────────── ground
  buildGround() {
    const g = new THREE.PlaneGeometry(9000, 9000, 1, 1);
    g.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        ...this.u,
        uLand: { value: col('#09111f') },
        uWater: { value: col('#050b16') },
        uShoreGlow: { value: col('#f2b33d') },
        uReflect: { value: col('#ffc277') },
        uReveal: { value: 0 },
      },
      vertexShader: `
        varying vec3 vW; varying float vDepth;
        void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; vec4 mv = viewMatrix*w; vDepth = -mv.z; gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `
        uniform vec3 uLand, uWater, uShoreGlow, uReflect, uFog; uniform float uFogDensity, uTime, uReveal;
        varying vec3 vW; varying float vDepth;
        ${SHORE_GLSL}${HASH_GLSL}${FOG_GLSL}${SKY_GLSL}
        void main(){
          float s = shore(vW.x);
          float dz = vW.z - s;
          float water = smoothstep(-1.5, 1.5, dz);
          vec3 c = mix(uLand, uWater, water);
          // promenade lights along the waterfront
          c += uShoreGlow * exp(-abs(dz)*0.45) * 0.35 * uReveal;
          // skyline glow reflected on the harbour: soft, continuous shimmer
          if (dz > 0.0) {
            float band = 0.5 + 0.5 * sin(vW.x * 0.045 + 1.3) * sin(vW.x * 0.013 + 0.4);
            float ripple = 0.75 + 0.25 * sin(vW.z * 0.22 - uTime * 1.2 + vW.x * 0.03);
            c += uReflect * band * ripple * exp(-dz * 0.02) * 0.05 * uReveal * smoothstep(700.0, 200.0, abs(vW.x));
          }
          c = mix(c, skyCol(normalize(vW - cameraPosition)), fogFactor(vDepth));
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.groundMat = mat;
    this.scene.add(new THREE.Mesh(g, mat));
  }

  // ───────────────────────────────────────────────────────── buildings
  buildBuildings() {
    const rng = this.rng;
    const P = [], S = [], M = [], C = [];   // pos, size, meta(seed, delay, baseY, totalH), crown
    const tall = [];
    const push = (x, z, w, d, base, h, total, seed, delay, crown) => {
      P.push(x, 0, z); S.push(w, h, d); M.push(seed, delay, base, total); C.push(crown);
    };

    for (let i = -HALF; i < HALF; i++) {
      for (let j = -HALF; j < HALF; j++) {
        const cx = (i + 0.5) * PITCH, cz = (j + 0.5) * PITCH;
        if (cz + PITCH / 2 > shore(cx) - 5) continue;           // harbour
        const r = Math.hypot(cx, cz);
        if (r > CORE && rng() < clamp((r - CORE) / 260)) continue; // thin out to suburbs
        if (rng() < 0.05) continue;                             // plazas / parks

        const dC = Math.hypot(cx - CBD.x, cz - CBD.y);
        const cbd = Math.exp(-Math.pow(dC / 150, 2));
        const second = 0.62 * Math.exp(-Math.pow(Math.hypot(cx - 230, cz + 170) / 95, 2));
        const front = clamp(1 - (shore(cx) - cz) / 90) * 0.35 * Math.exp(-Math.pow(cx / 320, 2));
        const outer = clamp(1 - (r - CORE) / 300, 0.15, 1);
        const blockH = (4 + rng() * 9) * outer + (cbd * 125 + second * 85 + front * 70) * Math.pow(rng(), 0.75);

        const inner = PITCH - ROAD;
        const roll = rng();
        const lots = roll < 0.28 ? [[0, 0, inner, inner]]
          : roll < 0.62 ? (rng() < 0.5
            ? [[-inner / 4, 0, inner / 2, inner], [inner / 4, 0, inner / 2, inner]]
            : [[0, -inner / 4, inner, inner / 2], [0, inner / 4, inner, inner / 2]])
            : [[-inner / 4, -inner / 4, inner / 2, inner / 2], [inner / 4, -inner / 4, inner / 2, inner / 2],
               [-inner / 4, inner / 4, inner / 2, inner / 2], [inner / 4, inner / 4, inner / 2, inner / 2]];

        for (const [ox, oz, lw, ld] of lots) {
          const m = 0.8 + rng() * 1.6;
          const w = Math.max(3, lw - m), d = Math.max(3, ld - m);
          let h = Math.max(3, blockH * (0.5 + 0.65 * rng()));
          const x = cx + ox, z = cz + oz, seed = Math.floor(rng() * 997);
          const delay = 1.55 + (Math.hypot(x, z) / 520) * 1.9 + rng() * 0.35;
          const crown = h > 55 && rng() < 0.45 ? (rng() < 0.6 ? 1 : 2) : 0;
          if (h > 60 && rng() < 0.7) {
            // stepped tower: podium + shaft (+ crown)
            const h1 = h * (0.55 + rng() * 0.15), h2 = h * (0.35 + rng() * 0.2);
            const total = h1 + h2;
            push(x, z, w, d, 0, h1, total, seed, delay, 0);
            push(x, z, w * 0.72, d * 0.72, h1, h2, total, seed + 1, delay, crown);
            tall.push({ x, z, h: total, w: Math.min(w, d) * 0.72 });
          } else {
            push(x, z, w, d, 0, h, h, seed, delay, crown);
            if (h > 50) tall.push({ x, z, h, w: Math.min(w, d) });
          }
        }
      }
    }

    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = box.index;
    geo.setAttribute('position', box.attributes.position);
    geo.setAttribute('normal', box.attributes.normal);
    geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(new Float32Array(P), 3));
    geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(new Float32Array(S), 3));
    geo.setAttribute('aMeta', new THREE.InstancedBufferAttribute(new Float32Array(M), 4));
    geo.setAttribute('aCrown', new THREE.InstancedBufferAttribute(new Float32Array(C), 1));
    geo.instanceCount = S.length / 3;

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        ...this.u,
        uBodyLow: { value: col('#070d18') },
        uBodyHigh: { value: col('#1a2740') },
        uRoof: { value: col('#0d1626') },
        uWarm: { value: col('#ffc27a') },
        uCool: { value: col('#a8ccff') },
        uOff: { value: col('#14213a') },
        uAmber: { value: col('#f2b33d') },
        uCyan: { value: col('#6fd3e8') },
        uWin: { value: 1 },
      },
      vertexShader: `
        attribute vec3 aPos; attribute vec3 aSize; attribute vec4 aMeta; attribute float aCrown;
        uniform float uTime;
        varying vec3 vLocal; varying vec3 vN; varying vec3 vSize; varying float vSeed, vH, vTopDist, vY, vLit, vDepth, vCrown, vRise;
        varying vec3 vW;
        void main(){
          float r = clamp((uTime - aMeta.y) / 1.5, 0.0, 1.0);
          r = 1.0 - pow(1.0 - r, 3.0);
          vec3 local = position * aSize;
          vec3 w = aPos + local;
          w.y = aMeta.z + local.y - (1.0 - r) * (aMeta.w + 1.0);
          vLocal = local; vN = normal; vSize = aSize; vSeed = aMeta.x;
          vH = aMeta.z + local.y; vTopDist = aSize.y - local.y; vY = w.y; vCrown = aCrown; vRise = r;
          vLit = clamp((uTime - aMeta.y - 0.6) / 1.4, 0.0, 1.0);
          vW = w;
          vec4 mv = modelViewMatrix * vec4(w, 1.0);
          vDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform float uTime, uFogDensity, uWin; uniform vec3 uFog, uBodyLow, uBodyHigh, uRoof, uWarm, uCool, uOff, uAmber, uCyan;
        varying vec3 vLocal; varying vec3 vN; varying vec3 vSize; varying float vSeed, vH, vTopDist, vY, vLit, vDepth, vCrown, vRise;
        varying vec3 vW;
        ${HASH_GLSL}${FOG_GLSL}${SKY_GLSL}
        void main(){
          if (vY < -0.02) discard;
          vec3 n = normalize(vN);
          float seed = floor(vSeed + 0.5);   // integer seed: immune to interpolation error
          float shade = 0.78 + 0.22 * dot(n, normalize(vec3(0.55, 0.35, 0.75)));
          vec3 c;
          if (n.y > 0.5) {
            c = uRoof * 1.2;
          } else {
            c = mix(uBodyLow, uBodyHigh, clamp(vH / 140.0, 0.0, 1.0)) * shade;
            bool xf = abs(n.x) > 0.5;
            float u = xf ? vLocal.z + vSize.z * 0.5 : vLocal.x + vSize.x * 0.5;
            float face = xf ? (n.x > 0.0 ? 1.0 : 2.0) : (n.z > 0.0 ? 3.0 : 4.0);
            vec2 cell = vec2(u / 1.45, vH / 1.12);
            vec2 id = floor(cell), f = fract(cell);
            vec2 fw = fwidth(cell);
            float wx = smoothstep(0.18 - fw.x, 0.18 + fw.x, f.x) * smoothstep(0.82 + fw.x, 0.82 - fw.x, f.x);
            float wy = smoothstep(0.24 - fw.y, 0.24 + fw.y, f.y) * smoothstep(0.80 + fw.y, 0.80 - fw.y, f.y);
            float win = wx * wy;
            float rnd = hash(id + vec2(seed * 3.17, face * 7.3));
            float litFrac = 0.26 * vLit;
            float lit = step(1.0 - litFrac, rnd);
            lit *= step(0.035, hash(id + floor(uTime * 0.3 + rnd * 9.0)));       // slow flicker
            vec3 wc = mix(uWarm, uCool, step(0.66, hash(id.yx + seed)));
            float bright = 0.30 + 0.55 * hash(id * 1.7 + seed);
            vec3 detail = win * (lit * wc * bright + (1.0 - lit) * uOff * 0.6);
            vec3 avg = 0.30 * (litFrac * mix(uWarm, uCool, 0.34) * 0.58 + (1.0 - litFrac) * uOff * 0.6);
            float far = clamp(max(fw.x, fw.y) * 1.6 - 0.4, 0.0, 1.0);
            c += mix(detail, avg, far) * uWin;
            // crown light strips on some towers
            float crown = smoothstep(0.9, 0.0, vTopDist) * step(0.5, vCrown);
            c += mix(uAmber, uCyan, step(1.5, vCrown)) * crown * 1.1 * vLit;
            // faint roofline edge
            c += vec3(0.06, 0.08, 0.12) * smoothstep(0.35, 0.0, vTopDist) * 0.6;
          }
          c = mix(c, skyCol(normalize(vW - cameraPosition)), fogFactor(vDepth));
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.buildingMat = mat;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    tall.sort((a, b) => b.h - a.h);
    this.tall = tall;

    // aviation lights on the tallest towers
    const top = tall.slice(0, 40);
    const lp = new Float32Array(top.length * 3), ls = new Float32Array(top.length);
    top.forEach((b, k) => { lp.set([b.x, b.h + 1.2, b.z], k * 3); ls[k] = rng(); });
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    lg.setAttribute('aSeed', new THREE.BufferAttribute(ls, 1));
    const lmat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { ...this.u, uColor: { value: col('#ff5a4a') } },
      vertexShader: `
        attribute float aSeed; uniform float uTime, uPR; varying float vA;
        void main(){
          float on = smoothstep(2.6, 3.4, uTime);
          vA = on * (0.25 + 0.75 * step(0.55, fract(uTime * 0.7 + aSeed)));
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(5200.0 / -mv.z, 2.0, 14.0) * uPR;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform vec3 uColor; varying float vA; void main(){ float d = length(gl_PointCoord-0.5); gl_FragColor = vec4(uColor * vA * smoothstep(0.5, 0.0, d) * 1.6, 1.0); }`,
    });
    this.scene.add(new THREE.Points(lg, lmat));
  }

  // ─────────────────────────────────────────────────────────── roads
  buildRoads() {
    const pos = [], meta = [];   // meta: brightness, reveal time
    const lim = HALF * PITCH;
    const seg = (x1, z1, x2, z2, b) => {
      const r1 = 0.9 + Math.hypot(x1, z1) / 420, r2 = 0.9 + Math.hypot(x2, z2) / 420;
      pos.push(x1, 0.25, z1, x2, 0.25, z2);
      meta.push(b, r1, b, r2);
    };
    for (let k = -HALF; k <= HALF; k++) {
      const x = k * PITCH, b = k % 4 === 0 ? 1 : 0.45;
      const zEnd = shore(x) - 3;
      for (let z = -lim; z < zEnd; z += PITCH) seg(x, z, x, Math.min(z + PITCH, zEnd), b);
    }
    for (let k = -HALF; k <= HALF; k++) {
      const z = k * PITCH, b = k % 4 === 0 ? 1 : 0.45;
      for (let x = -lim; x < lim; x += PITCH) {
        if (shore(x) - 3 > z && shore(x + PITCH) - 3 > z) seg(x, z, x + PITCH, z, b);
      }
    }
    // waterfront boulevard
    for (let x = -lim; x < lim; x += 8) seg(x, shore(x) - 3, x + 8, shore(x + 8) - 3, 1.1);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('aMeta', new THREE.BufferAttribute(new Float32Array(meta), 2));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { ...this.u, uColor: { value: col('#3b5784') }, uLevel: { value: 1 } },
      vertexShader: `
        attribute vec2 aMeta; uniform float uTime; varying float vA; varying float vDepth;
        void main(){
          vA = aMeta.x * smoothstep(aMeta.y, aMeta.y + 0.7, uTime) * smoothstep(540.0, 330.0, length(position.xz));
          vec4 mv = modelViewMatrix * vec4(position, 1.0); vDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uColor; uniform float uLevel, uFogDensity; varying float vA; varying float vDepth;
        ${FOG_GLSL}
        void main(){ gl_FragColor = vec4(uColor * vA * uLevel * (1.0 - fogFactor(vDepth)), 1.0); }`,
    });
    this.roadMat = mat;
    this.scene.add(new THREE.LineSegments(g, mat));
  }

  // ───────────────────────────────────────────────────────── traffic
  buildTraffic() {
    const rng = mulberry32(4242);
    const TRAIL = 6;
    const aLine = [], aMove = [], aKind = [], aTrail = [];
    const lim = HALF * PITCH;
    const addRoad = (vertical, coord, from, to, count) => {
      for (let v = 0; v < count; v++) {
        const dir = rng() < 0.5 ? 1 : -1;
        const speed = 16 + rng() * 22;
        const kind = rng() < 0.42 ? 1 : rng() < 0.6 ? 0 : 2;  // amber robotaxi / white / coral
        const lane = dir * (1.1 + rng() * 0.6);
        const phase = rng();
        for (let k = 0; k < TRAIL; k++) {
          aLine.push(vertical ? 0 : 1, coord, from, to);
          aMove.push(phase, speed, dir, lane);
          aKind.push(kind);
          aTrail.push(k / (TRAIL - 1));
        }
      }
    };
    for (let k = -HALF; k <= HALF; k++) {
      const x = k * PITCH, art = k % 4 === 0;
      const zEnd = shore(x) - 3;
      const len = zEnd + lim;
      addRoad(true, x, -lim, zEnd, Math.round(len / (art ? 26 : 70)));
    }
    for (let k = -HALF; k <= 4; k++) {
      const z = k * PITCH, art = k % 4 === 0;
      addRoad(false, z, -lim, lim, Math.round((2 * lim) / (art ? 26 : 70)));
    }
    const g = new THREE.BufferGeometry();
    const n = aKind.length;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aLine', new THREE.BufferAttribute(new Float32Array(aLine), 4));
    g.setAttribute('aMove', new THREE.BufferAttribute(new Float32Array(aMove), 4));
    g.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(aKind), 1));
    g.setAttribute('aTrail', new THREE.BufferAttribute(new Float32Array(aTrail), 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        ...this.u,
        uWhite: { value: col('#dce8ff') }, uAmber: { value: col('#f2b33d') }, uCoral: { value: col('#f0766b') },
        uLevel: { value: 1 },
      },
      vertexShader: `
        attribute vec4 aLine; attribute vec4 aMove; attribute float aKind; attribute float aTrail;
        uniform float uTime, uPR, uFogDensity; uniform vec3 uWhite, uAmber, uCoral;
        varying vec3 vC; varying float vA;
        ${SHORE_GLSL}${FOG_GLSL}
        void main(){
          float len = aLine.w - aLine.z;
          float tt = uTime - aTrail * 0.11;
          float s = fract(aMove.x + aMove.z * aMove.y * tt / len);
          float c = aLine.z + s * len;
          vec3 p = aLine.x < 0.5 ? vec3(aLine.y + aMove.w, 0.7, c) : vec3(c, 0.7, aLine.y + aMove.w);
          float edge = smoothstep(0.0, 0.025, s) * smoothstep(1.0, 0.975, s);
          float land = step(p.z, shore(p.x) - 2.0);
          float reveal = smoothstep(1.3 + length(p.xz) / 420.0, 2.2 + length(p.xz) / 420.0, uTime) * smoothstep(560.0, 360.0, length(p.xz));
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float d = -mv.z;
          float size = (1.0 - aTrail * 0.65) * clamp(2600.0 / d, 1.4, 11.0);
          gl_PointSize = size * uPR;
          vA = pow(1.0 - aTrail, 1.6) * edge * land * reveal * (1.0 - fogFactor(d)) * (size < 2.0 ? 0.6 : 1.0);
          vC = aKind < 0.5 ? uWhite : (aKind < 1.5 ? uAmber * 1.15 : uCoral);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform float uLevel; varying vec3 vC; varying float vA;
        void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.05, d); gl_FragColor = vec4(vC * vA * a * uLevel * 1.4, 1.0); }`,
    });
    this.trafficMat = mat;
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    this.scene.add(pts);
  }

  // ───────────────────────────────────── network (the poster's motif)
  buildNetwork() {
    const rng = mulberry32(911);
    const nodes = [];
    let guard = 0;
    while (nodes.length < 74 && guard++ < 5000) {
      const kx = Math.round((rng() * 2 - 1) * 13), kz = Math.round((rng() * 2 - 1) * 13);
      const x = kx * PITCH, z = kz * PITCH;
      if (Math.hypot(x - CBD.x * 0.5, z - CBD.y * 0.5) > 330) continue;
      if (z > shore(x) - 10) continue;
      if (nodes.some((n) => n.x === x && n.z === z)) continue;
      nodes.push({ x, z, r: Math.hypot(x, z) });
    }
    nodes.sort((a, b) => a.r - b.r);
    const edges = [];
    nodes.forEach((n, i) => {
      const near = nodes.map((m, j) => ({ j, d: Math.hypot(m.x - n.x, m.z - n.z) }))
        .filter((o) => o.j !== i).sort((a, b) => a.d - b.d).slice(0, 2 + (i % 2));
      near.forEach(({ j }) => {
        if (!edges.some(([a, b]) => (a === i && b === j) || (a === j && b === i))) edges.push([i, j]);
      });
    });

    // lines with grow-on animation: each vertex knows the segment start and its reveal time
    const lp = [], la = [], lb = [];
    edges.forEach(([i, j], k) => {
      const a = nodes[i], b = nodes[j];
      const t0 = 0.25 + Math.min(i, j) * 0.022 + (k % 5) * 0.03;
      lp.push(a.x, 2, a.z, a.x, 2, a.z);
      lb.push(b.x, 2, b.z, b.x, 2, b.z);
      la.push(0, t0, 1, t0);
    });
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lp), 3));
    lg.setAttribute('aEnd', new THREE.BufferAttribute(new Float32Array(lb), 3));
    lg.setAttribute('aInfo', new THREE.BufferAttribute(new Float32Array(la), 2));
    const lmat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { ...this.u, uColor: { value: col('#aeb9cb') }, uLevel: { value: 1 } },
      vertexShader: `
        attribute vec3 aEnd; attribute vec2 aInfo; uniform float uTime; varying float vA;
        void main(){
          float g = smoothstep(aInfo.y, aInfo.y + 0.55, uTime);
          vec3 p = aInfo.x > 0.5 ? mix(position, aEnd, g) : position;
          vA = g > 0.0 ? 1.0 : 0.0;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `uniform vec3 uColor; uniform float uLevel; varying float vA; void main(){ gl_FragColor = vec4(uColor * 0.55 * vA * uLevel, 1.0); }`,
    });
    this.netLineMat = lmat;
    const lines = new THREE.LineSegments(lg, lmat);
    lines.frustumCulled = false;
    this.scene.add(lines);

    // nodes
    const np = new Float32Array(nodes.length * 3), nk = new Float32Array(nodes.length), nt = new Float32Array(nodes.length);
    nodes.forEach((n, i) => { np.set([n.x, 2.5, n.z], i * 3); nk[i] = rng() < 0.38 ? 1 : 0; nt[i] = 0.1 + i * 0.02; });
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.BufferAttribute(np, 3));
    ng.setAttribute('aKind', new THREE.BufferAttribute(nk, 1));
    ng.setAttribute('aT', new THREE.BufferAttribute(nt, 1));
    const nmat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { ...this.u, uAmber: { value: col('#f2b33d') }, uGrey: { value: col('#aeb9cb') }, uLevel: { value: 1 } },
      vertexShader: `
        attribute float aKind; attribute float aT; uniform float uTime, uPR; varying vec3 vC; varying float vA;
        uniform vec3 uAmber, uGrey;
        void main(){
          float g = smoothstep(aT, aT + 0.4, uTime);
          float pop = 1.0 + 0.8 * (1.0 - smoothstep(aT + 0.1, aT + 0.6, uTime)) * g;
          vC = aKind > 0.5 ? uAmber * 1.3 : uGrey * 0.8;
          vA = g;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp((aKind > 0.5 ? 14000.0 : 10000.0) / -mv.z, 3.0, 26.0) * pop * uPR;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform float uLevel; varying vec3 vC; varying float vA;
        void main(){ float d = length(gl_PointCoord - 0.5); float core = smoothstep(0.5, 0.3, d); float halo = smoothstep(0.5, 0.0, d) * 0.35;
          gl_FragColor = vec4(vC * (core + halo) * vA * uLevel, 1.0); }`,
    });
    this.netNodeMat = nmat;
    const pts = new THREE.Points(ng, nmat);
    pts.frustumCulled = false;
    this.scene.add(pts);

    // a dashed amber route threading through the network (poster motif)
    const route = [];
    let cur = nodes.reduce((best, n) => (n.x - n.z < best.x - best.z ? n : best), nodes[0]);
    const used = new Set([cur]);
    for (let s = 0; s < 9; s++) {
      const cand = nodes.filter((n) => !used.has(n) && n.x > cur.x - 10 && n.z < cur.z + 10)
        .sort((a, b) => Math.hypot(a.x - cur.x, a.z - cur.z) - Math.hypot(b.x - cur.x, b.z - cur.z));
      route.push(cur);
      if (!cand.length) break;
      cur = cand[0]; used.add(cur);
    }
    route.push(cur);
    const curve = new THREE.CatmullRomCurve3(route.map((n) => new THREE.Vector3(n.x, 3, n.z)), false, 'centripetal');
    const ptsR = curve.getSpacedPoints(400);
    const rp = new Float32Array(ptsR.length * 3), rd = new Float32Array(ptsR.length);
    let acc = 0;
    ptsR.forEach((p, i) => { rp.set([p.x, p.y, p.z], i * 3); if (i) acc += p.distanceTo(ptsR[i - 1]); rd[i] = acc; });
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    rg.setAttribute('aDist', new THREE.BufferAttribute(rd, 1));
    const rmat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { ...this.u, uColor: { value: col('#f2b33d') }, uLevel: { value: 1 }, uLen: { value: acc } },
      vertexShader: `attribute float aDist; varying float vD; void main(){ vD = aDist; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 uColor; uniform float uLevel, uTime, uLen; varying float vD;
        void main(){
          float drawn = step(vD, uLen * smoothstep(0.6, 2.4, uTime));
          float dash = step(0.55, fract((vD - uTime * 22.0) / 14.0));
          gl_FragColor = vec4(uColor * 1.4 * dash * drawn * uLevel, 1.0);
        }`,
    });
    this.netRouteMat = rmat;
    this.scene.add(new THREE.Line(rg, rmat));
  }

  // ─────────────────────────────────────────────────────────── drones
  buildDrones() {
    const rng = mulberry32(31337);
    const ports = [];
    for (const b of this.tall) {
      if (ports.length >= 11) break;
      if (Math.hypot(b.x, b.z) > 330) continue;
      if (ports.some((p) => Math.hypot(p.x - b.x, p.z - b.z) < 70)) continue;
      ports.push(new THREE.Vector3(b.x, b.h + 3, b.z));
    }
    // vertiport rings
    this.portRings = [];
    const ringMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { ...this.u, uColor: { value: col('#6fd3e8') }, uLevel: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uColor; uniform float uLevel; void main(){ gl_FragColor = vec4(uColor * 1.3 * uLevel, 1.0); }`,
    });
    this.ringMat = ringMat;
    const ringGeo = new THREE.RingGeometry(3.4, 4.2, 48);
    ringGeo.rotateX(-Math.PI / 2);
    ports.forEach((p) => {
      const m = new THREE.Mesh(ringGeo, ringMat);
      m.position.copy(p).add(new THREE.Vector3(0, -2.4, 0));
      this.scene.add(m);
      this.portRings.push(m);
    });

    // corridors between vertiports (ping-pong) + loops over neighbourhoods
    const paths = [];
    const pairs = new Set();
    ports.forEach((a, i) => {
      ports.map((b, j) => ({ j, d: a.distanceTo(b) })).filter((o) => o.j !== i)
        .sort((x, y) => x.d - y.d).slice(0, 2).forEach(({ j }) => {
          const key = i < j ? `${i}-${j}` : `${j}-${i}`;
          if (pairs.has(key)) return;
          pairs.add(key);
          const b = ports[j];
          const top = Math.max(a.y, b.y) + 26 + rng() * 20;
          const mid = a.clone().lerp(b, 0.5); mid.y = top;
          const c = new THREE.CatmullRomCurve3([
            a.clone(), a.clone().add(new THREE.Vector3(0, 16, 0)), mid, b.clone().add(new THREE.Vector3(0, 16, 0)), b.clone(),
          ], false, 'centripetal');
          paths.push({ curve: c, loop: false, drones: 2, speed: 0.03 + rng() * 0.02 });
        });
    });
    for (let k = 0; k < 7; k++) {
      const cx = (rng() * 2 - 1) * 240, cz = -40 + (rng() * 2 - 1) * 200, R = 50 + rng() * 70, y = 48 + rng() * 40;
      const pts = [];
      for (let s = 0; s < 6; s++) {
        const a = (s / 6) * Math.PI * 2;
        pts.push(new THREE.Vector3(cx + Math.cos(a) * R * (0.7 + rng() * 0.5), y + rng() * 12, cz + Math.sin(a) * R * (0.7 + rng() * 0.5)));
      }
      paths.push({ curve: new THREE.CatmullRomCurve3(pts, true, 'centripetal'), loop: true, drones: 2, speed: 0.022 + rng() * 0.02 });
    }
    // a few long air corridors crossing the harbour
    for (let k = 0; k < 3; k++) {
      const x0 = -260 + k * 220;
      const c = new THREE.CatmullRomCurve3([
        new THREE.Vector3(x0, 70 + k * 12, -300), new THREE.Vector3(x0 + 40, 95, -60),
        new THREE.Vector3(x0 + 20, 90, 160), new THREE.Vector3(x0 - 30, 75, 380),
      ], false, 'centripetal');
      paths.push({ curve: c, loop: false, drones: 3, speed: 0.018 + rng() * 0.01 });
    }

    // dashed flowing trajectories
    const lp = [], ld = [], idx = [];
    let base = 0;
    paths.forEach((p) => {
      const pts = p.curve.getSpacedPoints(160);
      let acc = 0;
      pts.forEach((v, i) => {
        if (i) acc += v.distanceTo(pts[i - 1]);
        lp.push(v.x, v.y, v.z); ld.push(acc);
        if (i) idx.push(base + i - 1, base + i);
      });
      base += pts.length;
      p.samples = pts;
    });
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lp), 3));
    lg.setAttribute('aDist', new THREE.BufferAttribute(new Float32Array(ld), 1));
    lg.setIndex(idx);
    const lmat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { ...this.u, uColor: { value: col('#6fd3e8') }, uLevel: { value: 0 } },
      vertexShader: `attribute float aDist; varying float vD; varying float vDepth; void main(){ vD = aDist; vec4 mv = modelViewMatrix*vec4(position,1.0); vDepth = -mv.z; gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `
        uniform vec3 uColor; uniform float uLevel, uTime, uFogDensity; varying float vD; varying float vDepth;
        ${FOG_GLSL}
        void main(){ float dash = step(0.5, fract((vD - uTime * 10.0) / 7.0));
          gl_FragColor = vec4(uColor * 0.32 * dash * uLevel * (1.0 - fogFactor(vDepth) * 0.8), 1.0); }`,
    });
    this.droneLineMat = lmat;
    const lines = new THREE.LineSegments(lg, lmat);
    lines.frustumCulled = false;
    this.scene.add(lines);

    // drone points (positions updated on the CPU each frame — deterministic in t)
    this.drones = [];
    paths.forEach((p) => {
      for (let d = 0; d < p.drones; d++) this.drones.push({ path: p, phase: d / p.drones + rng() * 0.1, seed: rng() });
    });
    const n = this.drones.length;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(this.drones.map((d) => d.seed)), 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { ...this.u, uColor: { value: col('#6fd3e8') }, uLevel: { value: 0 } },
      vertexShader: `
        attribute float aSeed; uniform float uTime, uPR; varying float vS;
        void main(){
          vS = step(0.86, fract(uTime * 1.1 + aSeed));
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(5200.0 / -mv.z, 2.5, 11.0) * uPR;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uColor; uniform float uLevel; varying float vS;
        void main(){ float d = length(gl_PointCoord - 0.5); float core = smoothstep(0.5, 0.2, d); float halo = smoothstep(0.5, 0.0, d) * 0.4;
          vec3 c = mix(uColor * 1.1, vec3(1.4), vS * core);
          gl_FragColor = vec4(c * (core + halo * 0.6) * uLevel, 1.0); }`,
    });
    this.droneMat = mat;
    this.dronePts = new THREE.Points(g, mat);
    this.dronePts.frustumCulled = false;
    this.scene.add(this.dronePts);
  }

  updateDrones(t) {
    const arr = this.dronePts.geometry.attributes.position.array;
    const v = new THREE.Vector3();
    this.drones.forEach((d, i) => {
      const p = d.path;
      let u;
      if (p.loop) u = (d.phase + t * p.speed) % 1;
      else u = 0.5 - 0.5 * Math.cos(2 * Math.PI * (d.phase + t * p.speed));
      const s = p.samples;
      const f = u * (s.length - 1), k = Math.min(s.length - 2, Math.floor(f));
      v.copy(s[k]).lerp(s[k + 1], f - k);
      arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z;
    });
    this.dronePts.geometry.attributes.position.needsUpdate = true;
  }

  // ─────────────────────────────────────────────────────── camera path
  buildCameraPath() {
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const keys = [
      { t: 0.0, p: V(10, 1050, 140), q: V(-10, 0, -20) },
      { t: 1.9, p: V(70, 800, 300), q: V(-10, 0, -20) },
      { t: 3.5, p: V(230, 360, 560), q: V(-20, 20, -40) },
      { t: 4.9, p: V(110, 72, 330), q: V(-10, 48, 20) },
      { t: 6.0, p: V(10, 36, 196), q: V(-4, 54, 40) },
      { t: 7.4, p: V(-8, 70, 110), q: V(-40, 64, -120) },
      { t: 8.9, p: V(-160, 170, 330), q: V(-40, 40, -60) },
    ];
    // slow orbit behind the information scenes
    const C = V(-40, 0, -50), R = 470, H = 190;
    let th = Math.atan2(-160 - C.x, 330 - C.z);
    for (let t = 10.6; t <= 26.6; t += 2) {
      th -= 0.075;
      const rr = R + 30 * Math.sin(t * 0.21);
      keys.push({ t, p: V(C.x + Math.sin(th) * rr, H + 18 * Math.sin(t * 0.33), C.z + Math.cos(th) * rr), q: V(C.x + 30, 38, C.z) });
    }
    keys.push({ t: 28.4, p: V(-60, 640, 520), q: V(-30, 0, -40) });
    keys.push({ t: 30.0, p: V(-70, 820, 560), q: V(-30, 0, -40) });
    this.camKeys = keys;
  }

  cameraAt(t) {
    const K = this.camKeys;
    t = clamp(t, K[0].t, K[K.length - 1].t);
    let i = 0;
    while (i < K.length - 2 && t > K[i + 1].t) i++;
    const k0 = K[Math.max(0, i - 1)], k1 = K[i], k2 = K[i + 1], k3 = K[Math.min(K.length - 1, i + 2)];
    const h = k2.t - k1.t, u = (t - k1.t) / h;
    const herm = (a0, a1, a2, a3) => {
      // time-aware Catmull-Rom (Hermite with finite-difference tangents)
      const m1 = (a2 - a0) / Math.max(1e-6, k2.t - k0.t) * h;
      const m2 = (a3 - a1) / Math.max(1e-6, k3.t - k1.t) * h;
      const u2 = u * u, u3 = u2 * u;
      return (2 * u3 - 3 * u2 + 1) * a1 + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * a2 + (u3 - u2) * m2;
    };
    const ip = (key) => new THREE.Vector3(
      herm(k0[key].x, k1[key].x, k2[key].x, k3[key].x),
      herm(k0[key].y, k1[key].y, k2[key].y, k3[key].y),
      herm(k0[key].z, k1[key].z, k2[key].z, k3[key].z));
    return { p: ip('p'), q: ip('q') };
  }

  // ───────────────────────────────────────────────────────── render
  render(t) {
    this.u.uTime.value = t;
    const { p, q } = this.cameraAt(t);
    this.camera.position.copy(p);
    this.camera.lookAt(q);
    // a little wider during the street-level fly-through
    this.camera.fov = 48 + 10 * smooth(prog(t, 4.2, 1.4)) * (1 - smooth(prog(t, 6.6, 1.8)));
    this.camera.updateProjectionMatrix();
    this.sky.position.copy(p);
    this.stars.position.copy(p);

    // network: bright in the opening, faint behind the data, back for the close
    const net = lerp(1, 0.14, smooth(prog(t, 2.6, 2.2))) + 0.75 * smooth(prog(t, 27.2, 1.6));
    this.netLineMat.uniforms.uLevel.value = net;
    this.netNodeMat.uniforms.uLevel.value = net;
    this.netRouteMat.uniforms.uLevel.value = lerp(1, 0.35, smooth(prog(t, 3.0, 2.0))) + 0.6 * smooth(prog(t, 27.2, 1.6));
    this.roadMat.uniforms.uLevel.value = lerp(1.25, 0.7, smooth(prog(t, 3.2, 2.0)));
    this.groundMat.uniforms.uReveal.value = smooth(prog(t, 2.2, 1.6));

    const air = smooth(prog(t, 3.3, 1.2));
    this.droneMat.uniforms.uLevel.value = air;
    this.droneLineMat.uniforms.uLevel.value = air * (0.85 - 0.35 * smooth(prog(t, 8, 2)));
    this.ringMat.uniforms.uLevel.value = air * (0.6 + 0.4 * Math.sin(t * 3.0));
    this.portRings.forEach((m, i) => m.scale.setScalar(1 + 0.12 * Math.sin(t * 2.4 + i)));
    this.updateDrones(t);

    this.bloom.strength = 0.62 + 0.12 * smooth(prog(t, 3.8, 1.2)) * (1 - smooth(prog(t, 7, 2)));
    this.composer.render();
  }
}
