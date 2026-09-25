// 角色建模：8 种角色 × 10 种皮肤 × 12 种颜色 × 10 顶帽子，外加受击反应动画
// 模型按半径 1 建，朝 +z 方向；外部负责位置、缩放和朝向。
import * as THREE from 'three';
import { std, mesh, markShared, disposeGroup } from './core.js';
import { faceGeo, faceDir, faceTexture, bellyGeo, bellyTexture } from './face.js';

const sphereGeo = markShared(new THREE.SphereGeometry(1, 40, 28));
// 身体用的球：顶点色做一点"下面暗、上面亮"的柔和阴影，看起来更有体积感
const bodyGeo = markShared(
  (() => {
    const g = new THREE.SphereGeometry(1, 48, 32);
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const k = 0.62 + 0.38 * THREE.MathUtils.smoothstep(y, -1, 0.35);
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  })()
);
// 塑胶玩具质感：清漆高光 + 边缘柔光
const vinyl = (color, o = {}) =>
  new THREE.MeshPhysicalMaterial({ color, roughness: 0.42, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.22, sheen: 0.6, sheenRoughness: 0.45, sheenColor: new THREE.Color('#ffffff'), vertexColors: true, ...o });

// ---------------------------------------------------------------------
// 皮肤贴图（canvas 生成，按 皮肤+颜色 缓存）
// ---------------------------------------------------------------------
const texCache = new Map();
function canvasTex(key, draw, w = 256, h = 128) {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = markShared(new THREE.CanvasTexture(c));
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  texCache.set(key, t);
  return t;
}
function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}
const shade = (hex, l) => '#' + new THREE.Color(hex).offsetHSL(0, 0, l).getHexString();

function skinMaterial(skin, color) {
  switch (skin) {
    case 'stripes':
      return vinyl('#ffffff', {
        roughness: 0.35,
        map: canvasTex(`stripes${color}`, (g, w, h) => {
          g.fillStyle = color;
          g.fillRect(0, 0, w, h);
          g.fillStyle = shade(color, 0.28);
          for (let i = 1; i < 9; i += 2) g.fillRect(0, (i * h) / 9, w, h / 9);
        }),
      });
    case 'dots':
      return vinyl('#ffffff', {
        roughness: 0.35,
        map: canvasTex(`dots${color}`, (g, w, h) => {
          g.fillStyle = color;
          g.fillRect(0, 0, w, h);
          g.fillStyle = '#ffffff';
          for (let r = 0; r < 6; r++) {
            for (let c = 0; c < 12; c++) {
              g.beginPath();
              g.arc(c * (w / 12) + (r % 2) * (w / 24), r * (h / 6) + h / 12, 6, 0, Math.PI * 2);
              g.fill();
            }
          }
        }),
      });
    case 'camo':
      return vinyl('#ffffff', {
        roughness: 0.6,
        map: canvasTex(`camo${color}`, (g, w, h) => {
          const rnd = seeded(7);
          g.fillStyle = color;
          g.fillRect(0, 0, w, h);
          const cols = [shade(color, -0.18), shade(color, 0.14), shade(color, -0.32)];
          for (let i = 0; i < 70; i++) {
            g.fillStyle = cols[i % 3];
            g.beginPath();
            g.ellipse(rnd() * w, rnd() * h, 8 + rnd() * 20, 5 + rnd() * 12, rnd() * 3, 0, Math.PI * 2);
            g.fill();
          }
        }),
      });
    case 'rainbow':
      return vinyl('#ffffff', {
        roughness: 0.3,
        map: canvasTex('rainbow', (g, w, h) => {
          for (let y = 0; y < h; y++) {
            g.fillStyle = `hsl(${(y / h) * 330}, 90%, 62%)`;
            g.fillRect(0, y, w, 1);
          }
        }),
      });
    case 'candy':
      return vinyl('#ffffff', {
        roughness: 0.25,
        map: canvasTex(`candy${color}`, (g, w, h) => {
          g.fillStyle = '#ffffff';
          g.fillRect(0, 0, w, h);
          g.fillStyle = color;
          for (let i = -8; i < 16; i++) {
            g.beginPath();
            g.moveTo(i * 24, 0);
            g.lineTo(i * 24 + 12, 0);
            g.lineTo(i * 24 + 12 + h, h);
            g.lineTo(i * 24 + h, h);
            g.fill();
          }
        }),
      });
    case 'gold':
      return vinyl('#ffcf4a', { metalness: 1, roughness: 0.2, clearcoat: 1, sheen: 0, emissive: '#5a3a00', emissiveIntensity: 0.25 });
    case 'galaxy': {
      const tex = canvasTex('galaxy', (g, w, h) => {
        const rnd = seeded(3);
        g.fillStyle = '#0b0a2a';
        g.fillRect(0, 0, w, h);
        for (const [x, y, r, c] of [
          [60, 50, 60, 'rgba(176,108,255,0.55)'],
          [170, 80, 70, 'rgba(255,111,181,0.45)'],
          [230, 30, 50, 'rgba(46,230,214,0.35)'],
          [110, 100, 45, 'rgba(91,108,255,0.5)'],
        ]) {
          const gr = g.createRadialGradient(x, y, 0, x, y, r);
          gr.addColorStop(0, c);
          gr.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = gr;
          g.fillRect(0, 0, w, h);
        }
        g.fillStyle = '#ffffff';
        for (let i = 0; i < 160; i++) g.fillRect(rnd() * w, rnd() * h, rnd() < 0.1 ? 2 : 1, rnd() < 0.1 ? 2 : 1);
      });
      return vinyl('#ffffff', { roughness: 0.4, map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0.55 });
    }
    case 'lava': {
      const tex = canvasTex('lavaskin', (g, w, h) => {
        const rnd = seeded(11);
        g.fillStyle = '#2a1714';
        g.fillRect(0, 0, w, h);
        g.strokeStyle = '#ff7a1a';
        g.lineWidth = 3;
        g.shadowColor = '#ffb347';
        g.shadowBlur = 6;
        for (let i = 0; i < 22; i++) {
          g.beginPath();
          let x = rnd() * w;
          let y = rnd() * h;
          g.moveTo(x, y);
          for (let k = 0; k < 4; k++) {
            x += (rnd() - 0.5) * 50;
            y += (rnd() - 0.5) * 30;
            g.lineTo(x, y);
          }
          g.stroke();
        }
      });
      return vinyl('#ffffff', { roughness: 0.9, map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0.9, flatShading: false });
    }
    case 'ice':
      return vinyl('#cdf3ff', { roughness: 0.05, metalness: 0.1, transmission: 0, transparent: true, opacity: 0.84, emissive: '#6fd6ff', emissiveIntensity: 0.2, clearcoat: 1 });
    default:
      return vinyl(color);
  }
}

// 各皮肤的配件主色（保险杠、尾巴等）
function accentColor(skin, color) {
  return { rainbow: '#b06cff', gold: '#c8961e', galaxy: '#5b6cff', lava: '#ff7a1a', ice: '#7fdcff' }[skin] || color;
}

// ---------------------------------------------------------------------
// 帽子
// ---------------------------------------------------------------------
function makeHat(id, color) {
  const g = new THREE.Group();
  const gold = std('#ffcf4a', { metalness: 0.9, roughness: 0.25 });
  const black = std('#1b1822', { roughness: 0.5 });
  const tint = std(new THREE.Color(color).offsetHSL(0, 0, -0.18), { roughness: 0.5 });
  switch (id) {
    case 'crown': {
      g.add(mesh(new THREE.CylinderGeometry(0.42, 0.4, 0.22, 16, 1, true), gold, 0, 0.98, 0));
      const gem = std('#3fa7ff', { roughness: 0.1 });
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        g.add(mesh(new THREE.ConeGeometry(0.09, 0.22, 6), gold, Math.cos(a) * 0.4, 1.19, Math.sin(a) * 0.4));
        g.add(mesh(new THREE.SphereGeometry(0.05, 8, 6), gem, Math.cos(a + 0.6) * 0.42, 0.98, Math.sin(a + 0.6) * 0.42));
      }
      break;
    }
    case 'tophat':
      g.add(mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.05, 20), black, 0, 0.9, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.55, 20), black, 0, 1.18, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.39, 0.39, 0.1, 20), std('#ff5a5f'), 0, 0.98, 0));
      g.rotation.z = 0.15;
      break;
    case 'party':
      g.add(mesh(new THREE.ConeGeometry(0.34, 0.8, 16), std('#b06cff', { roughness: 0.5 }), 0, 1.25, 0));
      g.add(mesh(new THREE.TorusGeometry(0.3, 0.05, 6, 16).rotateX(Math.PI / 2), std('#ffd23f'), 0, 0.97, 0));
      g.add(mesh(new THREE.SphereGeometry(0.1, 10, 8), std('#ffffff'), 0, 1.68, 0));
      g.rotation.z = -0.2;
      break;
    case 'propeller': {
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
    case 'horns': {
      const red = std('#e6394a', { roughness: 0.4 });
      for (const s of [-1, 1]) {
        const h = mesh(new THREE.ConeGeometry(0.13, 0.5, 10), red, s * 0.45, 0.95, 0);
        h.rotation.z = -s * 0.5;
        g.add(h);
      }
      break;
    }
    case 'halo': {
      const halo = mesh(new THREE.TorusGeometry(0.42, 0.06, 8, 32).rotateX(Math.PI / 2), std('#fff2a8', { emissive: '#ffd23f', emissiveIntensity: 1.1 }), 0, 1.5, 0);
      halo.userData.bob = true;
      g.add(halo);
      break;
    }
    case 'sprout': {
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
    case 'headphones': {
      const band = mesh(new THREE.TorusGeometry(1.08, 0.07, 8, 32, Math.PI), black, 0, 0.12, 0);
      g.add(band);
      for (const s of [-1, 1]) {
        const cup = mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.2, 20), tint, s * 1.08, 0.12, 0);
        cup.rotation.z = Math.PI / 2;
        g.add(cup);
      }
      break;
    }
    case 'cowboy': {
      const brown = std('#9a6232', { roughness: 0.8 });
      const brim = mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.05, 24), brown, 0, 0.88, 0);
      brim.scale.z = 0.8;
      g.add(brim);
      g.add(mesh(new THREE.CylinderGeometry(0.36, 0.44, 0.42, 16), brown, 0, 1.1, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.08, 16), std('#3a2412'), 0, 0.95, 0));
      g.rotation.z = -0.12;
      break;
    }
  }
  return g;
}

// ---------------------------------------------------------------------
// 角色
// ---------------------------------------------------------------------

const TAUNT_DUR = 1.4;

export class Character {
  constructor(profile, opts = {}) {
    this.root = new THREE.Group();
    this.squash = 0;
    this.squashV = 0;
    this.tilt = new THREE.Vector2();
    this.tiltV = new THREE.Vector2();
    this.flash = 0;
    this.dizzy = 0;
    this.blink = 2 + Math.random() * 3;
    this.opacity = 1;
    this.hopT = Math.random() * 10;
    this.tauntKind = '';
    this.tauntT = TAUNT_DUR;
    this.build(profile, opts);
  }

  build(profile, opts = {}) {
    if (this.body) {
      this.root.remove(this.body, this.fxGroup);
      disposeGroup(this.body);
      disposeGroup(this.fxGroup);
    }
    this.key = `${profile.char}|${profile.skin}|${profile.color}|${profile.hat}|${opts.team ?? -1}`;
    const { char, skin, color, hat } = profile;
    const accent = accentColor(skin, color);
    const body = new THREE.Group();
    this.body = body;
    this.bodyMat = skinMaterial(skin, color);
    if (char === 'robot') {
      this.bodyMat.metalness = Math.max(this.bodyMat.metalness, 0.55);
      this.bodyMat.roughness = Math.min(this.bodyMat.roughness, 0.3);
    }
    // 身体稍微扁一点、下面宽一点，像麻薯
    const shell = new THREE.Group();
    shell.scale.set(1.0, 0.94, 0.98); // 身体宽度 = 物理半径，碰撞时不会互相穿进去
    body.add(shell);
    shell.add(mesh(bodyGeo, this.bodyMat));
    // 浅色肚皮（纯色类皮肤才有）：贴在球面上的柔和椭圆
    if (['solid', 'stripes', 'dots', 'camo', 'candy'].includes(skin) && char !== 'robot') {
      const bellyCol = char === 'penguin' ? '#ffffff' : new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.6);
      const belly = new THREE.Mesh(bellyGeo, new THREE.MeshStandardMaterial({ color: bellyCol, map: bellyTexture(), transparent: true, roughness: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
      belly.material.userData.decal = true;
      belly.renderOrder = 2;
      shell.add(belly);
    }
    // 团队模式：一条发光的队伍颜色腰带
    const teamCol = opts.teamColor;
    if (teamCol) {
      const belt = mesh(new THREE.TorusGeometry(1.0, 0.07, 10, 48), std(teamCol, { roughness: 0.4, emissive: teamCol, emissiveIntensity: 0.6 }));
      belt.rotation.x = Math.PI / 2;
      belt.position.y = -0.34;
      belt.scale.set(1.04, 1.0, 1);
      body.add(belt);
    }
    // 脸：一张画好的贴图，按表情换
    const dark = std('#15131f', { roughness: 0.15 });
    const white = std('#ffffff', { roughness: 0.25 });
    const orange = std('#ffa53a', { roughness: 0.35 });
    const pink = std('#ff9fb3', { roughness: 0.5 });
    this.char = char;
    this.faceState = 'normal';
    this.faceMat = new THREE.MeshStandardMaterial({
      map: faceTexture(char, 'normal'),
      transparent: true,
      roughness: 0.35,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      emissive: char === 'robot' ? '#ffffff' : '#000000',
      emissiveMap: char === 'robot' ? faceTexture(char, 'normal') : null,
      emissiveIntensity: char === 'robot' ? 0.9 : 0,
    });
    this.faceMat.userData.decal = true;
    const faceMesh = new THREE.Mesh(faceGeo, this.faceMat);
    faceMesh.renderOrder = 3;
    shell.add(faceMesh);
    const onFace = (o, az, el, r = 1.0) => {
      const n = faceDir(az, el);
      o.position.copy(n).multiplyScalar(r);
      o.lookAt(n.multiplyScalar(3));
      return o;
    };
    if (char === 'robot') {
      const metal = std('#aab2cc', { metalness: 0.85, roughness: 0.28 });
      // 天线 + 发光小球
      const stalk = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.36, 8), metal, 0, 1.12, 0);
      stalk.userData.top = 'tuft';
      shell.add(stalk);
      const bulb = mesh(new THREE.SphereGeometry(0.11, 16, 12), new THREE.MeshStandardMaterial({ color: '#ff5a7a', emissive: '#ff3a6a', emissiveIntensity: 1.2 }), 0, 1.34, 0);
      bulb.userData.top = 'tuft';
      shell.add(bulb);
      // 圆圆的耳朵
      for (const s of [-1, 1]) {
        const ear = mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.14, 24), metal, s * 1.0, 0.22, 0);
        ear.rotation.z = Math.PI / 2;
        shell.add(ear);
        const cap = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 16), new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.5 }), s * 1.08, 0.22, 0);
        cap.rotation.z = Math.PI / 2;
        shell.add(cap);
      }
      // 胸口指示灯
      const chest = onFace(new THREE.Group(), 0, -42, 1.0);
      chest.add(mesh(new THREE.CircleGeometry(0.1, 24), new THREE.MeshBasicMaterial({ color: '#4ff0ff' })));
      chest.add(mesh(new THREE.RingGeometry(0.1, 0.14, 24), metal));
      shell.add(chest);
    }
    // 各角色的特征部件（加在 shell 上，跟身体一起变形）
    const accentMat = vinyl(accent, { vertexColors: false });
    const darkAccent = vinyl(new THREE.Color(accent).offsetHSL(0, 0, -0.14), { vertexColors: false });
    const pinkSoft = vinyl('#ffb3c6', { vertexColors: false, clearcoat: 0.3 });
    const wings = [];
    switch (char) {
      case 'cat': {
        for (const s of [-1, 1]) {
          const ear = new THREE.Group();
          ear.position.set(s * 0.52, 0.8, -0.02);
          ear.rotation.z = -s * 0.42;
          const outer = mesh(new THREE.ConeGeometry(0.33, 0.52, 24), accentMat, 0, 0.14, 0);
          outer.scale.z = 0.6;
          const inner = mesh(new THREE.ConeGeometry(0.19, 0.34, 20), pinkSoft, 0, 0.12, 0.11);
          inner.scale.z = 0.4;
          ear.add(outer, inner);
          ear.userData.top = 'ear';
          shell.add(ear);
        }
        const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.4, -0.9), new THREE.Vector3(0, -0.1, -1.3), new THREE.Vector3(0.25, 0.4, -1.4), new THREE.Vector3(0.3, 0.7, -1.15)]);
        shell.add(mesh(new THREE.TubeGeometry(curve, 24, 0.1, 12), accentMat));
        shell.add(mesh(new THREE.SphereGeometry(0.1, 12, 10), accentMat, 0.3, 0.7, -1.15));
        break;
      }
      case 'bean': {
        // 头顶一根弯弯的呆毛 + 小叶子
        const curl = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.9, 0.05), new THREE.Vector3(0.02, 1.16, 0.08), new THREE.Vector3(0.18, 1.26, 0.02), new THREE.Vector3(0.24, 1.12, -0.02)]);
        const curlM = mesh(new THREE.TubeGeometry(curl, 16, 0.045, 8), darkAccent);
        curlM.userData.top = 'tuft';
        shell.add(curlM);
        const leaf = mesh(new THREE.SphereGeometry(0.13, 16, 10), vinyl('#6fdc6a', { vertexColors: false }), 0.25, 1.1, -0.02);
        leaf.scale.set(1, 0.45, 0.6);
        leaf.rotation.z = -0.6;
        leaf.userData.top = 'tuft';
        shell.add(leaf);
        break;
      }
      case 'dino': {
        const spikeMat = vinyl(new THREE.Color(accent).offsetHSL(0.1, 0.1, -0.05), { vertexColors: false });
        for (let k = 0; k < 5; k++) {
          const th = 0.2 + k * 0.34;
          const sp = mesh(new THREE.ConeGeometry(0.14 - k * 0.012, 0.3, 16), spikeMat);
          sp.scale.x = 0.55;
          const n = new THREE.Vector3(0, Math.cos(th), -Math.sin(th));
          sp.position.copy(n).multiplyScalar(0.97);
          sp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
          shell.add(sp);
        }
        const tail = mesh(new THREE.ConeGeometry(0.3, 0.8, 20), accentMat, 0, -0.45, -1.05);
        tail.rotation.x = -Math.PI / 2 - 0.35;
        shell.add(tail);
        break;
      }
      case 'penguin': {
        const beak = onFace(new THREE.Group(), 0, -4, 0.99);
        const b = mesh(new THREE.ConeGeometry(0.1, 0.22, 20), orange, 0, 0, 0.1);
        b.rotation.x = Math.PI / 2;
        b.scale.set(1.3, 0.8, 1);
        beak.add(b);
        shell.add(beak);
        for (const s of [-1, 1]) {
          const fl = mesh(sphereGeo, darkAccent, s * 0.97, -0.12, 0.02);
          fl.scale.set(0.1, 0.38, 0.24);
          fl.rotation.z = s * 0.4;
          body.add(fl);
          wings.push({ obj: fl, side: s, base: fl.rotation.z });
        }
        break;
      }
      case 'chick': {
        const beak = onFace(new THREE.Group(), 0, -4, 0.99);
        const up = mesh(new THREE.ConeGeometry(0.1, 0.2, 20), orange, 0, 0.025, 0.08);
        up.rotation.x = Math.PI / 2;
        up.scale.set(1.2, 0.7, 1);
        const lo = mesh(new THREE.ConeGeometry(0.075, 0.13, 16), orange, 0, -0.035, 0.06);
        lo.rotation.x = Math.PI / 2;
        beak.add(up, lo);
        shell.add(beak);
        // 头顶三根小毛
        const tuft = vinyl('#ffb020', { vertexColors: false });
        for (const [x, rz, len] of [
          [-0.08, 0.45, 0.22],
          [0, 0, 0.28],
          [0.08, -0.45, 0.22],
        ]) {
          const f = mesh(new THREE.CapsuleGeometry(0.045, len, 6, 10), tuft, x, 0.98 + len * 0.3, 0.05);
          f.rotation.z = rz;
          f.userData.top = 'tuft';
          shell.add(f);
        }
        for (const s of [-1, 1]) {
          const w = mesh(sphereGeo, darkAccent, s * 0.97, -0.1, -0.02);
          w.scale.set(0.1, 0.32, 0.26);
          w.rotation.z = s * 0.5;
          body.add(w);
          wings.push({ obj: w, side: s, base: w.rotation.z });
        }
        break;
      }
      case 'panda': {
        const black = vinyl('#1d1b24', { vertexColors: false, clearcoat: 0.3 });
        for (const s of [-1, 1]) {
          const ear = mesh(new THREE.SphereGeometry(0.25, 20, 14), black, s * 0.58, 0.78, -0.08);
          ear.scale.z = 0.7;
          ear.userData.top = 'ear';
          shell.add(ear);
        }
        break;
      }
      case 'bunny': {
        for (const s of [-1, 1]) {
          const ear = new THREE.Group();
          ear.position.set(s * 0.3, 0.86, -0.05);
          ear.rotation.z = -s * 0.18;
          ear.rotation.x = -0.1;
          const outer = mesh(new THREE.CapsuleGeometry(0.15, 0.62, 8, 16), accentMat, 0, 0.4, 0);
          outer.scale.z = 0.62;
          const inner = mesh(new THREE.CapsuleGeometry(0.08, 0.46, 6, 12), pinkSoft, 0, 0.4, 0.07);
          inner.scale.z = 0.35;
          ear.add(outer, inner);
          ear.userData.top = 'ear';
          shell.add(ear);
        }
        shell.add(mesh(new THREE.SphereGeometry(0.24, 16, 12), vinyl('#ffffff', { vertexColors: false }), 0, -0.2, -0.98));
        break;
      }
    }
    this.hat = makeHat(hat, accent);
    body.add(this.hat);
    // 戴了盖住头顶的帽子：头顶的耳朵、天线、呆毛会穿过帽子，收起来
    const covers = ['tophat', 'cowboy', 'propeller', 'party', 'crown'].includes(hat);
    const bigBrim = ['tophat', 'cowboy', 'propeller', 'headphones'].includes(hat);
    shell.traverse((o) => {
      if (!o.userData.top) return;
      if (o.userData.top === 'ear') o.visible = !bigBrim;
      else o.visible = !covers;
    });
    if (covers && !bigBrim && char === 'bunny') {
      // 小帽子（派对帽、皇冠）夹在两只兔耳朵中间：耳朵往外张开一点
      shell.traverse((o) => {
        if (o.userData.top === 'ear') {
          o.position.x *= 1.55;
          o.rotation.z *= 3;
        }
      });
    }

    // 四肢：身体同色的小圆脚 + 小圆手（企鹅、小鸡用翅膀代替手）
    const birdy = char === 'penguin' || char === 'chick';
    const limbCol = birdy ? '#ffa53a' : char === 'robot' ? '#8a90a8' : new THREE.Color(accent).offsetHSL(0, 0, -0.1);
    const footMat = vinyl(limbCol, { vertexColors: false, metalness: char === 'robot' ? 0.6 : 0, roughness: 0.4 });
    this.feet = [];
    for (const s of [-1, 1]) {
      const f = new THREE.Group();
      f.position.set(s * 0.36, -0.86, 0.12);
      const shoe = mesh(sphereGeo, footMat, 0, 0, 0.08);
      shoe.scale.set(birdy ? 0.2 : 0.22, 0.14, birdy ? 0.3 : 0.27);
      f.add(shoe);
      body.add(f);
      this.feet.push({ obj: f, side: s, base: f.position.clone() });
    }
    this.hands = [];
    this.wings = wings;
    if (!birdy) {
      const handMat = char === 'robot' ? std('#aab2cc', { metalness: 0.85, roughness: 0.28 }) : vinyl(new THREE.Color(accent).offsetHSL(0, 0, 0.04), { vertexColors: false });
      for (const s of [-1, 1]) {
        const h = mesh(sphereGeo, handMat, s * 0.9, -0.22, 0.2);
        h.scale.set(0.15, 0.17, 0.15);
        body.add(h);
        this.hands.push({ obj: h, side: s, base: h.position.clone() });
      }
    }
    this.walk = 0;
    this.flail = 0;

    // 特效外壳：受击闪白、护盾、冰块、晕眩星星
    const fx = new THREE.Group();
    this.fxGroup = fx;
    this.flashMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    this.flashShell = new THREE.Mesh(sphereGeo, this.flashMat);
    this.flashShell.scale.setScalar(1.05);
    this.flashShell.visible = false;
    body.add(this.flashShell);
    this.shield = new THREE.Group();
    this.shield.add(new THREE.Mesh(sphereGeo, new THREE.MeshStandardMaterial({ color: '#6fc3ff', emissive: '#3fa7ff', emissiveIntensity: 0.6, transparent: true, opacity: 0.25, depthWrite: false })));
    this.wire = new THREE.Mesh(new THREE.IcosahedronGeometry(1.05, 1), new THREE.MeshBasicMaterial({ color: '#bfe6ff', wireframe: true, transparent: true, opacity: 0.6 }));
    this.shield.add(this.wire);
    this.shield.scale.setScalar(1.45);
    this.shield.visible = false;
    fx.add(this.shield);
    this.ice = new THREE.Mesh(
      new THREE.BoxGeometry(2.5, 2.4, 2.5),
      new THREE.MeshStandardMaterial({ color: '#c8f1ff', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.55, emissive: '#6fd6ff', emissiveIntensity: 0.3, depthWrite: false })
    );
    this.ice.rotation.y = 0.4;
    this.ice.visible = false;
    fx.add(this.ice);
    this.stars = new THREE.Group();
    const starMat = new THREE.MeshBasicMaterial({ color: '#ffe066' });
    for (let i = 0; i < 3; i++) {
      const st = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), starMat);
      const a = (i / 3) * Math.PI * 2;
      st.position.set(Math.cos(a) * 0.7, 1.4, Math.sin(a) * 0.7);
      this.stars.add(st);
    }
    this.stars.visible = false;
    fx.add(this.stars);

    this.root.add(body, fx);
    this.mats = [];
    body.traverse((o) => {
      if (o.material && o.material !== this.flashMat && !this.mats.includes(o.material)) this.mats.push(o.material);
    });
    this.baseOpacity = new Map(this.mats.map((m) => [m, m.opacity]));
    this.opacity = 1;
  }

  // 受击：闪白 + 被撞方向倾倒 + 挤压；重击会晕眩
  hit(power, nx, nz) {
    const k = Math.min(1, power / 1000);
    this.flash = Math.max(this.flash, 0.5 + k * 0.5);
    this.squashV += 2 + k * 5;
    // 转到模型本地坐标（root 已经按朝向旋转过）
    const yaw = this.root.rotation.y;
    const lx = nx * Math.cos(-yaw) - nz * Math.sin(-yaw);
    const lz = nx * Math.sin(-yaw) + nz * Math.cos(-yaw);
    this.tiltV.x += lz * (4 + k * 10);
    this.tiltV.y += -lx * (4 + k * 10);
    if (power > 750) this.dizzy = Math.max(this.dizzy, 0.4 + k * 0.7);
    this.flail = Math.max(this.flail, 0.5 + k * 0.6);
  }

  bounce(amount) {
    this.squashV += amount;
  }

  // 嘲讽动作（发贴图时）：spin 转圈 / wiggle 扭屁股 / laugh 笑到后仰 / hop 蹦蹦跳 / stomp 跺脚 / sulk 垂头丧气 / shrug 摊手 / wave 挥手 / cheer 欢呼
  taunt(kind) {
    this.tauntKind = kind || 'hop';
    this.tauntT = 0;
    this.squashV += 4;
  }

  // s: { speed(0~1), frozen, slip, ghost, shield, speedFx, falling, lean, cheer }
  update(dt, t, s = {}) {
    const d = Math.min(dt, 0.05);
    this.animateLimbs(dt, t, s);
    this.squashV += (-120 * this.squash - 9 * this.squashV) * d;
    this.squash = Math.max(-0.28, Math.min(0.28, this.squash + this.squashV * d));
    this.tiltV.x += (-90 * this.tilt.x - 8 * this.tiltV.x) * d;
    this.tiltV.y += (-90 * this.tilt.y - 8 * this.tiltV.y) * d;
    this.tilt.x = Math.max(-0.9, Math.min(0.9, this.tilt.x + this.tiltV.x * d));
    this.tilt.y = Math.max(-0.9, Math.min(0.9, this.tilt.y + this.tiltV.y * d));
    const body = this.body;
    body.scale.set(1 + this.squash * 0.5, 1 - this.squash, 1 + this.squash * 0.5);
    body.rotation.x = (s.lean || 0) + this.tilt.x;
    body.rotation.z = this.tilt.y;
    if (s.falling) body.rotation.y += dt * 12;
    else body.rotation.y *= 0.85;
    this.applyTaunt(dt, s);

    this.dizzy = Math.max(0, this.dizzy - dt);
    this.blink -= dt;
    if (this.blink < 0) this.blink = 2 + Math.random() * 4;
    // 表情：选一张脸贴图
    const dizzy = this.dizzy > 0 || s.falling;
    const scared = !dizzy && this.flail > 0.45;
    const tk = this.tauntT < TAUNT_DUR ? this.tauntKind : '';
    let face = 'normal';
    if (dizzy) face = 'dizzy';
    else if (s.frozen) face = 'frozen';
    else if (scared) face = 'scared';
    else if (s.cheer || ['laugh', 'cheer', 'hop', 'wiggle', 'spin', 'wave'].includes(tk)) face = 'happy';
    else if (tk === 'stomp') face = 'angry';
    else if (tk === 'sulk') face = 'sad';
    else if ((s.speed || 0) > 0.75) face = 'run';
    else if (this.blink < 0.12) face = 'blink';
    if (face !== this.faceState) {
      this.faceState = face;
      const tex = faceTexture(this.char, face);
      this.faceMat.map = tex;
      if (this.char === 'robot') this.faceMat.emissiveMap = tex;
    }
    this.stars.visible = s.slip || this.dizzy > 0;
    this.stars.rotation.y += dt * 6;
    this.shield.visible = !!s.shield && (s.shield > 1.5 || Math.sin(t * 25) > 0);
    this.wire.rotation.y += dt * 1.5;
    this.wire.rotation.x += dt * 0.7;
    this.ice.visible = !!s.frozen;

    // 闪白 / 加速时发黄光
    this.flash = Math.max(0, this.flash - dt * 4);
    const glow = s.speedFx ? 0.18 + 0.12 * Math.sin(t * 20) : 0;
    const f = Math.max(this.flash, glow);
    this.flashShell.visible = f > 0.01;
    this.flashMat.opacity = f;
    this.flashMat.color.set(this.flash > glow ? '#ffffff' : '#ffd23f');

    const opacity = s.ghost ? (s.ghost < 1.2 && Math.sin(t * 20) > 0 ? 0.7 : 0.3) : 1;
    if (opacity !== this.opacity) {
      this.opacity = opacity;
      for (const m of this.mats) {
        m.transparent = opacity < 1 || this.baseOpacity.get(m) < 1;
        m.opacity = this.baseOpacity.get(m) * opacity;
        m.depthWrite = opacity === 1 && !m.userData.decal;
        m.needsUpdate = true;
      }
    }
    if (!s.frozen) {
      this.hat.traverse((o) => {
        if (o.userData.spin) o.rotation.y += o.userData.spin * dt;
        if (o.userData.bob) o.position.y = 1.5 + Math.sin(t * 3) * 0.05;
      });
    }
  }

  applyTaunt(dt, s) {
    const body = this.body;
    if (this.bodyY === undefined) this.bodyY = body.position.y;
    if (this.tauntT >= TAUNT_DUR || s.frozen || s.falling) {
      body.position.x = 0;
      body.position.y += (this.bodyY - body.position.y) * Math.min(1, dt * 12);
      return;
    }
    this.tauntT += dt;
    const k = Math.min(1, this.tauntT / TAUNT_DUR);
    const env = Math.sin(Math.PI * k); // 先变大再收回
    const tt = this.tauntT;
    let lift = 0;
    switch (this.tauntKind) {
      case 'spin': {
        const a = (1 - Math.pow(1 - k, 3)) * Math.PI * 4;
        body.rotation.y = Math.atan2(Math.sin(a), Math.cos(a));
        lift = Math.abs(Math.sin(tt * 7)) * 0.25 * env;
        break;
      }
      case 'wiggle':
        body.rotation.z += Math.sin(tt * 22) * 0.4 * env;
        body.rotation.y = Math.sin(tt * 11) * 0.5 * env;
        break;
      case 'laugh':
        body.rotation.x -= 0.35 * env;
        body.scale.y *= 1 + Math.sin(tt * 38) * 0.09 * env;
        lift = Math.abs(Math.sin(tt * 19)) * 0.1 * env;
        break;
      case 'hop':
      case 'cheer':
        lift = Math.abs(Math.sin(tt * 9)) * 0.45 * env;
        break;
      case 'stomp':
        body.position.x = Math.sin(tt * 60) * 0.06 * env;
        lift = Math.abs(Math.sin(tt * 12)) * 0.15 * env;
        break;
      case 'sulk':
        body.rotation.x += 0.4 * env;
        body.scale.y *= 1 - 0.1 * env;
        break;
      case 'shrug':
        body.rotation.z += Math.sin(tt * 4) * 0.2 * env;
        break;
      default:
        break;
    }
    body.position.y = this.bodyY + lift;
    if (k >= 1) body.position.x = 0;
  }

  // 走路：左右脚交替迈步、手反向摆；被撞 / 掉下去时手脚乱挥；赢了举手欢呼
  animateLimbs(dt, t, s) {
    const mv = s.frozen ? 0 : Math.min(1, s.speed || 0);
    this.walk += dt * (4 + 14 * mv);
    this.flail = Math.max(0, this.flail - dt * 2.2);
    const fl = s.frozen ? 0 : Math.min(1, this.flail + (s.falling ? 1 : 0));
    const taunting = this.tauntT < TAUNT_DUR && !s.frozen && !s.falling;
    const tk = taunting ? this.tauntKind : '';
    const tenv = taunting ? Math.sin((Math.PI * this.tauntT) / TAUNT_DUR) : 0;
    const cheer = s.cheer && !s.frozen ? 1 : tk === 'cheer' || tk === 'laugh' ? tenv : 0;
    this.feet.forEach((f, i) => {
      const ph = this.walk + i * Math.PI;
      f.obj.position.set(
        f.base.x,
        f.base.y + Math.max(0, Math.cos(ph)) * 0.18 * mv + (fl ? Math.sin(t * 26 + i * 2) * 0.1 * fl : 0),
        f.base.z + Math.sin(ph) * 0.32 * mv
      );
      f.obj.rotation.x = -Math.sin(ph) * 0.55 * mv;
    });
    this.hands.forEach((h, i) => {
      const ph = this.walk + i * Math.PI + Math.PI;
      let up = cheer * (0.5 + Math.sin(t * 14 + i * 2) * 0.12) + fl * (0.4 + Math.abs(Math.sin(t * 22 + i * 1.7)) * 0.25);
      let out = 0;
      if (tk === 'wave' && i === 1) {
        up += tenv * 0.6;
        out = Math.sin(t * 16) * 0.2 * tenv;
      } else if (tk === 'shrug' || tk === 'wiggle') {
        up += tenv * 0.35;
        out = 0.18 * tenv;
      }
      h.obj.position.set(
        h.base.x + h.side * (fl * 0.22 + out - Math.min(up, 1) * 0.24),
        h.base.y + up + Math.sin(t * 2.6 + i) * 0.03,
        h.base.z + Math.sin(ph) * 0.34 * mv * (1 - cheer)
      );
    });
    for (const w of this.wings) {
      const flap = mv * 0.5 + fl + cheer;
      w.obj.rotation.z = w.base + w.side * flap * (0.4 + Math.sin(t * (flap > 0.3 ? 20 : 3)) * 0.35);
    }
  }

  dispose() {
    disposeGroup(this.root);
  }
}
