// 场上物体的模型：道具、龙卷风、香蕉皮、陨石、皇冠、足球 / 球门、Boss / 小怪、烫手炸弹、领奖台
import * as THREE from 'three';
import { scene, std, mesh, rockify, textSprite } from './core.js';
import { ITEMS, TEAM_COLORS } from '../data.js';

const ITEM_INFO = ITEMS;

export function makeBanana(s = 1) {
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

export function makeItemModel(type) {
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
export function makeTornado() {
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

export function makeCrown() {
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

export function makeMeteor() {
  const warn = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 40), new THREE.MeshBasicMaterial({ color: '#ff3b3b', transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
  warn.rotation.x = -Math.PI / 2;
  const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: '#ff3b3b', transparent: true, opacity: 0.25, depthWrite: false }));
  fill.rotation.x = -Math.PI / 2;
  const rock = new THREE.Mesh(rockify(new THREE.DodecahedronGeometry(22, 0), 0.2, Math.random() * 10), std('#5a3a30', { flatShading: true, emissive: '#ff5a10', emissiveIntensity: 0.8 }));
  rock.castShadow = true;
  scene.add(warn, fill, rock);
  return { warn, fill, rock };
}


// ---- 碰碰足球：彩色沙滩球 + 两个球门 ----
let ballTex = null;
function beachTexture() {
  if (ballTex) return ballTex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  const cols = ['#ffffff', '#ff4d5a', '#ffffff', '#3f8cff', '#ffffff', '#ffd23f'];
  cols.forEach((col, i) => {
    g.fillStyle = col;
    g.fillRect((i * 256) / 6, 0, 256 / 6 + 1, 128);
  });
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 14);
  g.fillRect(0, 114, 256, 14);
  ballTex = new THREE.CanvasTexture(c);
  ballTex.colorSpace = THREE.SRGBColorSpace;
  return ballTex;
}
export function makeBall(r) {
  const g = new THREE.Group();
  const ball = mesh(new THREE.SphereGeometry(r, 32, 20), std('#ffffff', { map: beachTexture(), roughness: 0.3 }));
  g.add(ball);
  const ring = new THREE.Mesh(new THREE.RingGeometry(r * 1.1, r * 1.3, 32), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  g.add(ring);
  scene.add(g);
  return { g, ball, ring, r };
}

export function makeGoals(goal) {
  const g = new THREE.Group();
  [-1, 1].forEach((side, i) => {
    const col = TEAM_COLORS[i];
    const zone = new THREE.Mesh(
      new THREE.PlaneGeometry(goal.hw * 2, goal.hh * 2),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.28, depthWrite: false })
    );
    zone.rotation.x = -Math.PI / 2;
    zone.position.set(side * goal.x, 1.2, 0);
    zone.userData.pulse = true;
    g.add(zone);
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(goal.hw * 2, goal.hh * 2)),
      new THREE.LineBasicMaterial({ color: col })
    );
    edge.rotation.x = -Math.PI / 2;
    edge.position.set(side * goal.x, 1.5, 0);
    g.add(edge);
    // 门框和球网（在球门区域外侧）
    const post = std('#ffffff', { roughness: 0.3, emissive: col, emissiveIntensity: 0.25 });
    const bx = side * (goal.x + goal.hw);
    for (const y of [-goal.hh, goal.hh]) g.add(mesh(new THREE.CylinderGeometry(4, 4, 80, 10), post, bx, 40, y));
    const bar = mesh(new THREE.CylinderGeometry(4, 4, goal.hh * 2, 10), post, bx, 80, 0);
    bar.rotation.x = Math.PI / 2;
    g.add(bar);
    const net = new THREE.Mesh(
      new THREE.BoxGeometry(34, 80, goal.hh * 2, 3, 6, 10),
      new THREE.MeshBasicMaterial({ color: '#ffffff', wireframe: true, transparent: true, opacity: 0.35 })
    );
    net.position.set(bx + side * 17, 40, 0);
    g.add(net);
  });
  scene.add(g);
  return g;
}

// ---- 合力打 Boss：巨无霸 ----
export function makeBoss() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const metal = std('#3a3f55', { metalness: 0.75, roughness: 0.3, emissive: '#ff2a2a', emissiveIntensity: 0 });
  const darkMetal = std('#22263a', { metalness: 0.8, roughness: 0.35 });
  const red = new THREE.MeshBasicMaterial({ color: '#ff3b3b' });
  body.add(mesh(new THREE.SphereGeometry(1, 40, 28), metal));
  // 肚子装甲
  const plate = mesh(new THREE.SphereGeometry(1.01, 32, 16, -0.9, 1.8, 1.3, 1.1), std('#5a6080', { metalness: 0.7, roughness: 0.25 }));
  body.add(plate);
  // 发光面罩 + 红眼
  const visor = new THREE.Mesh(new THREE.CylinderGeometry(1.04, 1.04, 0.32, 28, 1, true, -0.9, 1.8), std('#0e0f18', { metalness: 0.6, roughness: 0.15, side: THREE.DoubleSide }));
  visor.position.y = 0.38;
  body.add(visor);
  const eyes = [];
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.1, 0.06), red);
    const n = new THREE.Vector3(s * 0.33, 0.38, 0.95).normalize();
    e.position.copy(n).multiplyScalar(1.06);
    e.lookAt(n.multiplyScalar(3));
    e.rotation.z += s * -0.25;
    body.add(e);
    eyes.push(e);
  }
  // 犄角
  for (const s of [-1, 1]) {
    const horn = mesh(new THREE.ConeGeometry(0.18, 0.7, 10), std('#e8e2d0', { roughness: 0.4 }), s * 0.6, 0.95, 0.1);
    horn.rotation.z = -s * 0.55;
    horn.rotation.x = -0.2;
    body.add(horn);
  }
  // 带尖刺的保险杠
  const bumper = mesh(new THREE.TorusGeometry(0.98, 0.16, 12, 40), darkMetal);
  bumper.rotation.x = Math.PI / 2;
  bumper.position.y = -0.3;
  body.add(bumper);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const sp = mesh(new THREE.ConeGeometry(0.08, 0.3, 6), std('#c9cfdf', { metalness: 0.9, roughness: 0.2 }), Math.cos(a) * 1.14, -0.3, Math.sin(a) * 1.14);
    sp.rotation.z = -Math.PI / 2;
    sp.rotation.y = -a;
    body.add(sp);
  }
  // 牙
  for (let i = -2; i <= 2; i++) {
    const n = new THREE.Vector3(i * 0.12, 0.02, 1).normalize();
    const t = mesh(new THREE.ConeGeometry(0.05, 0.14, 4), std('#ffffff'));
    t.position.copy(n).multiplyScalar(0.99);
    t.rotation.x = Math.PI;
    body.add(t);
  }
  const iceMat = new THREE.MeshStandardMaterial({ color: '#c8f1ff', roughness: 0.05, transparent: true, opacity: 0.5, depthWrite: false, emissive: '#6fd6ff', emissiveIntensity: 0.3 });
  const ice = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.3, 2.4), iceMat);
  ice.visible = false;
  root.add(ice);
  // 砸地预警圈
  const warn = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 48), new THREE.MeshBasicMaterial({ color: '#ff3b3b', transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
  warn.rotation.x = -Math.PI / 2;
  warn.visible = false;
  const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color: '#ff3b3b', transparent: true, opacity: 0.22, depthWrite: false }));
  fill.rotation.x = -Math.PI / 2;
  fill.visible = false;
  // 累趴时头顶转圈的星星
  const stars = new THREE.Group();
  const starMat = new THREE.MeshBasicMaterial({ color: '#ffe066' });
  for (let i = 0; i < 5; i++) {
    const st = new THREE.Mesh(new THREE.OctahedronGeometry(0.13), starMat);
    const a = (i / 5) * Math.PI * 2;
    st.position.set(Math.cos(a) * 0.75, 0, Math.sin(a) * 0.75);
    stars.add(st);
  }
  stars.position.y = 1.45;
  stars.visible = false;
  root.add(stars);
  scene.add(root, warn, fill);
  return { root, body, metal, eyes, eyeMat: red, ice, stars, warn, fill, squash: 0, squashV: 0, flash: 0, y: 0, vy: 0 };
}

export function makeMinion() {
  const root = new THREE.Group();
  root.add(mesh(new THREE.SphereGeometry(1, 20, 14), std('#2a2230', { roughness: 0.5 })));
  for (let i = 0; i < 10; i++) {
    const n = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).normalize();
    const sp = mesh(new THREE.ConeGeometry(0.16, 0.5, 6), std('#4a3a55'));
    sp.position.copy(n).multiplyScalar(0.95);
    sp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    root.add(sp);
  }
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff3b3b' }));
    e.position.set(s * 0.32, 0.3, 0.88);
    root.add(e);
  }
  scene.add(root);
  return { root };
}

// ---- 烫手炸弹：挂在持有者头上，引信越短闪得越快 ----
export function makeHotBomb() {
  const g = new THREE.Group();
  const shell = std('#23202c', { metalness: 0.5, roughness: 0.35, emissive: '#ff2a00', emissiveIntensity: 0 });
  g.add(mesh(new THREE.SphereGeometry(16, 20, 14), shell));
  g.add(mesh(new THREE.CylinderGeometry(5, 5, 6, 10), std('#777777', { metalness: 0.8, roughness: 0.3 }), 0, 16, 0));
  const fuse = mesh(new THREE.CylinderGeometry(1.2, 1.2, 10, 6), std('#c9a36b'), 3, 22, 0);
  fuse.rotation.z = -0.4;
  g.add(fuse);
  const spark = new THREE.Mesh(new THREE.SphereGeometry(3.5, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffe066' }));
  spark.position.set(5, 27, 0);
  g.add(spark);
  const label = textSprite('10', { color: '#ffffff', size: 48, height: 20 });
  label.position.set(0, 44, 0);
  g.add(label);
  g.visible = false;
  scene.add(g);
  return { g, shell, spark, label, last: '' };
}

// ---- 领奖台 / 大厅展示台 ----
export function makePodium(h, color = '#6d5fc7', rank = 0) {
  const g = new THREE.Group();
  const top = mesh(new THREE.CylinderGeometry(42, 46, h, 32), std(color, { roughness: 0.4, metalness: 0.1 }), 0, h / 2, 0);
  top.receiveShadow = true;
  g.add(top);
  const trim = new THREE.Mesh(new THREE.TorusGeometry(43, 2.5, 8, 40), std('#ffd23f', { metalness: 0.7, roughness: 0.3, emissive: '#7a4a00', emissiveIntensity: 0.3 }));
  trim.rotation.x = Math.PI / 2;
  trim.position.y = h;
  g.add(trim);
  if (rank) {
    const num = textSprite(String(rank), { color: '#ffd23f', size: 64, height: 26 });
    num.position.set(0, h * 0.5, 48);
    num.material.depthTest = true;
    g.add(num);
  }
  scene.add(g);
  return g;
}

// 闯关的钥匙：金色大钥匙，带一圈光
export function makeKey() {
  const g = new THREE.Group();
  const gold = std('#ffcf4a', { metalness: 0.9, roughness: 0.22, emissive: '#8a5a00', emissiveIntensity: 0.5 });
  const bow = new THREE.Mesh(new THREE.TorusGeometry(9, 3.2, 10, 24), gold);
  bow.position.y = 10;
  g.add(bow);
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(4), std('#3fa7ff', { roughness: 0.1, emissive: '#1f6fff', emissiveIntensity: 0.6 }));
  gem.position.y = 10;
  g.add(gem);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 26, 10), gold);
  shaft.position.y = -10;
  g.add(shaft);
  for (const [y, w] of [
    [-19, 9],
    [-13, 6],
  ]) {
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(w, 4, 3), gold);
    tooth.position.set(w / 2, y, 0);
    g.add(tooth);
  }
  g.traverse((o) => o.isMesh && (o.castShadow = true));
  const halo = new THREE.Mesh(new THREE.RingGeometry(16, 22, 32), new THREE.MeshBasicMaterial({ color: '#ffe066', transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  g.add(halo);
  const root = new THREE.Group();
  root.add(g);
  scene.add(root);
  return { root, g, halo };
}

// 任务提示光柱：告诉大家下一步去哪
export function makeBeacon(color = '#ffe066') {
  const root = new THREE.Group();
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(22, 22, 260, 20, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  beam.position.y = 130;
  root.add(beam);
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(12, 22, 4), new THREE.MeshBasicMaterial({ color }));
  arrow.rotation.x = Math.PI;
  root.add(arrow);
  root.visible = false;
  scene.add(root);
  return { root, beam, arrow };
}

