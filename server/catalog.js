// 角色外观目录：角色 / 皮肤 / 颜色 / 帽子（客户端 public/js/data.js 里有对应的显示名称）
const CHARACTERS = ['bean', 'cat', 'dino', 'robot', 'penguin', 'chick', 'panda', 'bunny'];
const SKINS = ['solid', 'stripes', 'dots', 'camo', 'rainbow', 'candy', 'gold', 'galaxy', 'lava', 'ice'];
const HATS = ['none', 'crown', 'tophat', 'party', 'propeller', 'horns', 'halo', 'sprout', 'headphones', 'cowboy'];
// 贴图 / 动图（客户端 public/js/stickers.js 里画出来）
const STICKERS = ['lol', 'bleh', 'catch', 'bye', 'cry', 'mad', 'rip', 'clown', 'boom', 'wait', 'weak', 'noob', 'gg', 'six', 'oops', 'ez'];
const COLORS = ['#ff5a5f', '#ff8c42', '#ffd23f', '#9be15d', '#3ddc84', '#2ee6d6', '#3fa7ff', '#5b6cff', '#b06cff', '#ff6fb5', '#f2f2f2', '#3a3a4a'];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function randomProfile(seed = Math.floor(Math.random() * 1000)) {
  return {
    char: CHARACTERS[seed % CHARACTERS.length],
    skin: Math.random() < 0.6 ? 'solid' : pick(SKINS),
    color: COLORS[(seed * 5) % COLORS.length],
    hat: pick(HATS),
  };
}

// 校验客户端发来的外观，非法值换成默认
function sanitizeProfile(p) {
  const src = p && typeof p === 'object' ? p : {};
  return {
    char: CHARACTERS.includes(src.char) ? src.char : 'bean',
    skin: SKINS.includes(src.skin) ? src.skin : 'solid',
    color: COLORS.includes(src.color) ? src.color : COLORS[0],
    hat: HATS.includes(src.hat) ? src.hat : 'none',
  };
}

function sanitizeName(name, fallback) {
  const n = String(name || '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .slice(0, 12);
  return n || fallback;
}

module.exports = { CHARACTERS, SKINS, HATS, COLORS, STICKERS, randomProfile, sanitizeProfile, sanitizeName };
