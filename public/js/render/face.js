// 角色的脸：画在一块贴合球面的"面具"上（canvas 贴图），换贴图就换表情。
// 大眼睛 + 高光 + 腮红 + 小嘴巴，比立体零件拼出来的脸更可爱、更干净。
import * as THREE from 'three';
import { markShared } from './core.js';

const W = 400;
const H = 316;
const PHI = 1.95; // 面具横向覆盖的角度（弧度）
const T0 = 0.62; // 从头顶往下量的起止角度
const T1 = 2.18;
const DEG = 180 / Math.PI;
const DX = W / (PHI * DEG); // 每度多少像素
const DY = H / ((T1 - T0) * DEG);
const px = (az) => W / 2 + az * DX;
const py = (el) => (90 - el - T0 * DEG) * DY;

// 面具几何体：半径略大于身体，正对 +z
export const faceGeo = markShared(new THREE.SphereGeometry(1.012, 40, 32, Math.PI / 2 - PHI / 2, PHI, T0, T1 - T0));
// 从脸的角度（左右 az、上下 el，单位度）换算成身体表面的方向，给鸟嘴、牙齿之类的立体零件定位
export function faceDir(az, el) {
  const a = az / DEG;
  const e = el / DEG;
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
}

const INK = '#2a1a33';
const IRIS = { bean: '#b0673a', cat: '#3fbf5a', dino: '#e0901c', penguin: '#4a6ad0', chick: '#8a5a2a', panda: '#8a6a5a', bunny: '#e0447a', robot: '#4ff0ff' };

// 眼睛位置
const EYE_AZ = 16.5;
const EYE_EL = 11;
const ERX = 9.8 * DX;
const ERY = 12.6 * DY;

function ellipse(g, x, y, rx, ry, rot = 0) {
  g.beginPath();
  g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
}
function stroke(g, w, color = INK) {
  g.lineWidth = w;
  g.strokeStyle = color;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.stroke();
}

// 睁开的大眼睛：上深下亮的渐变 + 一大一小两个高光 + 一颗小星星
function eyeOpen(g, x, y, iris, k = 1, dark = '#1b1026') {
  const rx = ERX * k;
  const ry = ERY * k;
  const grad = g.createLinearGradient(0, y - ry, 0, y + ry);
  grad.addColorStop(0, dark);
  grad.addColorStop(0.5, dark);
  grad.addColorStop(1, iris);
  ellipse(g, x, y, rx, ry);
  g.fillStyle = grad;
  g.fill();
  g.fillStyle = '#ffffff';
  ellipse(g, x - rx * 0.3, y - ry * 0.34, rx * 0.4, ry * 0.32, -0.3);
  g.fill();
  ellipse(g, x + rx * 0.38, y + ry * 0.32, rx * 0.17, ry * 0.14);
  g.fill();
  g.globalAlpha = 0.9;
  ellipse(g, x + rx * 0.4, y - ry * 0.5, rx * 0.09, ry * 0.08);
  g.fill();
  g.globalAlpha = 1;
}
// 开心：^ ^
function eyeHappy(g, x, y, color = INK) {
  g.beginPath();
  g.arc(x, y + ERY * 0.45, ERX * 0.95, Math.PI * 1.15, Math.PI * 1.85);
  stroke(g, 9, color);
}
// 眨眼 / 闭眼：‿
function eyeClosed(g, x, y, color = INK) {
  g.beginPath();
  g.arc(x, y - ERY * 0.35, ERX * 0.85, Math.PI * 0.2, Math.PI * 0.8);
  stroke(g, 8, color);
}
// 晕了：蚊香眼
function eyeSpiral(g, x, y, color = INK) {
  g.beginPath();
  for (let a = 0; a < Math.PI * 5; a += 0.2) {
    const r = (a / (Math.PI * 5)) * ERX * 0.95;
    const X = x + Math.cos(a) * r;
    const Y = y + Math.sin(a) * r * (ERY / ERX);
    if (a === 0) g.moveTo(X, Y);
    else g.lineTo(X, Y);
  }
  stroke(g, 5, color);
}
function brows(g, kind, color = INK) {
  for (const s of [-1, 1]) {
    const x = px(s * EYE_AZ);
    const y = py(EYE_EL + 15);
    g.beginPath();
    if (kind === 'angry') {
      g.moveTo(x - s * 16, y - 6);
      g.lineTo(x + s * 12, y + 5);
    } else {
      g.moveTo(x - s * 14, y + 5);
      g.lineTo(x + s * 12, y - 5);
    }
    stroke(g, 7, color);
  }
}
function cheeks(g, color = '#ff7fa6', alpha = 0.55) {
  for (const s of [-1, 1]) {
    const x = px(s * 30);
    const y = py(-3);
    const gr = g.createRadialGradient(x, y, 0, x, y, 30);
    gr.addColorStop(0, color);
    gr.addColorStop(1, 'rgba(255,127,166,0)');
    g.globalAlpha = alpha;
    g.fillStyle = gr;
    ellipse(g, x, y, 30, 20);
    g.fill();
    g.globalAlpha = 1;
  }
}
function sweat(g) {
  const x = px(31);
  const y = py(22);
  g.beginPath();
  g.moveTo(x, y - 16);
  g.quadraticCurveTo(x + 11, y + 2, x, y + 8);
  g.quadraticCurveTo(x - 11, y + 2, x, y - 16);
  g.fillStyle = '#8ad8ff';
  g.fill();
  stroke(g, 3, '#3a7ab0');
}

// 嘴巴
const MY = py(-5);
function mouth(g, kind, color = INK) {
  const x = W / 2;
  const y = MY;
  switch (kind) {
    case 'open': {
      g.beginPath();
      g.moveTo(x - 19, y - 5);
      g.quadraticCurveTo(x, y + 30, x + 19, y - 5);
      g.closePath();
      g.fillStyle = '#5a1830';
      g.fill();
      g.save();
      g.clip();
      g.fillStyle = '#ff7b9c';
      ellipse(g, x, y + 16, 13, 9);
      g.fill();
      g.restore();
      g.beginPath();
      g.moveTo(x - 19, y - 5);
      g.quadraticCurveTo(x, y + 30, x + 19, y - 5);
      g.closePath();
      stroke(g, 5, color);
      break;
    }
    case 'oh':
      ellipse(g, x, y + 4, 9, 12);
      g.fillStyle = '#5a1830';
      g.fill();
      stroke(g, 4, color);
      break;
    case 'cat':
      g.beginPath();
      g.arc(x - 9, y - 2, 9, Math.PI * 0.1, Math.PI * 0.95);
      g.moveTo(x + 18, y - 1);
      g.arc(x + 9, y - 2, 9, Math.PI * 0.05, Math.PI * 0.9);
      stroke(g, 5, color);
      break;
    case 'flat':
      g.beginPath();
      g.moveTo(x - 10, y + 2);
      g.lineTo(x + 10, y);
      stroke(g, 6, color);
      break;
    case 'wavy':
      g.beginPath();
      g.moveTo(x - 16, y + 2);
      for (let i = 1; i <= 4; i++) g.lineTo(x - 16 + i * 8, y + (i % 2 ? -4 : 3));
      stroke(g, 5, color);
      break;
    case 'frown':
      g.beginPath();
      g.arc(x, y + 14, 12, Math.PI * 1.2, Math.PI * 1.8);
      stroke(g, 6, color);
      break;
    case 'grin': {
      // 小恐龙：咧嘴笑 + 一颗小尖牙
      g.beginPath();
      g.arc(x, y - 10, 20, Math.PI * 0.18, Math.PI * 0.82);
      stroke(g, 6, color);
      g.beginPath();
      g.moveTo(x + 5, y + 7);
      g.lineTo(x + 11, y + 16);
      g.lineTo(x + 15, y + 5);
      g.fillStyle = '#ffffff';
      g.fill();
      stroke(g, 2.5, color);
      break;
    }
    default:
      g.beginPath();
      g.arc(x, y - 7, 12, Math.PI * 0.18, Math.PI * 0.82);
      stroke(g, 6, color);
  }
}

// 各角色的脸部特征（画在眼睛下面 / 上面）
function under(g, char) {
  if (char === 'panda') {
    g.fillStyle = '#1d1b24';
    for (const s of [-1, 1]) {
      ellipse(g, px(s * (EYE_AZ + 1)), py(EYE_EL - 1), 14 * DX, 15.5 * DY, s * 0.55);
      g.fill();
    }
  }
  if (char === 'penguin') {
    // 白色心形脸
    g.fillStyle = '#ffffff';
    for (const s of [-1, 1]) {
      ellipse(g, px(s * 16), py(10), 19 * DX, 20 * DY);
      g.fill();
    }
    ellipse(g, px(0), py(-4), 26 * DX, 17 * DY);
    g.fill();
  }
  if (char === 'robot') {
    // 屏幕脸
    const x0 = px(-31);
    const x1 = px(31);
    const y0 = py(31);
    const y1 = py(-20);
    const r = 34;
    g.beginPath();
    g.roundRect(x0, y0, x1 - x0, y1 - y0, r);
    const gr = g.createLinearGradient(0, y0, 0, y1);
    gr.addColorStop(0, '#26305a');
    gr.addColorStop(1, '#0c1022');
    g.fillStyle = gr;
    g.fill();
    stroke(g, 8, '#9aa3c2');
    g.save();
    g.clip();
    g.globalAlpha = 0.12;
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(x0, y0 + 30);
    g.lineTo(x0 + 90, y0);
    g.lineTo(x0 + 130, y0);
    g.lineTo(x0, y0 + 80);
    g.fill();
    g.restore();
    g.globalAlpha = 1;
  }
}
function over(g, char, state) {
  if (char === 'cat') {
    // 粉鼻子 + 胡须
    g.beginPath();
    g.moveTo(W / 2 - 7, py(1.5));
    g.lineTo(W / 2 + 7, py(1.5));
    g.lineTo(W / 2, py(-1.5));
    g.closePath();
    g.fillStyle = '#ff8fb0';
    g.fill();
    stroke(g, 2.5);
    for (const s of [-1, 1]) {
      for (const k of [-1, 0, 1]) {
        g.beginPath();
        g.moveTo(px(s * 25), py(-1 + k * 2));
        g.lineTo(px(s * 35), py(-1 + k * 4));
        stroke(g, 2.5, 'rgba(42,26,51,0.75)');
      }
    }
  }
  if (char === 'bunny') {
    g.fillStyle = '#ff8fb0';
    ellipse(g, W / 2, py(0.5), 7, 5);
    g.fill();
    if (state !== 'happy' && state !== 'run' && state !== 'scared') {
      // 两颗门牙
      g.beginPath();
      g.roundRect(W / 2 - 9, MY + 1, 18, 13, 3);
      g.fillStyle = '#ffffff';
      g.fill();
      stroke(g, 2.5);
      g.beginPath();
      g.moveTo(W / 2, MY + 1);
      g.lineTo(W / 2, MY + 14);
      stroke(g, 2);
    }
  }
  if (char === 'panda') {
    g.beginPath();
    g.ellipse(W / 2, py(1), 9, 6, 0, 0, Math.PI * 2);
    g.fillStyle = '#1d1b24';
    g.fill();
  }
}

// state: normal / blink / happy / run / scared / dizzy / angry / sad / frozen
function draw(g, char, state) {
  g.clearRect(0, 0, W, H);
  const robot = char === 'robot';
  const iris = IRIS[char] || '#8a5a2a';
  const ink = robot ? '#4ff0ff' : INK;
  under(g, char);
  if (robot) {
    g.shadowColor = '#4ff0ff';
    g.shadowBlur = 16;
  }
  const lx = px(-EYE_AZ);
  const rx = px(EYE_AZ);
  const ey = py(EYE_EL);
  const pandaDark = char === 'panda' ? '#3a2a33' : '#1b1026';
  const eyeInk = char === 'panda' ? '#f4f0ff' : ink; // 熊猫的眼圈是黑的，闭眼线要用浅色
  const open = (k = 1) => {
    if (robot) {
      for (const x of [lx, rx]) {
        g.beginPath();
        g.roundRect(x - ERX * 0.55 * k, ey - ERY * 0.75 * k, ERX * 1.1 * k, ERY * 1.5 * k, 14);
        g.fillStyle = '#4ff0ff';
        g.fill();
        g.fillStyle = '#e8ffff';
        ellipse(g, x - ERX * 0.15, ey - ERY * 0.35, ERX * 0.18, ERY * 0.16);
        g.fill();
      }
    } else {
      eyeOpen(g, lx, ey, iris, k, pandaDark);
      eyeOpen(g, rx, ey, iris, k, pandaDark);
    }
  };
  const noMouth = char === 'penguin' || char === 'chick';
  const baseMouth = char === 'cat' ? 'cat' : char === 'dino' ? 'grin' : 'smile';
  switch (state) {
    case 'blink':
      eyeClosed(g, lx, ey, eyeInk);
      eyeClosed(g, rx, ey, eyeInk);
      if (!noMouth) mouth(g, baseMouth, ink);
      break;
    case 'happy':
      eyeHappy(g, lx, ey, eyeInk);
      eyeHappy(g, rx, ey, eyeInk);
      if (!noMouth) mouth(g, 'open', ink);
      break;
    case 'run':
      open(1);
      brows(g, 'angry', eyeInk);
      if (!noMouth) mouth(g, 'open', ink);
      break;
    case 'scared':
      open(0.9);
      brows(g, 'worried', eyeInk);
      if (!noMouth) mouth(g, 'oh', ink);
      if (!robot) sweat(g);
      break;
    case 'dizzy':
      eyeSpiral(g, lx, ey, eyeInk);
      eyeSpiral(g, rx, ey, eyeInk);
      if (!noMouth) mouth(g, 'wavy', ink);
      break;
    case 'angry':
      open(0.9);
      brows(g, 'angry', eyeInk);
      if (!noMouth) mouth(g, 'flat', ink);
      break;
    case 'sad':
      open(1);
      brows(g, 'worried', eyeInk);
      if (!noMouth) mouth(g, 'frown', ink);
      break;
    case 'frozen':
      eyeClosed(g, lx, ey, robot ? ink : char === 'panda' ? '#bfe6ff' : '#3a6a9a');
      eyeClosed(g, rx, ey, robot ? ink : char === 'panda' ? '#bfe6ff' : '#3a6a9a');
      if (!noMouth) mouth(g, 'wavy', robot ? ink : '#3a6a9a');
      break;
    default:
      open(1);
      if (!noMouth) mouth(g, baseMouth, ink);
  }
  g.shadowBlur = 0;
  if (state !== 'dizzy') over(g, char, state);
  cheeks(g, state === 'frozen' ? '#8ad8ff' : '#ff7fa6', robot ? 0.8 : char === 'panda' ? 0.45 : 0.55);
}

const cache = new Map();
export function faceTexture(char, state) {
  const key = char + ':' + state;
  let t = cache.get(key);
  if (!t) {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    draw(c.getContext('2d'), char, state);
    t = markShared(new THREE.CanvasTexture(c));
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    cache.set(key, t);
  }
  return t;
}

// 肚皮：一块柔和的浅色椭圆（同样贴在球面上，不会穿模）
export const bellyGeo = markShared(new THREE.SphereGeometry(1.006, 32, 20, Math.PI / 2 - 0.75, 1.5, 1.68, 1.15));
let bellyTex = null;
export function bellyTexture() {
  if (bellyTex) return bellyTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 58, 10, 64, 58, 62);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.72, 'rgba(255,255,255,1)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.beginPath();
  g.ellipse(64, 58, 62, 58, 0, 0, Math.PI * 2);
  g.fill();
  bellyTex = markShared(new THREE.CanvasTexture(c));
  bellyTex.colorSpace = THREE.SRGBColorSpace;
  return bellyTex;
}
