// 本地保存的设置、昵称、角色外观和身份令牌
import { CHARACTERS, SKINS, HATS, COLORS } from './data.js';

const load = (k, d) => {
  try {
    const v = localStorage.getItem(k);
    return v ? JSON.parse(v) : d;
  } catch {
    return d;
  }
};
const save = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* 隐私模式等情况下无法保存，忽略 */
  }
};

const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

export const settings = Object.assign(
  { music: 0.5, sfx: 0.8, quality: isTouch ? 'medium' : 'high', shake: true, names: true, autoQuality: true },
  load('bb_settings', {})
);
export function saveSettings() {
  save('bb_settings', settings);
}

function randomProfile() {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  return { char: pick(CHARACTERS).id, skin: 'solid', color: pick(COLORS), hat: pick(HATS).id };
}
const stored = load('bb_profile', null);
export const profile = stored && CHARACTERS.some((c) => c.id === stored.char) ? stored : randomProfile();
if (!SKINS.some((s) => s.id === profile.skin)) profile.skin = 'solid';
export function saveProfile() {
  save('bb_profile', profile);
}

const NAMES = ['快乐豆', '弹弹怪', '冲冲冲', '圆滚滚', '撞墙王', '小旋风', '不倒翁', '铁头娃'];
export let playerName = load('bb_name', '') || NAMES[Math.floor(Math.random() * NAMES.length)] + Math.floor(Math.random() * 90 + 10);
export function setPlayerName(n) {
  playerName = String(n || '').trim().slice(0, 12) || playerName;
  save('bb_name', playerName);
}

// 身份令牌：断线重连 / 刷新页面时用来认出你。
// 存在 sessionStorage 里：同一个标签页刷新后还是你，另开一个标签页就是新玩家（方便一台电脑开两个窗口测试）
export const token = (() => {
  let t = null;
  try {
    t = sessionStorage.getItem('bb_token');
    if (!t) {
      t = Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem('bb_token', t);
    }
  } catch {
    t = Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  return t;
})();

// 当前所在房间（刷新页面后自动回到房间）
export const lastRoom = {
  get() {
    try {
      return sessionStorage.getItem('bb_room') || '';
    } catch {
      return '';
    }
  },
  set(code) {
    try {
      if (code) sessionStorage.setItem('bb_room', code);
      else sessionStorage.removeItem('bb_room');
    } catch {
      /* 忽略 */
    }
  },
};

export { isTouch };
