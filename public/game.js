// 碰碰球大乱斗 3D —— 客户端（Three.js 渲染）
import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const DASH_COOLDOWN = 1.2;
const LIQUID_Y = -150;
const TILE_H = 26;
const COLORS = ['#ff5a5f', '#3fa7ff', '#ffd23f', '#3ddc84', '#b06cff', '#ff8c42', '#2ee6d6', '#ff6fb5'];
const TEAM_COLORS = ['#ff4d5a', '#3f8cff'];
const TEAM_NAMES = ['红队', '蓝队'];
const ITEM_INFO = {
  big: { icon: '🍄', name: '巨大化', color: '#ff5a5f' },
  speed: { icon: '⚡', name: '加速', color: '#ffd23f' },
  shield: { icon: '🛡️', name: '护盾', color: '#3fa7ff' },
  bomb: { icon: '💣', name: '炸弹', color: '#ff8c42' },
  freeze: { icon: '❄️', name: '冰冻', color: '#8fe3ff' },
  ghost: { icon: '👻', name: '幽灵', color: '#d9d2ff' },
  tornado: { icon: '🌪️', name: '龙卷风', color: '#9ff0c0' },
  banana: { icon: '🍌', name: '香蕉皮', color: '#ffe066' },
};
const MAP_INFO = {
  lava: { icon: '🌋', name: '熔岩浮岛', desc: '外圈一层层塌进岩浆' },
  ice: { icon: '🧊', name: '冰川碎冰', desc: '冰面超滑，冰块随机碎裂' },
  space: { icon: '🪐', name: '星际空间站', desc: '陨石雨砸穿地板' },
  candy: { icon: '🍭', name: '糖果乐园', desc: '软糖弹簧会把人弹飞' },
};
const MODE_INFO = {
  classic: { icon: '🥊', name: '经典乱斗', desc: '活到最后得 1 分', targets: [3, 5, 7], label: '先赢', unit: '局', respawn: false },
  team: { icon: '⚔️', name: '团队对抗', desc: '红蓝对战，全灭对面得分', targets: [3, 5, 7], label: '先赢', unit: '局', respawn: false },
  crown: { icon: '👑', name: '抢皇冠', desc: '戴冠计时，撞人抢冠', targets: [20, 30, 45], label: '先拿满', unit: '秒', respawn: true },
  knockout: { icon: '💥', name: '击飞大赛', desc: '无限复活，比谁击飞多', targets: [60, 90, 120], label: '比赛', unit: '秒', respawn: true },
};

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
scene.fog = new THREE.Fog('#6a2230', 1500, 4200);
const camera = new THREE.PerspectiveCamera(45, 1, 10, 12000);

const hemi = new THREE.HemisphereLight('#9fb0ff', '#ff6a2a', 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff0dc', 2.6);
sun.position.set(300, 800, 380);
sun.castShadow = true;
sun.shadow.mapSize.set(isTouch ? 1024 : 2048, isTouch ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -600, right: 600, top: 600, bottom: -600, near: 100, far: 2000 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 1.5;
scene.add(sun);
// 从下方照亮浮岛（岩浆 / 海水 / 星球的反光）
const underLight = new THREE.PointLight('#ff5a1a', 3.5, 1400, 0);
underLight.position.set(0, LIQUID_Y + 30, 0);
scene.add(underLight);

// ---- 天空 ----
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  fog: false,
  uniforms: {
    uTop: { value: new THREE.Color('#0d0820') },
    uMid: { value: new THREE.Color('#3a1240') },
    uHorizon: { value: new THREE.Color('#6a2230') },
    uStars: { value: 0.8 },
    uTime: { value: 0 },
  },
  vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHorizon; uniform float uStars; uniform float uTime; varying vec3 vDir;
    float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
    void main(){
      float h = vDir.y;
      vec3 col = mix(uHorizon, uMid, smoothstep(-0.05, 0.25, h));
      col = mix(col, uTop, smoothstep(0.2, 0.7, h));
      vec3 cell = floor(vDir * 320.0);
      float r = hash(cell);
      float tw = 0.6 + 0.4 * sin(uTime * 2.0 + r * 40.0);
      float star = step(1.0 - 0.004 * uStars, r) * smoothstep(-0.6, 0.3, h) * tw;
      col += vec3(star) * 0.9;
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(10000, 32, 16), skyMat);
scene.add(sky);

// ---- 液面（岩浆 / 海水 / 草莓牛奶，程序化噪声） ----
const liquidMat = new THREE.ShaderMaterial({
  fog: true,
  uniforms: THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uA: { value: new THREE.Color() },
      uB: { value: new THREE.Color() },
      uC: { value: new THREE.Color() },
      uGlow: { value: new THREE.Color() },
      uMode: { value: 0 },
      uBoost: { value: 1 },
    },
  ]),
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
    uniform float uTime; uniform vec3 uA; uniform vec3 uB; uniform vec3 uC; uniform vec3 uGlow; uniform float uMode; uniform float uBoost;
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
      vec3 col;
      if (uMode < 0.5) {
        float glow = 1.0 - smoothstep(0.3, 0.47, n);
        vec3 dark = uA * (0.7 + 0.6 * noise(p * 18.0));
        col = mix(dark, uB, glow);
        col = mix(col, uC * uBoost, glow * glow * glow);
        col *= 0.85 + 0.15 * sin(uTime * 1.5 + n * 10.0);
      } else if (uMode < 1.5) {
        col = mix(uA, uB, smoothstep(0.3, 0.7, n));
        float floe = smoothstep(0.62, 0.66, fbm(p * 2.5 + vec2(t * 0.4, 1.7)));
        col = mix(col, uC, floe * 0.85);
        float sparkle = pow(max(0.0, noise(p * 70.0 + uTime * 0.4) - 0.82) * 5.5, 3.0);
        col += sparkle * 0.5;
      } else {
        float s = sin((p.x * 0.7 + p.y) * 7.0 + n * 9.0 + uTime * 0.25);
        col = mix(uA, uB, smoothstep(-0.4, 0.4, s));
        col = mix(col, uC, smoothstep(0.62, 0.72, n) * 0.5);
      }
      float d = length(vWorld.xz);
      col += uGlow * smoothstep(800.0, 300.0, d) * 0.35;
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }`,
});
const liquid = new THREE.Mesh(new THREE.PlaneGeometry(14000, 14000), liquidMat);
liquid.rotation.x = -Math.PI / 2;
liquid.position.y = LIQUID_Y;
scene.add(liquid);

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

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...o });

// 条纹贴图（拐杖糖、星球光环）
function stripeTexture(colors, count) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 16;
  const g = c.getContext('2d');
  const n = colors.length * count;
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[i % colors.length];
    g.fillRect((i * 256) / n, 0, 256 / n + 1, 16);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
// 棒棒糖的螺旋花纹
function swirlTexture(colors) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  for (let i = 0; i < 24; i++) {
    g.fillStyle = colors[i % colors.length];
    g.beginPath();
    g.moveTo(128, 128);
    for (let a = 0; a <= 1.01; a += 0.05) {
      const ang = (i / 24) * Math.PI * 2 + a * 5;
      g.lineTo(128 + Math.cos(ang) * a * 128, 128 + Math.sin(ang) * a * 128);
    }
    for (let a = 1; a >= 0; a -= 0.05) {
      const ang = ((i + 1) / 24) * Math.PI * 2 + a * 5;
      g.lineTo(128 + Math.cos(ang) * a * 128, 128 + Math.sin(ang) * a * 128);
    }
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// =====================================================================
// 地图主题：天空、液面、灯光、地砖配色、周边装饰、环境粒子
// =====================================================================
const THEMES = {
  lava: {
    sky: ['#0d0820', '#3a1240', '#6a2230'],
    stars: 0.8,
    fog: ['#6a2230', 1500, 4200],
    liquid: { mode: 0, a: '#4a2226', b: '#f26b26', c: '#ffe07a', glow: '#ff5a10', boost: 1.8 },
    hemi: ['#9fb0ff', '#ff6a2a', 0.9],
    sun: ['#fff0dc', 2.6],
    under: ['#ff5a1a', 3.5],
    floor: { cols: ['#e6d3ae', '#d4bf95', '#dcc8a0'], center: ['#9aa3d6', '#8790c8'], rough: 0.8, metal: 0, side: '#7a5c4a' },
    splash: ['#ff7a1a', '#ffd23f'],
    ambient: 'embers',
  },
  ice: {
    sky: ['#2f7fcf', '#8cc8f0', '#e3f4ff'],
    stars: 0,
    fog: ['#d8eefa', 1500, 4500],
    liquid: { mode: 1, a: '#07294d', b: '#1a64a0', c: '#eaf8ff', glow: '#000000', boost: 1 },
    hemi: ['#ffffff', '#6fb6e6', 1.1],
    sun: ['#ffffff', 2.3],
    under: ['#5fc8ff', 1.0],
    floor: { cols: ['#eef9ff', '#d3edfa', '#e0f3fc'], center: ['#eef9ff', '#d3edfa'], rough: 0.1, metal: 0.05, side: '#8cc8e8' },
    splash: ['#bfe9ff', '#ffffff'],
    ambient: 'snow',
  },
  space: {
    sky: ['#02010a', '#0a0a2a', '#1b1245'],
    stars: 2,
    fog: ['#0d0b26', 3500, 11000],
    liquid: null,
    hemi: ['#8fa0ff', '#40306a', 0.8],
    sun: ['#ffffff', 2.8],
    under: ['#8a5cff', 2.2],
    floor: { cols: ['#4b5478', '#3d4566', '#555f88'], center: ['#6a55a8', '#5b4896', '#7461b8'], rough: 0.4, metal: 0.6, side: '#232842', sideGlow: '#19d3ff' },
    splash: null,
    ambient: 'dust',
  },
  candy: {
    sky: ['#ff8cc6', '#ffc2e0', '#fff0f6'],
    stars: 0,
    fog: ['#ffe3f0', 1500, 4500],
    liquid: { mode: 2, a: '#ffa3cf', b: '#fff0f7', c: '#ffffff', glow: '#000000', boost: 1 },
    hemi: ['#fff5fb', '#ff9ecf', 1.0],
    sun: ['#fff8f0', 2.3],
    under: ['#ff7ab8', 1.0],
    floor: { cols: ['#f7d49c', '#ffb3d1', '#f7d49c'], center: ['#8fdcff', '#7fcfef'], rough: 0.55, metal: 0, side: '#6b3a24' },
    splash: ['#ffb3d1', '#ffffff'],
    ambient: 'sprinkles',
  },
};

let theme = THEMES.lava;
let mapDef = null;
const arena = new THREE.Group();
const decor = new THREE.Group();
scene.add(arena, decor);
let tiles = [];
let bumpers = [];
let arenaR = 460;
const floaters = [];
const rockMat = std('#4a3436', { roughness: 0.95, flatShading: true });

function disposeGroup(g) {
  g.traverse((o) => {
    if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m !== rockMat && m.dispose());
  });
  g.clear();
}

function tileShape(t, inset) {
  const s = new THREE.Shape();
  if (t.k === 's') {
    const rOut = t.rOut - inset;
    const rIn = t.rIn > 0 ? t.rIn + inset : 0;
    const gap = inset / t.rOut;
    const a0 = t.a0 + gap;
    const a1 = t.a1 - gap;
    s.moveTo(Math.cos(a0) * rOut, Math.sin(a0) * rOut);
    s.absarc(0, 0, rOut, a0, a1, false);
    if (rIn > 0) {
      s.lineTo(Math.cos(a1) * rIn, Math.sin(a1) * rIn);
      s.absarc(0, 0, rIn, a1, a0, true);
    } else {
      s.lineTo(0, 0);
    }
  } else if (t.k === 'q') {
    const h = t.s / 2 - inset;
    const r = 8;
    const x0 = t.x - h;
    const y0 = t.y - h;
    const x1 = t.x + h;
    const y1 = t.y + h;
    s.moveTo(x0 + r, y0);
    s.lineTo(x1 - r, y0);
    s.quadraticCurveTo(x1, y0, x1, y0 + r);
    s.lineTo(x1, y1 - r);
    s.quadraticCurveTo(x1, y1, x1 - r, y1);
    s.lineTo(x0 + r, y1);
    s.quadraticCurveTo(x0, y1, x0, y1 - r);
    s.lineTo(x0, y0 + r);
    s.quadraticCurveTo(x0, y0, x0 + r, y0);
  } else {
    const r = t.r - inset * 1.15;
    for (let i = 0; i < 6; i++) {
      const a = ((60 * i - 30) * Math.PI) / 180;
      const px = t.x + Math.cos(a) * r;
      const py = t.y + Math.sin(a) * r;
      if (i === 0) s.moveTo(px, py);
      else s.lineTo(px, py);
    }
  }
  return s;
}

function buildArena(def) {
  disposeGroup(arena);
  tiles = [];
  bumpers = [];
  const f = theme.floor;
  const bevel = 2.5;
  const isIce = theme === THEMES.ice;
  const sideMat = std(f.side, { roughness: 0.85, flatShading: true, emissive: f.sideGlow || '#000000', emissiveIntensity: f.sideGlow ? 0.7 : 0 });
  const underMat = isIce
    ? new THREE.MeshStandardMaterial({ color: '#cfefff', roughness: 0.1, transparent: true, opacity: 0.85 })
    : std(theme === THEMES.candy ? '#5a2f1c' : '#2e2026', { roughness: 1, flatShading: true });
  const stalGeos = [0, 1, 2].map((k) =>
    isIce ? new THREE.ConeGeometry(6 + k * 2, 26 + k * 12, 6).rotateX(Math.PI) : rockify(new THREE.ConeGeometry(12 + k * 4, 40 + k * 22, 5, 2), 0.1, k + 9).rotateX(Math.PI)
  );
  def.tiles.forEach((t, i) => {
    const isCenter = t.l >= def.center;
    const palette = isCenter ? f.center : f.cols;
    const col = new THREE.Color(palette[t.c % palette.length]);
    if (isIce) col.offsetHSL(0, 0, Math.sin(i * 12.9898) * 0.02);
    const top = std(col, { roughness: f.rough, metalness: f.metal, emissive: '#ff2a00', emissiveIntensity: 0 });
    const geo = new THREE.ExtrudeGeometry(tileShape(t, 3), {
      depth: TILE_H,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 2,
      curveSegments: t.k === 's' ? 5 : 2,
    });
    // 形状在 (x, y) 平面，转到 3D 后 y -> z，挤出方向朝下，顶面在 y = 0
    geo.rotateX(Math.PI / 2);
    geo.translate(-t.cx, -bevel, -t.cy);
    const m = new THREE.Mesh(geo, [top, sideMat]);
    m.position.set(t.cx, 0, t.cy);
    m.receiveShadow = true;
    // 地砖底下挂一点岩石 / 冰锥
    if ((theme === THEMES.lava || isIce) && (i * 7 + t.l) % 3 !== 0) {
      const st = new THREE.Mesh(stalGeos[(i * 5) % 3], underMat);
      st.position.y = -TILE_H - (isIce ? 10 : 20);
      m.add(st);
    }
    // 太空站：地砖底部的推进器灯
    if (theme === THEMES.space && i % 4 === 0) {
      const th = new THREE.Mesh(new THREE.CylinderGeometry(8, 12, 10, 8), std('#1a1d30', { metalness: 0.8, emissive: '#19d3ff', emissiveIntensity: 0.9 }));
      th.position.y = -TILE_H - 6;
      m.add(th);
    }
    // 糖果：巧克力滴落
    if (theme === THEMES.candy && i % 3 === 0) {
      const drip = new THREE.Mesh(new THREE.CapsuleGeometry(5, 14 + (i % 4) * 6, 4, 8), underMat);
      drip.position.set(((i * 13) % 20) - 10, -TILE_H - 12, ((i * 7) % 20) - 10);
      m.add(drip);
    }
    arena.add(m);
    tiles.push({ mesh: m, mat: top, def: t, base: m.position.clone(), state: 0, anim: null, vy: 0, t: 0, spin: new THREE.Vector3(), splashed: false });
  });

  if (theme === THEMES.lava) {
    // 中心金色镶嵌 + 浮岛底部的巨大岩锥
    const gold = std('#ffcf4a', { metalness: 0.8, roughness: 0.3, emissive: '#7a4a00', emissiveIntensity: 0.4 });
    const inlay = new THREE.Mesh(new THREE.TorusGeometry(70, 3, 8, 64), gold);
    inlay.rotation.x = -Math.PI / 2;
    inlay.position.y = 0.3;
    inlay.scale.z = 0.25;
    arena.add(inlay);
    const hex = new THREE.Mesh(new THREE.CylinderGeometry(18, 18, 2, 6), gold);
    hex.position.y = 0.2;
    arena.add(hex);
    const cone = new THREE.Mesh(rockify(new THREE.ConeGeometry(136, 300, 9, 4), 0.08, 3).rotateX(Math.PI), rockMat);
    cone.position.y = -TILE_H - 150;
    arena.add(cone);
  } else if (theme === THEMES.space) {
    // 中心的能量核心
    const core = new THREE.Mesh(new THREE.TorusGeometry(40, 3, 8, 48), new THREE.MeshBasicMaterial({ color: '#19d3ff' }));
    core.rotation.x = -Math.PI / 2;
    core.position.y = 0.5;
    core.scale.z = 0.2;
    arena.add(core);
  }
  // 糖果：软糖弹簧
  const jellyCols = ['#ff5aa5', '#ffd23f', '#3ddc84', '#3fa7ff', '#b06cff'];
  (def.bumpers || []).forEach((b, i) => {
    const g = new THREE.Group();
    g.position.set(b.x, 0, b.y);
    const col = jellyCols[i % jellyCols.length];
    const jelly = new THREE.Mesh(
      new THREE.SphereGeometry(b.r, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: col, roughness: 0.15, transparent: true, opacity: 0.9, emissive: col, emissiveIntensity: 0.15 })
    );
    jelly.scale.y = 1.3;
    jelly.castShadow = true;
    g.add(jelly);
    const sugar = std('#ffffff', { roughness: 0.3 });
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const e = 0.3 + (k % 3) * 0.2;
      const dot = new THREE.Mesh(new THREE.SphereGeometry(2.6, 6, 4), sugar);
      dot.position.set(Math.cos(a) * b.r * Math.cos(e), b.r * Math.sin(e), Math.sin(a) * b.r * Math.cos(e));
      jelly.add(dot);
    }
    const base = new THREE.Mesh(new THREE.TorusGeometry(b.r + 2, 4, 8, 28), std('#ffffff', { roughness: 0.4 }));
    base.rotation.x = -Math.PI / 2;
    base.position.y = 2;
    g.add(base);
    arena.add(g);
    bumpers.push({ jelly, squash: 0, squashV: 0 });
  });
  arenaR = def.radius;
}

function buildDecor(id) {
  disposeGroup(decor);
  floaters.length = 0;
  if (id === 'lava') {
    const dark = std('#2e2026', { roughness: 1, flatShading: true });
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2 + Math.sin(i * 7) * 0.2;
      const r = 900 + ((i * 373) % 1100);
      const h = 180 + ((i * 131) % 420);
      const m = new THREE.Mesh(rockify(new THREE.CylinderGeometry(22 + (i % 4) * 14, 70 + (i % 5) * 22, h, 7, 4), 0.12, i), i % 3 ? rockMat : dark);
      m.position.set(Math.cos(a) * r, LIQUID_Y + h / 2 - 10, Math.sin(a) * r);
      m.rotation.y = i;
      decor.add(m);
    }
    // 远处冒火的火山
    for (let i = 0; i < 4; i++) {
      const a = i * 1.7 + 0.5;
      const v = new THREE.Mesh(rockify(new THREE.ConeGeometry(500, 700, 10, 3, true), 0.06, i + 30), dark);
      v.position.set(Math.cos(a) * 3200, LIQUID_Y + 300, Math.sin(a) * 3200);
      decor.add(v);
      const glow = new THREE.Mesh(new THREE.CircleGeometry(110, 16), new THREE.MeshBasicMaterial({ color: '#ffb040' }));
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(v.position.x, LIQUID_Y + 640, v.position.z);
      decor.add(glow);
    }
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(rockify(new THREE.DodecahedronGeometry(12 + (i % 4) * 8, 0), 0.15, i + 50), rockMat);
      m.castShadow = true;
      floaters.push({ m, a: (i / 12) * Math.PI * 2, r: 600 + (i % 3) * 70, y: -30 + (i % 4) * 25, sp: 0.03 + (i % 3) * 0.015 });
      decor.add(m);
    }
  } else if (id === 'ice') {
    const snow = std('#ffffff', { roughness: 0.9, flatShading: true });
    const iceBlue = std('#bfe8ff', { roughness: 0.15, flatShading: true });
    const trunkMat = std('#6b4a2e');
    const leafMats = [std('#2f7a55', { flatShading: true }), std('#ffffff', { flatShading: true })];
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2 + Math.sin(i * 3) * 0.3;
      const r = 850 + ((i * 419) % 1300);
      const s = 60 + ((i * 97) % 140);
      const berg = new THREE.Mesh(rockify(new THREE.DodecahedronGeometry(s, 0), 0.12, i), i % 2 ? snow : iceBlue);
      berg.scale.y = 0.8 + (i % 3) * 0.3;
      berg.position.set(Math.cos(a) * r, LIQUID_Y + s * 0.3, Math.sin(a) * r);
      berg.rotation.y = i;
      decor.add(berg);
      // 冰山上的小松树
      if (i % 3 === 0) {
        for (let k = 0; k < 3; k++) {
          const tree = new THREE.Group();
          tree.add(mesh(new THREE.CylinderGeometry(3, 4, 14, 6), trunkMat, 0, 7, 0));
          for (let l = 0; l < 3; l++) tree.add(mesh(new THREE.ConeGeometry(22 - l * 5, 26, 7), leafMats[l === 2 ? 1 : 0], 0, 22 + l * 14, 0));
          tree.position.set(berg.position.x + (k - 1) * 30, berg.position.y + s * 0.55 * berg.scale.y, berg.position.z + ((k * 17) % 20) - 10);
          decor.add(tree);
        }
      }
    }
    // 远处的雪山
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.3;
      const h = 900 + (i % 3) * 350;
      const mtn = new THREE.Mesh(rockify(new THREE.ConeGeometry(800, h, 8, 3), 0.05, i + 70), i % 2 ? snow : iceBlue);
      mtn.position.set(Math.cos(a) * 4200, LIQUID_Y + h / 2 - 50, Math.sin(a) * 4200);
      decor.add(mtn);
    }
    // 漂着的浮冰
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(rockify(new THREE.DodecahedronGeometry(14 + (i % 3) * 8, 0), 0.1, i + 90), iceBlue);
      floaters.push({ m, a: (i / 10) * Math.PI * 2, r: 620 + (i % 3) * 80, y: LIQUID_Y + 6, sp: 0.02 + (i % 3) * 0.01, bob: true });
      decor.add(m);
    }
  } else if (id === 'space') {
    // 脚下的巨大星球 + 光环
    const pc = document.createElement('canvas');
    pc.width = 512;
    pc.height = 256;
    const g = pc.getContext('2d');
    const bands = ['#5b3fb8', '#7a5cff', '#c77dff', '#ff9e7a', '#7a5cff', '#3f2e8f', '#9d7bff', '#ffb38a'];
    for (let y = 0; y < 256; y += 4) {
      g.fillStyle = bands[Math.floor((y / 256) * bands.length * 2 + Math.sin(y * 0.1) * 1.2 + 16) % bands.length];
      g.fillRect(0, y, 512, 4);
    }
    const ptex = new THREE.CanvasTexture(pc);
    ptex.colorSpace = THREE.SRGBColorSpace;
    const planet = new THREE.Mesh(new THREE.SphereGeometry(2200, 64, 32), std('#ffffff', { map: ptex, roughness: 0.9, emissive: '#2a1660', emissiveIntensity: 0.6 }));
    planet.position.set(600, -3600, -2600);
    planet.rotation.z = 0.35;
    decor.add(planet);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2700, 3600, 96),
      new THREE.MeshBasicMaterial({ map: stripeTexture(['#c9b8ff', '#8a74e0', '#e8d9ff', '#6a58c0'], 6), transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.position.copy(planet.position);
    ring.rotation.set(-Math.PI / 2 + 0.25, 0, 0.35);
    decor.add(ring);
    const moon = new THREE.Mesh(new THREE.SphereGeometry(260, 32, 16), std('#cfd3e6', { roughness: 1, flatShading: true }));
    moon.position.set(-3000, 900, -4200);
    decor.add(moon);
    const astMat = std('#6e6a82', { roughness: 1, flatShading: true });
    for (let i = 0; i < 26; i++) {
      const m = new THREE.Mesh(rockify(new THREE.DodecahedronGeometry(10 + (i % 5) * 9, 0), 0.18, i + 11), astMat);
      m.castShadow = true;
      floaters.push({ m, a: (i / 26) * Math.PI * 2, r: 640 + (i % 4) * 110, y: -120 + ((i * 53) % 220), sp: 0.02 + (i % 3) * 0.012 });
      decor.add(m);
    }
    // 空间站外围的信号塔
    const towerMat = std('#3a4160', { metalness: 0.7, roughness: 0.4 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const tower = new THREE.Group();
      tower.add(mesh(new THREE.CylinderGeometry(6, 10, 220, 8), towerMat));
      tower.add(mesh(new THREE.SphereGeometry(12, 12, 8), new THREE.MeshBasicMaterial({ color: i % 2 ? '#ff4d6d' : '#19d3ff' }), 0, 116, 0));
      tower.position.set(Math.cos(a) * 640, -60, Math.sin(a) * 640);
      decor.add(tower);
    }
  } else if (id === 'candy') {
    // 棒棒糖、拐杖糖、甜甜圈、棉花糖云
    const cols = [
      ['#ff5aa5', '#ffffff'],
      ['#3fa7ff', '#ffffff'],
      ['#ffd23f', '#ff8c42'],
      ['#3ddc84', '#ffffff'],
    ];
    const stickMat = std('#ffffff', { roughness: 0.4 });
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + 0.2;
      const r = 900 + ((i * 347) % 1100);
      const h = 260 + ((i * 89) % 260);
      const lolly = new THREE.Group();
      lolly.add(mesh(new THREE.CylinderGeometry(6, 6, h, 8), stickMat, 0, h / 2, 0));
      const disc = mesh(new THREE.CylinderGeometry(70, 70, 22, 32), std('#ffffff', { map: swirlTexture(cols[i % cols.length]), roughness: 0.25 }), 0, h + 60, 0);
      disc.rotation.x = Math.PI / 2;
      lolly.add(disc);
      lolly.position.set(Math.cos(a) * r, LIQUID_Y, Math.sin(a) * r);
      lolly.rotation.y = -a + Math.PI / 2;
      lolly.rotation.z = Math.sin(i) * 0.15;
      decor.add(lolly);
    }
    const caneTex = stripeTexture(['#ff3b5c', '#ffffff'], 10);
    caneTex.repeat.set(8, 1);
    const caneMat = std('#ffffff', { map: caneTex, roughness: 0.35 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.6;
      const cane = new THREE.Group();
      cane.add(mesh(new THREE.CylinderGeometry(12, 12, 380, 12), caneMat, 0, 190, 0));
      cane.add(mesh(new THREE.TorusGeometry(50, 12, 10, 20, Math.PI), caneMat, -50, 380, 0));
      cane.position.set(Math.cos(a) * 1500, LIQUID_Y, Math.sin(a) * 1500);
      cane.rotation.y = a;
      decor.add(cane);
    }
    const dough = std('#e8b36a', { roughness: 0.7 });
    const icing = ['#ff8fc0', '#8b4a2b', '#b8f0ff', '#fff27a'].map((c) => std(c, { roughness: 0.3 }));
    for (let i = 0; i < 12; i++) {
      const donut = new THREE.Group();
      donut.add(mesh(new THREE.TorusGeometry(24, 11, 12, 24), dough));
      const top = mesh(new THREE.TorusGeometry(24, 11.5, 12, 24), icing[i % 4]);
      top.scale.z = 0.55;
      top.position.z = 4;
      donut.add(top);
      donut.rotation.x = -Math.PI / 2;
      floaters.push({ m: donut, a: (i / 12) * Math.PI * 2, r: 640 + (i % 3) * 90, y: LIQUID_Y + 8, sp: 0.02 + (i % 3) * 0.01, bob: true, flat: true });
      decor.add(donut);
    }
    const cloudMats = [std('#ffd6ec', { roughness: 1 }), std('#d6ecff', { roughness: 1 })];
    for (let i = 0; i < 8; i++) {
      const cloud = new THREE.Group();
      for (let k = 0; k < 5; k++) cloud.add(mesh(new THREE.SphereGeometry(80 + (k % 3) * 30, 12, 8), cloudMats[i % 2], k * 70 - 140, Math.sin(k) * 30, 0));
      const a = (i / 8) * Math.PI * 2;
      cloud.position.set(Math.cos(a) * 3000, 700 + (i % 3) * 200, Math.sin(a) * 3000);
      cloud.lookAt(0, cloud.position.y, 0);
      decor.add(cloud);
    }
  }
}

function applyMap(def) {
  mapDef = def;
  theme = THEMES[def.id] || THEMES.lava;
  const th = theme;
  skyMat.uniforms.uTop.value.set(th.sky[0]);
  skyMat.uniforms.uMid.value.set(th.sky[1]);
  skyMat.uniforms.uHorizon.value.set(th.sky[2]);
  skyMat.uniforms.uStars.value = th.stars;
  scene.fog.color.set(th.fog[0]);
  scene.fog.near = th.fog[1];
  scene.fog.far = th.fog[2];
  liquid.visible = !!th.liquid;
  if (th.liquid) {
    const u = liquidMat.uniforms;
    u.uA.value.set(th.liquid.a);
    u.uB.value.set(th.liquid.b);
    u.uC.value.set(th.liquid.c);
    u.uGlow.value.set(th.liquid.glow);
    u.uMode.value = th.liquid.mode;
    u.uBoost.value = th.liquid.boost;
  }
  hemi.color.set(th.hemi[0]);
  hemi.groundColor.set(th.hemi[1]);
  hemi.intensity = th.hemi[2];
  sun.color.set(th.sun[0]);
  sun.intensity = th.sun[1];
  underLight.color.set(th.under[0]);
  buildArena(def);
  buildDecor(def.id);
  for (const p of particlesAll) p.clear();
  if (state) syncTiles(state.tiles);
}

// 地砖状态：0 正常 1 预警 2 已塌
function syncTiles(str) {
  if (!str || str.length !== tiles.length) return;
  let maxR = 0;
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    const s = str.charCodeAt(i) - 48;
    if (s !== tile.state) {
      if (s === 2) {
        tile.anim = 'fall';
        tile.vy = 0;
        tile.splashed = false;
        tile.spin.set((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3);
      } else if (tile.state === 2) {
        tile.anim = 'rise';
        tile.t = 0;
        tile.mesh.visible = true;
      }
      tile.state = s;
    }
    if (s !== 2) maxR = Math.max(maxR, Math.hypot(tile.def.cx, tile.def.cy) + 55);
  }
  arenaR = maxR || 120;
}

function updateTiles(dt, t) {
  for (const tile of tiles) {
    const m = tile.mesh;
    tile.mat.emissiveIntensity = tile.state === 1 ? 0.35 + 0.35 * Math.sin(t * 16) : 0;
    if (tile.anim === 'fall') {
      if (!m.visible) continue;
      tile.vy -= 700 * dt;
      m.position.y += tile.vy * dt;
      m.rotation.x += tile.spin.x * dt;
      m.rotation.y += tile.spin.y * dt;
      m.rotation.z += tile.spin.z * dt;
      if (!theme.splash) m.scale.multiplyScalar(Math.pow(0.6, dt));
      if (m.position.y < LIQUID_Y && !tile.splashed && theme.splash) {
        tile.splashed = true;
        splash(m.position.x, m.position.z, 12);
      }
      if (m.position.y < LIQUID_Y - 200) m.visible = false;
    } else if (tile.anim === 'rise') {
      tile.t += dt / 0.7;
      const k = Math.min(1, tile.t);
      const e = 1 - Math.pow(1 - k, 3);
      m.position.set(tile.base.x, -260 * (1 - e), tile.base.z);
      m.rotation.set(0, 0, 0);
      m.scale.setScalar(1);
      if (k >= 1) tile.anim = null;
    } else if (tile.state === 1) {
      m.position.set(tile.base.x + (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5, tile.base.z + (Math.random() - 0.5) * 1.5);
    } else if (m.position.x !== tile.base.x || m.position.y !== 0) {
      m.position.copy(tile.base);
    }
  }
  for (const b of bumpers) {
    b.squashV += (-160 * b.squash - 10 * b.squashV) * Math.min(dt, 0.05);
    b.squash += b.squashV * Math.min(dt, 0.05);
    b.jelly.scale.set(1 + b.squash * 0.4, 1.3 * (1 - b.squash), 1 + b.squash * 0.4);
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
  clear() {
    this.list = [];
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
      this.pos[n * 3] = p.x;
      this.pos[n * 3 + 1] = p.y;
      this.pos[n * 3 + 2] = p.z;
      this.col[n * 4] = p.rgb[0];
      this.col[n * 4 + 1] = p.rgb[1];
      this.col[n * 4 + 2] = p.rgb[2];
      this.col[n * 4 + 3] = p.alpha * Math.min(1, k * 2);
      this.size[n] = p.size * (1 + p.grow * (1 - k));
      n++;
    }
    this.list = keep;
    this.geo.setDrawRange(0, n);
    for (const a of ['position', 'aColor', 'aSize']) this.geo.attributes[a].needsUpdate = true;
  }
}
const sparks = new Particles(1800, THREE.AdditiveBlending);
const dust = new Particles(900, THREE.NormalBlending);
const particlesAll = [sparks, dust];

function burst(x, y, z, color, n, speed = 200, size = 7, life = 0.45) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = speed * (0.4 + Math.random() * 0.6);
    sparks.add({ x, y, z, vx: Math.cos(a) * sp, vy: Math.random() * sp * 0.8 + 40, vz: Math.sin(a) * sp, life: life * (0.6 + Math.random() * 0.8), color, size, g: 500 });
  }
}
function splash(x, z, n) {
  const cols = theme.splash;
  if (!cols) return;
  const pool = theme === THEMES.lava ? sparks : dust;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 60 + Math.random() * 140;
    pool.add({ x, y: LIQUID_Y + 2, z, vx: Math.cos(a) * sp, vy: 200 + Math.random() * 250, vz: Math.sin(a) * sp, life: 0.8 + Math.random() * 0.5, color: cols[i % 2], size: 9, g: 600, drag: 0.98 });
  }
}
function puff(x, z, n, color = '#e8dcc4') {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 20 + Math.random() * 60;
    dust.add({ x: x + Math.cos(a) * 10, y: 4, z: z + Math.sin(a) * 10, vx: Math.cos(a) * sp, vy: 15 + Math.random() * 20, vz: Math.sin(a) * sp, life: 0.35 + Math.random() * 0.3, color, size: 10, grow: 1.2, alpha: 0.35 });
  }
}

// 各地图的环境粒子：火星 / 雪花 / 星尘 / 彩色糖针
function ambient(dt) {
  const n = Math.round(dt * 150);
  const cx = camTarget.x;
  const cz = camTarget.z;
  for (let i = 0; i < n; i++) {
    if (Math.random() > 0.8) continue;
    const a = Math.random() * Math.PI * 2;
    if (theme.ambient === 'embers') {
      const r = 200 + Math.random() * 1000;
      sparks.add({ x: Math.cos(a) * r, y: LIQUID_Y + 5, z: Math.sin(a) * r, vx: (Math.random() - 0.5) * 20, vy: 40 + Math.random() * 60, vz: (Math.random() - 0.5) * 20, life: 2 + Math.random() * 3, color: Math.random() < 0.5 ? '#ff7a1a' : '#ffb347', size: 4 + Math.random() * 4, g: -5, drag: 0.99 });
    } else if (theme.ambient === 'snow') {
      const r = Math.random() * 1100;
      dust.add({ x: cx + Math.cos(a) * r, y: 500 + Math.random() * 200, z: cz + Math.sin(a) * r, vx: 20 + (Math.random() - 0.5) * 20, vy: -70 - Math.random() * 40, vz: (Math.random() - 0.5) * 20, life: 8, color: '#ffffff', size: 4 + Math.random() * 3, alpha: 0.9, drag: 1 });
    } else if (theme.ambient === 'dust') {
      const r = 300 + Math.random() * 1200;
      sparks.add({ x: Math.cos(a) * r, y: -200 + Math.random() * 500, z: Math.sin(a) * r, vx: (Math.random() - 0.5) * 10, vy: (Math.random() - 0.5) * 10, vz: (Math.random() - 0.5) * 10, life: 3 + Math.random() * 3, color: Math.random() < 0.7 ? '#bcd8ff' : '#ff9ef0', size: 3 + Math.random() * 3, drag: 1 });
    } else if (theme.ambient === 'sprinkles') {
      if (Math.random() > 0.35) continue;
      const r = Math.random() * 1100;
      const c = ['#ff5aa5', '#ffd23f', '#3fa7ff', '#3ddc84', '#b06cff', '#ffffff'][Math.floor(Math.random() * 6)];
      dust.add({ x: cx + Math.cos(a) * r, y: 500 + Math.random() * 200, z: cz + Math.sin(a) * r, vx: (Math.random() - 0.5) * 30, vy: -110 - Math.random() * 40, vz: (Math.random() - 0.5) * 30, life: 7, color: c, size: 5, alpha: 1, drag: 1 });
    }
  }
}

// 扩散光环（炸弹冲击波 / 冰冻波 / 陨石落地）
const rings = [];
function ringWave(x, z, r, color = '#ffb347', dur = 0.45) {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(0.8, 1, 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 3, z);
  scene.add(m);
  rings.push({ m, r, t: 0, dur });
}

// =====================================================================
// 角色建模
// =====================================================================
const sphereGeo = new THREE.SphereGeometry(1, 36, 24);
sphereGeo.userData.shared = true;

// 每种颜色配一个专属头饰（材质在模型里单独创建，方便幽灵效果改透明度）
function makeAccessory(kind, color) {
  const g = new THREE.Group();
  const gold = std('#ffcf4a', { metalness: 0.9, roughness: 0.25 });
  const white = std('#f5f2ea');
  const black = std('#1b1822', { roughness: 0.5 });
  const tint = std(new THREE.Color(color).offsetHSL(0, 0, -0.18), { roughness: 0.5 });
  switch (kind) {
    case 0: {
      // 皇冠
      g.add(mesh(new THREE.CylinderGeometry(0.42, 0.4, 0.22, 16, 1, true), gold, 0, 0.98, 0));
      const gem = std('#3fa7ff', { roughness: 0.1 });
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        g.add(mesh(new THREE.ConeGeometry(0.09, 0.22, 6), gold, Math.cos(a) * 0.4, 1.19, Math.sin(a) * 0.4));
        g.add(mesh(new THREE.SphereGeometry(0.05, 8, 6), gem, Math.cos(a + 0.6) * 0.42, 0.98, Math.sin(a + 0.6) * 0.42));
      }
      break;
    }
    case 1:
      // 恶魔角
      for (const s of [-1, 1]) {
        const h = mesh(new THREE.ConeGeometry(0.13, 0.5, 10), white, s * 0.45, 0.95, 0);
        h.rotation.z = -s * 0.5;
        g.add(h);
      }
      break;
    case 2:
      // 天线
      g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6), black, 0, 1.2, 0));
      g.add(mesh(new THREE.SphereGeometry(0.12, 12, 8), std('#fff27a', { emissive: '#ffd23f', emissiveIntensity: 1.2 }), 0, 1.5, 0));
      break;
    case 3: {
      // 螺旋桨帽
      g.add(mesh(new THREE.SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), tint, 0, 0.82, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.25, 6), black, 0, 1.4, 0));
      const prop = new THREE.Group();
      prop.position.y = 1.52;
      prop.add(mesh(new THREE.BoxGeometry(1.1, 0.04, 0.14), std('#ffd23f')));
      prop.add(mesh(new THREE.BoxGeometry(0.14, 0.04, 1.1), std('#3fa7ff')));
      prop.userData.spin = 12;
      g.add(prop);
      break;
    }
    case 4:
      // 猫耳
      for (const s of [-1, 1]) {
        const e = mesh(new THREE.ConeGeometry(0.24, 0.42, 4), tint, s * 0.5, 0.88, -0.05);
        e.rotation.z = -s * 0.45;
        g.add(e);
      }
      break;
    case 5:
      // 礼帽
      g.add(mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.05, 20), black, 0, 0.9, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.55, 20), black, 0, 1.18, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.39, 0.39, 0.1, 20), std('#ff5a5f'), 0, 0.98, 0));
      g.rotation.z = 0.15;
      break;
    case 6: {
      // 小树苗
      const leafMat = std('#4cd964', { roughness: 0.5 });
      g.add(mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.35, 6), std('#6b8e23'), 0, 1.12, 0));
      for (const s of [-1, 1]) {
        const l = mesh(new THREE.SphereGeometry(0.2, 12, 8), leafMat, s * 0.18, 1.3, 0);
        l.scale.set(1, 0.35, 0.6);
        l.rotation.z = s * 0.5;
        g.add(l);
      }
      break;
    }
    default:
      // 派对帽
      g.add(mesh(new THREE.ConeGeometry(0.34, 0.8, 16), std('#b06cff', { roughness: 0.5 }), 0, 1.25, 0));
      g.add(mesh(new THREE.TorusGeometry(0.3, 0.05, 6, 16).rotateX(Math.PI / 2), std('#ffd23f'), 0, 0.97, 0));
      g.add(mesh(new THREE.SphereGeometry(0.1, 10, 8), std('#ffffff'), 0, 1.68, 0));
      g.rotation.z = -0.2;
  }
  return g;
}

function makeLabel(text, color = '#ffffff') {
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
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, 29);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set((w / 56) * 16, 16, 1);
  s.renderOrder = 10;
  return s;
}

function makePlayerModel(p, teamMode) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const bodyMat = std(p.color, { roughness: 0.32, metalness: 0.05, emissive: '#ffd23f', emissiveIntensity: 0 });
  body.add(mesh(sphereGeo, bodyMat));
  // 碰碰车保险杠（团队模式换成发光的队伍颜色）
  const teamCol = TEAM_COLORS[p.team];
  const bumper = mesh(
    new THREE.TorusGeometry(0.95, teamMode ? 0.2 : 0.14, 12, 40),
    std(teamMode ? teamCol : new THREE.Color(p.color).offsetHSL(0, 0.05, -0.22), { roughness: 0.4, emissive: teamMode ? teamCol : '#000000', emissiveIntensity: teamMode ? 0.4 : 0 })
  );
  bumper.rotation.x = Math.PI / 2;
  bumper.position.y = -0.3;
  body.add(bumper);
  // 脸
  const face = new THREE.Group();
  const eyes = [];
  const eyeWhite = std('#ffffff', { roughness: 0.2 });
  const pupilMat = std('#15131f', { roughness: 0.1 });
  const onSurface = (o, x, y, z, r) => {
    const n = new THREE.Vector3(x, y, z).normalize();
    o.position.copy(n).multiplyScalar(r);
    o.lookAt(n.multiplyScalar(3));
  };
  for (const s of [-1, 1]) {
    const eye = new THREE.Group();
    onSurface(eye, s * 0.36, 0.5, 0.8, 0.84);
    eye.add(mesh(new THREE.SphereGeometry(0.26, 16, 12), eyeWhite));
    eye.add(mesh(new THREE.SphereGeometry(0.14, 12, 10), pupilMat, 0, 0, 0.17));
    eye.add(mesh(new THREE.SphereGeometry(0.05, 8, 6), eyeWhite, 0.05, 0.06, 0.29));
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
  // 冰块
  const ice = new THREE.Mesh(
    new THREE.BoxGeometry(2.5, 2.4, 2.5),
    new THREE.MeshStandardMaterial({ color: '#c8f1ff', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.55, emissive: '#6fd6ff', emissiveIntensity: 0.3, depthWrite: false })
  );
  ice.rotation.y = 0.4;
  ice.visible = false;
  root.add(ice);
  // 踩香蕉时头上转圈的星星
  const stars = new THREE.Group();
  const starMat = new THREE.MeshBasicMaterial({ color: '#ffe066' });
  for (let i = 0; i < 3; i++) {
    const st = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), starMat);
    const a = (i / 3) * Math.PI * 2;
    st.position.set(Math.cos(a) * 0.7, 1.35, Math.sin(a) * 0.7);
    stars.add(st);
  }
  stars.visible = false;
  root.add(stars);
  scene.add(root);

  const mats = new Set();
  body.traverse((o) => {
    if (o.material) {
      o.material.transparent = true;
      mats.add(o.material);
    }
  });

  const label = makeLabel(p.name, teamMode ? (p.team ? '#9cc4ff' : '#ff9ca4') : '#ffffff');
  scene.add(label);
  return {
    root, body, bodyMat, mats: [...mats], eyes, acc, shield, wire, ice, stars, label,
    key: `${p.color}|${p.name}|${teamMode ? p.team : -1}`,
    x: p.x, z: p.y, yaw: 0, scale: p.r,
    squash: 0, squashV: 0, hop: 0,
    fy: 0, fvy: 0, splashed: false, pop: 1, opacity: 1,
    blink: 2 + Math.random() * 3,
  };
}

function disposeView(v) {
  scene.remove(v.root);
  scene.remove(v.label);
  v.label.material.map.dispose();
  v.label.material.dispose();
  disposeGroup(v.root);
}

// 自己的标记：脚下的冲刺环 + 头顶箭头
const myRing = new THREE.Mesh(new THREE.RingGeometry(1.3, 1.55, 48), new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.9, depthWrite: false }));
myRing.rotation.x = -Math.PI / 2;
scene.add(myRing);
const myArrow = new THREE.Mesh(new THREE.ConeGeometry(6, 12, 4), new THREE.MeshBasicMaterial({ color: '#ffd23f' }));
myArrow.rotation.x = Math.PI;
scene.add(myArrow);

// =====================================================================
// 道具建模
// =====================================================================
function makeBanana(s = 1) {
  const g = new THREE.Group();
  const peel = mesh(new THREE.TorusGeometry(9 * s, 3.4 * s, 8, 16, Math.PI * 0.85), std('#ffd84a', { roughness: 0.45 }));
  peel.rotation.z = Math.PI * 0.08;
  g.add(peel);
  const tipMat = std('#6b4a1e');
  g.add(mesh(new THREE.SphereGeometry(2 * s, 6, 4), tipMat, 9 * s, 0, 0));
  const a = Math.PI * 0.85;
  g.add(mesh(new THREE.SphereGeometry(2 * s, 6, 4), tipMat, Math.cos(a) * 9 * s, Math.sin(a) * 9 * s, 0));
  return g;
}

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
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(12, 18, 110, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: info.color, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  beam.position.y = 55;
  root.add(beam);
  const white = std('#f5f2ea');

  if (type === 'big') {
    float.add(mesh(new THREE.CylinderGeometry(4.5, 6, 11, 12), white, 0, -4, 0));
    float.add(mesh(new THREE.SphereGeometry(12, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), std('#ff4a4f', { roughness: 0.4, emissive: '#ff2020', emissiveIntensity: 0.25 }), 0, 1, 0));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      float.add(mesh(new THREE.SphereGeometry(2.2, 8, 6), white, Math.cos(a) * 8, 8.5, Math.sin(a) * 8));
    }
    float.add(mesh(new THREE.SphereGeometry(2.4, 8, 6), white, 0, 13, 0));
  } else if (type === 'speed') {
    const s = new THREE.Shape();
    [[3, 14], [-7, -1], [-1, -1], [-4, -14], [7, 2], [1, 2], [3, 14]].forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
    const geo = new THREE.ExtrudeGeometry(s, { depth: 4, bevelEnabled: true, bevelThickness: 1, bevelSize: 1, bevelSegments: 1 });
    geo.center();
    float.add(mesh(geo, std('#ffd23f', { emissive: '#ffb000', emissiveIntensity: 0.8, metalness: 0.3, roughness: 0.3 })));
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
    float.add(mesh(geo, std('#3fa7ff', { emissive: '#1f6fff', emissiveIntensity: 0.5, metalness: 0.4, roughness: 0.3 })));
    float.add(mesh(new THREE.BoxGeometry(3, 14, 2), white, 0, 0, 3));
    float.add(mesh(new THREE.BoxGeometry(12, 3, 2), white, 0, 3, 3));
  } else if (type === 'bomb') {
    float.add(mesh(new THREE.SphereGeometry(10, 20, 14), std('#23202c', { metalness: 0.5, roughness: 0.35 })));
    float.add(mesh(new THREE.CylinderGeometry(3, 3, 4, 10), std('#777777', { metalness: 0.8, roughness: 0.3 }), 0, 10, 0));
    float.add(mesh(new THREE.CylinderGeometry(0.8, 0.8, 6, 6), std('#c9a36b'), 1.5, 14, 0));
    const spark = mesh(new THREE.SphereGeometry(2, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffe066' }), 2.5, 17, 0);
    spark.userData.spark = true;
    float.add(spark);
  } else if (type === 'freeze') {
    // 雪花：三根交叉的冰晶
    const iceMat = std('#bff0ff', { emissive: '#5fd0ff', emissiveIntensity: 0.7, metalness: 0.2, roughness: 0.15 });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI;
      const arm = mesh(new THREE.BoxGeometry(26, 3, 3), iceMat);
      arm.rotation.z = a;
      float.add(arm);
      for (const s of [-1, 1]) {
        for (const k of [-1, 1]) {
          const tip = mesh(new THREE.BoxGeometry(7, 2, 2), iceMat);
          tip.position.set(Math.cos(a) * 9 * s, Math.sin(a) * 9 * s, 0);
          tip.rotation.z = a + k * 0.8;
          float.add(tip);
        }
      }
    }
    float.add(mesh(new THREE.OctahedronGeometry(4, 0), iceMat));
  } else if (type === 'ghost') {
    const gm = std('#f4f0ff', { transparent: true, opacity: 0.85, emissive: '#b8a8ff', emissiveIntensity: 0.4 });
    float.add(mesh(new THREE.SphereGeometry(10, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), gm, 0, 2, 0));
    float.add(mesh(new THREE.CylinderGeometry(10, 11, 12, 18, 1, true), gm, 0, -4, 0));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      float.add(mesh(new THREE.ConeGeometry(3.2, 6, 6).rotateX(Math.PI), gm, Math.cos(a) * 8.5, -12, Math.sin(a) * 8.5));
    }
    const eyeMat = std('#2a2340');
    for (const s of [-1, 1]) float.add(mesh(new THREE.SphereGeometry(2, 8, 6), eyeMat, s * 3.5, 4, 9));
  } else if (type === 'tornado') {
    const tm = std('#c8f7dc', { transparent: true, opacity: 0.8, emissive: '#6fe0a0', emissiveIntensity: 0.4 });
    for (let i = 0; i < 5; i++) {
      const t = mesh(new THREE.TorusGeometry(4 + i * 2.6, 1.4, 6, 20), tm, Math.sin(i) * 2, -10 + i * 5, 0);
      t.rotation.x = Math.PI / 2;
      float.add(t);
    }
  } else if (type === 'banana') {
    float.add(makeBanana(1.2));
  }
  float.scale.setScalar(1.5);
  scene.add(root);
  return { root, float, glow, beam, type, born: performance.now() / 1000 };
}

// ---- 场上的东西：龙卷风、皇冠、陨石 ----
function makeTornado() {
  const g = new THREE.Group();
  const layers = [];
  const mat = new THREE.MeshStandardMaterial({ color: '#d8f5e6', transparent: true, opacity: 0.35, emissive: '#9fe8c0', emissiveIntensity: 0.3, depthWrite: false, side: THREE.DoubleSide });
  for (let i = 0; i < 7; i++) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(18 + i * 11, 4 + i * 0.8, 6, 28), mat);
    t.rotation.x = Math.PI / 2;
    t.position.y = 8 + i * 22;
    g.add(t);
    layers.push(t);
  }
  scene.add(g);
  return { g, layers, init: false };
}

function makeCrown() {
  const g = new THREE.Group();
  const gold = std('#ffcf4a', { metalness: 0.9, roughness: 0.2, emissive: '#a06a00', emissiveIntensity: 0.5 });
  g.add(mesh(new THREE.CylinderGeometry(15, 13, 10, 20, 1, true), gold));
  const gemCols = ['#ff4d6d', '#3fa7ff', '#3ddc84'];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.add(mesh(new THREE.ConeGeometry(3.4, 10, 6), gold, Math.cos(a) * 14.5, 9, Math.sin(a) * 14.5));
    g.add(mesh(new THREE.SphereGeometry(1.8, 8, 6), gold, Math.cos(a) * 14.5, 14.5, Math.sin(a) * 14.5));
    const gc = gemCols[i % 3];
    g.add(mesh(new THREE.OctahedronGeometry(2.4, 0), std(gc, { roughness: 0.1, metalness: 0.3, emissive: gc, emissiveIntensity: 0.4 }), Math.cos(a + 0.52) * 15, 0, Math.sin(a + 0.52) * 15));
  }
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(14, 22, 160, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  beam.position.y = 50;
  const root = new THREE.Group();
  root.add(g, beam);
  root.visible = false;
  scene.add(root);
  return { root, g, beam };
}
const crownView = makeCrown();

function makeMeteor() {
  const warn = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 40), new THREE.MeshBasicMaterial({ color: '#ff3b3b', transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
  warn.rotation.x = -Math.PI / 2;
  const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: '#ff3b3b', transparent: true, opacity: 0.25, depthWrite: false }));
  fill.rotation.x = -Math.PI / 2;
  const rock = new THREE.Mesh(rockify(new THREE.DodecahedronGeometry(22, 0), 0.2, Math.random() * 10), std('#5a3a30', { flatShading: true, emissive: '#ff5a10', emissiveIntensity: 0.8 }));
  rock.castShadow = true;
  scene.add(warn, fill, rock);
  return { warn, fill, rock };
}

// =====================================================================
// 界面 / 网络
// =====================================================================
const screens = ['menu', 'lobby', 'gameOver', 'board'];
let currentScreen = 'menu';
let boardReturn = 'menu';
function showScreen(name) {
  currentScreen = name;
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
      showScreen('menu');
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
$('copyBtn').onclick = async () => {
  const link = `${location.origin}${location.pathname}?room=${state.code}`;
  try {
    await navigator.clipboard.writeText(link);
    $('copyBtn').textContent = '已复制！';
  } catch {
    prompt('复制这个链接发给朋友：', link);
  }
  setTimeout(() => ($('copyBtn').textContent = '复制邀请链接'), 2000);
};

// 地图 / 模式选择按钮
function buildPicker(el, info, msgType) {
  el.innerHTML = '';
  for (const [id, m] of Object.entries(info)) {
    const b = document.createElement('button');
    b.className = 'opt';
    b.dataset.v = id;
    b.innerHTML = `<b>${m.icon} ${m.name}</b><small>${m.desc}</small>`;
    b.onclick = () => sendMsg({ t: msgType, v: id });
    el.append(b);
  }
}
buildPicker($('mapPicker'), MAP_INFO, 'setMap');
buildPicker($('modePicker'), MODE_INFO, 'setMode');

// 排行榜
async function openBoard(from) {
  boardReturn = from;
  showScreen('board');
  const table = $('boardTable');
  table.innerHTML = '<tr><td class="empty" colspan="5">加载中…</td></tr>';
  try {
    const list = await (await fetch('/api/leaderboard')).json();
    if (!list.length) {
      table.innerHTML = '<tr><td class="empty" colspan="5">还没有战绩，快去玩一局吧！</td></tr>';
      return;
    }
    table.innerHTML = '<tr><th>#</th><th>玩家</th><th>冠军</th><th>击飞</th><th>场次</th></tr>';
    list.forEach((s, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${['🥇', '🥈', '🥉'][i] || i + 1}</td><td class="name"></td><td>${s.wins}</td><td>${s.kos}</td><td>${s.games}</td>`;
      tr.children[1].textContent = s.name;
      table.append(tr);
    });
  } catch {
    table.innerHTML = '<tr><td class="empty" colspan="5">加载失败</td></tr>';
  }
}
$('boardBtn').onclick = () => openBoard('menu');
$('overBoardBtn').onclick = () => openBoard('gameOver');
$('boardClose').onclick = () => {
  if (!state) showScreen('menu');
  else {
    currentScreen = boardReturn;
    showScreen(boardReturn === 'gameOver' ? 'gameOver' : null);
    updateUI();
  }
};

const mapCache = {};
function onMessage(msg) {
  if (msg.t === 'error') {
    $('menuError').textContent = msg.msg;
    myId = null;
    ws.close();
    return;
  }
  if (msg.t === 'joined') {
    myId = msg.id;
    $('menuError').textContent = '';
    history.replaceState(null, '', `?room=${msg.code}`);
    return;
  }
  if (msg.t === 'map') {
    mapCache[msg.id] = msg;
    applyMap(msg);
    return;
  }
  if (msg.t === 'state') {
    state = msg;
    syncTiles(msg.tiles);
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
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const views = new Map(); // 玩家 id -> 3D 模型
const itemViews = new Map();
const tornadoViews = new Map();
const trapViews = new Map();
const meteorViews = new Map();

function handleEvents(events) {
  const nameOf = (id) => esc(state.players.find((p) => p.id === id)?.name || '');
  for (const ev of events) {
    switch (ev.type) {
      case 'hit':
        burst(ev.x, 22, ev.y, '#ffe9a8', Math.min(16, Math.floor(ev.power / 40)), 120 + ev.power * 0.25, 6, 0.3);
        shake = Math.min(14, shake + ev.power / 90);
        for (const id of [ev.a, ev.b]) {
          const v = views.get(id);
          if (v) v.squashV += Math.min(5, ev.power / 100);
        }
        beep(160 + Math.random() * 80, 0.12, 'square', 0.06, -90);
        break;
      case 'dash': {
        const v = views.get(ev.id);
        if (v) {
          puff(v.x, v.z, 6);
          v.squashV -= 4;
        }
        if (ev.id === myId) beep(500, 0.1, 'sawtooth', 0.04, 400);
        break;
      }
      case 'fall':
        beep(420, 0.6, 'triangle', 0.1, -360);
        if (ev.id === myId) shake = 16;
        break;
      case 'pickup': {
        const info = ITEM_INFO[ev.item];
        burst(ev.x, 20, ev.y, info.color, 26, 180, 8);
        beep(700, 0.1, 'square', 0.06, 500);
        setTimeout(() => beep(1100, 0.15, 'square', 0.05, 400), 90);
        if (ev.id === myId) toast(`${info.icon} 你获得了<span style="color:${info.color}">${info.name}</span>！`);
        else if (['bomb', 'freeze', 'tornado'].includes(ev.item)) toast(`${info.icon} ${nameOf(ev.id)} 使用了${info.name}！`);
        break;
      }
      case 'shock':
        ringWave(ev.x, ev.y, ev.r);
        burst(ev.x, 15, ev.y, '#ff8c42', 60, 380, 10);
        burst(ev.x, 15, ev.y, '#ffe066', 30, 250, 8);
        puff(ev.x, ev.y, 20, '#9a8878');
        shake = Math.max(shake, 16);
        boom(0.9, 0.35, 900);
        break;
      case 'freeze':
        ringWave(ev.x, ev.y, ev.r, '#8fe3ff', 0.6);
        burst(ev.x, 15, ev.y, '#dff8ff', 50, 320, 8);
        beep(1500, 0.5, 'sine', 0.06, -900);
        break;
      case 'slip':
        burst(ev.x, 10, ev.y, '#ffe066', 12, 120, 6);
        beep(900, 0.35, 'sine', 0.06, -600);
        if (ev.id === myId) toast('🍌 哎呀，踩到香蕉皮了！');
        break;
      case 'bump': {
        const b = bumpers[ev.i];
        if (b && b.squash < 0.15) {
          b.squashV += 7;
          beep(300, 0.18, 'sine', 0.07, 400);
          burst(ev.x, 20, ev.y, '#ffffff', 6, 140, 5);
        }
        break;
      }
      case 'meteor':
        ringWave(ev.x, ev.y, ev.r * 1.6, '#ff7a3a', 0.5);
        burst(ev.x, 20, ev.y, '#ff8c42', 50, 360, 10);
        burst(ev.x, 20, ev.y, '#ffe066', 25, 250, 8);
        puff(ev.x, ev.y, 16, '#6e6a82');
        shake = Math.max(shake, 12);
        boom(0.8, 0.32, 700);
        break;
      case 'collapse':
        boom(1.2, 0.3, 300);
        shake = Math.max(shake, 8);
        toast('💥 外圈坍塌了！');
        break;
      case 'ko':
        if (ev.id === myId) toast(`💥 你击飞了 ${nameOf(ev.victim)}！`);
        else if (ev.victim === myId) toast(`😵 你被 ${nameOf(ev.id)} 撞飞了`);
        break;
      case 'crown':
        beep(880, 0.12, 'square', 0.06, 300);
        setTimeout(() => beep(1320, 0.2, 'square', 0.05, 200), 100);
        toast(ev.id === myId ? '👑 你拿到了皇冠！快跑！' : `👑 ${nameOf(ev.id)} ${ev.from ? '抢走了' : '拿到了'}皇冠！`);
        break;
      case 'respawn': {
        const v = views.get(ev.id);
        if (v) v.pop = 0;
        break;
      }
    }
  }
}

function playerLi(p, right, teamMode) {
  const li = document.createElement('li');
  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.style.background = p.color;
  if (teamMode) dot.style.boxShadow = `0 0 0 3px ${TEAM_COLORS[p.team]}`;
  const name = document.createElement('span');
  name.textContent = p.name + (p.id === myId ? '（你）' : '');
  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = right;
  li.append(dot, name, tag);
  return li;
}

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const scoreText = (p) => (state.mode === 'crown' ? `${p.score.toFixed(1)}s` : `${p.score}`);

function updateUI() {
  const s = state;
  const isHost = s.hostId === myId;
  const me = s.players.find((p) => p.id === myId);
  const mi = MODE_INFO[s.mode];
  const teamMode = s.mode === 'team';

  if (s.phase !== lastPhase) {
    if (s.phase === 'countdown') beep(440, 0.15, 'square', 0.06);
    if (s.phase === 'playing') beep(880, 0.25, 'square', 0.07);
    if (s.phase === 'roundEnd') beep(660, 0.3, 'triangle', 0.08, 300);
    lastPhase = s.phase;
  }

  if (currentScreen === 'board') {
    // 正在看排行榜，不切走
  } else if (s.phase === 'lobby') {
    showScreen('lobby');
    $('roomCode').textContent = s.code;
    for (const [el, cur] of [
      [$('mapPicker'), s.map],
      [$('modePicker'), s.mode],
    ]) {
      el.classList.toggle('locked', !isHost);
      for (const b of el.children) b.classList.toggle('on', b.dataset.v === cur);
    }
    $('targetLabel').textContent = mi.label;
    $('targetUnit').textContent = mi.unit;
    const tp = $('targetPicker');
    if (tp.dataset.mode !== s.mode) {
      tp.dataset.mode = s.mode;
      tp.innerHTML = '';
      for (const v of mi.targets) {
        const b = document.createElement('button');
        b.textContent = v;
        b.dataset.v = v;
        b.onclick = () => sendMsg({ t: 'setTarget', v });
        tp.append(b);
      }
    }
    tp.classList.toggle('locked', !isHost);
    for (const b of tp.children) b.classList.toggle('on', Number(b.dataset.v) === s.target);
    const list = $('playerList');
    list.innerHTML = '';
    for (const p of s.players) list.append(playerLi(p, p.id === s.hostId ? '房主' : p.bot ? '机器人' : '', false));
    $('playerCount').textContent = `${s.players.length}/8`;
    $('hostControls').classList.toggle('hidden', !isHost);
    $('waitHost').classList.toggle('hidden', isHost);
  } else if (s.phase === 'gameOver') {
    showScreen('gameOver');
    const top = Math.max(...s.players.map((q) => q.score));
    const tops = s.players.filter((p) => p.score === top);
    const champ = s.players.find((p) => p.id === s.winner);
    if (teamMode && s.winnerTeam >= 0) {
      $('champName').innerHTML = `<span style="color:${TEAM_COLORS[s.winnerTeam]}">${TEAM_NAMES[s.winnerTeam]}</span> 获胜！`;
      $('overSub').textContent = `比分 ${s.teamScore[0]} : ${s.teamScore[1]} · ${MAP_INFO[s.map].icon} ${MAP_INFO[s.map].name}`;
    } else {
      $('champName').textContent = champ ? `${champ.name} 获得冠军！` : tops.length > 1 ? `${tops.map((p) => p.name).join('、')} 并列第一！` : '游戏结束';
      $('overSub').textContent = `${mi.icon} ${mi.name} · ${MAP_INFO[s.map].icon} ${MAP_INFO[s.map].name}`;
    }
    const list = $('finalList');
    list.innerHTML = '';
    [...s.players]
      .sort((a, b) => b.score - a.score || b.kills - a.kills)
      .forEach((p) => {
        const txt = s.mode === 'knockout' ? `击飞 ${p.kills}` : s.mode === 'crown' ? `${scoreText(p)} · 击飞 ${p.kills}` : `${p.score} 胜 · 击飞 ${p.kills}`;
        list.append(playerLi(p, txt, teamMode));
      });
    $('overHost').classList.toggle('hidden', !isHost);
    $('overWait').classList.toggle('hidden', isHost);
  } else {
    showScreen(null);
  }

  // 顶部信息条
  let top = '';
  if (s.mode === 'knockout') top = `⏱ ${fmtTime(s.clock)}`;
  else if (s.mode === 'crown') top = `👑 先拿满 ${s.target} 秒`;
  else if (teamMode) top = `<span style="color:${TEAM_COLORS[0]}">红队 ${s.teamScore[0]}</span> : <span style="color:${TEAM_COLORS[1]}">${s.teamScore[1]} 蓝队</span>`;
  $('topbar').innerHTML = top;

  // 计分板
  const sb = $('scoreboard');
  const head = s.mode === 'knockout' ? '击飞数' : s.mode === 'crown' ? '戴冠时间' : `第 ${s.round} 局 · 先赢 ${s.target} 局`;
  sb.innerHTML = `<div style="color:#b7b0e0;margin-bottom:4px">${mi.icon} ${head}</div>`;
  const holder = s.crown && s.crown.h;
  let ranked = [...s.players].sort((a, b) => b.score - a.score);
  // 手机竖屏空间小：只显示前 4 名和自己
  if (window.innerWidth < 600) ranked = ranked.filter((p, i) => i < 4 || p.id === myId);
  for (const p of ranked) {
    const row = document.createElement('div');
    row.className = 'row' + (p.alive ? '' : ' out');
    const mark = holder === p.id ? '👑 ' : teamMode ? `<span class="tm" style="color:${TEAM_COLORS[p.team]}">● </span>` : '';
    row.innerHTML = `<span class="dot" style="background:${p.color}"></span><span></span><span class="pts">${mark}${scoreText(p)}</span>`;
    row.children[1].textContent = p.name + (p.id === myId ? '（你）' : '');
    sb.append(row);
    if (s.mode === 'crown') {
      const bar = document.createElement('div');
      bar.className = 'bar';
      bar.style.width = `${Math.min(100, (p.score / s.target) * 100) * 0.8}%`;
      bar.style.background = p.color;
      sb.append(bar);
    }
  }

  // 中央横幅
  let banner = '';
  if (s.phase === 'countdown') banner = String(Math.ceil(s.timer) || '开始！');
  else if (s.phase === 'playing' && me && !me.alive && me.respawn > 0) banner = `<span style="font-size:24px">${me.respawn.toFixed(1)} 秒后复活…</span>`;
  else if (s.phase === 'playing' && me && !me.alive && !mi.respawn && s.round > 0) banner = '<span style="font-size:24px">你出局了，观战中…</span>';
  else if (s.phase === 'playing' && s.warn >= 0) banner = `<span style="font-size:26px;color:#ff7b7f">⚠ 外圈即将坍塌 ${Math.ceil(s.warn)}</span>`;
  else if (s.phase === 'roundEnd') {
    if (teamMode) banner = s.winnerTeam >= 0 ? `<span style="color:${TEAM_COLORS[s.winnerTeam]}">${TEAM_NAMES[s.winnerTeam]}</span> 赢了这局！` : '平局！';
    else {
      const w = s.players.find((p) => p.id === s.winner);
      banner = w ? `${esc(w.name)} 赢了这局！` : '平局！';
    }
  }
  $('banner').innerHTML = banner;

  // 自己身上的道具效果
  const fxBox = $('effects');
  fxBox.innerHTML = '';
  if (me && me.alive) {
    const fxShow = [
      ['big', ITEM_INFO.big],
      ['speed', ITEM_INFO.speed],
      ['shield', ITEM_INFO.shield],
      ['ghost', ITEM_INFO.ghost],
      ['frozen', { icon: '🧊', name: '被冻住', color: '#8fe3ff' }],
      ['slip', { icon: '🍌', name: '打滑', color: '#ffe066' }],
    ];
    for (const [k, info] of fxShow) {
      if (me.fx[k] > 0) {
        const d = document.createElement('div');
        d.className = 'fx';
        d.style.color = info.color;
        d.textContent = `${info.icon} ${info.name} ${me.fx[k].toFixed(1)}s`;
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
  const scale = renderer.getDrawingBufferSize(new THREE.Vector2()).y / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  for (const p of particlesAll) p.mat.uniforms.uScale.value = scale;
}
window.addEventListener('resize', resize);

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
  const teamMode = !!state && state.mode === 'team';
  const k = 1 - Math.exp(-rdt * 18);
  let me = null;

  players.forEach((p, idx) => {
    ids.add(p.id);
    let v = views.get(p.id);
    const key = `${p.color}|${p.name}|${teamMode ? p.team : -1}`;
    if (v && v.key !== key) {
      disposeView(v);
      v = null;
    }
    if (!v) {
      v = makePlayerModel(p, teamMode);
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
      tx = Math.cos(a) * 160;
      tz = Math.sin(a) * 160;
      yawTarget = Math.atan2(camera.position.x - tx, camera.position.z - tz);
      speed = 0;
    }

    if (Math.hypot(tx - v.x, tz - v.z) > 150 || !v.root.visible) {
      v.x = tx;
      v.z = tz;
    } else {
      v.x += (tx - v.x) * k;
      v.z += (tz - v.z) * k;
    }
    // 踩香蕉时原地打转
    if (inRound && p.fx.slip > 0) v.yaw += rdt * 14;
    else v.yaw = lerpAngle(v.yaw, yawTarget, 1 - Math.exp(-rdt * 10));

    // 掉下去：有液面就溅起水花，太空里就飘远变小
    if (inRound && p.falling) {
      v.fvy -= 900 * rdt;
      v.fy += v.fvy * rdt;
      if (theme.splash) {
        if (v.fy + p.r < LIQUID_Y - p.r && !v.splashed) {
          v.splashed = true;
          splash(v.x, v.z, 30);
        }
        if (v.splashed) visible = false;
      } else if (v.fy < -500) visible = false;
    } else {
      v.fy = 0;
      v.fvy = 0;
      v.splashed = false;
    }

    v.squashV += (-120 * v.squash - 9 * v.squashV) * dt;
    v.squash += v.squashV * dt;
    v.squash = Math.max(-0.28, Math.min(0.28, v.squash));

    const frozen = inRound && p.fx.frozen > 0;
    const moving = frozen ? 0 : Math.min(1, speed / 250);
    v.hop += dt * (8 + moving * 10);
    const hopY = moving > 0.1 ? Math.abs(Math.sin(v.hop)) * 0.12 * moving : 0;
    const won = phase === 'roundEnd' && (state.winner === p.id || (teamMode && state.winnerTeam === p.team));
    const celebrate = won ? Math.abs(Math.sin(t * 6)) * 0.9 : 0;
    const lobbyBob = inRound ? 0 : Math.abs(Math.sin(t * 3 + idx)) * 0.25;
    const ghostOn = inRound && p.fx.ghost > 0;
    const ghostFloat = ghostOn ? 0.35 + Math.sin(t * 4) * 0.1 : 0;

    v.pop = Math.min(1, v.pop + rdt * 3);
    const popS = v.pop < 1 ? v.pop * (1 + Math.sin(v.pop * Math.PI) * 0.3) : 1;
    v.scale += (p.r - v.scale) * (1 - Math.exp(-rdt * 8));
    const fade = theme.splash || !(inRound && p.falling) ? 1 : Math.max(0.2, 1 + v.fy / 600);
    const s = v.scale * fade * popS;
    v.root.visible = visible;
    v.root.position.set(v.x, s * (1 + hopY + celebrate + lobbyBob + ghostFloat) + v.fy, v.z);
    v.root.scale.setScalar(Math.max(0.01, s));
    v.root.rotation.y = v.yaw;
    v.body.scale.set(1 + v.squash * 0.5, 1 - v.squash, 1 + v.squash * 0.5);
    v.body.rotation.x = Math.min(0.35, speed / 900);

    v.blink -= dt;
    const closed = frozen || v.blink < 0.12;
    if (v.blink < 0) v.blink = 2 + Math.random() * 4;
    for (const e of v.eyes) e.scale.y = closed ? 0.12 : 1;
    if (!frozen) {
      v.acc.traverse((o) => {
        if (o.userData.spin) o.rotation.y += o.userData.spin * dt;
      });
    }

    // 道具效果
    const shieldOn = inRound && p.fx.shield > 0;
    v.shield.visible = shieldOn && (p.fx.shield > 1.5 || Math.sin(t * 25) > 0);
    v.wire.rotation.y += dt * 1.5;
    v.wire.rotation.x += dt * 0.7;
    v.ice.visible = frozen;
    v.stars.visible = inRound && p.fx.slip > 0;
    v.stars.rotation.y += rdt * 6;
    const opacity = ghostOn ? (p.fx.ghost < 1.2 && Math.sin(t * 20) > 0 ? 0.7 : 0.3) : 1;
    if (v.opacity !== opacity) {
      v.opacity = opacity;
      for (const m of v.mats) {
        m.opacity = m === v.bodyMat || m.type !== 'MeshBasicMaterial' ? opacity : Math.min(0.7, opacity);
        m.depthWrite = opacity === 1;
      }
    }
    const speedOn = inRound && p.fx.speed > 0;
    v.bodyMat.emissive.set(frozen ? '#6fd6ff' : '#ffd23f');
    v.bodyMat.emissiveIntensity = speedOn ? 0.35 + 0.25 * Math.sin(t * 20) : frozen ? 0.4 : 0;
    if (speedOn && speed > 80 && visible && Math.random() < rdt * 40) {
      sparks.add({ x: v.x + (Math.random() - 0.5) * 10, y: s * 0.6, z: v.z + (Math.random() - 0.5) * 10, vx: 0, vy: 20, vz: 0, life: 0.35, color: '#ffd23f', size: 8, g: 0 });
    }
    if (inRound && p.fx.big > 0 && speed > 150 && Math.random() < rdt * 12) puff(v.x, v.z, 1, '#cbb893');

    v.label.visible = visible;
    v.label.position.set(v.x, v.root.position.y + s * 1.6 + 16, v.z);

    if (p.id === myId) me = { p, v, visible };
  });

  for (const [id, v] of views) {
    if (!ids.has(id)) {
      disposeView(v);
      views.delete(id);
    }
  }

  const showMe = me && me.visible && inRound && !me.p.falling;
  myRing.visible = myArrow.visible = !!showMe;
  if (showMe) {
    const ready = me.p.dashCd <= 0;
    myRing.position.set(me.v.x, 1.2, me.v.z);
    myRing.scale.setScalar(me.v.scale * (ready ? 1 + 0.06 * Math.sin(t * 8) : 1));
    myRing.material.color.set(ready ? '#ffd23f' : '#8a84b8');
    myRing.material.opacity = ready ? 0.95 : 0.5 + 0.4 * (1 - me.p.dashCd / DASH_COOLDOWN);
    myArrow.position.set(me.v.x, me.v.root.position.y + me.v.scale * 1.6 + 34 + Math.sin(t * 5) * 3, me.v.z);
    myArrow.rotation.y = t * 2;
  }
  return me;
}

// 同步一组按 id 管理的 3D 物体
function syncViews(map, list, create, update, remove) {
  const ids = new Set();
  for (const o of list) {
    ids.add(o.id);
    let v = map.get(o.id);
    if (!v) {
      v = create(o);
      map.set(o.id, v);
    }
    update(v, o);
  }
  for (const [id, v] of map) {
    if (!ids.has(id)) {
      remove(v);
      map.delete(id);
    }
  }
}

function updateObjects(dt, t) {
  const inRound = !!state && (state.phase === 'playing' || state.phase === 'roundEnd' || state.phase === 'countdown');
  // 道具
  syncViews(
    itemViews,
    inRound ? state.items : [],
    (it) => {
      burst(it.x, 10, it.y, ITEM_INFO[it.type].color, 14, 120, 6);
      return makeItemModel(it.type);
    },
    (v, it) => {
      const pop = Math.min(1, (t - v.born) * 3);
      const popScale = pop < 1 ? pop * (1 + Math.sin(pop * Math.PI) * 0.4) : 1;
      v.root.position.set(it.x, 0, it.y);
      v.float.position.y = 30 + Math.sin(t * 3 + it.id) * 5;
      v.float.rotation.y = t * 1.8;
      v.float.scale.setScalar(1.5 * popScale);
      v.glow.material.opacity = 0.55 + 0.3 * Math.sin(t * 5 + it.id);
      v.beam.material.opacity = 0.16 + 0.08 * Math.sin(t * 4 + it.id);
      if (it.type === 'bomb') {
        v.float.traverse((o) => {
          if (o.userData.spark) o.scale.setScalar(0.6 + Math.random() * 0.8);
        });
        if (Math.random() < dt * 18) sparks.add({ x: it.x + 3, y: v.float.position.y + 25, z: it.y, vx: (Math.random() - 0.5) * 40, vy: 40, vz: (Math.random() - 0.5) * 40, life: 0.3, color: '#ffe066', size: 5, g: 100 });
      }
    },
    (v) => {
      scene.remove(v.root);
      disposeGroup(v.root);
    }
  );
  // 龙卷风
  syncViews(
    tornadoViews,
    inRound ? state.hazards.filter((h) => h.type === 'tornado') : [],
    () => makeTornado(),
    (v, h) => {
      if (!v.init) {
        v.g.position.set(h.x, 0, h.y);
        v.init = true;
      }
      v.g.position.x += (h.x - v.g.position.x) * Math.min(1, dt * 10);
      v.g.position.z += (h.y - v.g.position.z) * Math.min(1, dt * 10);
      v.g.scale.setScalar(Math.max(0.05, Math.min(1, (7 - h.life) * 3, h.life * 2)));
      v.layers.forEach((l, i) => {
        l.rotation.z = t * (4 + i * 0.6);
        l.position.x = Math.sin(t * 3 + i * 0.7) * (6 + i * 2);
      });
      if (Math.random() < dt * 30) {
        const a = Math.random() * Math.PI * 2;
        dust.add({ x: v.g.position.x + Math.cos(a) * 40, y: Math.random() * 120, z: v.g.position.z + Math.sin(a) * 40, vx: -Math.sin(a) * 160, vy: 60, vz: Math.cos(a) * 160, life: 0.6, color: '#cfe8d8', size: 8, alpha: 0.6 });
      }
    },
    (v) => {
      scene.remove(v.g);
      disposeGroup(v.g);
    }
  );
  // 香蕉皮
  syncViews(
    trapViews,
    inRound ? state.traps : [],
    (tr) => {
      const g = makeBanana(1.3);
      g.rotation.x = -Math.PI / 2;
      g.rotation.z = tr.id;
      g.position.set(tr.x, 4, tr.y);
      scene.add(g);
      return g;
    },
    () => {},
    (g) => {
      scene.remove(g);
      disposeGroup(g);
    }
  );
  // 陨石：地面红圈预警 + 从天上斜着砸下来
  syncViews(
    meteorViews,
    inRound ? state.meteors : [],
    () => makeMeteor(),
    (v, m) => {
      const k = 1 - Math.max(0, m.t) / 1.6;
      v.warn.position.set(m.x, 2, m.y);
      v.warn.scale.setScalar(m.r);
      v.warn.material.opacity = 0.5 + 0.4 * Math.sin(t * 20);
      v.fill.position.set(m.x, 1.5, m.y);
      v.fill.scale.setScalar(Math.max(0.01, m.r * k));
      const h = Math.max(0, m.t) * 700;
      v.rock.position.set(m.x + h * 0.45, h + 20, m.y - h * 0.3);
      v.rock.rotation.x += dt * 5;
      v.rock.rotation.y += dt * 3;
      if (Math.random() < dt * 60) sparks.add({ x: v.rock.position.x, y: v.rock.position.y, z: v.rock.position.z, vx: (Math.random() - 0.5) * 30, vy: 20, vz: (Math.random() - 0.5) * 30, life: 0.5, color: Math.random() < 0.5 ? '#ff7a1a' : '#ffd23f', size: 12, g: 0 });
    },
    (v) => {
      for (const o of [v.warn, v.fill, v.rock]) {
        scene.remove(o);
        o.geometry.dispose();
        o.material.dispose();
      }
    }
  );
  // 皇冠：戴在持有者头上，没人拿时浮在地上
  const cr = inRound && state.crown;
  crownView.root.visible = !!cr;
  if (cr) {
    if (cr.h) {
      const v = views.get(cr.h);
      crownView.root.visible = !!(v && v.root.visible);
      if (v) {
        crownView.root.position.set(v.x, v.root.position.y + v.scale * 1.25, v.z);
        crownView.root.scale.setScalar((v.scale / 24) * 1.6);
      }
      crownView.beam.visible = false;
      crownView.g.rotation.y = t * 1.5;
      crownView.g.position.y = 0;
    } else {
      crownView.root.position.set(cr.x, 0, cr.y);
      crownView.root.scale.setScalar(1.4);
      crownView.beam.visible = true;
      crownView.g.position.y = 26 + Math.sin(t * 3) * 5;
      crownView.g.rotation.y = t * 2;
    }
  }
}

// ---- 摄像机 ----
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3(0, 700, 900);
const CAM_DIR = new THREE.Vector3(0, Math.sin(THREE.MathUtils.degToRad(52)), Math.cos(THREE.MathUtils.degToRad(52)));
let camR = 460;

function updateCamera(dt, t, me) {
  const phase = state ? state.phase : 'menu';
  const inRound = phase === 'countdown' || phase === 'playing' || phase === 'roundEnd';
  const want = new THREE.Vector3();
  const look = new THREE.Vector3();
  camR += (arenaR - camR) * Math.min(1, dt * 1.5);
  if (!inRound) {
    // 菜单 / 大厅：缓慢环绕
    const a = t * 0.1;
    const near = phase === 'lobby' || phase === 'gameOver';
    const r = near ? 640 : 900;
    want.set(Math.sin(a) * r, near ? 380 : 520, Math.cos(a) * r);
    look.set(0, near ? 0 : -30, 0);
  } else {
    // 让整个场地都在画面里；竖屏手机上镜头跟着自己走
    const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const R = camR + 40;
    let dist = Math.max(R / (tanH * camera.aspect), R * 2.2);
    let follow = 0.2;
    const cap = 1300;
    if (dist > cap) {
      follow = Math.min(0.75, (dist - cap) / dist + 0.3);
      dist = cap;
    }
    if (me && me.visible && !me.p.falling) look.set(me.v.x * follow, 0, me.v.z * follow + 60);
    else look.set(0, 0, 60);
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

  liquidMat.uniforms.uTime.value = t;
  skyMat.uniforms.uTime.value = t;
  underLight.intensity = theme.under[1] * (1 + Math.sin(t * 2.1) * 0.1 + Math.sin(t * 5.3) * 0.05);
  for (const f of floaters) {
    f.a += f.sp * rdt;
    f.m.position.set(Math.cos(f.a) * f.r, f.y + (f.bob ? Math.sin(t * 1.5 + f.r) * 3 : Math.sin(t + f.r) * 8), Math.sin(f.a) * f.r);
    if (f.flat) {
      f.m.rotation.z += rdt * 0.3;
    } else {
      f.m.rotation.x += rdt * 0.2;
      f.m.rotation.y += rdt * 0.3;
    }
  }
  // 菜单背景：轮流展示 4 张地图
  if (!state && myId === null && Object.keys(mapCache).length === 4) {
    const id = Object.keys(MAP_INFO)[Math.floor(t / 9) % 4];
    if (!mapDef || mapDef.id !== id) applyMap(mapCache[id]);
  }
  ambient(rdt);
  updateTiles(rdt, t);
  const me = updatePlayers(dt, t, rdt);
  updateObjects(rdt, t);

  for (let i = rings.length - 1; i >= 0; i--) {
    const s = rings[i];
    s.t += rdt;
    const k = Math.min(1, s.t / s.dur);
    s.m.scale.setScalar(Math.max(0.01, s.r * Math.sqrt(k)));
    s.m.material.opacity = 0.9 * (1 - k);
    if (k >= 1) {
      scene.remove(s.m);
      s.m.geometry.dispose();
      s.m.material.dispose();
      rings.splice(i, 1);
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

resize();
// 预先加载 4 张地图，菜单背景轮流展示
Promise.all(Object.keys(MAP_INFO).map((id) => fetch(`/api/map/${id}`).then((r) => r.json())))
  .then((defs) => {
    for (const d of defs) if (!mapCache[d.id]) mapCache[d.id] = d;
    if (!mapDef) applyMap(mapCache.lava);
  })
  .catch(() => {});
$('loading').classList.add('hidden');
showScreen('menu');
requestAnimationFrame(frame);
