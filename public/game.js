// 碰碰球大乱斗 3D —— 客户端（Three.js 渲染）
import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const DASH_COOLDOWN = 1.2;
const LAVA_Y = -150;
const TILE_H = 26;
const COLORS = ['#ff5a5f', '#3fa7ff', '#ffd23f', '#3ddc84', '#b06cff', '#ff8c42', '#2ee6d6', '#ff6fb5'];
const ITEM_INFO = {
  big: { icon: '🍄', name: '巨大化', color: '#ff5a5f' },
  speed: { icon: '⚡', name: '加速', color: '#ffd23f' },
  shield: { icon: '🛡️', name: '护盾', color: '#3fa7ff' },
  bomb: { icon: '💣', name: '炸弹', color: '#ff8c42' },
};
let RINGS = [320, 278, 236, 194, 152, 110];

let isTouch = 'ontouchstart' in window;
let ws = null;
let myId = null;
let state = null;
let lastPhase = null;
let shake = 0;

// =====================================================================
// 音效（WebAudio 实时合成，无需素材）
// =====================================================================
let audio = null;
let noiseBuf = null;
function ac() {
  if (!audio) {
    audio = new (window.AudioContext || window.webkitAudioContext)();
    noiseBuf = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return audio;
}
function beep(freq, dur, type = 'square', vol = 0.08, slide = 0) {
  try {
    const a = ac();
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, a.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), a.currentTime + dur);
    g.gain.setValueAtTime(vol, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    o.connect(g).connect(a.destination);
    o.start();
    o.stop(a.currentTime + dur);
  } catch {
    /* 忽略 */
  }
}
function boom(dur = 0.6, vol = 0.25, cutoff = 600) {
  try {
    const a = ac();
    const src = a.createBufferSource();
    src.buffer = noiseBuf;
    const f = a.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff, a.currentTime);
    f.frequency.exponentialRampToValueAtTime(60, a.currentTime + dur);
    const g = a.createGain();
    g.gain.setValueAtTime(vol, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    src.connect(f).connect(g).connect(a.destination);
    src.start();
    src.stop(a.currentTime + dur);
  } catch {
    /* 忽略 */
  }
}

// =====================================================================
// 渲染器 / 场景 / 灯光
// =====================================================================
const canvas = $('game');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch {
  $('loading').textContent = '你的浏览器不支持 WebGL，无法显示 3D 画面';
  throw new Error('WebGL unavailable');
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouch ? 1.5 : 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
const FOG_COLOR = new THREE.Color('#6a2230');
scene.fog = new THREE.Fog(FOG_COLOR, 1300, 3400);
const camera = new THREE.PerspectiveCamera(45, 1, 10, 9000);

scene.add(new THREE.HemisphereLight('#9fb0ff', '#ff6a2a', 0.9));
const sun = new THREE.DirectionalLight('#fff0dc', 2.6);
sun.position.set(260, 700, 320);
sun.castShadow = true;
sun.shadow.mapSize.set(isTouch ? 1024 : 2048, isTouch ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -420, right: 420, top: 420, bottom: -420, near: 100, far: 1600 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 1.5;
scene.add(sun);
// 岩浆从下方照亮浮岛和角色
const lavaLight = new THREE.PointLight('#ff5a1a', 3.5, 1100, 0);
lavaLight.position.set(0, LAVA_Y + 30, 0);
scene.add(lavaLight);

// ---- 天空 ----
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(6000, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color('#0d0820') },
      uMid: { value: new THREE.Color('#3a1240') },
      uHorizon: { value: FOG_COLOR },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHorizon; varying vec3 vDir;
      float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
      void main(){
        float h = vDir.y;
        vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.25, h));
        col = mix(col, uTop, smoothstep(0.2, 0.7, h));
        vec3 cell = floor(vDir * 300.0);
        float star = step(0.997, hash(cell)) * smoothstep(0.15, 0.5, h);
        col += vec3(star) * 0.8;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
);
scene.add(sky);

// ---- 岩浆海（程序化噪声着色器） ----
const lavaMat = new THREE.ShaderMaterial({
  fog: true,
  uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
  vertexShader: `
    #include <fog_pars_vertex>
    varying vec3 vWorld;
    void main(){
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      vec4 mvPosition = viewMatrix * wp;
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`,
  fragmentShader: `
    #include <fog_pars_fragment>
    uniform float uTime;
    varying vec3 vWorld;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
    float noise(vec2 p){
      vec2 i = floor(p), f = fract(p);
      vec2 u = f*f*(3.0-2.0*f);
      return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
    }
    float fbm(vec2 p){ float v = 0.0, a = 0.5; for(int i=0;i<4;i++){ v += a*noise(p); p *= 2.03; a *= 0.5; } return v; }
    void main(){
      vec2 p = vWorld.xz * 0.005;
      float t = uTime * 0.06;
      vec2 q = vec2(fbm(p + vec2(t, 0.0)), fbm(p + vec2(3.1, -t)));
      float n = fbm(p * 1.6 + q * 2.2 + vec2(t * 1.4, -t));
      float glow = 1.0 - smoothstep(0.3, 0.47, n);
      vec3 hot = vec3(1.8, 0.75, 0.2);
      vec3 mid = vec3(0.9, 0.15, 0.02);
      vec3 dark = vec3(0.09, 0.025, 0.03) * (0.7 + 0.6 * noise(p * 18.0));
      vec3 col = mix(dark, mid, glow);
      col = mix(col, hot, glow * glow * glow);
      float pulse = 0.85 + 0.15 * sin(uTime * 1.5 + n * 10.0);
      col *= pulse;
      float d = length(vWorld.xz);
      col += vec3(0.5, 0.12, 0.02) * smoothstep(650.0, 250.0, d) * 0.35;
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }`,
});
const lava = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), lavaMat);
lava.rotation.x = -Math.PI / 2;
lava.position.y = LAVA_Y;
scene.add(lava);

// 用确定性噪声扰动顶点，做出低多边形岩石
function rockify(geo, amount, seed = 1) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = Math.sin(x * 0.11 + seed) * Math.cos(z * 0.13 + seed * 2) + Math.sin(y * 0.17 + seed * 3);
    const k = 1 + n * amount;
    pos.setXYZ(i, x * k, y + n * amount * 20, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

// ---- 远处的岩柱、漂浮碎石 ----
const rockMat = new THREE.MeshStandardMaterial({ color: '#4a3436', roughness: 0.95, flatShading: true });
const darkRockMat = new THREE.MeshStandardMaterial({ color: '#2e2026', roughness: 1, flatShading: true });
for (let i = 0; i < 22; i++) {
  const a = (i / 22) * Math.PI * 2 + Math.sin(i * 7) * 0.2;
  const r = 750 + ((i * 373) % 900);
  const h = 160 + ((i * 131) % 380);
  const geo = rockify(new THREE.CylinderGeometry(20 + (i % 4) * 12, 60 + (i % 5) * 20, h, 7, 4), 0.12, i);
  const m = new THREE.Mesh(geo, i % 3 ? rockMat : darkRockMat);
  m.position.set(Math.cos(a) * r, LAVA_Y + h / 2 - 10, Math.sin(a) * r);
  m.rotation.y = i;
  scene.add(m);
}
const floaters = [];
for (let i = 0; i < 10; i++) {
  const geo = rockify(new THREE.DodecahedronGeometry(10 + (i % 4) * 7, 0), 0.15, i + 50);
  const m = new THREE.Mesh(geo, rockMat);
  m.castShadow = true;
  const a = (i / 10) * Math.PI * 2;
  const r = 440 + (i % 3) * 60;
  floaters.push({ m, a, r, y: -30 + (i % 4) * 25, sp: 0.03 + (i % 3) * 0.015 });
  scene.add(m);
}

// =====================================================================
// 浮岛场地：一圈圈可坍塌的地砖
// =====================================================================
const arena = new THREE.Group();
scene.add(arena);
const tiles = [];
const ringMats = [];
let shownCollapsed = 0;
const sideMat = new THREE.MeshStandardMaterial({ color: '#7a5c4a', roughness: 0.9, flatShading: true });
const stalactiteGeos = [0, 1, 2].map((k) => rockify(new THREE.ConeGeometry(12 + k * 4, 40 + k * 22, 5, 2), 0.1, k + 9).rotateX(Math.PI));

function sectorShape(rIn, rOut, a0, a1) {
  const s = new THREE.Shape();
  s.moveTo(Math.cos(a0) * rOut, Math.sin(a0) * rOut);
  s.absarc(0, 0, rOut, a0, a1, false);
  if (rIn > 0) {
    s.lineTo(Math.cos(a1) * rIn, Math.sin(a1) * rIn);
    s.absarc(0, 0, rIn, a1, a0, true);
  } else {
    s.lineTo(0, 0);
  }
  return s;
}

function buildArena() {
  const ringCount = RINGS.length; // 最后一个是中心圆盘
  const palette = ['#e6d3ae', '#d4bf95'];
  const centerPalette = ['#9aa3d6', '#8790c8'];
  const bevel = 2.5;
  const inset = 3;
  for (let k = 0; k < ringCount; k++) {
    const isCenter = k === ringCount - 1;
    const rOut = RINGS[k] - inset;
    const rIn = isCenter ? 0 : RINGS[k + 1] + inset;
    const segs = isCenter ? 6 : Math.round((2 * Math.PI * RINGS[k]) / 72);
    const cols = isCenter ? centerPalette : palette;
    const mats = cols.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, emissive: '#ff2a00', emissiveIntensity: 0 }));
    ringMats.push(mats);
    const offset = k * 0.37;
    for (let i = 0; i < segs; i++) {
      const gap = inset / RINGS[k];
      const a0 = offset + (i / segs) * Math.PI * 2 + gap;
      const a1 = offset + ((i + 1) / segs) * Math.PI * 2 - gap;
      const geo = new THREE.ExtrudeGeometry(sectorShape(rIn, rOut, a0, a1), {
        depth: TILE_H,
        bevelEnabled: true,
        bevelThickness: bevel,
        bevelSize: bevel,
        bevelSegments: 2,
        curveSegments: isCenter ? 10 : 5,
      });
      geo.rotateX(-Math.PI / 2);
      const am = (a0 + a1) / 2;
      const rm = isCenter ? rOut * 0.55 : (rIn + rOut) / 2;
      const cx = Math.cos(am) * rm;
      const cz = -Math.sin(am) * rm;
      geo.translate(-cx, -(TILE_H + bevel), -cz);
      const mesh = new THREE.Mesh(geo, [mats[(i + k) % 2], sideMat]);
      mesh.position.set(cx, 0, cz);
      mesh.receiveShadow = true;
      if (!isCenter && (i + k) % 2 === 0) {
        const st = new THREE.Mesh(stalactiteGeos[(i * 7 + k) % 3], darkRockMat);
        st.position.y = -TILE_H - 20;
        mesh.add(st);
      }
      arena.add(mesh);
      tiles.push({ mesh, ring: k, base: mesh.position.clone(), falling: false, delay: 0, vy: 0, spin: new THREE.Vector3(), splashed: false });
    }
  }
  // 中心金色镶嵌环
  const inlay = new THREE.Mesh(
    new THREE.TorusGeometry(62, 3, 8, 64),
    new THREE.MeshStandardMaterial({ color: '#ffcf4a', metalness: 0.8, roughness: 0.3, emissive: '#7a4a00', emissiveIntensity: 0.4 })
  );
  inlay.rotation.x = -Math.PI / 2;
  inlay.position.y = 0.3;
  inlay.scale.z = 0.25;
  arena.add(inlay);
  const star = new THREE.Mesh(
    new THREE.CylinderGeometry(16, 16, 2, 6),
    new THREE.MeshStandardMaterial({ color: '#ffcf4a', metalness: 0.8, roughness: 0.3, emissive: '#7a4a00', emissiveIntensity: 0.4 })
  );
  star.position.y = 0.2;
  star.receiveShadow = true;
  arena.add(star);
  // 浮岛底部的巨大岩锥
  const cone = new THREE.Mesh(rockify(new THREE.ConeGeometry(RINGS[RINGS.length - 1] + 4, 260, 9, 4), 0.08, 3).rotateX(Math.PI), rockMat);
  cone.position.y = -TILE_H - 130;
  arena.add(cone);
}
buildArena();

function resetTiles() {
  for (const t of tiles) {
    t.falling = false;
    t.mesh.visible = true;
    t.mesh.position.copy(t.base);
    t.mesh.rotation.set(0, 0, 0);
    t.vy = 0;
    t.splashed = false;
  }
  shownCollapsed = 0;
}

function collapseRing(k) {
  for (const t of tiles) {
    if (t.ring !== k || t.falling) continue;
    t.falling = true;
    t.delay = Math.random() * 0.35;
    t.vy = 0;
    t.spin.set((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3);
  }
  boom(1.2, 0.3, 300);
  shake = Math.max(shake, 8);
}

function syncCollapsed(target) {
  if (target < shownCollapsed) resetTiles();
  while (shownCollapsed < target) collapseRing(shownCollapsed++);
}

function updateTiles(dt, t) {
  const warnRing = state && state.phase === 'playing' && state.warn >= 0 ? state.collapsed : -1;
  ringMats.forEach((mats, k) => {
    let e = 0;
    if (k === warnRing) e = 0.35 + 0.35 * Math.sin(t * (10 + (3 - state.warn) * 6));
    for (const m of mats) m.emissiveIntensity = e;
  });
  for (const tile of tiles) {
    const m = tile.mesh;
    if (tile.falling) {
      if (tile.delay > 0) {
        tile.delay -= dt;
        m.position.set(tile.base.x + (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, tile.base.z + (Math.random() - 0.5) * 3);
        continue;
      }
      if (!m.visible) continue;
      tile.vy -= 700 * dt;
      m.position.y += tile.vy * dt;
      m.rotation.x += tile.spin.x * dt;
      m.rotation.y += tile.spin.y * dt;
      m.rotation.z += tile.spin.z * dt;
      if (m.position.y < LAVA_Y && !tile.splashed) {
        tile.splashed = true;
        splash(m.position.x, m.position.z, 14);
      }
      if (m.position.y < LAVA_Y - 150) m.visible = false;
    } else if (tile.ring === warnRing) {
      const amp = 1.5 * (1 - state.warn / 3);
      m.position.set(tile.base.x + (Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp, tile.base.z + (Math.random() - 0.5) * amp);
    } else if (m.position.y !== 0 || m.position.x !== tile.base.x) {
      m.position.copy(tile.base);
    }
  }
}

// =====================================================================
// 粒子系统
// =====================================================================
function hexRGB(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

class Particles {
  constructor(max, blending) {
    this.max = max;
    this.list = [];
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending,
      uniforms: { uScale: { value: 500 } },
      vertexShader: `attribute float aSize; attribute vec4 aColor; varying vec4 vColor; uniform float uScale;
        void main(){ vColor = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec4 vColor;
        void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(vColor.rgb, vColor.a * smoothstep(0.5, 0.1, d)); }`,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  add(o) {
    if (this.list.length >= this.max) this.list.shift();
    const rgb = hexRGB(o.color || '#ffffff');
    this.list.push({ g: 0, drag: 0.9, size: 6, alpha: 1, grow: 0, ...o, rgb, life: o.life, max: o.life });
  }
  update(dt) {
    let n = 0;
    const keep = [];
    for (const p of this.list) {
      p.life -= dt;
      if (p.life <= 0) continue;
      keep.push(p);
      p.vy -= p.g * dt;
      const drag = Math.pow(p.drag, dt * 10);
      p.vx *= drag;
      p.vz *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const k = p.life / p.max;
      this.pos.set([p.x, p.y, p.z], n * 3);
      this.col.set([p.rgb[0], p.rgb[1], p.rgb[2], p.alpha * Math.min(1, k * 2)], n * 4);
      this.size[n] = p.size * (1 + p.grow * (1 - k));
      n++;
    }
    this.list = keep;
    this.geo.setDrawRange(0, n);
    for (const a of ['position', 'aColor', 'aSize']) this.geo.attributes[a].needsUpdate = true;
  }
}
const sparks = new Particles(1500, THREE.AdditiveBlending);
const dust = new Particles(600, THREE.NormalBlending);

function burst(x, y, z, color, n, speed = 200, size = 7, life = 0.45) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const up = Math.random();
    const sp = speed * (0.4 + Math.random() * 0.6);
    sparks.add({ x, y, z, vx: Math.cos(a) * sp, vy: up * sp * 0.8 + 40, vz: Math.sin(a) * sp, life: life * (0.6 + Math.random() * 0.8), color, size, g: 500 });
  }
}
function splash(x, z, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 60 + Math.random() * 140;
    sparks.add({ x, y: LAVA_Y + 2, z, vx: Math.cos(a) * sp, vy: 200 + Math.random() * 250, vz: Math.sin(a) * sp, life: 0.8 + Math.random() * 0.5, color: i % 3 ? '#ff7a1a' : '#ffd23f', size: 9, g: 600, drag: 0.98 });
  }
}
function puff(x, z, n, color = '#e8dcc4') {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 20 + Math.random() * 60;
    dust.add({ x: x + Math.cos(a) * 10, y: 4, z: z + Math.sin(a) * 10, vx: Math.cos(a) * sp, vy: 15 + Math.random() * 20, vz: Math.sin(a) * sp, life: 0.35 + Math.random() * 0.3, color, size: 10, grow: 1.2, alpha: 0.35 });
  }
}

// 冲击波光环
const shockwaves = [];
function shockwave(x, z, r, color = '#ffb347') {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(0.8, 1, 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 3, z);
  scene.add(m);
  shockwaves.push({ m, r, t: 0 });
}

// =====================================================================
// 角色建模
// =====================================================================
const sphereGeo = new THREE.SphereGeometry(1, 36, 24);
const eyeWhiteMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.2 });
const pupilMat = new THREE.MeshStandardMaterial({ color: '#15131f', roughness: 0.1 });
const goldMat = new THREE.MeshStandardMaterial({ color: '#ffcf4a', metalness: 0.9, roughness: 0.25 });
const whiteMat = new THREE.MeshStandardMaterial({ color: '#f5f2ea', roughness: 0.6 });
const blackMat = new THREE.MeshStandardMaterial({ color: '#1b1822', roughness: 0.5 });

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

// 每种颜色配一个专属头饰
function makeAccessory(kind, color) {
  const g = new THREE.Group();
  const tint = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).offsetHSL(0, 0, -0.18), roughness: 0.5 });
  switch (kind) {
    case 0: {
      // 皇冠
      g.add(mesh(new THREE.CylinderGeometry(0.42, 0.4, 0.22, 16, 1, true), goldMat, 0, 0.98, 0));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        g.add(mesh(new THREE.ConeGeometry(0.09, 0.22, 6), goldMat, Math.cos(a) * 0.4, 1.19, Math.sin(a) * 0.4));
        g.add(mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshStandardMaterial({ color: '#3fa7ff', roughness: 0.1 }), Math.cos(a + 0.6) * 0.42, 0.98, Math.sin(a + 0.6) * 0.42));
      }
      break;
    }
    case 1: {
      // 恶魔角
      for (const s of [-1, 1]) {
        const h = mesh(new THREE.ConeGeometry(0.13, 0.5, 10), whiteMat, s * 0.45, 0.95, 0);
        h.rotation.z = -s * 0.5;
        g.add(h);
      }
      break;
    }
    case 2: {
      // 天线
      g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6), blackMat, 0, 1.2, 0));
      g.add(mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshStandardMaterial({ color: '#fff27a', emissive: '#ffd23f', emissiveIntensity: 1.2 }), 0, 1.5, 0));
      break;
    }
    case 3: {
      // 螺旋桨帽
      g.add(mesh(new THREE.SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), tint, 0, 0.82, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.25, 6), blackMat, 0, 1.4, 0));
      const prop = new THREE.Group();
      prop.position.y = 1.52;
      prop.add(mesh(new THREE.BoxGeometry(1.1, 0.04, 0.14), new THREE.MeshStandardMaterial({ color: '#ffd23f' })));
      prop.add(mesh(new THREE.BoxGeometry(0.14, 0.04, 1.1), new THREE.MeshStandardMaterial({ color: '#3fa7ff' })));
      prop.userData.spin = 12;
      g.add(prop);
      break;
    }
    case 4: {
      // 猫耳
      for (const s of [-1, 1]) {
        const e = mesh(new THREE.ConeGeometry(0.24, 0.42, 4), tint, s * 0.5, 0.88, -0.05);
        e.rotation.z = -s * 0.45;
        g.add(e);
      }
      break;
    }
    case 5: {
      // 礼帽
      g.add(mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.05, 20), blackMat, 0, 0.9, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.55, 20), blackMat, 0, 1.18, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.39, 0.39, 0.1, 20), new THREE.MeshStandardMaterial({ color: '#ff5a5f' }), 0, 0.98, 0));
      g.rotation.z = 0.15;
      break;
    }
    case 6: {
      // 小树苗
      const leafMat = new THREE.MeshStandardMaterial({ color: '#4cd964', roughness: 0.5 });
      g.add(mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.35, 6), new THREE.MeshStandardMaterial({ color: '#6b8e23' }), 0, 1.12, 0));
      for (const s of [-1, 1]) {
        const l = mesh(new THREE.SphereGeometry(0.2, 12, 8), leafMat, s * 0.18, 1.3, 0);
        l.scale.set(1, 0.35, 0.6);
        l.rotation.z = s * 0.5;
        g.add(l);
      }
      break;
    }
    default: {
      // 派对帽
      const hat = mesh(new THREE.ConeGeometry(0.34, 0.8, 16), new THREE.MeshStandardMaterial({ color: '#b06cff', roughness: 0.5 }), 0, 1.25, 0);
      g.add(hat);
      g.add(mesh(new THREE.TorusGeometry(0.3, 0.05, 6, 16).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#ffd23f' }), 0, 0.97, 0));
      g.add(mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshStandardMaterial({ color: '#ffffff' }), 0, 1.68, 0));
      g.rotation.z = -0.2;
    }
  }
  return g;
}

function makeLabel(text) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = 'bold 40px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 24;
  c.width = w;
  c.height = 56;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(20,14,40,0.85)';
  ctx.strokeText(text, w / 2, 29);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, w / 2, 29);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set((w / 56) * 15, 15, 1);
  s.renderOrder = 10;
  return s;
}

function makePlayerModel(p) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const bodyMat = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.32, metalness: 0.05, emissive: '#ffd23f', emissiveIntensity: 0 });
  body.add(mesh(sphereGeo, bodyMat));
  // 碰碰车式的保险杠圈
  const bumper = mesh(new THREE.TorusGeometry(0.95, 0.14, 12, 40), new THREE.MeshStandardMaterial({ color: new THREE.Color(p.color).offsetHSL(0, 0.05, -0.22), roughness: 0.5 }));
  bumper.rotation.x = Math.PI / 2;
  bumper.position.y = -0.3;
  body.add(bumper);
  // 脸
  const face = new THREE.Group();
  const eyes = [];
  const onSurface = (o, x, y, z, r) => {
    const n = new THREE.Vector3(x, y, z).normalize();
    o.position.copy(n).multiplyScalar(r);
    o.lookAt(n.multiplyScalar(3));
  };
  for (const s of [-1, 1]) {
    const eye = new THREE.Group();
    onSurface(eye, s * 0.36, 0.5, 0.8, 0.84);
    eye.add(mesh(new THREE.SphereGeometry(0.26, 16, 12), eyeWhiteMat));
    const pupil = mesh(new THREE.SphereGeometry(0.14, 12, 10), pupilMat, 0, 0, 0.17);
    eye.add(pupil);
    eye.add(mesh(new THREE.SphereGeometry(0.05, 8, 6), eyeWhiteMat, 0.05, 0.06, 0.29));
    face.add(eye);
    eyes.push(eye);
  }
  const mouthG = new THREE.Group();
  onSurface(mouthG, 0, 0.2, 1, 1.0);
  const mouth = mesh(new THREE.TorusGeometry(0.16, 0.035, 6, 14, Math.PI), pupilMat);
  mouth.rotation.z = Math.PI;
  mouthG.add(mouth);
  face.add(mouthG);
  for (const s of [-1, 1]) {
    const cheek = new THREE.Mesh(new THREE.CircleGeometry(0.1, 12), new THREE.MeshBasicMaterial({ color: '#ff9fb3', transparent: true, opacity: 0.7 }));
    onSurface(cheek, s * 0.6, 0.25, 0.76, 1.005);
    face.add(cheek);
  }
  body.add(face);
  const acc = makeAccessory(Math.max(0, COLORS.indexOf(p.color)), p.color);
  body.add(acc);
  // 护盾气泡
  const shield = new THREE.Group();
  shield.add(new THREE.Mesh(sphereGeo, new THREE.MeshStandardMaterial({ color: '#6fc3ff', emissive: '#3fa7ff', emissiveIntensity: 0.6, transparent: true, opacity: 0.25, depthWrite: false })));
  const wire = new THREE.Mesh(new THREE.IcosahedronGeometry(1.05, 1), new THREE.MeshBasicMaterial({ color: '#bfe6ff', wireframe: true, transparent: true, opacity: 0.6 }));
  shield.add(wire);
  shield.scale.setScalar(1.45);
  shield.visible = false;
  root.add(shield);
  scene.add(root);

  const label = makeLabel(p.name);
  scene.add(label);
  return {
    root, body, bodyMat, eyes, acc, shield, wire, label,
    name: p.name, color: p.color,
    x: p.x, z: p.y, yaw: 0, scale: p.r,
    squash: 0, squashV: 0, hop: 0,
    fy: 0, fvy: 0, splashed: false,
    blink: 2 + Math.random() * 3,
  };
}

function disposeView(v) {
  scene.remove(v.root);
  scene.remove(v.label);
  v.label.material.map.dispose();
  v.label.material.dispose();
}

// 自己的标记：脚下的冲刺环 + 头顶箭头
const myRing = new THREE.Mesh(
  new THREE.RingGeometry(1.3, 1.55, 48),
  new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.9, depthWrite: false })
);
myRing.rotation.x = -Math.PI / 2;
scene.add(myRing);
const myArrow = new THREE.Mesh(new THREE.ConeGeometry(6, 12, 4), new THREE.MeshBasicMaterial({ color: '#ffd23f' }));
myArrow.rotation.x = Math.PI;
scene.add(myArrow);

// =====================================================================
// 道具建模
// =====================================================================
function makeItemModel(type) {
  const root = new THREE.Group();
  const float = new THREE.Group();
  root.add(float);
  const info = ITEM_INFO[type];
  const glow = new THREE.Mesh(
    new THREE.RingGeometry(18, 28, 32),
    new THREE.MeshBasicMaterial({ color: info.color, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 1;
  root.add(glow);
  // 光柱
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(12, 18, 110, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: info.color, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  beam.position.y = 55;
  root.add(beam);

  if (type === 'big') {
    float.add(mesh(new THREE.CylinderGeometry(4.5, 6, 11, 12), whiteMat, 0, -4, 0));
    const capMat = new THREE.MeshStandardMaterial({ color: '#ff4a4f', roughness: 0.4, emissive: '#ff2020', emissiveIntensity: 0.25 });
    float.add(mesh(new THREE.SphereGeometry(12, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), capMat, 0, 1, 0));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const d = mesh(new THREE.SphereGeometry(2.2, 8, 6), whiteMat, Math.cos(a) * 8, 8.5, Math.sin(a) * 8);
      float.add(d);
    }
    float.add(mesh(new THREE.SphereGeometry(2.4, 8, 6), whiteMat, 0, 13, 0));
  } else if (type === 'speed') {
    const s = new THREE.Shape();
    s.moveTo(3, 14);
    s.lineTo(-7, -1);
    s.lineTo(-1, -1);
    s.lineTo(-4, -14);
    s.lineTo(7, 2);
    s.lineTo(1, 2);
    s.lineTo(3, 14);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 4, bevelEnabled: true, bevelThickness: 1, bevelSize: 1, bevelSegments: 1 });
    geo.center();
    float.add(mesh(geo, new THREE.MeshStandardMaterial({ color: '#ffd23f', emissive: '#ffb000', emissiveIntensity: 0.8, metalness: 0.3, roughness: 0.3 })));
  } else if (type === 'shield') {
    const s = new THREE.Shape();
    s.moveTo(-10, 11);
    s.lineTo(10, 11);
    s.lineTo(10, 1);
    s.quadraticCurveTo(10, -9, 0, -14);
    s.quadraticCurveTo(-10, -9, -10, 1);
    s.lineTo(-10, 11);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 3, bevelEnabled: true, bevelThickness: 1.5, bevelSize: 1.5, bevelSegments: 2 });
    geo.center();
    float.add(mesh(geo, new THREE.MeshStandardMaterial({ color: '#3fa7ff', emissive: '#1f6fff', emissiveIntensity: 0.5, metalness: 0.4, roughness: 0.3 })));
    const inner = mesh(new THREE.BoxGeometry(3, 14, 2), whiteMat, 0, 0, 3);
    const inner2 = mesh(new THREE.BoxGeometry(12, 3, 2), whiteMat, 0, 3, 3);
    float.add(inner, inner2);
  } else {
    float.add(mesh(new THREE.SphereGeometry(10, 20, 14), new THREE.MeshStandardMaterial({ color: '#23202c', metalness: 0.5, roughness: 0.35 })));
    float.add(mesh(new THREE.CylinderGeometry(3, 3, 4, 10), new THREE.MeshStandardMaterial({ color: '#777', metalness: 0.8, roughness: 0.3 }), 0, 10, 0));
    float.add(mesh(new THREE.CylinderGeometry(0.8, 0.8, 6, 6), new THREE.MeshStandardMaterial({ color: '#c9a36b' }), 1.5, 14, 0));
    const spark = mesh(new THREE.SphereGeometry(2, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffe066' }), 2.5, 17, 0);
    spark.userData.spark = true;
    float.add(spark);
  }
  float.scale.setScalar(1.5);
  scene.add(root);
  return { root, float, glow, beam, type, born: performance.now() / 1000 };
}

// =====================================================================
// 界面 / 网络
// =====================================================================
const screens = ['menu', 'lobby', 'gameOver'];
function show(name) {
  for (const s of screens) $(s).classList.toggle('hidden', s !== name);
  const inGame = name === null;
  $('hud').classList.toggle('hidden', !inGame);
  $('touchUI').classList.toggle('hidden', !(inGame && isTouch));
  document.body.classList.toggle('touch', isTouch);
}

const params = new URLSearchParams(location.search);
try {
  $('nameInput').value = localStorage.getItem('bb_name') || '';
} catch {
  /* 忽略 */
}
if (params.get('room')) $('codeInput').value = params.get('room').toUpperCase();

function connect(code) {
  const name = $('nameInput').value.trim();
  try {
    localStorage.setItem('bb_name', name);
  } catch {
    /* 忽略 */
  }
  $('menuError').textContent = '连接中…';
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', room: code, name }));
  ws.onmessage = (e) => onMessage(JSON.parse(e.data));
  ws.onclose = () => {
    if (myId !== null) {
      myId = null;
      state = null;
      show('menu');
      $('menuError').textContent = '与服务器断开连接';
    }
  };
  ws.onerror = () => {
    $('menuError').textContent = '无法连接服务器';
  };
}

function sendMsg(msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

$('createBtn').onclick = () => connect('');
$('joinBtn').onclick = () => {
  const code = $('codeInput').value.trim().toUpperCase();
  if (code.length !== 4) {
    $('menuError').textContent = '请输入 4 位房间码';
    return;
  }
  connect(code);
};
$('codeInput').addEventListener('keydown', (e) => e.key === 'Enter' && $('joinBtn').click());
$('startBtn').onclick = () => sendMsg({ t: 'start' });
$('againBtn').onclick = () => sendMsg({ t: 'start' });
$('lobbyBtn').onclick = () => sendMsg({ t: 'toLobby' });
$('addBotBtn').onclick = () => sendMsg({ t: 'addBot' });
$('removeBotBtn').onclick = () => sendMsg({ t: 'removeBot' });
for (const b of $('winPicker').querySelectorAll('button')) {
  b.onclick = () => sendMsg({ t: 'setWin', v: Number(b.dataset.v) });
}
$('copyBtn').onclick = async () => {
  const link = `${location.origin}${location.pathname}?room=${state.code}`;
  try {
    await navigator.clipboard.writeText(link);
    $('copyBtn').textContent = '已复制！发给朋友吧';
  } catch {
    prompt('复制这个链接发给朋友：', link);
  }
  setTimeout(() => ($('copyBtn').textContent = '复制邀请链接'), 2000);
};

function onMessage(msg) {
  if (msg.t === 'error') {
    $('menuError').textContent = msg.msg;
    myId = null;
    ws.close();
    return;
  }
  if (msg.t === 'joined') {
    myId = msg.id;
    if (msg.rings) RINGS = msg.rings;
    $('menuError').textContent = '';
    history.replaceState(null, '', `?room=${msg.code}`);
    return;
  }
  if (msg.t === 'state') {
    state = msg;
    syncCollapsed(state.phase === 'lobby' ? 0 : state.collapsed);
    handleEvents(msg.events);
    updateUI();
  }
}

let toastTimer = 0;
function toast(html) {
  $('toast').innerHTML = html;
  $('toast').style.opacity = 1;
  toastTimer = 1.8;
}
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const views = new Map(); // 玩家 id -> 3D 模型
const itemViews = new Map(); // 道具 id -> 3D 模型

function handleEvents(events) {
  for (const ev of events) {
    const nameOf = (id) => state.players.find((p) => p.id === id)?.name || '';
    if (ev.type === 'hit') {
      const n = Math.min(16, Math.floor(ev.power / 40));
      burst(ev.x, 22, ev.y, '#ffe9a8', n, 120 + ev.power * 0.25, 6, 0.3);
      shake = Math.min(14, shake + ev.power / 90);
      for (const id of [ev.a, ev.b]) {
        const v = views.get(id);
        if (v) v.squashV += Math.min(5, ev.power / 100);
      }
      beep(160 + Math.random() * 80, 0.12, 'square', 0.06, -90);
    } else if (ev.type === 'dash') {
      const v = views.get(ev.id);
      if (v) {
        puff(v.x, v.z, 6);
        v.squashV -= 4;
      }
      if (ev.id === myId) beep(500, 0.1, 'sawtooth', 0.04, 400);
    } else if (ev.type === 'fall') {
      beep(420, 0.6, 'triangle', 0.1, -360);
      if (ev.id === myId) shake = 16;
    } else if (ev.type === 'pickup') {
      const info = ITEM_INFO[ev.item];
      burst(ev.x, 20, ev.y, info.color, 26, 180, 8);
      beep(700, 0.1, 'square', 0.06, 500);
      setTimeout(() => beep(1100, 0.15, 'square', 0.05, 400), 90);
      if (ev.id === myId) toast(`${info.icon} 你获得了<span style="color:${info.color}">${info.name}</span>！`);
      else if (ev.item === 'bomb') toast(`💣 ${esc(nameOf(ev.id))} 引爆了炸弹！`);
    } else if (ev.type === 'shock') {
      shockwave(ev.x, ev.y, ev.r);
      burst(ev.x, 15, ev.y, '#ff8c42', 60, 380, 10);
      burst(ev.x, 15, ev.y, '#ffe066', 30, 250, 8);
      puff(ev.x, ev.y, 20, '#9a8878');
      shake = Math.max(shake, 16);
      boom(0.9, 0.35, 900);
    } else if (ev.type === 'collapse') {
      toast('💥 外圈坍塌了！');
    }
  }
}

function playerLi(p, right) {
  const li = document.createElement('li');
  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.style.background = p.color;
  const name = document.createElement('span');
  name.textContent = p.name + (p.id === myId ? '（你）' : '');
  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = right;
  li.append(dot, name, tag);
  return li;
}

function updateUI() {
  const s = state;
  const isHost = s.hostId === myId;
  const me = s.players.find((p) => p.id === myId);

  if (s.phase !== lastPhase) {
    if (s.phase === 'countdown') beep(440, 0.15, 'square', 0.06);
    if (s.phase === 'playing') beep(880, 0.25, 'square', 0.07);
    if (s.phase === 'roundEnd') beep(660, 0.3, 'triangle', 0.08, 300);
    lastPhase = s.phase;
  }

  if (s.phase === 'lobby') {
    show('lobby');
    $('roomCode').textContent = s.code;
    const list = $('playerList');
    list.innerHTML = '';
    for (const p of s.players) list.append(playerLi(p, p.id === s.hostId ? '房主' : p.bot ? '机器人' : ''));
    $('hostControls').classList.toggle('hidden', !isHost);
    $('waitHost').classList.toggle('hidden', isHost);
    $('winPicker').classList.toggle('locked', !isHost);
    for (const b of $('winPicker').querySelectorAll('button')) b.classList.toggle('on', Number(b.dataset.v) === s.winScore);
  } else if (s.phase === 'gameOver') {
    show('gameOver');
    const champ = s.players.find((p) => p.id === s.winner);
    $('champName').textContent = champ ? `${champ.name} 获得冠军！` : '游戏结束';
    const list = $('finalList');
    list.innerHTML = '';
    [...s.players]
      .sort((a, b) => b.score - a.score || b.kills - a.kills)
      .forEach((p) => list.append(playerLi(p, `${p.score} 胜 · 撞飞 ${p.kills}`)));
    $('overHost').classList.toggle('hidden', !isHost);
    $('overWait').classList.toggle('hidden', isHost);
  } else {
    show(null);
  }

  // 计分板
  const sb = $('scoreboard');
  sb.innerHTML = `<div style="color:#b7b0e0;margin-bottom:4px">第 ${s.round} 局 · 先到 ${s.winScore} 分</div>`;
  for (const p of [...s.players].sort((a, b) => b.score - a.score)) {
    const row = document.createElement('div');
    row.className = 'row' + (p.alive ? '' : ' out');
    row.innerHTML = `<span class="dot" style="background:${p.color}"></span><span></span><span class="pts">${p.score}</span>`;
    row.children[1].textContent = p.name + (p.id === myId ? '（你）' : '');
    sb.append(row);
  }

  // 中央横幅
  let banner = '';
  if (s.phase === 'countdown') banner = String(Math.ceil(s.timer) || '开始！');
  else if (s.phase === 'playing' && me && !me.alive && s.round > 0) banner = '<span style="font-size:24px">你出局了，观战中…</span>';
  else if (s.phase === 'playing' && s.warn >= 0) banner = `<span style="font-size:26px;color:#ff7b7f">⚠ 外圈即将坍塌 ${Math.ceil(s.warn)}</span>`;
  else if (s.phase === 'roundEnd') {
    const w = s.players.find((p) => p.id === s.winner);
    banner = w ? `${esc(w.name)} 赢了这局！` : '平局！';
  }
  $('banner').innerHTML = banner;

  // 自己的道具效果
  const fxBox = $('effects');
  fxBox.innerHTML = '';
  if (me && me.alive) {
    for (const k of ['big', 'speed', 'shield']) {
      if (me.fx[k] > 0) {
        const d = document.createElement('div');
        d.className = 'fx';
        d.style.color = ITEM_INFO[k].color;
        d.textContent = `${ITEM_INFO[k].icon} ${ITEM_INFO[k].name} ${me.fx[k].toFixed(1)}s`;
        fxBox.append(d);
      }
    }
  }

  if (me) $('dashBtn').classList.toggle('cooling', me.dashCd > 0);
}

// =====================================================================
// 输入
// =====================================================================
const keys = new Set();
let dashQueued = false;
const touchDir = { x: 0, y: 0 };

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') {
    if (e.key === 'Enter' && e.target.id === 'nameInput') $('createBtn').click();
    return;
  }
  keys.add(e.code);
  if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'KeyJ') {
    dashQueued = true;
    e.preventDefault();
  }
  if (e.code.startsWith('Arrow')) e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

// 摇杆：左半屏任意位置按下即生成
const stick = $('stick');
const knob = $('knob');
let stickTouch = null;
let stickOrigin = null;
window.addEventListener(
  'touchstart',
  (e) => {
    if (!isTouch) {
      isTouch = true;
      if (state) updateUI();
    }
    if (!state || state.phase === 'lobby' || state.phase === 'gameOver') return;
    for (const t of e.changedTouches) {
      if (t.clientX < window.innerWidth / 2 && stickTouch === null) {
        stickTouch = t.identifier;
        stickOrigin = { x: t.clientX, y: t.clientY };
        stick.style.left = t.clientX - 65 + 'px';
        stick.style.top = t.clientY - 65 + 'px';
        stick.style.bottom = 'auto';
      }
    }
  },
  { passive: true }
);
window.addEventListener(
  'touchmove',
  (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== stickTouch) continue;
      let dx = t.clientX - stickOrigin.x;
      let dy = t.clientY - stickOrigin.y;
      const d = Math.hypot(dx, dy);
      const max = 50;
      if (d > max) {
        dx = (dx / d) * max;
        dy = (dy / d) * max;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      touchDir.x = dx / max;
      touchDir.y = dy / max;
    }
  },
  { passive: true }
);
const endTouch = (e) => {
  for (const t of e.changedTouches) {
    if (t.identifier === stickTouch) {
      stickTouch = null;
      touchDir.x = touchDir.y = 0;
      knob.style.transform = '';
    }
  }
};
window.addEventListener('touchend', endTouch);
window.addEventListener('touchcancel', endTouch);
$('dashBtn').addEventListener('touchstart', (e) => {
  e.preventDefault();
  e.stopPropagation();
  dashQueued = true;
});
$('dashBtn').addEventListener('mousedown', () => (dashQueued = true));

function readInput() {
  let x = 0;
  let y = 0;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
  if (keys.has('KeyW') || keys.has('ArrowUp')) y -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) y += 1;
  return { x: x + touchDir.x, y: y + touchDir.y };
}

let lastSent = '';
setInterval(() => {
  if (!state || myId === null) return;
  const inp = readInput();
  const msg = { t: 'input', x: +inp.x.toFixed(2), y: +inp.y.toFixed(2), dash: dashQueued };
  const key = JSON.stringify(msg);
  if (key !== lastSent || dashQueued) {
    sendMsg(msg);
    lastSent = key;
  }
  dashQueued = false;
}, 1000 / 30);

// =====================================================================
// 每帧更新
// =====================================================================
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const scale = (renderer.getDrawingBufferSize(new THREE.Vector2()).y / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  sparks.mat.uniforms.uScale.value = scale;
  dust.mat.uniforms.uScale.value = scale;
}
window.addEventListener('resize', resize);
resize();

function lerpAngle(a, b, k) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

function updatePlayers(dt, t, rdt) {
  const ids = new Set();
  const phase = state ? state.phase : 'menu';
  const inRound = phase === 'countdown' || phase === 'playing' || phase === 'roundEnd';
  const players = state ? state.players : [];
  const k = 1 - Math.exp(-rdt * 18);
  let me = null;

  players.forEach((p, idx) => {
    ids.add(p.id);
    let v = views.get(p.id);
    if (v && (v.color !== p.color || v.name !== p.name)) {
      disposeView(v);
      v = null;
    }
    if (!v) {
      v = makePlayerModel(p);
      views.set(p.id, v);
    }

    let visible;
    let tx = p.x;
    let tz = p.y;
    let yawTarget = v.yaw;
    let speed = Math.hypot(p.vx, p.vy);
    if (inRound) {
      visible = p.alive || p.falling;
      if (speed > 25) yawTarget = Math.atan2(p.vx, p.vy);
    } else {
      // 大厅 / 结算：大家在场地上围成一圈转
      visible = true;
      const a = t * 0.25 + (idx / players.length) * Math.PI * 2;
      tx = Math.cos(a) * 150;
      tz = Math.sin(a) * 150;
      yawTarget = Math.atan2(camera.position.x - tx, camera.position.z - tz);
      speed = 0;
    }

    // 平滑插值到服务器位置
    if (Math.hypot(tx - v.x, tz - v.z) > 150 || !v.root.visible) {
      v.x = tx;
      v.z = tz;
    } else {
      v.x += (tx - v.x) * k;
      v.z += (tz - v.z) * k;
    }
    v.yaw = lerpAngle(v.yaw, yawTarget, 1 - Math.exp(-rdt * 10));

    // 掉进岩浆
    if (inRound && p.falling) {
      v.fvy -= 900 * rdt;
      v.fy += v.fvy * rdt;
      if (v.fy + p.r < LAVA_Y - p.r && !v.splashed) {
        v.splashed = true;
        splash(v.x, v.z, 30);
        visible = false;
      }
      if (v.splashed) visible = false;
    } else {
      v.fy = 0;
      v.fvy = 0;
      v.splashed = false;
    }

    // 挤压回弹（弹簧）
    v.squashV += (-120 * v.squash - 9 * v.squashV) * dt;
    v.squash += v.squashV * dt;
    v.squash = Math.max(-0.28, Math.min(0.28, v.squash));

    // 移动时一蹦一蹦
    const moving = Math.min(1, speed / 250);
    v.hop += dt * (8 + moving * 10);
    const hopY = moving > 0.1 ? Math.abs(Math.sin(v.hop)) * 0.12 * moving : 0;
    const celebrate = phase === 'roundEnd' && state.winner === p.id ? Math.abs(Math.sin(t * 6)) * 0.9 : 0;
    const lobbyBob = inRound ? 0 : Math.abs(Math.sin(t * 3 + idx)) * 0.25;

    v.scale += (p.r - v.scale) * (1 - Math.exp(-rdt * 8));
    const s = v.scale;
    v.root.visible = visible;
    v.root.position.set(v.x, s * (1 + hopY + celebrate + lobbyBob) + v.fy, v.z);
    v.root.scale.setScalar(s);
    v.root.rotation.y = v.yaw;
    v.body.scale.set(1 + v.squash * 0.5, 1 - v.squash, 1 + v.squash * 0.5);
    v.body.rotation.x = Math.min(0.35, speed / 900);

    // 眨眼
    v.blink -= dt;
    const closed = v.blink < 0.12;
    if (v.blink < 0) v.blink = 2 + Math.random() * 4;
    for (const e of v.eyes) e.scale.y = closed ? 0.12 : 1;

    // 头饰动画
    v.acc.traverse((o) => {
      if (o.userData.spin) o.rotation.y += o.userData.spin * dt;
    });

    // 道具效果
    const shieldOn = inRound && p.fx.shield > 0;
    v.shield.visible = shieldOn && (p.fx.shield > 1.5 || Math.sin(t * 25) > 0);
    v.wire.rotation.y += dt * 1.5;
    v.wire.rotation.x += dt * 0.7;
    const speedOn = inRound && p.fx.speed > 0;
    v.bodyMat.emissiveIntensity = speedOn ? 0.35 + 0.25 * Math.sin(t * 20) : 0;
    if (speedOn && speed > 80 && visible && Math.random() < rdt * 40) {
      sparks.add({ x: v.x + (Math.random() - 0.5) * 10, y: s * 0.6, z: v.z + (Math.random() - 0.5) * 10, vx: 0, vy: 20, vz: 0, life: 0.35, color: '#ffd23f', size: 8, g: 0 });
    }
    if (inRound && p.fx.big > 0 && speed > 150 && Math.random() < rdt * 12) puff(v.x, v.z, 1, '#cbb893');

    // 名字
    v.label.visible = visible;
    v.label.position.set(v.x, v.root.position.y + s * 1.6 + 14, v.z);

    if (p.id === myId) me = { p, v, visible };
  });

  for (const [id, v] of views) {
    if (!ids.has(id)) {
      disposeView(v);
      views.delete(id);
    }
  }

  // 自己的标记
  const showMe = me && me.visible && inRound && !me.p.falling;
  myRing.visible = myArrow.visible = !!showMe;
  if (showMe) {
    const ready = me.p.dashCd <= 0;
    myRing.position.set(me.v.x, 1.2, me.v.z);
    myRing.scale.setScalar(me.v.scale * (ready ? 1 + 0.06 * Math.sin(t * 8) : 1));
    myRing.material.color.set(ready ? '#ffd23f' : '#8a84b8');
    myRing.material.opacity = ready ? 0.95 : 0.5 + 0.4 * (1 - me.p.dashCd / DASH_COOLDOWN);
    myArrow.position.set(me.v.x, me.v.root.position.y + me.v.scale * 1.6 + 30 + Math.sin(t * 5) * 3, me.v.z);
    myArrow.rotation.y = t * 2;
  }
  return me;
}

function updateItems(dt, t) {
  const ids = new Set();
  const inRound = state && (state.phase === 'playing' || state.phase === 'roundEnd' || state.phase === 'countdown');
  if (inRound) {
    for (const it of state.items) {
      ids.add(it.id);
      let v = itemViews.get(it.id);
      if (!v) {
        v = makeItemModel(it.type);
        itemViews.set(it.id, v);
        burst(it.x, 10, it.y, ITEM_INFO[it.type].color, 14, 120, 6);
      }
      const age = t - v.born;
      const pop = Math.min(1, age * 3);
      const popScale = pop < 1 ? pop * (1 + Math.sin(pop * Math.PI) * 0.4) : 1;
      v.root.position.set(it.x, 0, it.y);
      v.float.position.y = 30 + Math.sin(t * 3 + it.id) * 5;
      v.float.rotation.y = t * 1.8;
      v.float.scale.setScalar(1.5 * popScale);
      v.glow.material.opacity = 0.55 + 0.3 * Math.sin(t * 5 + it.id);
      v.beam.material.opacity = 0.16 + 0.08 * Math.sin(t * 4 + it.id);
      v.float.traverse((o) => {
        if (o.userData.spark) o.scale.setScalar(0.6 + Math.random() * 0.8);
      });
      if (it.type === 'bomb' && Math.random() < dt * 18) {
        sparks.add({ x: it.x + 3, y: v.float.position.y + 25, z: it.y, vx: (Math.random() - 0.5) * 40, vy: 40, vz: (Math.random() - 0.5) * 40, life: 0.3, color: '#ffe066', size: 5, g: 100 });
      }
    }
  }
  for (const [id, v] of itemViews) {
    if (!ids.has(id)) {
      scene.remove(v.root);
      itemViews.delete(id);
    }
  }
}

// ---- 摄像机 ----
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3(0, 600, 800);
const CAM_DIR = new THREE.Vector3(0, Math.sin(THREE.MathUtils.degToRad(52)), Math.cos(THREE.MathUtils.degToRad(52)));

function updateCamera(dt, t, me) {
  const phase = state ? state.phase : 'menu';
  const inRound = phase === 'countdown' || phase === 'playing' || phase === 'roundEnd';
  const want = new THREE.Vector3();
  const look = new THREE.Vector3();
  if (!inRound) {
    // 菜单 / 大厅：缓慢环绕浮岛
    const a = t * 0.12;
    const near = phase === 'lobby' || phase === 'gameOver';
    const r = near ? 560 : 760;
    want.set(Math.sin(a) * r, near ? 300 : 420, Math.cos(a) * r);
    look.set(0, near ? 0 : -30, 0);
  } else {
    const aspect = camera.aspect;
    const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const fitW = 380 / (tanH * aspect);
    const fitH = 880;
    let dist = Math.max(fitW, fitH);
    let follow = 0.12;
    const cap = 1050;
    if (dist > cap) {
      follow = Math.min(0.75, (dist - cap) / dist + 0.25);
      dist = cap;
    }
    if (me && me.visible && !me.p.falling) look.set(me.v.x * follow, 0, me.v.z * follow + 30);
    else look.set(0, 0, 30);
    // 场地缩小后镜头慢慢拉近
    const shrink = state ? RINGS[state.collapsed] / RINGS[0] : 1;
    dist *= 0.75 + 0.25 * shrink;
    want.copy(look).addScaledVector(CAM_DIR, dist);
  }
  const k = 1 - Math.exp(-dt * (inRound ? 4 : 1.5));
  camPos.lerp(want, k);
  camTarget.lerp(look, k);
  shake *= Math.pow(0.02, dt);
  camera.position.copy(camPos);
  camera.position.x += (Math.random() - 0.5) * shake;
  camera.position.y += (Math.random() - 0.5) * shake;
  camera.lookAt(camTarget);
}

let lastFrame = performance.now();
function frame(now) {
  const rdt = Math.min(0.25, (now - lastFrame) / 1000); // 真实时间（低帧率时特效也按时消失）
  const dt = Math.min(0.05, rdt); // 弹簧等需要小步长的计算
  lastFrame = now;
  const t = now / 1000;

  lavaMat.uniforms.uTime.value = t;
  lavaLight.intensity = 3.2 + Math.sin(t * 2.1) * 0.4 + Math.sin(t * 5.3) * 0.2;
  for (const f of floaters) {
    f.a += f.sp * dt;
    f.m.position.set(Math.cos(f.a) * f.r, f.y + Math.sin(t + f.r) * 8, Math.sin(f.a) * f.r);
    f.m.rotation.x += dt * 0.2;
    f.m.rotation.y += dt * 0.3;
  }
  // 岩浆火星
  for (let i = 0; i < Math.round(rdt * 150); i++) {
    if (Math.random() < 0.8) {
      const a = Math.random() * Math.PI * 2;
      const r = 150 + Math.random() * 900;
      sparks.add({ x: Math.cos(a) * r, y: LAVA_Y + 5, z: Math.sin(a) * r, vx: (Math.random() - 0.5) * 20, vy: 40 + Math.random() * 60, vz: (Math.random() - 0.5) * 20, life: 2 + Math.random() * 3, color: Math.random() < 0.5 ? '#ff7a1a' : '#ffb347', size: 4 + Math.random() * 4, g: -5, drag: 0.99 });
    }
  }

  updateTiles(rdt, t);
  const me = updatePlayers(dt, t, rdt);
  updateItems(rdt, t);

  for (let i = shockwaves.length - 1; i >= 0; i--) {
    const s = shockwaves[i];
    s.t += rdt;
    const k = Math.min(1, s.t / 0.45);
    s.m.scale.setScalar(Math.max(0.01, s.r * Math.sqrt(k)));
    s.m.material.opacity = 0.9 * (1 - k);
    if (k >= 1) {
      scene.remove(s.m);
      s.m.geometry.dispose();
      s.m.material.dispose();
      shockwaves.splice(i, 1);
    }
  }

  if (toastTimer > 0) {
    toastTimer -= rdt;
    if (toastTimer <= 0) $('toast').style.opacity = 0;
  }

  sparks.update(rdt);
  dust.update(rdt);
  updateCamera(rdt, t, me);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

$('loading').classList.add('hidden');
show('menu');
requestAnimationFrame(frame);
