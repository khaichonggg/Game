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
    floor: { cols: ['#ffeccb', '#fbe0b6', '#fff2d9'], center: ['#cdb9ff', '#bba5f7'], rough: 0.65, metal: 0, body: '#c0703f', bodyRough: 0.55 },
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
    floor: { cols: ['#ffffff', '#f3faff', '#fafdff'], center: ['#e2f4ff', '#d4eeff'], rough: 0.55, metal: 0, body: '#8fd6f7', bodyRough: 0.08 },
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
    floor: { cols: ['#9aa3f0', '#8b95e6', '#a6aef5'], center: ['#d2a6ff', '#c393ff', '#dcb6ff'], rough: 0.4, metal: 0.25, body: '#34386e', bodyRough: 0.35, sideGlow: '#19d3ff' },
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
    floor: { cols: ['#ffc2dc', '#fff1c9', '#c6f2df', '#ffd8f0'], center: ['#aee6ff', '#9edcff'], rough: 0.4, metal: 0, body: '#c7864a', bodyRough: 0.6 },
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
const rockMat = markShared(std('#8a5540', { roughness: 0.6 }));

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
    for (let i = 0; i < 260; i++) {
      const v = 214 + Math.floor(rnd() * 34);
      g.fillStyle = `rgb(${v},${v - 8},${v - 18})`;
      g.beginPath();
      g.arc(rnd() * 256, rnd() * 256, 1 + rnd() * 2.4, 0, Math.PI * 2);
      g.fill();
    }
  } else if (kind === 'ice') {
    // 雪面：细碎的闪光点
    for (let i = 0; i < 220; i++) {
      const v = 226 + Math.floor(rnd() * 29);
      g.fillStyle = `rgb(${v - 10},${v - 3},${v})`;
      g.beginPath();
      g.arc(rnd() * 256, rnd() * 256, 0.8 + rnd() * 1.8, 0, Math.PI * 2);
      g.fill();
    }
  } else if (kind === 'ice-old') {
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
  const bevel = 6;
  const isIce = theme === THEMES.ice;
  // 底座：所有地砖共用一个材质；顶面的"糖霜 / 雪 / 沙"每块一个材质（预警发光、涂色要单独改颜色）
  const bodyMat = std(f.body, { roughness: f.bodyRough, metalness: theme === THEMES.space ? 0.4 : 0, emissive: f.sideGlow || '#000000', emissiveIntensity: f.sideGlow ? 0.45 : 0 });
  const underMat = isIce
    ? new THREE.MeshStandardMaterial({ color: '#cfefff', roughness: 0.1, transparent: true, opacity: 0.85 })
    : std(theme === THEMES.candy ? '#7a4424' : new THREE.Color(f.body).offsetHSL(0, -0.1, -0.18), { roughness: 0.9 });
  const stalGeos = [0, 1, 2].map((k) => (isIce ? new THREE.ConeGeometry(6 + k * 2, 26 + k * 12, 10).rotateX(Math.PI) : new THREE.ConeGeometry(11 + k * 4, 34 + k * 18, 12).rotateX(Math.PI)));
  def.tiles.forEach((t, i) => {
    const isCenter = t.l >= def.center;
    const palette = isCenter ? f.center : f.cols;
    const col = new THREE.Color(palette[(t.c + (isCenter ? 0 : t.l)) % palette.length]);
    // 闯关关卡：机关地砖用醒目的颜色（闪烁地砖橙 / 蓝两组，钥匙桥木头色，机关桥青色，终点岛带一点绿）
    if (def.level) {
      const lc = { A: '#ff9d3a', B: '#3fb8ff', k: '#c8935a', p: '#4fd6d0', E: t.c ? '#ffe27a' : '#fff6d0' }[t.ch];
      if (lc) col.lerp(new THREE.Color(lc), 0.75);
      else if (exitZone.has(i)) col.lerp(new THREE.Color('#7be38b'), 0.28);
    }
    if (isIce) col.offsetHSL(0, 0, Math.sin(i * 12.9898) * 0.015);
    const top = std(col, { roughness: f.rough, metalness: f.metal, emissive: '#ff2a00', emissiveIntensity: 0, map: detailTexture(def.theme || def.id) });
    const curveSegments = t.k === 's' ? 6 : 3;
    const geo = new THREE.ExtrudeGeometry(tileShape(t, 4), { depth: TILE_H - 4, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 4, curveSegments });
    // 形状在 (x, y) 平面，转到 3D 后 y -> z，挤出方向朝下；底座顶面在 y = -5，糖霜顶面正好在 y = 0（和物理地面一致）
    geo.rotateX(Math.PI / 2);
    geo.translate(-t.cx, -bevel - 5, -t.cy);
    const m = new THREE.Mesh(geo, bodyMat);
    m.position.set(t.cx, 0, t.cy);
    m.receiveShadow = true;
    const capGeo = new THREE.ExtrudeGeometry(tileShape(t, 9), { depth: 2, bevelEnabled: true, bevelThickness: 3, bevelSize: 3.5, bevelSegments: 4, curveSegments });
    capGeo.rotateX(Math.PI / 2);
    capGeo.translate(-t.cx, -3, -t.cy);
    const cap = new THREE.Mesh(capGeo, top);
    cap.receiveShadow = true;
    m.add(cap);
    // 地砖底下挂一点圆圆的岩石 / 冰锥
    if ((theme === THEMES.lava || isIce) && (i * 7 + t.l) % 3 !== 0) {
      const st = new THREE.Mesh(stalGeos[(i * 5) % 3], underMat);
      st.position.y = -TILE_H - (isIce ? 10 : 16);
      m.add(st);
    }
    // 太空站：地砖底部的推进器灯
    if (theme === THEMES.space && i % 4 === 0) {
      const th = new THREE.Mesh(new THREE.CylinderGeometry(8, 12, 10, 12), std('#1a1d30', { metalness: 0.8, emissive: '#19d3ff', emissiveIntensity: 0.9 }));
      th.position.y = -TILE_H - 8;
      m.add(th);
    }
    // 糖果：巧克力滴落
    if (theme === THEMES.candy && i % 3 === 0) {
      const drip = new THREE.Mesh(new THREE.CapsuleGeometry(5, 14 + (i % 4) * 6, 4, 8), underMat);
      drip.position.set(((i * 13) % 20) - 10, -TILE_H - 14, ((i * 7) % 20) - 10);
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
    const cone = new THREE.Mesh(moundGeo(150, 300).rotateX(Math.PI), rockMat);
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
      const rock = new THREE.Mesh(blobGeo(26, i + 70, 0.12), rockMat);
      rock.scale.set(1, 0.7, 1);
      rock.position.y = -26;
      g.add(rock);
      const bowl = new THREE.Mesh(new THREE.SphereGeometry(17, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), std('#6a3f33', { roughness: 0.5, side: THREE.DoubleSide }));
      bowl.position.y = 10;
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

// 圆滚滚的石头 / 冰山：球体加一点点起伏，法线平滑（不再是棱角分明的多面体）
function blobGeo(r, seed = 1, amt = 0.12, w = 20, h = 14) {
  const g = new THREE.SphereGeometry(r, w, h);
  const pos = g.attributes.position;
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k) / r;
    const y = pos.getY(k) / r;
    const z = pos.getZ(k) / r;
    const n = Math.sin(x * 2.3 + seed) * Math.cos(z * 2.1 + seed * 1.7) * 0.6 + Math.sin(y * 3.1 + seed * 2.3) * 0.4;
    const kk = 1 + n * amt;
    pos.setXYZ(k, pos.getX(k) * kk, pos.getY(k) * kk, pos.getZ(k) * kk);
  }
  g.computeVertexNormals();
  return g;
}
// 圆顶的火山 / 雪山：用旋转体画一条圆润的轮廓
function moundGeo(r, h, crater = 0) {
  const pts = [];
  for (let k = 0; k <= 16; k++) {
    const u = k / 16;
    const x = r * (1 - u) * (1 - u * 0.25) + crater * u;
    const y = h * Math.sin((u * Math.PI) / 2);
    pts.push(new THREE.Vector2(Math.max(x, crater), y));
  }
  if (crater) pts.push(new THREE.Vector2(crater * 0.6, h * 0.94));
  return new THREE.LatheGeometry(pts, 28);
}
// 五角星（太空图里一闪一闪的星星）
function starGeo(r, depth) {
  const sh = new THREE.Shape();
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + Math.PI / 2;
    const rr = k % 2 ? r * 0.48 : r;
    if (k === 0) sh.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else sh.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: depth * 0.4, bevelSize: r * 0.12, bevelSegments: 3 });
  g.center();
  return g;
}
// 会动的小装饰：冒烟、闪烁、摇摆
const decoFx = [];
const soft = (color, o = {}) => std(color, { roughness: 0.55, ...o });

function snowman(scale = 1) {
  const g = new THREE.Group();
  const snowM = soft('#ffffff', { roughness: 0.8 });
  const coal = soft('#2a2233', { roughness: 0.4 });
  g.add(mesh(new THREE.SphereGeometry(26, 20, 14), snowM, 0, 22, 0));
  g.add(mesh(new THREE.SphereGeometry(19, 20, 14), snowM, 0, 54, 0));
  g.add(mesh(new THREE.SphereGeometry(14, 20, 14), snowM, 0, 80, 0));
  for (const s of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(2.2, 8, 6), coal, s * 5, 84, 12.5));
  const nose = mesh(new THREE.ConeGeometry(2.6, 12, 10), soft('#ff8c2a'), 0, 80, 18);
  nose.rotation.x = Math.PI / 2;
  g.add(nose);
  const scarf = mesh(new THREE.TorusGeometry(15, 3.6, 8, 24), soft('#ff5a7a'), 0, 68, 0);
  scarf.rotation.x = Math.PI / 2;
  g.add(scarf);
  for (let k = 0; k < 3; k++) g.add(mesh(new THREE.SphereGeometry(2, 8, 6), coal, 0, 44 + k * 8, 18.5 - k * 0.3));
  for (const s of [-1, 1]) {
    const arm = mesh(new THREE.CylinderGeometry(1.4, 1.4, 26, 6), soft('#7a5236'), s * 26, 58, 0);
    arm.rotation.z = s * 1.0;
    g.add(arm);
  }
  // 小红帽
  g.add(mesh(new THREE.ConeGeometry(11, 20, 16), soft('#ff5a7a'), 0, 100, 0));
  g.add(mesh(new THREE.SphereGeometry(4, 10, 8), snowM, 0, 111, 0));
  g.scale.setScalar(scale);
  return g;
}
function pineTree(scale = 1, snowy = true) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(4, 5, 16, 10), soft('#8a5a36'), 0, 8, 0));
  const green = soft('#3fb07a');
  const white = soft('#ffffff', { roughness: 0.8 });
  for (let l = 0; l < 3; l++) {
    const r = 26 - l * 6;
    g.add(mesh(new THREE.ConeGeometry(r, 26, 16), green, 0, 26 + l * 15, 0));
    if (snowy) g.add(mesh(new THREE.ConeGeometry(r * 0.62, 12, 16), white, 0, 34 + l * 15, 0));
  }
  g.scale.setScalar(scale);
  return g;
}
function miniPenguin(scale = 1) {
  const g = new THREE.Group();
  const body = mesh(new THREE.SphereGeometry(14, 20, 14), soft('#2d3150'), 0, 14, 0);
  body.scale.set(1, 1.15, 0.95);
  const belly = mesh(new THREE.SphereGeometry(10, 18, 12), soft('#ffffff'), 0, 12, 5.5);
  belly.scale.set(1, 1.2, 0.8);
  g.add(body, belly);
  for (const s of [-1, 1]) {
    g.add(mesh(new THREE.SphereGeometry(2.4, 10, 8), soft('#15131f', { roughness: 0.2 }), s * 4.5, 20, 12));
    g.add(mesh(new THREE.SphereGeometry(0.9, 6, 4), new THREE.MeshBasicMaterial({ color: '#ffffff' }), s * 4.5 + 0.8, 21, 14));
    const flip = mesh(new THREE.SphereGeometry(5, 10, 8), soft('#2d3150'), s * 13, 12, 0);
    flip.scale.set(0.35, 1, 0.6);
    flip.rotation.z = s * 0.4;
    g.add(flip);
    const foot = mesh(new THREE.SphereGeometry(4, 10, 6), soft('#ffa53a'), s * 5, 1.5, 4);
    foot.scale.set(1, 0.4, 1.3);
    g.add(foot);
  }
  const beak = mesh(new THREE.ConeGeometry(2.4, 6, 10), soft('#ffa53a'), 0, 17, 14);
  beak.rotation.x = Math.PI / 2;
  g.add(beak);
  g.scale.setScalar(scale);
  return g;
}
function cupcake(scale = 1, frost = '#ffb3d1') {
  const g = new THREE.Group();
  const wrap = mesh(new THREE.CylinderGeometry(34, 26, 34, 18), soft('#6fc7ff', { flatShading: true }), 0, 17, 0);
  g.add(wrap);
  const fm = soft(frost, { roughness: 0.35 });
  g.add(mesh(new THREE.SphereGeometry(36, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), fm, 0, 34, 0));
  g.add(mesh(new THREE.SphereGeometry(24, 18, 12), fm, 0, 52, 0));
  g.add(mesh(new THREE.SphereGeometry(14, 16, 10), fm, 0, 70, 0));
  g.add(mesh(new THREE.SphereGeometry(8, 14, 10), soft('#ff3b5c', { roughness: 0.2 }), 0, 86, 0));
  const cols = ['#ffd23f', '#3fa7ff', '#3ddc84', '#ffffff', '#b06cff'];
  for (let k = 0; k < 14; k++) {
    const a = k * 2.4;
    const r = 18 + (k % 3) * 7;
    const sp = mesh(new THREE.CapsuleGeometry(1.2, 4, 2, 4), soft(cols[k % cols.length]), Math.cos(a) * r, 40 + (k % 4) * 6 + (30 - r) * 0.6, Math.sin(a) * r);
    sp.rotation.set(k, k * 2, 0);
    g.add(sp);
  }
  g.scale.setScalar(scale);
  return g;
}
function gumdrop(color, scale = 1) {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.2, transparent: true, opacity: 0.92, emissive: color, emissiveIntensity: 0.15 });
  const d = mesh(new THREE.SphereGeometry(20, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), m);
  d.scale.y = 1.3;
  g.add(d);
  g.add(mesh(new THREE.CylinderGeometry(20, 20, 6, 20), m, 0, -3, 0));
  g.scale.setScalar(scale);
  return g;
}
function iceCream(scale = 1, scoops = ['#ffb3d1', '#fff2b0', '#b8f0d8']) {
  const g = new THREE.Group();
  const cone = mesh(new THREE.ConeGeometry(34, 120, 18), soft('#e8a95e', { flatShading: true }), 0, 60, 0);
  cone.rotation.x = Math.PI;
  g.add(cone);
  scoops.forEach((c, k) => g.add(mesh(new THREE.SphereGeometry(38 - k * 4, 20, 14), soft(c, { roughness: 0.4 }), 0, 128 + k * 50, 0)));
  g.add(mesh(new THREE.SphereGeometry(9, 12, 10), soft('#ff3b5c', { roughness: 0.2 }), 0, 128 + scoops.length * 50 - 12, 0));
  g.scale.setScalar(scale);
  return g;
}
// 月亮上的困困脸
function sleepyFaceTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#f4f1ff';
  g.fillRect(0, 0, 512, 256);
  g.fillStyle = 'rgba(190,185,230,0.8)';
  for (const [x, y, r] of [[80, 60, 22], [420, 180, 30], [330, 50, 14], [150, 200, 18], [470, 80, 12]]) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = '#4a3a6a';
  g.lineWidth = 7;
  g.lineCap = 'round';
  for (const x of [226, 286]) {
    g.beginPath();
    g.arc(x, 118, 14, 0.15 * Math.PI, 0.85 * Math.PI);
    g.stroke();
  }
  g.beginPath();
  g.arc(256, 138, 12, 0.2 * Math.PI, 0.8 * Math.PI);
  g.stroke();
  g.fillStyle = 'rgba(255,140,180,0.55)';
  for (const x of [206, 306]) {
    g.beginPath();
    g.ellipse(x, 140, 14, 8, 0, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildDecor(id) {
  disposeGroup(decor);
  floaters.length = 0;
  decoFx.length = 0;
  if (id === 'lava') {
    // 圆滚滚的岩石堆
    const rockCols = [soft('#8a5540'), soft('#a0654a'), soft('#74463a')];
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2 + Math.sin(i * 7) * 0.2;
      const r = 900 + ((i * 373) % 1100);
      const s = 60 + ((i * 131) % 90);
      const pile = new THREE.Group();
      const n = 1 + (i % 3);
      for (let k = 0; k < n; k++) {
        const b = mesh(blobGeo(s * (1 - k * 0.28), i + k * 5, 0.1), rockCols[(i + k) % 3], (k % 2 ? 0.3 : -0.2) * s * k, s * (0.4 + k * 0.9), 0);
        b.scale.y = 0.85;
        pile.add(b);
      }
      pile.position.set(Math.cos(a) * r, LIQUID_Y - s * 0.2, Math.sin(a) * r);
      pile.rotation.y = i;
      decor.add(pile);
    }
    // 远处圆圆的小火山，山顶冒着一团团烟
    const volMat = soft('#9a5a44');
    const lavaTop = new THREE.MeshStandardMaterial({ color: '#ff9a3a', emissive: '#ff6a1a', emissiveIntensity: 1.2 });
    const smokeMat = soft('#f1e6ee', { roughness: 1, transparent: true, opacity: 0.9 });
    for (let i = 0; i < 5; i++) {
      const a = i * 1.26 + 0.5;
      const R = 2600 + (i % 2) * 700;
      const h = 520 + (i % 3) * 160;
      const v = new THREE.Group();
      v.add(mesh(moundGeo(560, h, 90), volMat));
      const pool = mesh(new THREE.CircleGeometry(95, 24), lavaTop, 0, h * 0.95, 0);
      pool.rotation.x = -Math.PI / 2;
      v.add(pool);
      // 岩浆顺着山坡流下来的几道
      for (let k = 0; k < 4; k++) {
        const drip = mesh(new THREE.CapsuleGeometry(20, 180 + k * 40, 4, 10), lavaTop);
        const ang = k * 1.6 + i;
        drip.position.set(Math.cos(ang) * 150, h * 0.72, Math.sin(ang) * 150);
        drip.rotation.set(Math.sin(ang) * 0.55, 0, -Math.cos(ang) * 0.55);
        v.add(drip);
      }
      v.position.set(Math.cos(a) * R, LIQUID_Y - 20, Math.sin(a) * R);
      decor.add(v);
      for (let k = 0; k < 4; k++) {
        const puff = mesh(new THREE.SphereGeometry(70, 14, 10), smokeMat);
        puff.castShadow = false;
        decor.add(puff);
        decoFx.push({ kind: 'smoke', m: puff, base: new THREE.Vector3(v.position.x, v.position.y + h, v.position.z), ph: k / 4 });
      }
    }
    // 在岩浆上漂着的小石头
    for (let i = 0; i < 12; i++) {
      const m = mesh(blobGeo(12 + (i % 4) * 7, i + 50, 0.14, 14, 10), rockCols[i % 3]);
      floaters.push({ m, a: (i / 12) * Math.PI * 2, r: 600 + (i % 3) * 70, y: -30 + (i % 4) * 25, sp: 0.03 + (i % 3) * 0.015 });
      decor.add(m);
    }
  } else if (id === 'ice') {
    const snow = soft('#ffffff', { roughness: 0.85 });
    const iceBlue = soft('#bfe8ff', { roughness: 0.12 });
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + Math.sin(i * 3) * 0.3;
      const r = 850 + ((i * 419) % 1300);
      const s = 70 + ((i * 97) % 120);
      const berg = new THREE.Group();
      const body = mesh(blobGeo(s, i, 0.1), iceBlue);
      body.scale.y = 0.6;
      const cap = mesh(blobGeo(s * 0.92, i + 3, 0.08), snow, 0, s * 0.22, 0);
      cap.scale.y = 0.42;
      berg.add(body, cap);
      berg.position.set(Math.cos(a) * r, LIQUID_Y + s * 0.15, Math.sin(a) * r);
      decor.add(berg);
      const topY = berg.position.y + s * 0.55;
      if (i % 3 === 0) {
        for (let k = 0; k < 3; k++) {
          const tree = pineTree(1.1 + (k % 2) * 0.3);
          tree.position.set(berg.position.x + (k - 1) * s * 0.4, topY - 6, berg.position.z + ((k * 17) % 20) - 10);
          decor.add(tree);
        }
      } else if (i % 3 === 1) {
        const sm = snowman(0.9 + (i % 2) * 0.3);
        sm.position.set(berg.position.x, topY - 8, berg.position.z);
        sm.lookAt(0, sm.position.y, 0);
        decor.add(sm);
        decoFx.push({ kind: 'sway', m: sm, ph: i });
      } else {
        for (let k = 0; k < 2; k++) {
          const pg = miniPenguin(1.6);
          pg.position.set(berg.position.x + (k ? 18 : -18), topY - 6, berg.position.z);
          pg.lookAt(0, pg.position.y, 0);
          decor.add(pg);
          decoFx.push({ kind: 'hop', m: pg, y: pg.position.y, ph: i + k * 1.3 });
        }
      }
    }
    // 远处圆顶雪山
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.3;
      const h = 900 + (i % 3) * 350;
      const mtn = new THREE.Group();
      mtn.add(mesh(moundGeo(820, h), i % 2 ? soft('#a9dcf7') : soft('#c4e8fb')));
      const top = mesh(moundGeo(820 * 0.42, h * 0.36), snow, 0, h * 0.64, 0);
      mtn.add(top);
      mtn.position.set(Math.cos(a) * 4200, LIQUID_Y - 50, Math.sin(a) * 4200);
      decor.add(mtn);
    }
    // 漂着的圆浮冰
    for (let i = 0; i < 10; i++) {
      const floe = new THREE.Group();
      floe.add(mesh(new THREE.CylinderGeometry(22 + (i % 3) * 8, 20 + (i % 3) * 8, 8, 20), iceBlue));
      floe.add(mesh(new THREE.CylinderGeometry(18 + (i % 3) * 8, 21 + (i % 3) * 8, 4, 20), snow, 0, 5, 0));
      if (i % 4 === 0) {
        const pg = miniPenguin(0.9);
        pg.position.y = 7;
        floe.add(pg);
      }
      floaters.push({ m: floe, a: (i / 10) * Math.PI * 2, r: 620 + (i % 3) * 80, y: LIQUID_Y + 6, sp: 0.02 + (i % 3) * 0.01, bob: true, upright: true });
      decor.add(floe);
    }
  } else if (id === 'space') {
    // 脚下的巨大星球 + 光环
    const pc = document.createElement('canvas');
    pc.width = 512;
    pc.height = 256;
    const g = pc.getContext('2d');
    const bands = ['#7a5cff', '#9d7bff', '#ffb3d9', '#ffd1a8', '#9d7bff', '#6a58e0', '#c2a8ff', '#ffc2e0'];
    for (let y = 0; y < 256; y += 4) {
      g.fillStyle = bands[Math.floor((y / 256) * bands.length * 2 + Math.sin(y * 0.1) * 1.2 + 16) % bands.length];
      g.fillRect(0, y, 512, 4);
    }
    const ptex = new THREE.CanvasTexture(pc);
    ptex.colorSpace = THREE.SRGBColorSpace;
    const planet = new THREE.Mesh(new THREE.SphereGeometry(2200, 64, 32), std('#ffffff', { map: ptex, roughness: 0.9, emissive: '#2a1660', emissiveIntensity: 0.5 }));
    planet.position.set(600, -3600, -2600);
    planet.rotation.z = 0.35;
    decor.add(planet);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2700, 3600, 96),
      new THREE.MeshBasicMaterial({ map: stripeTexture(['#d9ccff', '#a18cf0', '#ffe0f0', '#8a74e0'], 6), transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.position.copy(planet.position);
    ring.rotation.set(-Math.PI / 2 + 0.25, 0, 0.35);
    decor.add(ring);
    // 困困的月亮
    const moon = new THREE.Mesh(new THREE.SphereGeometry(300, 40, 24), std('#ffffff', { map: sleepyFaceTexture(), roughness: 0.9, emissive: '#6a5aa0', emissiveIntensity: 0.25 }));
    moon.position.set(-3000, 1000, -4200);
    moon.lookAt(0, 200, 0);
    moon.rotateY(-Math.PI / 2);
    decor.add(moon);
    // 远处几颗糖果色的小星球
    const minis = [
      ['#ff9ec7', '#ffe0f0'],
      ['#7fe0c8', '#d8fff2'],
      ['#ffd27a', '#fff2cc'],
      ['#9fb4ff', '#e0e8ff'],
      ['#c8a0ff', '#f0e0ff'],
    ];
    minis.forEach(([c, rc], k) => {
      const grp = new THREE.Group();
      const r = 90 + (k % 3) * 50;
      grp.add(mesh(new THREE.SphereGeometry(r, 32, 20), soft(c, { emissive: c, emissiveIntensity: 0.25 })));
      if (k % 2 === 0) {
        const rg = mesh(new THREE.TorusGeometry(r * 1.55, r * 0.12, 8, 48), soft(rc, { emissive: rc, emissiveIntensity: 0.3 }));
        rg.rotation.x = Math.PI / 2 - 0.4;
        grp.add(rg);
      }
      const a = (k / minis.length) * Math.PI * 2 + 0.6;
      grp.position.set(Math.cos(a) * 2600, 300 + (k % 3) * 400, Math.sin(a) * 2600);
      decor.add(grp);
      decoFx.push({ kind: 'spin', m: grp, sp: 0.1 + k * 0.03 });
    });
    // 一闪一闪的小星星
    const starMat = new THREE.MeshStandardMaterial({ color: '#ffe27a', emissive: '#ffcc33', emissiveIntensity: 1.0, roughness: 0.3 });
    const sg = starGeo(16, 5);
    for (let i = 0; i < 16; i++) {
      const st = new THREE.Mesh(sg, starMat);
      const a = (i / 16) * Math.PI * 2;
      const r = 700 + (i % 4) * 160;
      st.position.set(Math.cos(a) * r, -40 + ((i * 53) % 260), Math.sin(a) * r);
      decor.add(st);
      decoFx.push({ kind: 'twinkle', m: st, ph: i * 0.9, s: 0.8 + (i % 3) * 0.4 });
    }
    // 圆圆的小陨石
    const astMats = [soft('#8e86b8'), soft('#a79fd0'), soft('#7a72a6')];
    for (let i = 0; i < 20; i++) {
      const m = mesh(blobGeo(10 + (i % 5) * 8, i + 11, 0.16, 14, 10), astMats[i % 3]);
      floaters.push({ m, a: (i / 20) * Math.PI * 2, r: 640 + (i % 4) * 110, y: -120 + ((i * 53) % 220), sp: 0.02 + (i % 3) * 0.012 });
      decor.add(m);
    }
    // 空间站外围的信号塔
    const towerMat = std('#5a62a0', { metalness: 0.5, roughness: 0.35 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const tower = new THREE.Group();
      tower.add(mesh(new THREE.CylinderGeometry(6, 10, 220, 12), towerMat));
      tower.add(mesh(new THREE.SphereGeometry(13, 16, 12), new THREE.MeshBasicMaterial({ color: i % 2 ? '#ff7ab0' : '#19d3ff' }), 0, 116, 0));
      tower.position.set(Math.cos(a) * 640, -60, Math.sin(a) * 640);
      decor.add(tower);
    }
  } else if (id === 'candy') {
    // 棒棒糖树、拐杖糖、纸杯蛋糕、软糖、冰淇淋、甜甜圈、棉花糖云
    const cols = [
      ['#ff5aa5', '#ffffff'],
      ['#3fa7ff', '#ffffff'],
      ['#ffd23f', '#ff8c42'],
      ['#3ddc84', '#ffffff'],
    ];
    const stickMat = std('#ffffff', { roughness: 0.4 });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.2;
      const r = 900 + ((i * 347) % 1100);
      const h = 260 + ((i * 89) % 260);
      const lolly = new THREE.Group();
      lolly.add(mesh(new THREE.CylinderGeometry(6, 6, h, 10), stickMat, 0, h / 2, 0));
      const disc = mesh(new THREE.CylinderGeometry(70, 70, 22, 36), std('#ffffff', { map: swirlTexture(cols[i % cols.length]), roughness: 0.2 }), 0, h + 60, 0);
      disc.rotation.x = Math.PI / 2;
      lolly.add(disc);
      const bow = mesh(new THREE.TorusGeometry(10, 4, 8, 16), soft(cols[(i + 1) % cols.length][0]), 0, h - 6, 0);
      bow.rotation.x = Math.PI / 2;
      lolly.add(bow);
      lolly.position.set(Math.cos(a) * r, LIQUID_Y, Math.sin(a) * r);
      lolly.rotation.y = -a + Math.PI / 2;
      lolly.rotation.z = Math.sin(i) * 0.15;
      decor.add(lolly);
    }
    const caneTex = stripeTexture(['#ff3b5c', '#ffffff'], 10);
    caneTex.repeat.set(8, 1);
    const caneMat = std('#ffffff', { map: caneTex, roughness: 0.35 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.6;
      const cane = new THREE.Group();
      cane.add(mesh(new THREE.CylinderGeometry(12, 12, 380, 14), caneMat, 0, 190, 0));
      cane.add(mesh(new THREE.TorusGeometry(50, 12, 12, 24, Math.PI), caneMat, -50, 380, 0));
      cane.position.set(Math.cos(a) * 1500, LIQUID_Y, Math.sin(a) * 1500);
      cane.rotation.y = a;
      decor.add(cane);
    }
    const frosts = ['#ffb3d1', '#fff0b3', '#b8f0d8', '#d9c4ff', '#ffffff'];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.35;
      const cc = cupcake(1.6 + (i % 3) * 0.5, frosts[i % frosts.length]);
      cc.position.set(Math.cos(a) * (1000 + (i % 3) * 260), LIQUID_Y - 10, Math.sin(a) * (1000 + (i % 3) * 260));
      decor.add(cc);
    }
    const gumCols = ['#ff5aa5', '#ffd23f', '#3ddc84', '#3fa7ff', '#b06cff', '#ff8c42'];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + 0.1;
      const gd = gumdrop(gumCols[i % gumCols.length], 1.4 + (i % 3) * 0.6);
      gd.position.set(Math.cos(a) * (760 + (i % 4) * 120), LIQUID_Y + 2, Math.sin(a) * (760 + (i % 4) * 120));
      decor.add(gd);
      decoFx.push({ kind: 'jiggle', m: gd, ph: i, s: gd.scale.x });
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 1.0;
      const ic = iceCream(2.2, i % 2 ? ['#b8f0d8', '#ffb3d1', '#fff2b0'] : ['#8b5a3c', '#ffb3d1', '#ffffff']);
      ic.position.set(Math.cos(a) * 2300, LIQUID_Y - 40, Math.sin(a) * 2300);
      decor.add(ic);
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
      for (let k = 0; k < 5; k++) cloud.add(mesh(new THREE.SphereGeometry(80 + (k % 3) * 30, 16, 10), cloudMats[i % 2], k * 70 - 140, Math.sin(k) * 30, 0));
      const a = (i / 8) * Math.PI * 2;
      cloud.position.set(Math.cos(a) * 3000, 700 + (i % 3) * 200, Math.sin(a) * 3000);
      cloud.lookAt(0, cloud.position.y, 0);
      decor.add(cloud);
    }
  }
  decor.traverse((o) => {
    if (o.isMesh) o.castShadow = false;
  });
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
    else if (f.upright) f.m.rotation.y += dt * 0.25;
    else {
      f.m.rotation.x += dt * 0.2;
      f.m.rotation.y += dt * 0.3;
    }
  }
  for (const d of decoFx) {
    if (d.kind === 'smoke') {
      // 火山口的烟：一团团往上飘、变大、变淡，然后从头再来
      const k = (t * 0.12 + d.ph) % 1;
      d.m.position.set(d.base.x + Math.sin(k * 6 + d.ph * 9) * 60, d.base.y + k * 700, d.base.z + k * 120);
      d.m.scale.setScalar(0.5 + k * 1.6);
      d.m.material.opacity = 0.85 * (1 - k);
    } else if (d.kind === 'twinkle') {
      d.m.rotation.y += dt * 1.2;
      d.m.scale.setScalar(d.s * (0.8 + 0.25 * Math.sin(t * 3 + d.ph)));
    } else if (d.kind === 'sway') d.m.rotation.z = Math.sin(t * 1.3 + d.ph) * 0.06;
    else if (d.kind === 'hop') d.m.position.y = d.y + Math.max(0, Math.sin(t * 3 + d.ph)) * 10;
    else if (d.kind === 'spin') d.m.rotation.y += dt * d.sp;
    else if (d.kind === 'jiggle') {
      const k = Math.sin(t * 2.4 + d.ph) * 0.05;
      d.m.scale.set(d.s * (1 + k), d.s * (1 - k), d.s * (1 + k));
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
