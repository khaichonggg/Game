// 粒子与特效：火花、烟尘、水花、扩散光环、漫画字
import * as THREE from 'three';
import { scene, camera, renderer, quality, textSprite, LIQUID_Y, onResize } from './core.js';

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
    if (this.list.length >= this.max * quality.particles) this.list.shift();
    this.list.push({ g: 0, drag: 0.9, size: 6, alpha: 1, grow: 0, vx: 0, vy: 0, vz: 0, ...o, rgb: hexRGB(o.color || '#ffffff'), max: o.life });
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

export const sparks = new Particles(2000, THREE.AdditiveBlending);
export const dust = new Particles(1000, THREE.NormalBlending);
const all = [sparks, dust];
onResize(() => {
  const scale = renderer.getDrawingBufferSize(new THREE.Vector2()).y / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  for (const p of all) p.mat.uniforms.uScale.value = scale;
});
export const clearParticles = () => all.forEach((p) => p.clear());

const count = (n) => Math.max(1, Math.round(n * quality.particles));

export function burst(x, y, z, color, n, speed = 200, size = 7, life = 0.45) {
  for (let i = 0; i < count(n); i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = speed * (0.4 + Math.random() * 0.6);
    sparks.add({ x, y, z, vx: Math.cos(a) * sp, vy: Math.random() * sp * 0.8 + 40, vz: Math.sin(a) * sp, life: life * (0.6 + Math.random() * 0.8), color, size, g: 500 });
  }
}
// 星形火花：受击时向四周放射
export function starBurst(x, y, z, color, n, speed) {
  for (let i = 0; i < count(n); i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.3;
    sparks.add({ x, y, z, vx: Math.cos(a) * speed, vy: 30 + Math.random() * 60, vz: Math.sin(a) * speed, life: 0.28, color, size: 10, g: 0, drag: 0.7 });
  }
}
export function splash(x, z, n, cols) {
  if (!cols) return;
  const pool = cols[0] === '#ff7a1a' ? sparks : dust;
  for (let i = 0; i < count(n); i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 60 + Math.random() * 140;
    pool.add({ x, y: LIQUID_Y + 2, z, vx: Math.cos(a) * sp, vy: 200 + Math.random() * 250, vz: Math.sin(a) * sp, life: 0.8 + Math.random() * 0.5, color: cols[i % cols.length], size: 9, g: 600, drag: 0.98 });
  }
}
export function puff(x, z, n, color = '#e8dcc4', y = 4) {
  for (let i = 0; i < count(n); i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 20 + Math.random() * 60;
    dust.add({ x: x + Math.cos(a) * 10, y, z: z + Math.sin(a) * 10, vx: Math.cos(a) * sp, vy: 15 + Math.random() * 20, vz: Math.sin(a) * sp, life: 0.35 + Math.random() * 0.3, color, size: 10, grow: 1.2, alpha: 0.35 });
  }
}
// 冲刺速度线
export function speedLines(x, y, z, vx, vz, color = '#ffffff') {
  const sp = Math.hypot(vx, vz) || 1;
  for (let i = 0; i < count(5); i++) {
    const off = (Math.random() - 0.5) * 30;
    sparks.add({ x: x - (vz / sp) * off, y: y + (Math.random() - 0.5) * 20, z: z + (vx / sp) * off, vx: -vx * 0.3, vy: 0, vz: -vz * 0.3, life: 0.25, color, size: 6, drag: 0.8 });
  }
}

// 扩散光环（炸弹冲击波 / 冰冻波 / 陨石落地 / Boss 砸地）
const rings = [];
export function ringWave(x, z, r, color = '#ffb347', dur = 0.45, y = 3) {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(0.8, 1, 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  scene.add(m);
  rings.push({ m, r, t: 0, dur });
}

// 漫画字："砰！" "KO!"
const pops = [];
const WORDS = ['砰!', '咚!', '啪!', '嘭!', 'POW!', 'BAM!'];
export function popText(x, y, z, text, color = '#ffd23f', size = 26) {
  // 镜头拉近后字会显得很大，整体缩小一些
  const s = textSprite(text || WORDS[Math.floor(Math.random() * WORDS.length)], { color, size: 64, stroke: '#2a1640', height: size * 0.62 });
  s.position.set(x, y, z);
  s.material.rotation = (Math.random() - 0.5) * 0.5;
  scene.add(s);
  pops.push({ s, t: 0, base: s.scale.clone() });
}

export function updateEffects(dt) {
  sparks.update(dt);
  dust.update(dt);
  for (let i = rings.length - 1; i >= 0; i--) {
    const s = rings[i];
    s.t += dt;
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
  for (let i = pops.length - 1; i >= 0; i--) {
    const p = pops[i];
    p.t += dt;
    const k = p.t / 0.9;
    const pop = k < 0.15 ? (k / 0.15) * 1.3 : k < 0.25 ? 1.3 - ((k - 0.15) / 0.1) * 0.3 : 1;
    p.s.scale.copy(p.base).multiplyScalar(pop);
    p.s.position.y += dt * 30;
    p.s.material.opacity = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
    if (k >= 1) {
      scene.remove(p.s);
      p.s.material.map.dispose();
      p.s.material.dispose();
      pops.splice(i, 1);
    }
  }
}
