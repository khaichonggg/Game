// 机器人 AI：先看模式有没有特殊目标，没有就按"找人撞、捡道具、别掉下去"的通用逻辑走。
// 掉线的真人玩家也由这里托管。
const { BOT_LEVELS, DASH_IMPULSE } = require('./constants');
const { rand, dist, radiusOf } = require('./util');

function analyze(room, p) {
  const tiles = room.map.layout.tiles;
  // 最安全的落脚点：状态正常、越靠内越好、离自己越近越好
  let refuge = null;
  let best = -Infinity;
  for (let i = 0; i < tiles.length; i++) {
    if (room.tileState[i] !== 0) continue;
    const t = tiles[i];
    const s = t.layer * 60 - Math.hypot(t.cx - p.x, t.cy - p.y) * 0.5;
    if (s > best) {
      best = s;
      refuge = t;
    }
  }
  let nearestEnemy = null;
  let enemyDist = Infinity;
  for (const o of room.activeBodies()) {
    if (o === p || o.kind === 'ball' || !room.isEnemy(p, o) || (o.fx && o.fx.ghost > 0)) continue;
    const d = dist(p, o);
    if (d < enemyDist) {
      enemyDist = d;
      nearestEnemy = o;
    }
  }
  let item = null;
  let itemDist = Infinity;
  for (const it of room.items) {
    const d = Math.hypot(it.x - p.x, it.y - p.y);
    if (d < itemDist) {
      itemDist = d;
      item = it;
    }
  }
  return { refuge: refuge ? { x: refuge.cx, y: refuge.cy } : { x: 0, y: 0 }, nearestEnemy, enemyDist, item, itemDist };
}

// 危险区域：陨石落点、龙卷风、Boss 砸地
function danger(room, p) {
  for (const m of room.meteors) {
    if (Math.hypot(p.x - m.x, p.y - m.y) < m.r + 45) return { x: p.x + (p.x - m.x || 1), y: p.y + (p.y - m.y) };
  }
  for (const h of room.hazards) {
    if (h.owner !== p.id && Math.hypot(p.x - h.x, p.y - h.y) < 140) return { x: p.x + (p.x - h.x || 1), y: p.y + (p.y - h.y) };
  }
  return null;
}

// 机器人什么时候用手上的道具
function maybeUseItem(room, p, ctx, lvl) {
  if (!p.item) {
    p.itemHold = 0;
    return;
  }
  p.itemHold = (p.itemHold || 0) + lvl.think;
  const d = ctx.enemyDist;
  let use = false;
  switch (p.item) {
    case 'bomb':
      use = d < 150;
      break;
    case 'freeze':
      use = d < 170;
      break;
    case 'tornado':
      use = d < 380;
      break;
    case 'banana':
      use = d < 260 || p.itemHold > 4;
      break;
    case 'shield':
    case 'big':
      use = d < 200 || !room.safeAt(p.x, p.y);
      break;
    default: // speed / ghost
      use = p.itemHold > 1.2 + Math.random() * 1.5;
  }
  // 拿太久了就随便用掉（别一直攥着）
  if (use || p.itemHold > 8) room.useItem(p);
}

function think(room, p, dt) {
  p.botThink -= dt;
  if (p.botThink > 0) return;
  const lvl = BOT_LEVELS[room.settings.botLevel] || BOT_LEVELS[1];
  p.botThink = rand(lvl.think * 0.7, lvl.think * 1.3);
  p.input.dash = false;
  const ctx = analyze(room, p);
  maybeUseItem(room, p, ctx, lvl);
  let goal = danger(room, p);

  if (!goal && room.mode.botGoal) goal = room.mode.botGoal(room, p, ctx);
  if (!goal) {
    // 通用：道具比敌人近就去捡，否则从敌人"靠内"的一侧撞过去
    const e = ctx.nearestEnemy;
    if (ctx.item && ctx.itemDist < 230 && ctx.itemDist < ctx.enemyDist && room.safeAt(ctx.item.x, ctx.item.y)) {
      goal = { x: ctx.item.x, y: ctx.item.y };
    } else if (e) {
      const ox = e.x - ctx.refuge.x;
      const oy = e.y - ctx.refuge.y;
      const ol = Math.hypot(ox, oy) || 1;
      const scared = e.fx && e.fx.shield > 0 && p.fx.shield <= 0;
      goal = { x: e.x - (ox / ol) * 25, y: e.y - (oy / ol) * 25, dash: !scared && ctx.enemyDist < 115 };
      if (scared) goal = { x: p.x * 2 - goal.x, y: p.y * 2 - goal.y };
    } else {
      goal = ctx.refuge;
    }
  }

  let dx = goal.x - p.x;
  let dy = goal.y - p.y;
  let dash = !!goal.dash && Math.random() < lvl.dash;
  // 前方不安全就回安全区；脚下在预警就冲刺逃跑
  const l = Math.hypot(dx, dy) || 1;
  // 地面越滑（阻尼越小）看得越远
  const damping = room.map.physics.damping;
  const slip = Math.max(1, 2.4 / damping);
  const look = lvl.safety * slip + radiusOf(p);
  const hereSafe = room.safeAt(p.x, p.y);
  // 按当前速度预测会滑到哪里（冰面上滑得更远），要滑出去就提前刹车
  const sp = Math.hypot(p.vx, p.vy);
  const stop = Math.min(500, (sp / damping) * 0.9) + radiusOf(p);
  const sliding = sp > 60 && !room.safeAt(p.x + (p.vx / sp) * stop, p.y + (p.vy / sp) * stop);
  if (goal.raw) {
    // 模式自己规划好了路线：只在要滑出去的时候刹车
    if (sliding) {
      dx = dx / l - (p.vx / sp) * 1.2;
      dy = dy / l - (p.vy / sp) * 1.2;
    }
  } else if (sliding || !room.safeAt(p.x + (dx / l) * look, p.y + (dy / l) * look) || !hereSafe) {
    dx = ctx.refuge.x - p.x;
    dy = ctx.refuge.y - p.y;
    if (sliding) {
      const rl = Math.hypot(dx, dy) || 1;
      dx = dx / rl - p.vx / sp;
      dy = dy / rl - p.vy / sp;
    }
    dash = !hereSafe && Math.random() < 0.4;
  }
  const len = Math.hypot(dx, dy) || 1;
  // 冲刺会滑很远：整条冲刺路线都安全才冲（逃离预警地砖时除外）
  if (dash && hereSafe) {
    const reach = Math.max(lvl.safety * 2.6, (DASH_IMPULSE / damping) * 0.7 * (lvl.safety / 90));
    for (const k of [0.4, 0.7, 1]) {
      if (!room.safeAt(p.x + (dx / len) * reach * k, p.y + (dy / len) * reach * k)) dash = false;
    }
  }
  const wobble = (Math.random() - 0.5) * lvl.noise;
  p.input.x = dx / len + wobble;
  p.input.y = dy / len - wobble;
  p.input.dash = dash && p.dashCd <= 0;
}

module.exports = { think };
