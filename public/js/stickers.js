// 贴图 / 动图表情包：全部用 SVG 画出来（不需要图片文件），动图靠 style.css 里的 .stk-* 动画
// id 要和 server/catalog.js 里的 STICKERS 一致
import { t as tr } from './i18n.js';

const INK = '#2a1640';
let uid = 0;

// ---------- 小零件 ----------
const eyes = {
  dot: (y = 52) => `<g class="stk-blink"><circle cx="47" cy="${y}" r="5.5" fill="${INK}"/><circle cx="73" cy="${y}" r="5.5" fill="${INK}"/><circle cx="49" cy="${y - 2}" r="1.8" fill="#fff"/><circle cx="75" cy="${y - 2}" r="1.8" fill="#fff"/></g>`,
  happy: () => `<path d="M40 54 Q47 45 54 54 M66 54 Q73 45 80 54" stroke="${INK}" stroke-width="4.5" fill="none" stroke-linecap="round"/>`,
  laugh: () => `<path d="M40 46 L52 52 L40 58 M80 46 L68 52 L80 58" stroke="${INK}" stroke-width="4.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  smug: () => `<path d="M40 52 h13 M67 52 h13" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/><path d="M42 53 a5 4 0 0 0 10 0 M69 53 a5 4 0 0 0 10 0" fill="${INK}"/>`,
  wink: () => `<circle cx="47" cy="52" r="5.5" fill="${INK}"/><circle cx="49" cy="50" r="1.8" fill="#fff"/><path d="M66 53 Q73 46 80 53" stroke="${INK}" stroke-width="4.5" fill="none" stroke-linecap="round"/>`,
  angry: () => `${eyes.dot(55)}<path d="M38 42 L55 49 M82 42 L65 49" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`,
  sad: () => `${eyes.dot(55)}<path d="M39 47 L53 42 M81 47 L67 42" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>`,
  x: () => `<path d="M42 47 l10 10 M52 47 l-10 10 M68 47 l10 10 M78 47 l-10 10" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>`,
  shades: () => `<path d="M34 46 h52 v3 h-2 q-1 12 -12 12 h-4 q-9 0 -10 -10 h-4 q-1 10 -10 10 h-4 q-11 0 -12 -12 h-2z" fill="${INK}"/><path d="M40 50 l6 0 M70 50 l6 0" stroke="#8ad8ff" stroke-width="3" stroke-linecap="round"/>`,
  wide: () => `<circle cx="46" cy="51" r="9" fill="#fff" stroke="${INK}" stroke-width="3"/><circle cx="74" cy="51" r="9" fill="#fff" stroke="${INK}" stroke-width="3"/><circle cx="48" cy="52" r="4" fill="${INK}"/><circle cx="72" cy="52" r="4" fill="${INK}"/>`,
};
const mouths = {
  laugh: () => `<path d="M44 64 Q60 90 76 64 Z" fill="#7a1f3d" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/><path d="M52 76 Q60 71 68 76 Q60 84 52 76" fill="#ff7b9c"/>`,
  smile: () => `<path d="M48 66 Q60 77 72 66" stroke="${INK}" stroke-width="4.5" fill="none" stroke-linecap="round"/>`,
  smirk: () => `<path d="M48 70 Q64 72 74 62" stroke="${INK}" stroke-width="4.5" fill="none" stroke-linecap="round"/>`,
  tongue: (anim = true) => `<path d="M46 66 Q60 76 74 66" stroke="${INK}" stroke-width="4.5" fill="none" stroke-linecap="round"/><g class="${anim ? 'stk-tongue' : ''}"><path d="M53 70 h14 v8 a7 7 0 0 1 -14 0z" fill="#ff6f91" stroke="${INK}" stroke-width="3"/><path d="M60 71 v8" stroke="#d94770" stroke-width="2"/></g>`,
  frown: () => `<path d="M48 74 Q60 64 72 74" stroke="${INK}" stroke-width="4.5" fill="none" stroke-linecap="round"/>`,
  wail: () => `<path d="M47 76 Q60 58 73 76 Q60 70 47 76Z" fill="#7a1f3d" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>`,
  grit: () => `<rect x="45" y="64" width="30" height="12" rx="4" fill="#fff" stroke="${INK}" stroke-width="3.5"/><path d="M52 64 v12 M60 64 v12 M68 64 v12 M45 70 h30" stroke="${INK}" stroke-width="2"/>`,
  grin: () => `<path d="M44 64 Q60 84 76 64 Z" fill="#fff" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/><path d="M47 68 h26" stroke="${INK}" stroke-width="2"/>`,
  o: () => `<ellipse cx="60" cy="70" rx="6" ry="7" fill="#7a1f3d" stroke="${INK}" stroke-width="3.5"/>`,
  wobbly: () => `<path d="M46 70 q4 -5 7 0 t7 0 t7 0 t7 0" stroke="${INK}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
};

// 圆滚滚的球身（游戏里角色的样子）
function blob(color, face, { y = 0, extra = '', cls = '' } = {}) {
  const id = 'g' + ++uid;
  return `<g transform="translate(0 ${y})"><g class="${cls}">
    <defs><radialGradient id="${id}" cx="0.35" cy="0.3" r="0.75"><stop offset="0" stop-color="#fff" stop-opacity="0.55"/><stop offset="0.35" stop-color="${color}"/><stop offset="1" stop-color="${color}" stop-opacity="1"/></radialGradient></defs>
    <ellipse cx="60" cy="96" rx="26" ry="5" fill="#000" opacity="0.18"/>
    <circle cx="60" cy="58" r="34" fill="url(#${id})" stroke="${INK}" stroke-width="4"/>
    <ellipse cx="47" cy="38" rx="9" ry="5" fill="#fff" opacity="0.55" transform="rotate(-25 47 38)"/>
    ${face}${extra}</g></g>`;
}
const cheeks = `<ellipse cx="38" cy="64" rx="6" ry="3.5" fill="#ff6f91" opacity="0.6"/><ellipse cx="82" cy="64" rx="6" ry="3.5" fill="#ff6f91" opacity="0.6"/>`;
const hand = (x, y, color, cls = '', r = 0) => `<g class="${cls}" style="transform-origin:${x}px ${y + 8}px"><g transform="rotate(${r} ${x} ${y})"><circle cx="${x}" cy="${y}" r="8" fill="${color}" stroke="${INK}" stroke-width="3.5"/></g></g>`;

// 贴图文字：白字深色描边
function caption(text, { size = 21, color = '#fff', cls = '', y = 112 } = {}) {
  const s = text.length > 6 ? Math.round(size * 6.2 / text.length) : size;
  return `<g class="${cls}"><text x="60" y="${y}" text-anchor="middle" font-size="${s}" font-weight="900" fill="${color}" stroke="${INK}" stroke-width="6" stroke-linejoin="round" paint-order="stroke" font-family="inherit">${text}</text></g>`;
}

// ---------- 贴图列表 ----------
// anim: 动图；act: 角色做的动作；snd: 音效
const DEFS = [
  // ===== 动图 =====
  {
    id: 'lol', anim: true, act: 'laugh', snd: 'laugh', zh: '哈哈哈', en: 'LOL',
    art: () => blob('#ffd23f', eyes.laugh() + mouths.laugh(), {
      cls: 'stk-shake',
      extra: `<g class="stk-tear-l"><path d="M34 50 q-10 2 -12 10 q8 1 12 -10z" fill="#6ed3ff" stroke="${INK}" stroke-width="2"/></g><g class="stk-tear-r"><path d="M86 50 q10 2 12 10 q-8 1 -12 -10z" fill="#6ed3ff" stroke="${INK}" stroke-width="2"/></g>`,
    }),
  },
  {
    id: 'bleh', anim: true, act: 'wiggle', snd: 'bleh', zh: '略略略', en: 'Bleh~',
    art: () => blob('#ff8c42', eyes.wink() + mouths.tongue(), {
      cls: 'stk-sway',
      extra: `${hand(22, 44, '#ff8c42', 'stk-wave')}${hand(98, 44, '#ff8c42', 'stk-wave stk-delay')}`,
    }),
  },
  {
    id: 'catch', anim: true, act: 'spin', snd: 'boing', zh: '来追我呀', en: 'Catch me!',
    art: () => `<g class="stk-puff"><circle cx="16" cy="92" r="7" fill="#e7e1ff" stroke="${INK}" stroke-width="2.5"/><circle cx="6" cy="84" r="4" fill="#e7e1ff" stroke="${INK}" stroke-width="2"/></g>` +
      blob('#3fa7ff', eyes.happy() + mouths.tongue(false), {
        cls: 'stk-hop',
        extra: `<g class="stk-run"><ellipse cx="48" cy="94" rx="9" ry="5" fill="#3fa7ff" stroke="${INK}" stroke-width="3"/></g><g class="stk-run stk-delay"><ellipse cx="72" cy="94" rx="9" ry="5" fill="#3fa7ff" stroke="${INK}" stroke-width="3"/></g><path d="M100 40 h12 M104 52 h14 M100 64 h10" stroke="${INK}" stroke-width="3" stroke-linecap="round" opacity="0.5"/>`,
      }),
  },
  {
    id: 'bye', anim: true, act: 'wave', snd: 'bye', zh: '拜拜了您嘞', en: 'Bye bye~',
    art: () => blob('#ff6fb5', eyes.happy() + mouths.smile() + cheeks, { extra: hand(96, 36, '#ff6fb5', 'stk-wave') }),
  },
  {
    id: 'cry', anim: true, act: 'sulk', snd: 'cry', zh: '呜呜呜', en: 'Waaah',
    art: () => blob('#8ad8ff', eyes.sad() + mouths.wail(), {
      extra: `<g class="stk-drip"><path d="M44 60 q-3 8 0 12 q3 -4 0 -12z" fill="#3fa7ff"/></g><g class="stk-drip stk-delay"><path d="M76 60 q-3 8 0 12 q3 -4 0 -12z" fill="#3fa7ff"/></g><path d="M40 62 v26 M80 62 v26" stroke="#3fa7ff" stroke-width="5" stroke-linecap="round" opacity="0.7" class="stk-stream"/>`,
    }),
  },
  {
    id: 'mad', anim: true, act: 'stomp', snd: 'mad', zh: '气死我了', en: 'So mad!',
    art: () => `<g class="stk-steam"><circle cx="30" cy="22" r="7" fill="#fff" opacity="0.9"/><circle cx="22" cy="14" r="5" fill="#fff" opacity="0.8"/></g><g class="stk-steam stk-delay"><circle cx="90" cy="22" r="7" fill="#fff" opacity="0.9"/><circle cx="98" cy="14" r="5" fill="#fff" opacity="0.8"/></g>` +
      blob('#ff5a5f', eyes.angry() + mouths.grit(), { cls: 'stk-rattle', extra: `<path d="M84 30 l6 -2 l-2 6 l6 -2" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"/>` }),
  },
  {
    id: 'rip', anim: true, act: 'sulk', snd: 'rip', zh: '安息吧', en: 'R.I.P.',
    art: () => `<path d="M28 96 v-44 a32 32 0 0 1 64 0 v44z" fill="#b8b3d6" stroke="${INK}" stroke-width="4"/><text x="60" y="68" text-anchor="middle" font-size="18" font-weight="900" fill="${INK}" font-family="inherit">RIP</text><path d="M20 96 h80" stroke="#3ddc84" stroke-width="6" stroke-linecap="round"/>
      <g class="stk-float"><path d="M80 44 q0 -18 14 -18 q14 0 14 18 v14 l-5 -4 l-4 4 l-5 -4 l-5 4 l-5 -4z" fill="#fff" stroke="${INK}" stroke-width="3" opacity="0.95"/><circle cx="89" cy="38" r="2.5" fill="${INK}"/><circle cx="99" cy="38" r="2.5" fill="${INK}"/><ellipse cx="94" cy="46" rx="3" ry="3.5" fill="${INK}"/></g>`,
  },
  {
    id: 'clown', anim: true, act: 'hop', snd: 'honk', zh: '小丑竟是我', en: "I'm the clown",
    art: () => blob('#f2f2f2', eyes.x() + mouths.grin(), {
      extra: `<circle cx="32" cy="30" r="10" fill="#ff5a5f"/><circle cx="24" cy="42" r="8" fill="#ffd23f"/><circle cx="88" cy="30" r="10" fill="#3fa7ff"/><circle cx="96" cy="42" r="8" fill="#3ddc84"/><g class="stk-honk"><circle cx="60" cy="61" r="7" fill="#ff3b4a" stroke="${INK}" stroke-width="3"/></g>`,
    }),
  },
  {
    id: 'boom', anim: true, act: 'cheer', snd: 'boom', zh: '看我大招', en: 'Ultimate!',
    art: () => `<g class="stk-burst"><path d="M60 2 l9 22 l22 -12 l-6 24 l24 2 l-18 16 l18 16 l-24 2 l6 24 l-22 -12 l-9 22 l-9 -22 l-22 12 l6 -24 l-24 -2 l18 -16 l-18 -16 l24 -2 l-6 -24 l22 12z" fill="#ffd23f" stroke="#ff8c42" stroke-width="4" stroke-linejoin="round"/></g>` +
      blob('#b06cff', eyes.angry() + mouths.grin(), { cls: 'stk-pulse' }),
  },
  {
    id: 'wait', anim: true, act: 'hop', snd: 'wait', zh: '等等我！', en: 'Wait up!',
    art: () => blob('#9be15d', eyes.wide() + mouths.o(), {
      cls: 'stk-hop',
      extra: `<g class="stk-drip"><path d="M88 30 q-5 8 0 12 q5 -4 0 -12z" fill="#6ed3ff" stroke="${INK}" stroke-width="2"/></g>${hand(18, 56, '#9be15d', 'stk-reach')}`,
    }),
  },
  // ===== 贴图（静态） =====
  {
    id: 'weak', act: 'shrug', snd: 'hmm', zh: '就这？', en: "That's it?",
    art: () => blob('#b06cff', eyes.smug() + mouths.smirk(), { extra: `<path d="M64 38 Q74 30 82 38" stroke="${INK}" stroke-width="4" fill="none" stroke-linecap="round"/><text x="96" y="30" font-size="22" font-weight="900" fill="#ffd23f" stroke="${INK}" stroke-width="4" paint-order="stroke" font-family="inherit">?</text>` }),
  },
  {
    id: 'noob', act: 'laugh', snd: 'laugh', zh: '菜！', en: 'Noob!',
    art: () => blob('#3ddc84', eyes.laugh() + mouths.laugh(), {
      extra: `<path d="M60 26 q-14 -18 -26 -8 q10 2 14 10 q-12 -2 -16 6 q14 -2 28 -8z M60 26 q14 -18 26 -8 q-10 2 -14 10 q12 -2 16 6 q-14 -2 -28 -8z" fill="#7ed957" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>${hand(100, 62, '#3ddc84')}<path d="M104 60 l12 -6" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`,
    }),
  },
  {
    id: 'gg', act: 'cheer', snd: 'cool', zh: 'GG', en: 'GG',
    art: () => blob('#3a3a4a', eyes.shades() + mouths.smirk().replace(INK, '#fff'), { extra: `<path d="M96 20 l3 8 l8 3 l-8 3 l-3 8 l-3 -8 l-8 -3 l8 -3z" fill="#ffd23f"/>` }),
  },
  {
    id: 'six', act: 'cheer', snd: 'ding', zh: '666', en: '666',
    art: () => blob('#2ee6d6', eyes.happy() + mouths.grin() + cheeks, { extra: `<g transform="translate(96 60)"><rect x="-9" y="-4" width="16" height="20" rx="5" fill="#ffd23f" stroke="${INK}" stroke-width="3.5"/><rect x="-5" y="-20" width="8" height="20" rx="4" fill="#ffd23f" stroke="${INK}" stroke-width="3.5"/></g>` }),
  },
  {
    id: 'oops', act: 'shrug', snd: 'oops', zh: '对不起啦~', en: 'Oopsie~',
    art: () => blob('#ffb3d1', eyes.happy() + mouths.wobbly() + cheeks, { extra: `<path d="M88 30 q-6 9 0 14 q6 -5 0 -14z" fill="#6ed3ff" stroke="${INK}" stroke-width="2.5"/>` }),
  },
  {
    id: 'ez', act: 'cheer', snd: 'cool', zh: '轻松拿下', en: 'EZ',
    art: () => blob('#ffd23f', eyes.smug() + mouths.smirk(), { extra: `<path d="M40 30 l6 -18 l8 12 l6 -16 l6 16 l8 -12 l6 18z" fill="#ffc300" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/><circle cx="60" cy="22" r="3" fill="#ff5a5f"/>` }),
  },
];

export const STICKERS = DEFS.map((d) => ({ ...d, get name() { return tr(d.zh); } }));
export const STICKER_MAP = Object.fromEntries(STICKERS.map((s) => [s.id, s]));

// 生成贴图 SVG（每次生成新的渐变 id，同一个贴图可以在页面里出现多次）
export function stickerSVG(id, { label = true } = {}) {
  const s = STICKER_MAP[id];
  if (!s) return '';
  const text = label ? caption(s.name, { cls: s.anim ? 'stk-text' : '' }) : '';
  return `<svg class="stk ${s.anim ? 'stk-anim' : ''}" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-label="${s.name}"><g transform="translate(0 ${label ? -4 : 6})">${s.art()}</g>${text}</svg>`;
}
