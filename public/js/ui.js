// 界面小工具：切换页面、弹窗、通知、头像等
import { t as tr } from './i18n.js';
import { charInfo, EMOTES } from './data.js';
import { STICKERS, stickerSVG } from './stickers.js';
import { sfx } from './audio.js';

export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// 页面：menu / wardrobe / rooms / lobby / game / results / board / help
const SCREENS = ['menu', 'wardrobe', 'rooms', 'lobby', 'results', 'board', 'help'];
export let current = 'menu';
export function show(name) {
  current = name;
  for (const s of SCREENS) $('scr-' + s).classList.toggle('hidden', s !== name);
  $('hud').classList.toggle('hidden', name !== 'game');
  document.body.dataset.screen = name;
  hideEmotes();
}

// 头像：角色图标 + 身体颜色
export function avatarHTML(profile, cls = '') {
  const c = charInfo(profile && profile.char);
  const col = (profile && profile.color) || '#888';
  return `<span class="avatar ${cls}" style="background:${esc(col)}">${c.icon}</span>`;
}

// 顶部通知
export function notice(text, err = false) {
  const el = document.createElement('div');
  el.className = 'notice' + (err ? ' err' : '');
  el.textContent = text;
  $('notice').appendChild(el);
  if (err) sfx.error();
  setTimeout(() => (el.style.opacity = '0'), 2600);
  setTimeout(() => el.remove(), 3100);
  const all = $('notice').children;
  while (all.length > 4) all[0].remove();
}

// 弹窗：actions = [{ label, cls, onClick, keep }]
let modalOnClose = null;
export function modal({ title, body = '', actions = [{ label: tr('好的'), cls: 'btn-yellow' }], onClose = null, dismissable = true }) {
  $('modalTitle').textContent = title;
  const b = $('modalBody');
  b.innerHTML = '';
  if (typeof body === 'string') b.innerHTML = body;
  else if (body) b.appendChild(body);
  const act = $('modalActions');
  act.innerHTML = '';
  for (const a of actions) {
    const btn = document.createElement('button');
    btn.className = 'btn ' + (a.cls || 'btn-ghost');
    btn.innerHTML = a.label;
    btn.onclick = () => {
      if (!a.keep) closeModal(true);
      if (a.onClick) a.onClick();
    };
    act.appendChild(btn);
  }
  modalOnClose = onClose;
  $('modal').dataset.dismissable = dismissable ? '1' : '';
  $('modal').classList.remove('hidden');
  const inp = b.querySelector('input[type=text]');
  if (inp) setTimeout(() => inp.focus(), 50);
}
export function closeModal(silent = false) {
  if ($('modal').classList.contains('hidden')) return;
  $('modal').classList.add('hidden');
  const fn = modalOnClose;
  modalOnClose = null;
  if (fn && !silent) fn();
}
export const modalOpen = () => !$('modal').classList.contains('hidden');
$('modal').addEventListener('click', (e) => {
  if (e.target === $('modal') && $('modal').dataset.dismissable) closeModal();
});

// 表情选择：😀 表情 / 🖼️ 贴图 / ✨ 动图
let emoteSend = null;
let stickerSend = null;
let emoteTab = 'emoji';
try {
  emoteTab = localStorage.getItem('bb_emote_tab') || 'emoji';
} catch {
  /* 无痕模式 */
}
function renderPicker() {
  const el = $('emotePicker');
  const tabs = [
    ['emoji', tr('😀 表情')],
    ['static', tr('🖼️ 贴图')],
    ['anim', tr('✨ 动图')],
  ];
  const head = `<div class="emote-tabs">${tabs.map(([k, l]) => `<button class="tab ${emoteTab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>`;
  let body;
  if (emoteTab === 'emoji') body = EMOTES.map((e, i) => `<button data-i="${i}">${e}<small>${i + 1}</small></button>`).join('');
  else {
    body = STICKERS.filter((st) => !!st.anim === (emoteTab === 'anim'))
      .map((st) => `<button data-s="${st.id}" title="${st.name}">${stickerSVG(st.id)}</button>`)
      .join('');
    body += `<div class="stk-hint">${tr('按 T 快速发送上一次用的贴图')}</div>`;
  }
  el.classList.toggle('stickers', emoteTab !== 'emoji');
  el.innerHTML = head + body;
}
export function initEmotes(send, sendSticker) {
  emoteSend = send;
  stickerSend = sendSticker;
  const el = $('emotePicker');
  renderPicker();
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tab) {
      emoteTab = b.dataset.tab;
      try {
        localStorage.setItem('bb_emote_tab', emoteTab);
      } catch {
        /* 无痕模式 */
      }
      renderPicker();
      return;
    }
    if (b.dataset.s) stickerSend(b.dataset.s);
    else emoteSend(Number(b.dataset.i));
    hideEmotes();
  });
  document.addEventListener('pointerdown', (e) => {
    if (el.classList.contains('hidden')) return;
    if (!e.target.closest('#emotePicker, #btnEmote, #btnEmoteLobby, #btnEmoteRes')) hideEmotes();
  });
}
export function toggleEmotes(anchor) {
  const el = $('emotePicker');
  if (!el.classList.contains('hidden')) return hideEmotes();
  el.classList.remove('hidden');
  if (anchor && (current === 'lobby' || current === 'results')) {
    const r = anchor.getBoundingClientRect();
    renderPicker();
    el.style.left = Math.max(8, Math.min(window.innerWidth - el.offsetWidth - 8, r.left)) + 'px';
    el.style.top = Math.max(8, r.top - el.offsetHeight - 8) + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  } else {
    renderPicker();
    el.style.left = el.style.top = el.style.right = el.style.bottom = '';
  }
}
export function hideEmotes() {
  $('emotePicker').classList.add('hidden');
}

// 复制文字（http 局域网地址下 clipboard API 可能不可用，退回老办法）
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

// 只在内容变化时改 DOM，避免 30Hz 刷新导致闪烁 / 点不中
const htmlCache = new WeakMap();
export function setHTML(el, html) {
  if (htmlCache.get(el) === html) return false;
  htmlCache.set(el, html);
  el.innerHTML = html;
  return true;
}
