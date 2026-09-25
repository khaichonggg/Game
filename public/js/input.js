// 输入：键盘（WASD / 方向键 + 空格冲刺）和手机虚拟摇杆
const keys = new Set();
let dashQueued = false;
const touchDir = { x: 0, y: 0 };
let lookDX = 0; // 第一人称：鼠标 / 右半屏拖动累计的转向量（像素）
let fpMode = () => false;
let active = () => false; // 当前是否在操控角色（由 main.js 设置）

const typing = (e) => e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');

window.addEventListener('keydown', (e) => {
  if (typing(e)) return;
  keys.add(e.code);
  if (!active()) return;
  if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyJ' || e.code === 'KeyK') {
    dashQueued = true;
    e.preventDefault();
  }
  if (e.code.startsWith('Arrow')) e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

// 摇杆：左半屏任意位置按下即出现
const stick = document.getElementById('stick');
const knob = document.getElementById('knob');
let stickTouch = null;
let origin = null;
const STICK_MAX = 50;

function resetStick() {
  stickTouch = null;
  touchDir.x = touchDir.y = 0;
  knob.style.transform = '';
  stick.style.left = '';
  stick.style.top = '';
  stick.style.bottom = '';
}

let lookTouch = null;
let lookX = 0;
window.addEventListener(
  'touchstart',
  (e) => {
    if (!active()) return;
    for (const t of e.changedTouches) {
      if (t.target.closest && t.target.closest('button, .hud-buttons, .emote-picker, .modal')) continue;
      if (t.clientX >= window.innerWidth * 0.55 && lookTouch === null && fpMode()) {
        lookTouch = t.identifier;
        lookX = t.clientX;
        continue;
      }
      if (t.clientX < window.innerWidth * 0.55 && stickTouch === null) {
        stickTouch = t.identifier;
        origin = { x: t.clientX, y: t.clientY };
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
      if (t.identifier === lookTouch) {
        lookDX += (t.clientX - lookX) * 1.6;
        lookX = t.clientX;
        continue;
      }
      if (t.identifier !== stickTouch) continue;
      let dx = t.clientX - origin.x;
      let dy = t.clientY - origin.y;
      const d = Math.hypot(dx, dy);
      if (d > STICK_MAX) {
        dx = (dx / d) * STICK_MAX;
        dy = (dy / d) * STICK_MAX;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      touchDir.x = dx / STICK_MAX;
      touchDir.y = dy / STICK_MAX;
    }
  },
  { passive: true }
);
const endTouch = (e) => {
  for (const t of e.changedTouches) {
    if (t.identifier === stickTouch) resetStick();
    if (t.identifier === lookTouch) lookTouch = null;
  }
};

// 电脑：按住鼠标拖动转向；点一下画面锁定鼠标后，直接移动鼠标也能转向
let dragLook = false;
window.addEventListener('mousedown', (e) => {
  if (fpMode() && active() && e.target && e.target.id === 'game') dragLook = true;
});
window.addEventListener('mouseup', () => (dragLook = false));
window.addEventListener('mousemove', (e) => {
  if (!fpMode()) return;
  if (document.pointerLockElement || (dragLook && e.buttons)) lookDX += e.movementX;
});
window.addEventListener('touchend', endTouch);
window.addEventListener('touchcancel', endTouch);

const dashBtn = document.getElementById('dashBtn');
dashBtn.addEventListener(
  'touchstart',
  (e) => {
    e.preventDefault();
    e.stopPropagation();
    dashQueued = true;
    if (navigator.vibrate) navigator.vibrate(15);
  },
  { passive: false }
);
dashBtn.addEventListener('mousedown', () => (dashQueued = true));

export const input = {
  setActive(fn) {
    active = fn;
  },
  setFirstPerson(fn) {
    fpMode = fn;
  },
  // 第一人称转向：返回 [-1,1] 的键盘转向 + 鼠标/拖动像素
  takeTurn() {
    let k = 0;
    if (keys.has('ArrowLeft') || keys.has('KeyQ')) k -= 1;
    if (keys.has('ArrowRight') || keys.has('KeyE')) k += 1;
    const px = lookDX;
    lookDX = 0;
    return { keys: k, px };
  },
  // fp=true 时方向键左右用来转向，不再左右平移
  read(fp = false) {
    let x = 0;
    let y = 0;
    if (keys.has('KeyA') || (!fp && keys.has('ArrowLeft'))) x -= 1;
    if (keys.has('KeyD') || (!fp && keys.has('ArrowRight'))) x += 1;
    if (keys.has('KeyW') || keys.has('ArrowUp')) y -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) y += 1;
    x += touchDir.x;
    y += touchDir.y;
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    return { x, y };
  },
  takeDash() {
    const d = dashQueued;
    dashQueued = false;
    return d;
  },
  reset() {
    keys.clear();
    dashQueued = false;
    lookDX = 0;
    lookTouch = null;
    resetStick();
  },
};
