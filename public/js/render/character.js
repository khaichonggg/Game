// 角色建模：8 种角色 × 10 种皮肤 × 12 种颜色 × 10 顶帽子，外加受击反应动画
// 模型按半径 1 建，朝 +z 方向；外部负责位置、缩放和朝向。
import * as THREE from 'three';
import { std, mesh, markShared, disposeGroup } from './core.js';

const sphereGeo = markShared(new THREE.SphereGeometry(1, 40, 28));

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
      return std('#ffffff', {
        roughness: 0.35,
        map: canvasTex(`stripes${color}`, (g, w, h) => {
          g.fillStyle = color;
          g.fillRect(0, 0, w, h);
          g.fillStyle = shade(color, 0.28);
          for (let i = 1; i < 9; i += 2) g.fillRect(0, (i * h) / 9, w, h / 9);
        }),
      });
    case 'dots':
      return std('#ffffff', {
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
      return std('#ffffff', {
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
      return std('#ffffff', {
        roughness: 0.3,
        map: canvasTex('rainbow', (g, w, h) => {
          for (let y = 0; y < h; y++) {
            g.fillStyle = `hsl(${(y / h) * 330}, 90%, 62%)`;
            g.fillRect(0, y, w, 1);
          }
        }),
      });
    case 'candy':
      return std('#ffffff', {
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
      return std('#ffcf4a', { metalness: 1, roughness: 0.22, emissive: '#5a3a00', emissiveIntensity: 0.25 });
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
      return std('#ffffff', { roughness: 0.4, map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0.55 });
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
      return std('#ffffff', { roughness: 0.9, map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0.9, flatShading: false });
    }
    case 'ice':
      return std('#cdf3ff', { roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.82, emissive: '#6fd6ff', emissiveIntensity: 0.2 });
    default:
      return std(color, { roughness: 0.32, metalness: 0.05 });
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
      const band = mesh(new THREE.TorusGeometry(1.0, 0.07, 8, 24, Math.PI), black, 0, 0.12, 0);
      g.add(band);
      for (const s of [-1, 1]) {
        const cup = mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.2, 16), tint, s * 1.0, 0.12, 0);
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
function onSurface(o, x, y, z, r) {
  const n = new THREE.Vector3(x, y, z).normalize();
  o.position.copy(n).multiplyScalar(r);
  o.lookAt(n.multiplyScalar(3));
  return o;
}

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
    body.add(mesh(sphereGeo, this.bodyMat));

    // 碰碰车保险杠：团队模式换成发光的队伍颜色
    const teamCol = opts.teamColor;
    const bumper = mesh(
      new THREE.TorusGeometry(0.95, teamCol ? 0.2 : 0.14, 12, 40),
      std(teamCol || new THREE.Color(accent).offsetHSL(0, 0.05, -0.22), { roughness: 0.4, emissive: teamCol || '#000000', emissiveIntensity: teamCol ? 0.45 : 0 })
    );
    bumper.rotation.x = Math.PI / 2;
    bumper.position.y = -0.3;
    body.add(bumper);

    const face = new THREE.Group();
    body.add(face);
    const white = std('#ffffff', { roughness: 0.25 });
    const dark = std('#15131f', { roughness: 0.15 });
    const orange = std('#ffa53a', { roughness: 0.4 });
    const pink = std('#ff9fb3', { roughness: 0.5 });
    this.eyes = [];
    this.xEyes = [];
    const eyePos = [
      [-0.36, 0.5, 0.8],
      [0.36, 0.5, 0.8],
    ];
    if (char === 'robot') {
      // 发光面罩
      const visor = new THREE.Mesh(new THREE.CylinderGeometry(1.03, 1.03, 0.36, 28, 1, true, -1.1, 2.2), std('#141a2e', { metalness: 0.7, roughness: 0.15, side: THREE.DoubleSide }));
      visor.position.y = 0.42;
      face.add(visor);
      for (const s of [-1, 1]) {
        const e = new THREE.Group();
        onSurface(e, s * 0.3, 0.42, 0.9, 1.04);
        e.add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.04), new THREE.MeshBasicMaterial({ color: '#4ff0ff' })));
        face.add(e);
        this.eyes.push(e);
      }
      for (let i = 0; i < 3; i++) {
        const gr = new THREE.Group();
        onSurface(gr, 0, 0.02, 1, 1.0);
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.035, 0.03), dark);
        bar.position.y = (i - 1) * 0.07;
        gr.add(bar);
        face.add(gr);
      }
      const antenna = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 6), std('#8a90a8', { metalness: 0.8 }), 0.35, 1.05, -0.3);
      antenna.rotation.z = -0.35;
      face.add(antenna);
      face.add(mesh(new THREE.SphereGeometry(0.08, 10, 8), new THREE.MeshBasicMaterial({ color: '#ff4d6d' }), 0.43, 1.25, -0.3));
      for (const s of [-1, 1]) {
        const bolt = mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.14, 12), std('#8a90a8', { metalness: 0.8, roughness: 0.3 }), s * 1.0, 0.2, 0);
        bolt.rotation.z = Math.PI / 2;
        face.add(bolt);
      }
    } else {
      for (const [x, y, z] of eyePos) {
        const e = new THREE.Group();
        onSurface(e, x, y, z, 0.84);
        e.add(mesh(new THREE.SphereGeometry(0.26, 16, 12), white));
        e.add(mesh(new THREE.SphereGeometry(0.14, 12, 10), dark, 0, 0, 0.17));
        e.add(mesh(new THREE.SphereGeometry(0.05, 8, 6), white, 0.05, 0.06, 0.29));
        face.add(e);
        this.eyes.push(e);
      }
      if (char !== 'penguin' && char !== 'chick') {
        const mouthG = onSurface(new THREE.Group(), 0, 0.2, 1, 1.0);
        const m = mesh(new THREE.TorusGeometry(0.16, 0.035, 6, 14, Math.PI), dark);
        m.rotation.z = Math.PI;
        mouthG.add(m);
        face.add(mouthG);
      }
      for (const s of [-1, 1]) {
        const cheek = new THREE.Mesh(new THREE.CircleGeometry(0.1, 12), new THREE.MeshBasicMaterial({ color: '#ff9fb3', transparent: true, opacity: 0.7 }));
        onSurface(cheek, s * 0.6, 0.25, 0.76, 1.005);
        face.add(cheek);
      }
    }
    // 晕眩时的 X 眼
    for (const [x, y, z] of eyePos) {
      const g = onSurface(new THREE.Group(), x, y, z, 1.0);
      for (const r of [Math.PI / 4, -Math.PI / 4]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.05), dark);
        bar.rotation.z = r;
        g.add(bar);
      }
      g.visible = false;
      face.add(g);
      this.xEyes.push(g);
    }

    // 各角色的特征部件
    const accentMat = std(accent, { roughness: 0.45 });
    const darkAccent = std(new THREE.Color(accent).offsetHSL(0, 0, -0.2), { roughness: 0.45 });
    const wings = [];
    switch (char) {
      case 'cat': {
        for (const s of [-1, 1]) {
          const ear = mesh(new THREE.ConeGeometry(0.26, 0.48, 4), accentMat, s * 0.5, 0.86, -0.05);
          ear.rotation.z = -s * 0.4;
          body.add(ear);
          const inner = mesh(new THREE.ConeGeometry(0.14, 0.3, 4), pink, s * 0.5, 0.84, 0.06);
          inner.rotation.z = -s * 0.4;
          body.add(inner);
          for (const k of [-1, 0, 1]) {
            const w = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 4), dark, s * 0.42, 0.18 + k * 0.06, 0.9);
            w.rotation.z = Math.PI / 2 + k * 0.15 * s;
            body.add(w);
          }
        }
        body.add(onSurface(mesh(new THREE.SphereGeometry(0.07, 8, 6), pink), 0, 0.3, 1, 1.0));
        const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.35, -0.9), new THREE.Vector3(0, 0, -1.35), new THREE.Vector3(0.2, 0.55, -1.45), new THREE.Vector3(0.35, 0.85, -1.2)]);
        body.add(mesh(new THREE.TubeGeometry(curve, 20, 0.09, 8), accentMat));
        break;
      }
      case 'dino': {
        const spikeMat = std(new THREE.Color(accent).offsetHSL(0.12, 0.1, -0.1), { roughness: 0.4 });
        for (let k = 0; k < 5; k++) {
          const th = 0.25 + k * 0.33;
          const sp = mesh(new THREE.ConeGeometry(0.13, 0.34, 6), spikeMat);
          const n = new THREE.Vector3(0, Math.cos(th), -Math.sin(th));
          sp.position.copy(n).multiplyScalar(0.96);
          sp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
          body.add(sp);
        }
        const tail = mesh(new THREE.ConeGeometry(0.32, 0.9, 10), accentMat, 0, -0.4, -1.1);
        tail.rotation.x = -Math.PI / 2 - 0.3;
        body.add(tail);
        for (const s of [-1, 1]) {
          const tooth = onSurface(new THREE.Group(), s * 0.12, 0.08, 1, 0.99);
          const t = mesh(new THREE.ConeGeometry(0.04, 0.1, 4), white);
          t.rotation.x = Math.PI;
          tooth.add(t);
          body.add(tooth);
        }
        break;
      }
      case 'penguin': {
        const belly = mesh(sphereGeo, white, 0, -0.1, 0.5);
        belly.scale.set(0.72, 0.78, 0.55);
        body.add(belly);
        const beak = onSurface(new THREE.Group(), 0, 0.22, 1, 0.98);
        const b = mesh(new THREE.ConeGeometry(0.12, 0.32, 10), orange, 0, 0, 0.14);
        b.rotation.x = Math.PI / 2;
        beak.add(b);
        body.add(beak);
        for (const s of [-1, 1]) {
          const fl = mesh(sphereGeo, darkAccent, s * 0.95, -0.05, 0);
          fl.scale.set(0.12, 0.45, 0.28);
          fl.rotation.z = s * 0.35;
          body.add(fl);
          wings.push({ obj: fl, side: s, base: fl.rotation.z });
        }
        break;
      }
      case 'chick': {
        const beak = onSurface(new THREE.Group(), 0, 0.22, 1, 0.98);
        const up = mesh(new THREE.ConeGeometry(0.12, 0.26, 8), orange, 0, 0.03, 0.11);
        up.rotation.x = Math.PI / 2;
        const lo = mesh(new THREE.ConeGeometry(0.09, 0.18, 8), orange, 0, -0.05, 0.08);
        lo.rotation.x = Math.PI / 2;
        beak.add(up, lo);
        body.add(beak);
        const red = std('#ff3b3b', { roughness: 0.4 });
        for (const [x, y, z, r] of [
          [0, 1.02, 0.2, 0.13],
          [0, 1.07, 0, 0.15],
          [0, 1.02, -0.2, 0.12],
        ])
          body.add(mesh(new THREE.SphereGeometry(r, 10, 8), red, x, y, z));
        for (const s of [-1, 1]) {
          const w = mesh(sphereGeo, darkAccent, s * 0.95, -0.05, -0.05);
          w.scale.set(0.12, 0.38, 0.32);
          w.rotation.z = s * 0.5;
          body.add(w);
          wings.push({ obj: w, side: s, base: w.rotation.z });
        }
        for (let k = -1; k <= 1; k++) {
          const f = mesh(new THREE.ConeGeometry(0.08, 0.3, 6), darkAccent, k * 0.12, 0.25, -1.0);
          f.rotation.x = -0.9;
          body.add(f);
        }
        break;
      }
      case 'panda': {
        const black = std('#1d1b24', { roughness: 0.6 });
        for (const s of [-1, 1]) {
          body.add(mesh(new THREE.SphereGeometry(0.28, 14, 10), black, s * 0.56, 0.8, -0.05));
          const patch = onSurface(new THREE.Group(), s * 0.37, 0.48, 0.8, 0.9);
          const pm = mesh(sphereGeo, black);
          pm.scale.set(0.3, 0.24, 0.1);
          pm.rotation.z = s * 0.5;
          patch.add(pm);
          body.add(patch);
        }
        body.add(onSurface(mesh(new THREE.SphereGeometry(0.08, 8, 6), black), 0, 0.3, 1, 1.0));
        break;
      }
      case 'bunny': {
        for (const s of [-1, 1]) {
          const ear = new THREE.Group();
          ear.position.set(s * 0.3, 0.9, -0.05);
          ear.rotation.z = -s * 0.15;
          ear.add(mesh(new THREE.CapsuleGeometry(0.14, 0.7, 6, 12), accentMat, 0, 0.42, 0));
          const inner = mesh(new THREE.CapsuleGeometry(0.07, 0.5, 4, 8), pink, 0, 0.42, 0.08);
          inner.scale.z = 0.4;
          ear.add(inner);
          body.add(ear);
        }
        for (const s of [-1, 1]) {
          const tooth = onSurface(new THREE.Group(), s * 0.05, 0.08, 1, 0.99);
          tooth.add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.03), white));
          body.add(tooth);
        }
        body.add(onSurface(mesh(new THREE.SphereGeometry(0.07, 8, 6), pink), 0, 0.3, 1, 1.0));
        body.add(mesh(new THREE.SphereGeometry(0.26, 12, 10), white, 0, -0.1, -1.0));
        break;
      }
    }
    this.hat = makeHat(hat, accent);
    body.add(this.hat);

    // 四肢：会走路的小脚 + 会摆动的小手（企鹅、小鸡用翅膀代替手）
    const birdy = char === 'penguin' || char === 'chick';
    const footMat = std(birdy ? '#ffa53a' : char === 'robot' ? '#4a5068' : new THREE.Color(accent).offsetHSL(0, -0.15, -0.3), {
      roughness: 0.45,
      metalness: char === 'robot' ? 0.6 : 0,
    });
    this.feet = [];
    for (const s of [-1, 1]) {
      const f = new THREE.Group();
      f.position.set(s * 0.4, -0.86, 0.14);
      const shoe = mesh(sphereGeo, footMat, 0, 0, 0.1);
      shoe.scale.set(birdy ? 0.24 : 0.26, 0.15, birdy ? 0.36 : 0.34);
      shoe.castShadow = true;
      f.add(shoe);
      body.add(f);
      this.feet.push({ obj: f, side: s, base: f.position.clone() });
    }
    this.hands = [];
    this.wings = wings;
    if (!birdy) {
      const gloveMat = char === 'robot' ? std('#9aa0b8', { metalness: 0.8, roughness: 0.3 }) : std('#ffffff', { roughness: 0.4 });
      for (const s of [-1, 1]) {
        const h = mesh(new THREE.SphereGeometry(0.2, 16, 12), gloveMat, s * 1.04, -0.18, 0.12);
        h.castShadow = true;
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

    this.dizzy = Math.max(0, this.dizzy - dt);
    this.blink -= dt;
    if (this.blink < 0) this.blink = 2 + Math.random() * 4;
    const xEyes = this.dizzy > 0 || s.falling;
    const closed = s.frozen || (this.blink < 0.12 && !xEyes);
    for (const e of this.eyes) {
      e.visible = !xEyes;
      e.scale.y = closed ? 0.12 : 1;
    }
    for (const e of this.xEyes) {
      e.visible = xEyes;
      e.rotation.z = xEyes ? Math.sin(t * 12) * 0.3 : 0;
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
        m.depthWrite = opacity === 1;
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

  // 走路：左右脚交替迈步、手反向摆；被撞 / 掉下去时手脚乱挥；赢了举手欢呼
  animateLimbs(dt, t, s) {
    const mv = s.frozen ? 0 : Math.min(1, s.speed || 0);
    this.walk += dt * (4 + 14 * mv);
    this.flail = Math.max(0, this.flail - dt * 2.2);
    const fl = s.frozen ? 0 : Math.min(1, this.flail + (s.falling ? 1 : 0));
    const cheer = s.cheer && !s.frozen ? 1 : 0;
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
      const up = cheer * (0.85 + Math.sin(t * 14 + i * 2) * 0.12) + fl * (0.55 + Math.abs(Math.sin(t * 22 + i * 1.7)) * 0.35);
      h.obj.position.set(
        h.base.x + h.side * (fl * 0.22 + cheer * 0.05),
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
