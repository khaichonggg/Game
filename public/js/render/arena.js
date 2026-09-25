// 场地：4 张地图的主题（天空、液面、灯光、地砖配色、周边装饰）、地砖状态动画、涂色
import * as THREE from 'three';
import { scene, skyMat, liquidMat, liquid, hemi, sun, underLight, std, mesh, rockify, markShared, disposeGroup, TILE_H, LIQUID_Y, bloom } from './core.js';
import { splash, clearParticles, dust, sparks } from './particles.js';

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


// 地图主题
export const THEMES = {
  lava: {
    dust: '#cdb48c',
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
    dust: '#f0faff',
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
    dust: '#aab4e8',
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
    dust: '#ffd6ea',
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

export let theme = THEMES.lava;
export let mapDef = null;
const arena = new THREE.Group();
const decor = new THREE.Group();
scene.add(arena, decor);
export let tiles = [];
export let bumpers = [];
export let arenaR = 460;
const floaters = [];
const rockMat = markShared(std('#4a3436', { roughness: 0.95, flatShading: true }));

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

let exitZone = new Set();
// 地砖顶面的细节贴图（灰度，和地砖颜色相乘）：石纹 / 冰裂 / 金属面板 / 糖粒
const detailCache = new Map();
function detailTexture(kind) {
  if (detailCache.has(kind)) return detailCache.get(kind);
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 256);
  if (kind === 'lava') {
    for (let i = 0; i < 900; i++) {
      const v = 200 + Math.floor(rnd() * 55);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 3, 1 + rnd() * 3);
    }
    g.strokeStyle = 'rgba(90,70,60,0.35)';
    g.lineWidth = 1.5;
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      let x = rnd() * 256;
      let y = rnd() * 256;
      g.moveTo(x, y);
      for (let k = 0; k < 5; k++) g.lineTo((x += (rnd() - 0.5) * 50), (y += (rnd() - 0.5) * 50));
      g.stroke();
    }
  } else if (kind === 'ice') {
    const gr = g.createLinearGradient(0, 0, 256, 256);
    gr.addColorStop(0, '#ffffff');
    gr.addColorStop(0.5, '#e4f1f7');
    gr.addColorStop(1, '#ffffff');
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    for (let i = 0; i < 10; i++) {
      g.lineWidth = 0.5 + rnd() * 1.5;
      g.beginPath();
      let x = rnd() * 256;
      let y = rnd() * 256;
      g.moveTo(x, y);
      for (let k = 0; k < 4; k++) g.lineTo((x += (rnd() - 0.5) * 70), (y += (rnd() - 0.5) * 70));
      g.stroke();
    }
    g.strokeStyle = 'rgba(120,170,200,0.35)';
    for (let i = 0; i < 8; i++) {
      g.beginPath();
      const x = rnd() * 256;
      const y = rnd() * 256;
      g.moveTo(x, y);
      g.lineTo(x + (rnd() - 0.5) * 60, y + (rnd() - 0.5) * 60);
      g.stroke();
    }
  } else if (kind === 'space') {
    g.fillStyle = '#e8ebf2';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(40,50,80,0.35)';
    g.lineWidth = 2;
    g.strokeRect(10, 10, 236, 236);
    g.strokeStyle = 'rgba(40,50,80,0.18)';
    for (let i = -256; i < 256; i += 22) {
      g.beginPath();
      g.moveTo(i + 40, 60);
      g.lineTo(i + 140, 196);
      g.stroke();
    }
    g.fillStyle = 'rgba(60,70,100,0.55)';
    for (const [x, y] of [
      [24, 24],
      [232, 24],
      [24, 232],
      [232, 232],
    ]) {
      g.beginPath();
      g.arc(x, y, 5, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    // 糖果：表面一层糖粒
    const cols = ['#ffd6e8', '#fff3b0', '#d4f5ff', '#e6d8ff'];
    for (let i = 0; i < 140; i++) {
      g.save();
      g.translate(rnd() * 256, rnd() * 256);
      g.rotate(rnd() * Math.PI);
      g.fillStyle = cols[i % cols.length];
      g.fillRect(-4, -1.2, 8, 2.4);
      g.restore();
    }
    const gr = g.createRadialGradient(80, 70, 0, 80, 70, 160);
    gr.addColorStop(0, 'rgba(255,255,255,0.5)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 256);
  }
  const t = markShared(new THREE.CanvasTexture(c));
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / 96, 1 / 96);
  t.anisotropy = 4;
  detailCache.set(kind, t);
  return t;
}

function buildArena(def) {
  disposeGroup(arena);
  rimFx.length = 0;
  tiles = [];
  bumpers = [];
  exitZone = new Set(def.level ? def.feat.exit : []);
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
    // 闯关关卡：机关地砖用醒目的颜色（闪烁地砖橙 / 蓝两组，钥匙桥木头色，机关桥青色，终点岛带一点绿）
    if (def.level) {
      const lc = { A: '#ff9d3a', B: '#3fb8ff', k: '#c8935a', p: '#4fd6d0', E: t.c ? '#ffe27a' : '#fff6d0' }[t.ch];
      if (lc) col.lerp(new THREE.Color(lc), 0.75);
      else if (exitZone.has(i)) col.lerp(new THREE.Color('#7be38b'), 0.28);
    }
    if (isIce) col.offsetHSL(0, 0, Math.sin(i * 12.9898) * 0.02);
    const top = std(col, { roughness: f.rough, metalness: f.metal, emissive: '#ff2a00', emissiveIntensity: 0, map: detailTexture(def.theme || def.id) });
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

  if (def.level) {
    // 关卡没有圆形中心，不放中心装饰
  } else if (theme === THEMES.lava) {
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
  if (!def.level) addRimOrnaments(def);
}

// 场地边缘的装饰：熔岩火盆 / 冰晶 / 信号灯 / 拐杖糖（不参与碰撞）
const rimFx = [];
function addRimOrnaments(def) {
  const id = def.theme || def.id;
  const R = def.radius + 34;
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / n;
    const g = new THREE.Group();
    g.position.set(Math.cos(a) * R, 0, Math.sin(a) * R);
    g.rotation.y = -a;
    if (id === 'lava') {
      const rock = new THREE.Mesh(rockify(new THREE.DodecahedronGeometry(26, 0), 0.2, i + 70), rockMat);
      rock.scale.set(1, 0.7, 1);
      rock.position.y = -26;
      g.add(rock);
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(18, 11, 14, 10), std('#3a2a2a', { roughness: 0.6, metalness: 0.4 }));
      bowl.position.y = 2;
      g.add(bowl);
      const flameMat = new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
      const flame = new THREE.Mesh(new THREE.ConeGeometry(11, 34, 10), flameMat);
      flame.position.y = 24;
      const core = new THREE.Mesh(new THREE.ConeGeometry(6, 20, 8), new THREE.MeshBasicMaterial({ color: '#fff3a0', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
      core.position.y = 18;
      g.add(flame, core);
      rimFx.push({ kind: 'flame', flame, core, x: g.position.x, z: g.position.z, ph: i * 1.7 });
    } else if (id === 'ice') {
      const mat = new THREE.MeshStandardMaterial({ color: '#d8f6ff', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.85, emissive: '#6fd6ff', emissiveIntensity: 0.35 });
      for (let k = 0; k < 3; k++) {
        const c = new THREE.Mesh(new THREE.OctahedronGeometry(10 + k * 4, 0), mat);
        c.scale.set(0.6, 2.2, 0.6);
        c.position.set((k - 1) * 12, 16 + k * 6, (k % 2) * 8);
        c.rotation.z = (k - 1) * 0.3;
        g.add(c);
      }
      rimFx.push({ kind: 'bob', obj: g, ph: i });
    } else if (id === 'space') {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(3, 5, 46, 8), std('#9aa3c0', { metalness: 0.8, roughness: 0.3 }));
      post.position.y = 10;
      g.add(post);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(7, 12, 10), new THREE.MeshBasicMaterial({ color: i % 2 ? '#ff4d6d' : '#19d3ff' }));
      lamp.position.y = 36;
      g.add(lamp);
      const dish = new THREE.Mesh(new THREE.SphereGeometry(14, 16, 8, 0, Math.PI * 2, 0, Math.PI / 3), std('#c8cfe0', { metalness: 0.6, roughness: 0.3, side: THREE.DoubleSide }));
      dish.position.set(0, 26, 6);
      dish.rotation.x = -1;
      g.add(dish);
      rimFx.push({ kind: 'blink', lamp, ph: i * 0.8 });
    } else {
      // 糖果：红白拐杖糖
      const tex = stripeTexture(['#ff4d6d', '#ffffff'], 8);
      const mat = std('#ffffff', { map: tex, roughness: 0.3 });
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 60, 12), mat);
      stick.position.y = 10;
      g.add(stick);
      const hook = new THREE.Mesh(new THREE.TorusGeometry(10, 4, 10, 20, Math.PI), mat);
      hook.position.set(10, 40, 0);
      g.add(hook);
    }
    arena.add(g);
  }
}

// ---------------------------------------------------------------------
// 闯关关卡的机关：压力板、锁台、出口传送门、还没出现的桥的虚线轮廓
// ---------------------------------------------------------------------
export const level = { plates: [], lock: null, exit: null, active: false };
function buildLevel(def) {
  level.plates = [];
  level.lock = null;
  level.exit = null;
  level.active = !!def.level;
  for (const t of tiles) t.ghost = null;
  if (!def.level) return;
  const f = def.feat;
  // 待出现地砖的轮廓：钥匙桥金色、机关桥青色、闪烁地砖橙 / 蓝
  const ghostCol = { k: '#ffd23f', p: '#4ff0e0', A: '#ff9d3a', B: '#3fb8ff' };
  tiles.forEach((tile) => {
    const c = ghostCol[tile.def.ch];
    if (!c) return;
    const h = tile.def.s / 2 - 5;
    const pts = [new THREE.Vector3(-h, 0, -h), new THREE.Vector3(h, 0, -h), new THREE.Vector3(h, 0, h), new THREE.Vector3(-h, 0, h), new THREE.Vector3(-h, 0, -h)];
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: c, dashSize: 10, gapSize: 7, transparent: true, opacity: 0.9 }));
    line.computeLineDistances();
    line.position.set(tile.def.cx, 1.5, tile.def.cy);
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(h * 2, h * 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.12, depthWrite: false }));
    line.add(fill);
    line.visible = false;
    arena.add(line);
    tile.ghost = line;
  });
  // 压力板：底座 + 会被踩下去的大按钮
  for (const pl of f.plates) {
    const g = new THREE.Group();
    g.position.set(pl.x, 0, pl.y);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(33, 36, 5, 32), std('#3a3550', { metalness: 0.6, roughness: 0.35 }));
    base.position.y = 2.5;
    base.receiveShadow = true;
    g.add(base);
    const mat = std('#ff5a5f', { roughness: 0.3, emissive: '#ff2a2a', emissiveIntensity: 0.5 });
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(26, 28, 8, 32), mat);
    btn.position.y = 9;
    btn.castShadow = true;
    g.add(btn);
    const ring = new THREE.Mesh(new THREE.RingGeometry(38, 44, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ff5a5f', transparent: true, opacity: 0.7, depthWrite: false }));
    ring.position.y = 1.2;
    g.add(ring);
    arena.add(g);
    level.plates.push({ g, btn, mat, ring, y: 9 });
  }
  // 锁台：石柱 + 金色锁孔，开锁后发光
  if (f.lock) {
    const g = new THREE.Group();
    g.position.set(f.lock.x, 0, f.lock.y);
    const stone = std('#6b6478', { roughness: 0.8, flatShading: true });
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(16, 20, 44, 8), stone);
    pillar.position.y = 22;
    pillar.castShadow = true;
    g.add(pillar);
    const gold = std('#ffcf4a', { metalness: 0.9, roughness: 0.25, emissive: '#7a4a00', emissiveIntensity: 0.3 });
    const plate = new THREE.Mesh(new THREE.BoxGeometry(26, 30, 6), gold);
    plate.position.set(0, 36, 0);
    g.add(plate);
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 8, 12).rotateX(Math.PI / 2), std('#1b1822'));
    hole.position.set(0, 40, 0);
    g.add(hole);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(3, 9, 8), std('#1b1822'));
    slot.position.set(0, 34, 0);
    g.add(slot);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(30, 16, 12), new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.position.y = 36;
    g.add(glow);
    arena.add(g);
    level.lock = { g, glow, gold };
  }
  // 出口：旋转的传送门 + 光柱
  if (f.exitCore && f.exitCore.length) {
    let x = 0;
    let y = 0;
    for (const id of f.exitCore) {
      x += def.tiles[id].cx / f.exitCore.length;
      y += def.tiles[id].cy / f.exitCore.length;
    }
    const g = new THREE.Group();
    g.position.set(x, 0, y);
    const ringMat = new THREE.MeshStandardMaterial({ color: '#7bffb0', emissive: '#3ddc84', emissiveIntensity: 1.2, roughness: 0.3 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(46, 6, 12, 48), ringMat);
    ring.position.y = 60;
    g.add(ring);
    const inner = new THREE.Mesh(new THREE.CircleGeometry(42, 40), new THREE.MeshBasicMaterial({ color: '#b8ffd8', transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    inner.position.y = 60;
    g.add(inner);
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(6, 8, 60, 10), std('#e8e2d0', { roughness: 0.4 }));
      post.position.set(s * 46, 30, 0);
      g.add(post);
    }
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(60, 60, 500, 32, 1, true), new THREE.MeshBasicMaterial({ color: '#7bffb0', transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    beam.position.y = 250;
    g.add(beam);
    arena.add(g);
    level.exit = { g, ring, inner, beam };
  }
}

// 关卡是长条形的，远景装饰（岩柱、冰山等）可能压在关卡上，挪走离地砖太近的
function clearDecorNearLevel() {
  const near = (x, z, pad) => tiles.some((t) => Math.abs(t.def.cx - x) < pad && Math.abs(t.def.cy - z) < pad);
  for (const o of [...decor.children]) {
    if (near(o.position.x, o.position.z, 320)) {
      decor.remove(o);
      disposeGroup(o);
    }
  }
  for (const f of floaters) f.r = Math.max(f.r, arenaR + 260);
}

// 每帧根据模式数据更新机关的样子
export function updateLevel(m, dt, t) {
  if (!level.active) return;
  for (const tile of tiles) {
    if (!tile.ghost) continue;
    tile.ghost.visible = tile.state === 2 && !tile.anim;
    if (tile.ghost.visible) tile.ghost.material.opacity = 0.55 + 0.35 * Math.sin(t * 4 + tile.def.cx * 0.01);
  }
  (m.plates || []).forEach((pl, i) => {
    const v = level.plates[i];
    if (!v) return;
    const on = pl.on || m.pOpen;
    v.y += ((on ? 3.5 : 9) - v.y) * Math.min(1, dt * 14);
    v.btn.position.y = v.y;
    const c = on ? '#3ddc84' : '#ff5a5f';
    v.mat.color.set(c);
    v.mat.emissive.set(on ? '#16a35a' : '#ff2a2a');
    v.mat.emissiveIntensity = on ? 0.9 : 0.35 + 0.25 * Math.sin(t * 5 + i);
    v.ring.material.color.set(c);
    v.ring.scale.setScalar(on ? 1 : 1 + 0.06 * Math.sin(t * 5 + i));
  });
  if (level.lock) {
    const open = !!m.kOpen;
    level.lock.glow.material.opacity += ((open ? 0.45 : 0) - level.lock.glow.material.opacity) * Math.min(1, dt * 5);
    level.lock.gold.emissiveIntensity = open ? 1 : 0.3;
  }
  if (level.exit) {
    level.exit.ring.rotation.y = t * 1.2;
    level.exit.inner.rotation.y = t * 1.2;
    level.exit.beam.material.opacity = 0.06 + 0.04 * Math.sin(t * 3) + (m.need && m.inExit ? (m.inExit / m.need) * 0.12 : 0);
  }
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

export function applyMap(def) {
  mapDef = def;
  const themeId = def.theme || def.id;
  theme = THEMES[themeId] || THEMES.lava;
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
  // 每张图的泛光强度 / 阈值（糖果和冰面本身很亮，泛光要收着点）
  const bl = { lava: [0.5, 1.6], ice: [0.35, 1.9], space: [0.6, 1.3], candy: [0.3, 2.0] }[themeId] || [0.5, 1.6];
  bloom.strength = bl[0];
  bloom.threshold = bl[1];
  buildArena(def);
  for (const t of tiles) t.baseColor = t.mat.color.clone();
  buildLevel(def);
  buildDecor(themeId);
  if (def.level) clearDecorNearLevel();
  clearParticles();
  paintKey = '';
  freshMap = true;
}

// 地砖状态：0 正常 1 预警 2 已塌；返回当前还在的场地半径（给镜头用）
let freshMap = false;
export function syncTiles(str) {
  if (!str || str.length !== tiles.length) return arenaR;
  let maxR = 0;
  const instant = freshMap;
  freshMap = false;
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    const s = str.charCodeAt(i) - 48;
    if (s !== tile.state && instant) {
      // 刚换地图：直接摆成当前状态（比如还没出现的桥），不播放掉落动画
      tile.state = s;
      tile.anim = null;
      tile.mesh.visible = s !== 2;
      tile.mesh.position.copy(tile.base);
    } else if (s !== tile.state) {
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
  return arenaR;
}

export function resetTiles() {
  syncTiles('0'.repeat(tiles.length));
}

// 涂色大战：地砖顶面染成占领者的颜色
let paintKey = '';
export function setPaint(str, colorOfSlot) {
  if (!str) {
    if (paintKey) {
      for (const t of tiles) t.mat.color.copy(t.baseColor);
      paintKey = '';
    }
    return;
  }
  if (str === paintKey || str.length !== tiles.length) return;
  for (let i = 0; i < tiles.length; i++) {
    if (str[i] === paintKey[i]) continue;
    const t = tiles[i];
    const c = str[i] === '.' ? null : colorOfSlot(str.charCodeAt(i) - 97);
    t.mat.color.copy(t.baseColor);
    if (c) {
      t.mat.color.lerp(new THREE.Color(c), 0.8);
      t.painted = 0.3; // 染色时弹一下
    }
  }
  paintKey = str;
}

export function bumperHit(i) {
  const b = bumpers[i];
  if (b && b.squash < 0.15) {
    b.squashV += 7;
    return true;
  }
  return false;
}

export function updateArena(dt, t) {
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
        splash(m.position.x, m.position.z, 12, theme.splash);
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
    } else if (tile.painted > 0) {
      tile.painted = Math.max(0, tile.painted - dt);
      m.position.set(tile.base.x, Math.sin((tile.painted / 0.3) * Math.PI) * 4, tile.base.z);
    } else if (m.position.x !== tile.base.x || m.position.y !== 0) {
      m.position.copy(tile.base);
    }
  }
  const d = Math.min(dt, 0.05);
  for (const b of bumpers) {
    b.squashV += (-160 * b.squash - 10 * b.squashV) * d;
    b.squash += b.squashV * d;
    b.jelly.scale.set(1 + b.squash * 0.4, 1.3 * (1 - b.squash), 1 + b.squash * 0.4);
  }
  underLight.intensity = theme.under[1] * (1 + Math.sin(t * 2.1) * 0.1 + Math.sin(t * 5.3) * 0.05);
  for (const r of rimFx) {
    if (r.kind === 'flame') {
      const k = 1 + Math.sin(t * 13 + r.ph) * 0.12 + Math.sin(t * 29 + r.ph * 2) * 0.08;
      r.flame.scale.set(1 / k, k, 1 / k);
      r.core.scale.set(1, k * 0.9, 1);
      if (Math.random() < dt * 4) sparks.add({ x: r.x + (Math.random() - 0.5) * 10, y: 40, z: r.z + (Math.random() - 0.5) * 10, vx: (Math.random() - 0.5) * 20, vy: 60 + Math.random() * 40, vz: (Math.random() - 0.5) * 20, life: 0.9, color: '#ffb347', size: 5, g: -10 });
    } else if (r.kind === 'bob') r.obj.position.y = Math.sin(t * 1.4 + r.ph) * 4;
    else if (r.kind === 'blink') r.lamp.visible = Math.sin(t * 3 + r.ph) > -0.3;
  }
  for (const f of floaters) {
    f.a += f.sp * dt;
    f.m.position.set(Math.cos(f.a) * f.r, f.y + (f.bob ? Math.sin(t * 1.5 + f.r) * 3 : Math.sin(t + f.r) * 8), Math.sin(f.a) * f.r);
    if (f.flat) f.m.rotation.z += dt * 0.3;
    else {
      f.m.rotation.x += dt * 0.2;
      f.m.rotation.y += dt * 0.3;
    }
  }
}

// 各地图的环境粒子：火星 / 雪花 / 星尘 / 彩色糖针
export function ambient(dt, cx, cz) {
  const n = Math.round(dt * 150);
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
