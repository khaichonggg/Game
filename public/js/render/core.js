// 渲染核心：渲染器、场景、相机、灯光、天空、液面
import * as THREE from 'three';
import { settings, isTouch } from '../settings.js';

export const LIQUID_Y = -150;
export const TILE_H = 26;

export const canvas = document.getElementById('game');
export let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch {
  document.getElementById('loading').textContent = '你的浏览器不支持 WebGL，无法显示 3D 画面';
  throw new Error('WebGL unavailable');
}
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

export const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#6a2230', 1500, 4200);
export const camera = new THREE.PerspectiveCamera(45, 1, 10, 12000);

export const hemi = new THREE.HemisphereLight('#9fb0ff', '#ff6a2a', 0.9);
scene.add(hemi);
export const sun = new THREE.DirectionalLight('#fff0dc', 2.6);
sun.position.set(300, 800, 380);
sun.castShadow = true;
Object.assign(sun.shadow.camera, { left: -600, right: 600, top: 600, bottom: -600, near: 100, far: 2000 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 1.5;
scene.add(sun);
// 从下方照亮浮岛（岩浆 / 海水 / 星球的反光）
export const underLight = new THREE.PointLight('#ff5a1a', 3.5, 1400, 0);
underLight.position.set(0, LIQUID_Y + 30, 0);
scene.add(underLight);

// 画质：高 / 中 / 低
export const quality = { particles: 1 };
export function applyQuality() {
  const q = settings.quality;
  const dpr = window.devicePixelRatio || 1;
  renderer.setPixelRatio(Math.min(dpr, q === 'high' ? 2 : q === 'medium' ? 1.5 : 1));
  renderer.shadowMap.enabled = q !== 'low';
  sun.castShadow = q !== 'low';
  const size = q === 'high' && !isTouch ? 2048 : 1024;
  if (sun.shadow.mapSize.x !== size) {
    sun.shadow.mapSize.set(size, size);
    if (sun.shadow.map) {
      sun.shadow.map.dispose();
      sun.shadow.map = null;
    }
  }
  quality.particles = q === 'low' ? 0.4 : q === 'medium' ? 0.7 : 1;
  scene.traverse((o) => {
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => (m.needsUpdate = true));
  });
  resize();
}

// ---- 天空 ----
export const skyMat = new THREE.ShaderMaterial({
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
scene.add(new THREE.Mesh(new THREE.SphereGeometry(10000, 32, 16), skyMat));

// ---- 液面（岩浆 / 海水 / 草莓牛奶，程序化噪声） ----
export const liquidMat = new THREE.ShaderMaterial({
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
export const liquid = new THREE.Mesh(new THREE.PlaneGeometry(14000, 14000), liquidMat);
liquid.rotation.x = -Math.PI / 2;
liquid.position.y = LIQUID_Y;
scene.add(liquid);

// ---- 通用小工具 ----
export const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...o });
export function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}
// 用确定性噪声扰动顶点，做出低多边形岩石
export function rockify(geo, amount, seed = 1) {
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
const shared = new WeakSet();
export const markShared = (x) => (shared.add(x), x);
export function disposeGroup(g) {
  g.traverse((o) => {
    if (o.geometry && !shared.has(o.geometry)) o.geometry.dispose();
    if (o.material) {
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
        if (shared.has(m)) return;
        if (m.map && !shared.has(m.map)) m.map.dispose();
        m.dispose();
      });
    }
  });
  g.clear();
}

// 文字贴图精灵（名字、漫画字、表情气泡）
export function textSprite(text, { color = '#ffffff', size = 40, stroke = 'rgba(20,14,40,0.85)', height = 16, bg = null } = {}) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = `900 ${size}px -apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI Emoji", sans-serif`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + size * 0.6;
  const h = Math.ceil(size * 1.4);
  c.width = w;
  c.height = h;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (bg) {
    ctx.fillStyle = bg;
    const r = h / 2;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.arcTo(w, 0, w, h, r);
    ctx.arcTo(w, h, 0, h, r);
    ctx.arcTo(0, h, 0, 0, r);
    ctx.arcTo(0, 0, w, 0, r);
    ctx.fill();
  }
  if (stroke) {
    ctx.lineWidth = size / 5;
    ctx.strokeStyle = stroke;
    ctx.strokeText(text, w / 2, h / 2 + 1);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, h / 2 + 1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set((w / h) * height, height, 1);
  s.renderOrder = 10;
  return s;
}

export function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  for (const fn of resizeHooks) fn();
}
const resizeHooks = [];
export const onResize = (fn) => resizeHooks.push(fn);
window.addEventListener('resize', resize);
