// 物理 / 数学小工具
const { PLAYER_R } = require('./constants');

const rand = (a, b) => a + Math.random() * (b - a);
const lerp = (a, b, k) => a + (b - a) * Math.min(1, Math.max(0, k));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const r1 = (v) => Math.round(v * 10) / 10;

const emptyFx = () => ({ big: 0, speed: 0, shield: 0, ghost: 0, frozen: 0, slip: 0 });
const emptyStats = () => ({ kills: 0, falls: 0, hits: 0, items: 0, goals: 0, tiles: 0, dmg: 0, finishers: 0, passes: 0, crown: 0, keys: 0, plates: 0, saves: 0 });

// 半径和体重：玩家受道具影响；球、Boss、小怪用自己的属性
function radiusOf(b) {
  if (b.kind !== 'player') return b.r;
  return b.fx.big > 0 ? PLAYER_R * 1.55 : PLAYER_R;
}
function massOf(b) {
  const fx = b.fx || {};
  const base = b.kind === 'player' ? (fx.big > 0 ? 3 : 1) * (fx.shield > 0 ? 6 : 1) : b.mass;
  return base * (fx.frozen > 0 ? 1.5 : 1) * (b.massMul || 1);
}
const controllable = (b) => !b.fx || (b.fx.frozen <= 0 && b.fx.slip <= 0);
const ghosted = (b) => !!b.fx && b.fx.ghost > 0;

module.exports = { rand, lerp, clamp, dist, r1, emptyFx, emptyStats, radiusOf, massOf, controllable, ghosted };
