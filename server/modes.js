// 游戏模式：每个模式的规则写在这里，房间引擎（room.js）在固定时机调用这些钩子。
//
// 钩子一览（都是可选的）：
//   setup(room)                 比赛开始时
//   startRound(room)            每一局 / 每次开球，玩家摆好位置之后
//   spawn(room, p, i, list)     返回这一局的出生点 {x, y}
//   update(room, dt)            进行中每帧
//   control(room, body, dt)     控制非玩家物体（Boss、小怪）
//   onCollide(room, a, b, rel)  两个物体相撞
//   onPlayerFall(room, p, killer)
//   onBodyFall(room, body)      球 / Boss / 小怪开始掉落
//   onItem(room, p, item)       玩家捡到道具（在默认效果之后）
//   onTileBreak(room, id)
//   canRespawn(room, p)
//   check(room)                 判定本局 / 比赛是否结束
//   matchOver(room)             一局结束后：返回 { winners } 表示整场结束
//   snapshot(room)              发给客户端的模式数据
//   botGoal(room, p, ctx)       机器人的目标点 { x, y, dash }
//   accelMul(room, p)
const { rand, dist, r1, emptyFx, radiusOf } = require('./util');
const { PLAYER_R } = require('./constants');

const alivePlayers = (room) => room.list().filter((p) => p.alive && !p.falling);

// 淘汰制：场上只剩一人（单人练习时剩 0 人）就结束这一局
function eliminationCheck(room) {
  const list = room.list();
  if (list.some((p) => p.falling > 0)) return;
  const standing = list.filter((p) => p.alive && !p.falling);
  const solo = room.participants <= 1;
  if (solo ? standing.length > 0 : standing.length > 1) return;
  const winner = !solo && standing[0];
  if (winner) winner.score++;
  room.endRound({ winnerId: winner ? winner.id : null, text: winner ? `${winner.name} 赢了这局！` : '平局！' });
}
const roundWinners = (room) => {
  const w = room.list().filter((p) => p.score >= room.settings.target);
  return w.length ? { winners: w.map((p) => p.id) } : null;
};

// ---------------------------------------------------------------------
// 经典乱斗：活到最后
// ---------------------------------------------------------------------
const classic = {
  id: 'classic',
  targets: [3, 5, 7],
  defaultTarget: 3,
  minPlayers: 2,
  hazards: { collapse: true, cracks: 'permanent', meteors: true },
  check: eliminationCheck,
  matchOver: roundWinners,
};

// ---------------------------------------------------------------------
// 抢皇冠：戴着皇冠计时，撞人抢冠
// ---------------------------------------------------------------------
const CROWN_GUARD = 2;
const crown = {
  id: 'crown',
  targets: [20, 30, 45],
  defaultTarget: 20,
  minPlayers: 1,
  respawn: true,
  respawnDelay: 2.2,
  hazards: { collapse: false, cracks: 'regen', meteors: true },
  startRound(room) {
    const blocked = (room.map.bumpers || []).some((b) => Math.hypot(b.x, b.y) < b.r + 40);
    const t = blocked ? room.safeSpot(false) : null;
    room.m.crown = { holder: null, x: t ? t.cx : 0, y: t ? t.cy : 0, wait: 0, guard: 0 };
  },
  accelMul: (room, p) => (room.m.crown && room.m.crown.holder === p.id ? 0.95 : 1),
  update(room, dt) {
    const cr = room.m.crown;
    if (!cr.holder) {
      cr.wait -= dt;
      if (cr.wait > 0) return;
      const p = alivePlayers(room).find((q) => q.fx.ghost <= 0 && Math.hypot(q.x - cr.x, q.y - cr.y) < radiusOf(q) + 26);
      if (p) {
        cr.holder = p.id;
        cr.guard = CROWN_GUARD;
        room.event({ type: 'crown', id: p.id });
      }
      return;
    }
    cr.guard -= dt;
    const h = room.players.get(cr.holder);
    if (!h) return crown.drop(room, 0, 0);
    // 皇冠很沉：戴冠的人更难被撞飞
    for (const p of room.list()) p.massMul = p === h ? 1.6 : 1;
    h.score += dt;
    h.stats.crown += dt;
    if (h.score >= room.settings.target) {
      h.score = room.settings.target;
      room.endMatch([h.id]);
    }
  },
  drop(room, x, y) {
    room.m.crown = { holder: null, x, y, wait: 1, guard: 0 };
    for (const p of room.list()) p.massMul = 1;
  },
  onCollide(room, a, b, rel) {
    const cr = room.m.crown;
    if (!cr || !cr.holder || cr.guard > 0 || rel < 280 || a.kind !== 'player' || b.kind !== 'player') return;
    const taker = cr.holder === a.id ? b : cr.holder === b.id ? a : null;
    if (!taker) return;
    const from = cr.holder;
    cr.holder = taker.id;
    cr.guard = CROWN_GUARD;
    room.event({ type: 'crown', id: taker.id, from });
  },
  onPlayerFall(room, p) {
    if (room.m.crown && room.m.crown.holder === p.id) {
      // 皇冠掉在落水点附近靠内侧的安全地砖上
      const tiles = room.map.layout.tiles;
      const tx = p.x * 0.7;
      const ty = p.y * 0.7;
      let best = null;
      let bd = Infinity;
      for (let i = 0; i < tiles.length; i++) {
        if (room.tileState[i] !== 0) continue;
        if ((room.map.bumpers || []).some((b) => Math.hypot(b.x - tiles[i].cx, b.y - tiles[i].cy) < b.r + 30)) continue;
        const d = Math.hypot(tiles[i].cx - tx, tiles[i].cy - ty);
        if (d < bd) {
          bd = d;
          best = tiles[i];
        }
      }
      crown.drop(room, best ? best.cx : 0, best ? best.cy : 0);
      room.event({ type: 'crownDrop', id: p.id });
    }
  },
  onLeave(room, p) {
    if (room.m.crown && room.m.crown.holder === p.id) crown.drop(room, 0, 0);
  },
  snapshot(room) {
    const cr = room.m.crown;
    return cr ? { crown: cr.holder ? { h: cr.holder } : { x: r1(cr.x), y: r1(cr.y) } } : {};
  },
  botGoal(room, p, ctx) {
    const cr = room.m.crown;
    if (!cr) return null;
    if (cr.holder === p.id) {
      const e = ctx.nearestEnemy;
      if (e && ctx.enemyDist < 220) return { x: p.x + (p.x - e.x) + ctx.refuge.x * 0.5 - p.x * 0.5, y: p.y + (p.y - e.y) + ctx.refuge.y * 0.5 - p.y * 0.5, dash: ctx.enemyDist < 90 };
      return { x: ctx.refuge.x, y: ctx.refuge.y };
    }
    if (cr.holder) {
      const h = room.players.get(cr.holder);
      if (h) return { x: h.x, y: h.y, dash: dist(p, h) < 120 };
    }
    return { x: cr.x, y: cr.y };
  },
};

// ---------------------------------------------------------------------
// 涂色大战：限时，脚下的地砖变成自己的颜色，占地最多的人赢
// ---------------------------------------------------------------------
const paint = {
  id: 'paint',
  targets: [60, 90, 120],
  defaultTarget: 90,
  minPlayers: 1,
  respawn: true,
  respawnDelay: 2,
  hazards: { collapse: false, cracks: 'regen', meteors: true },
  setup(room) {
    room.m.owner = new Int16Array(room.map.layout.tiles.length).fill(-1);
    room.m.slots = room.list().map((p) => p.id);
    room.m.clock = room.settings.target;
  },
  slotOf(room, p) {
    let s = room.m.slots.indexOf(p.id);
    if (s < 0) {
      room.m.slots.push(p.id);
      s = room.m.slots.length - 1;
    }
    return s;
  },
  paintAt(room, p, x, y, r) {
    const tiles = room.map.layout.tiles;
    const slot = paint.slotOf(room, p);
    if (r <= 0) {
      const id = room.tileAt(x, y);
      if (id >= 0 && room.tileState[id] !== 2) room.m.owner[id] = slot;
      return;
    }
    for (let i = 0; i < tiles.length; i++) {
      if (room.tileState[i] !== 2 && Math.hypot(tiles[i].cx - x, tiles[i].cy - y) < r) room.m.owner[i] = slot;
    }
  },
  update(room, dt) {
    for (const p of alivePlayers(room)) paint.paintAt(room, p, p.x, p.y, p.fx.big > 0 ? 70 : 0);
    // 统计每人的地盘
    const counts = new Array(room.m.slots.length).fill(0);
    for (let i = 0; i < room.m.owner.length; i++) {
      const o = room.m.owner[i];
      if (o >= 0 && room.tileState[i] !== 2) counts[o]++;
    }
    room.m.slots.forEach((id, s) => {
      const p = room.players.get(id);
      if (p) {
        p.score = counts[s];
        p.stats.tiles = Math.max(p.stats.tiles, counts[s]);
      }
    });
    room.m.clock -= dt;
    if (room.m.clock <= 0) {
      room.m.clock = 0;
      const list = room.list();
      const top = Math.max(...list.map((p) => p.score));
      room.endMatch(list.filter((p) => p.score === top).map((p) => p.id));
    }
  },
  onItem(room, p, item) {
    if (item.type === 'bomb') paint.paintAt(room, p, p.x, p.y, 190);
  },
  onTileBreak(room, id) {
    if (room.m.owner) room.m.owner[id] = -1;
  },
  snapshot(room) {
    if (!room.m.owner) return {};
    let s = '';
    for (let i = 0; i < room.m.owner.length; i++) s += room.m.owner[i] < 0 ? '.' : String.fromCharCode(97 + room.m.owner[i]);
    return { paint: s, slots: room.m.slots, clock: r1(room.m.clock) };
  },
  botGoal(room, p, ctx) {
    // 找最近的一块不是自己颜色的地砖；附近有人就顺手撞一下
    if (ctx.nearestEnemy && ctx.enemyDist < 80 && Math.random() < 0.3) return { x: ctx.nearestEnemy.x, y: ctx.nearestEnemy.y, dash: true };
    const slot = paint.slotOf(room, p);
    const tiles = room.map.layout.tiles;
    let best = null;
    let bs = Infinity;
    for (let i = 0; i < tiles.length; i++) {
      if (room.tileState[i] !== 0 || room.m.owner[i] === slot) continue;
      const d = Math.hypot(tiles[i].cx - p.x, tiles[i].cy - p.y) + (room.m.owner[i] >= 0 ? -40 : 0) + Math.random() * 30;
      if (d < bs) {
        bs = d;
        best = tiles[i];
      }
    }
    return best ? { x: best.cx, y: best.cy } : null;
  },
};

// ---------------------------------------------------------------------
// 烫手炸弹：拿着炸弹撞别人就能传出去，引信烧完谁拿着谁出局
// ---------------------------------------------------------------------
const potato = {
  id: 'potato',
  targets: [3, 5, 7],
  defaultTarget: 3,
  minPlayers: 2,
  itemTypes: ['big', 'speed', 'shield', 'freeze', 'ghost', 'tornado', 'banana'],
  hazards: { collapse: true, cracks: 'permanent', meteors: true },
  startRound(room) {
    room.m.holder = null;
    room.m.next = 2;
    room.m.fuse = 0;
    room.m.fuseMax = 1;
    room.m.passCd = 0;
  },
  give(room) {
    const alive = alivePlayers(room);
    if (alive.length < 2) return;
    const p = alive[Math.floor(Math.random() * alive.length)];
    room.m.holder = p.id;
    room.m.fuseMax = room.m.fuse = rand(8, 11) + alive.length * 0.6;
    room.m.passCd = 1;
    room.event({ type: 'potatoGive', id: p.id });
  },
  accelMul: (room, p) => (room.m.holder === p.id ? 1.15 : 1),
  update(room, dt) {
    const m = room.m;
    if (!m.holder) {
      m.next -= dt;
      if (m.next <= 0) potato.give(room);
      return;
    }
    m.passCd -= dt;
    m.fuse -= dt;
    const h = room.players.get(m.holder);
    if (!h || !h.alive) {
      m.holder = null;
      m.next = 1;
      return;
    }
    if (m.fuse > 0) return;
    // 引信烧完：原地爆炸出局，把附近的人炸飞
    room.event({ type: 'potatoBoom', id: h.id, x: h.x, y: h.y });
    h.alive = false;
    h.exploded = true;
    h.stats.falls++;
    room.knock(h.x, h.y, 230, 760, null);
    m.holder = null;
    m.next = 1.6;
  },
  onCollide(room, a, b, rel) {
    const m = room.m;
    if (!m.holder || m.passCd > 0 || rel < 30 || a.kind !== 'player' || b.kind !== 'player') return;
    const from = m.holder === a.id ? a : m.holder === b.id ? b : null;
    if (!from) return;
    const to = from === a ? b : a;
    if (to.fx.shield > 0 || to.fx.ghost > 0) return;
    m.holder = to.id;
    m.passCd = 0.6;
    from.stats.passes++;
    room.event({ type: 'potatoPass', id: to.id, from: from.id });
  },
  onPlayerFall(room, p) {
    if (room.m.holder === p.id) {
      room.m.holder = null;
      room.m.next = 1;
    }
  },
  onLeave(room, p) {
    potato.onPlayerFall(room, p);
  },
  check: eliminationCheck,
  matchOver: roundWinners,
  snapshot: (room) => ({ holder: room.m.holder, fuse: r1(Math.max(0, room.m.fuse || 0)), fuseMax: r1(room.m.fuseMax || 1) }),
  botGoal(room, p, ctx) {
    const h = room.m.holder && room.players.get(room.m.holder);
    if (!h) return null;
    if (h === p) {
      const e = ctx.nearestEnemy;
      return e ? { x: e.x, y: e.y, dash: ctx.enemyDist < 130 } : null;
    }
    const d = dist(p, h);
    if (d > 260) return null;
    // 远离拿炸弹的人，同时往安全的地方靠
    return { x: p.x + (p.x - h.x) * 2 + (ctx.refuge.x - p.x) * 0.6, y: p.y + (p.y - h.y) * 2 + (ctx.refuge.y - p.y) * 0.6, dash: d < 90 };
  },
};

// ---------------------------------------------------------------------
// 碰碰足球：红蓝两队把大球撞进对方球门
// ---------------------------------------------------------------------
const BALL_R = 34;
const football = {
  id: 'football',
  targets: [3, 5, 7],
  defaultTarget: 3,
  minPlayers: 2,
  teams: true,
  respawn: true,
  respawnDelay: 1.5,
  roundEndDelay: 2.6,
  hazards: { collapse: false, cracks: 'none', meteors: true },
  setup(room) {
    room.balanceTeams();
  },
  kickoffSpot(room) {
    for (const [x, y] of [[0, 0], [0, 110], [0, -110]]) {
      if ((room.map.bumpers || []).every((b) => Math.hypot(b.x - x, b.y - y) > b.r + BALL_R + 10)) return { x, y };
    }
    return { x: 0, y: 0 };
  },
  spawnBall(room) {
    const k = football.kickoffSpot(room);
    const ball = { kind: 'ball', id: 'ball', x: k.x, y: k.y, vx: 0, vy: 0, r: BALL_R, mass: 1.3, alive: true, falling: 0, fx: emptyFx(), lastTouch: null };
    room.bodies = room.bodies.filter((b) => b.kind !== 'ball');
    room.bodies.push(ball);
    room.m.ball = ball;
    room.m.ballRespawn = 0;
  },
  startRound(room) {
    football.spawnBall(room);
  },
  spawn(room, p, i, list) {
    const mates = list.filter((q) => q.team === p.team);
    const k = mates.indexOf(p);
    const side = p.team === 0 ? -1 : 1;
    const x = side * room.map.goal.x * (0.45 + (k % 2) * 0.2);
    const y = (k - (mates.length - 1) / 2) * 75;
    return { x, y };
  },
  update(room, dt) {
    const m = room.m;
    const ball = m.ball;
    if (!ball || !ball.alive) {
      m.ballRespawn -= dt;
      if (m.ballRespawn <= 0) {
        football.spawnBall(room);
        room.event({ type: 'ballBack' });
      }
      return;
    }
    if (ball.falling) return;
    const g = room.map.goal;
    for (const side of [-1, 1]) {
      if (Math.abs(ball.x - side * g.x) <= g.hw && Math.abs(ball.y) <= g.hh) {
        // 左边球门是红队的，球进左门 = 蓝队得分
        const scorer = side < 0 ? 1 : 0;
        room.teamScore[scorer]++;
        const shooter = ball.lastTouch && room.players.get(ball.lastTouch);
        const own = shooter && shooter.team !== scorer;
        if (shooter && !own) {
          shooter.stats.goals++;
          shooter.score++;
        }
        room.event({ type: 'goal', team: scorer, id: shooter ? shooter.id : null, own: !!own, x: ball.x, y: ball.y });
        const who = shooter ? (own ? `${shooter.name} 乌龙球！` : `${shooter.name} 进球！`) : '进球！';
        room.endRound({ winnerTeam: scorer, text: who });
        return;
      }
    }
  },
  onCollide(room, a, b) {
    const ball = a.kind === 'ball' ? a : b.kind === 'ball' ? b : null;
    const p = a.kind === 'player' ? a : b.kind === 'player' ? b : null;
    if (ball && p) ball.lastTouch = p.id;
  },
  onBodyFall(room, b) {
    if (b.kind !== 'ball') return;
    room.event({ type: 'ballOut', x: b.x, y: b.y });
    room.m.ballRespawn = 1.4;
  },
  matchOver(room) {
    const t = room.teamScore.findIndex((s) => s >= room.settings.target);
    if (t < 0) return null;
    room.winnerTeam = t;
    return { winners: room.list().filter((p) => p.team === t).map((p) => p.id), winnerTeam: t };
  },
  snapshot: (room) => ({ goal: room.map.goal }),
  botGoal(room, p, ctx) {
    const ball = room.m.ball;
    if (!ball || !ball.alive || ball.falling) return { x: 0, y: 0 };
    const g = room.map.goal;
    const atk = p.team === 0 ? 1 : -1; // 进攻方向
    const own = { x: -atk * g.x, y: 0 };
    const mates = room.list().filter((q) => q.team === p.team && q.alive);
    const keeper = mates.length > 1 && mates.sort((a, b) => atk * (a.x - b.x))[0] === p;
    // 守门员：球在我方半场时站在球和球门之间
    if (keeper && ball.x * atk < 0) return { x: own.x + (ball.x - own.x) * 0.35, y: own.y + (ball.y - own.y) * 0.35 };
    const gx = atk * g.x - ball.x;
    const gy = -ball.y;
    const gl = Math.hypot(gx, gy) || 1;
    const ux = gx / gl;
    const uy = gy / gl;
    const off = BALL_R + PLAYER_R + 14;
    const bx = ball.x - ux * off;
    const by = ball.y - uy * off;
    const tx = ball.x - p.x;
    const ty = ball.y - p.y;
    const tl = Math.hypot(tx, ty) || 1;
    const aligned = (tx * ux + ty * uy) / tl > 0.75;
    if (aligned) return { x: ball.x + ux * 20, y: ball.y + uy * 20, dash: tl < 150 };
    // 绕到球后面：先侧移再靠近，避免把球往自己门里推
    const side = Math.sign((p.x - ball.x) * -uy + (p.y - ball.y) * ux) || 1;
    return { x: bx + -uy * side * 50, y: by + ux * side * 50 };
  },
  ballSafe: true,
};

// ---------------------------------------------------------------------
// 合力打 Boss（多人协作 1~8 人）：把巨无霸推下场地若干次，共享复活次数
// ---------------------------------------------------------------------
const DIFF = {
  1: { lives: [6, 2], bossLives: 3, mass: 0.8, accel: 560, cd: 3.8, slam: 550, charge: 750, tired: 1.7, name: '简单' },
  2: { lives: [5, 1.5], bossLives: 3, mass: 0.95, accel: 650, cd: 3.2, slam: 650, charge: 850, tired: 1.3, name: '普通' },
  3: { lives: [4, 1], bossLives: 4, mass: 1.1, accel: 740, cd: 2.6, slam: 750, charge: 950, tired: 1, name: '困难' },
};
const BOSS_ENRAGE = 120;
const boss = {
  id: 'boss',
  targets: [1, 2, 3],
  defaultTarget: 2,
  minPlayers: 1,
  coop: true,
  respawn: true,
  respawnDelay: 2.5,
  hazards: { collapse: false, cracks: 'regen', meteors: true },
  setup(room) {
    const n = Math.max(1, room.list().length);
    const d = DIFF[room.settings.target] || DIFF[2];
    for (const p of room.list()) p.team = 0;
    room.m.diff = d;
    room.m.n = n;
    room.m.livesMax = room.m.lives = Math.round(d.lives[0] + n * d.lives[1]);
    room.m.bossLivesMax = room.m.bossLives = d.bossLives;
    room.m.phase = 1;
    room.m.bossRespawn = 0;
    room.m.minionT = 8;
  },
  startRound(room) {
    boss.spawnBoss(room, 0);
  },
  spawn(room, p, i, list) {
    const a = (i / list.length) * Math.PI * 2 + Math.PI / 2;
    const r = Math.min(270, room.map.layout.radius * 0.58);
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  },
  spawnBoss(room, inv) {
    const m = room.m;
    const d = m.diff;
    const t = room.tileAt(0, 0) >= 0 && room.tileState[room.tileAt(0, 0)] === 0 ? { cx: 0, cy: 0 } : room.safeSpot(false) || { cx: 0, cy: 0 };
    const bumperAtCenter = (room.map.bumpers || []).find((b) => Math.hypot(b.x - t.cx, b.y - t.cy) < b.r + 70);
    const pos = bumperAtCenter ? { cx: 0, cy: -150 } : t;
    const b = {
      kind: 'boss',
      id: 'boss',
      x: pos.cx,
      y: pos.cy,
      vx: 0,
      vy: 0,
      r: 60,
      mass: (4 + m.n * 0.9) * d.mass,
      damping: 3.4, // 比玩家更"稳"，被推一下不会一路滑出场
      accel: d.accel * (1 + (m.phase - 1) * 0.12) * (m.enraged ? 1.3 : 1),
      alive: true,
      falling: 0,
      fx: emptyFx(),
      input: { x: 0, y: 0 },
      state: 'chase',
      stateT: 2.5,
      dir: { x: 0, y: 1 },
      target: null,
      lastHitBy: null,
      lastHitTime: -99,
    };
    b.fx.ghost = inv;
    room.bodies = room.bodies.filter((x) => x.kind !== 'boss');
    room.bodies.push(b);
    m.boss = b;
  },
  spawnMinion(room) {
    const t = room.safeSpot(true);
    if (!t) return;
    room.bodies.push({ kind: 'minion', id: 'm' + room.nextObj++, x: t.cx, y: t.cy, vx: 0, vy: 0, r: 18, mass: 0.8, accel: 950, alive: true, falling: 0, fx: emptyFx(), input: { x: 0, y: 0 }, think: 0, lastHitBy: null, lastHitTime: -99 });
    room.event({ type: 'minion', x: t.cx, y: t.cy });
  },
  control(room, b, dt) {
    const players = alivePlayers(room).filter((p) => p.fx.ghost <= 0);
    if (b.kind === 'minion') {
      b.think -= dt;
      if (b.think <= 0) {
        b.think = 0.2;
        let t = null;
        let td = Infinity;
        for (const p of players) {
          const d = dist(p, b);
          if (d < td) {
            td = d;
            t = p;
          }
        }
        const dx = t ? t.x - b.x : -b.x;
        const dy = t ? t.y - b.y : -b.y;
        const l = Math.hypot(dx, dy) || 1;
        b.input.x = dx / l;
        b.input.y = dy / l;
        if (t && td < 100 && Math.random() < 0.25) {
          b.vx += (dx / l) * 520;
          b.vy += (dy / l) * 520;
        }
      }
      return;
    }
    const m = room.m;
    b.stateT -= dt;
    if (b.fx.frozen > 0 || b.fx.slip > 0) return;
    if (!b.target || !b.target.alive || Math.random() < dt * 0.4) {
      let t = null;
      let td = Infinity;
      for (const p of players) {
        const d = dist(p, b) + Math.random() * 120;
        if (d < td) {
          td = d;
          t = p;
        }
      }
      b.target = t;
    }
    const t = b.target;
    switch (b.state) {
      case 'chase': {
        if (t) {
          const dx = t.x - b.x;
          const dy = t.y - b.y;
          const l = Math.hypot(dx, dy) || 1;
          b.input.x = dx / l;
          b.input.y = dy / l;
        } else {
          b.input.x = -b.x / 300;
          b.input.y = -b.y / 300;
        }
        // 别自己走到边上：前方没地面就往中心拐
        const ax = b.x + b.input.x * (b.r + 40);
        const ay = b.y + b.input.y * (b.r + 40);
        if (!room.safeAt(ax, ay)) {
          const l = Math.hypot(b.x, b.y) || 1;
          b.input.x = -b.x / l;
          b.input.y = -b.y / l;
        }
        if (b.stateT <= 0 && t) {
          const d = dist(t, b);
          if (d < 420 && Math.random() < 0.6) {
            b.state = 'windup';
            b.stateT = 1;
            const l = d || 1;
            b.dir = { x: (t.x - b.x) / l, y: (t.y - b.y) / l };
            room.event({ type: 'bossWindup' });
          } else {
            b.state = 'slamWind';
            b.stateT = 1.3;
            room.event({ type: 'bossSlamWind', x: b.x, y: b.y });
          }
        }
        break;
      }
      case 'windup':
        b.input.x = b.input.y = 0;
        if (t) {
          const dx = t.x - b.x;
          const dy = t.y - b.y;
          const l = Math.hypot(dx, dy) || 1;
          b.dir = { x: b.dir.x * 0.9 + (dx / l) * 0.1, y: b.dir.y * 0.9 + (dy / l) * 0.1 };
        }
        if (b.stateT <= 0) {
          const power = m.diff.charge * (1 + (m.phase - 1) * 0.1);
          b.vx += b.dir.x * power;
          b.vy += b.dir.y * power;
          b.state = 'charge';
          b.stateT = 0.7;
          room.event({ type: 'bossCharge' });
        }
        break;
      case 'charge':
        b.input.x = b.input.y = 0;
        if (b.stateT <= 0) boss.tire(room, b, 1);
        break;
      case 'slamWind':
        b.input.x = b.input.y = 0;
        if (b.stateT <= 0) {
          room.event({ type: 'bossSlam', x: b.x, y: b.y, r: 230 });
          room.knock(b.x, b.y, 230, m.diff.slam, b, (o) => o.kind === 'player');
          boss.tire(room, b, 0.8);
        }
        break;
      case 'tired':
        // 放完大招累趴了：不能动、变轻、被撞会滑很远 —— 全员进攻的好机会
        b.input.x = b.input.y = 0;
        if (b.stateT <= 0) {
          b.state = 'chase';
          b.massMul = 1;
          b.damping = 3.4;
          b.stateT = m.diff.cd * (1 - (m.phase - 1) * 0.15) * rand(0.8, 1.3) * (m.enraged ? 0.6 : 1);
        }
        break;
    }
  },
  tire(room, b, k) {
    b.state = 'tired';
    b.stateT = room.m.diff.tired * k * (1 - (room.m.phase - 1) * 0.1);
    b.massMul = 0.75;
    b.damping = 3;
    room.event({ type: 'bossTired', x: b.x, y: b.y });
  },
  update(room, dt) {
    const m = room.m;
    // 打太久 Boss 会狂暴：更快、出招更频繁，保证比赛不会无限拖下去
    if (!m.enraged && room.roundTime > BOSS_ENRAGE) {
      m.enraged = true;
      m.shrinkT = 4;
      m.shrinkLayer = 0;
      if (m.boss) m.boss.accel *= 1.3;
      room.event({ type: 'bossEnrage' });
    }
    // 狂暴后场地从外圈开始一层层永久坍塌，至少留两层
    if (m.enraged && m.shrinkLayer < room.map.layout.layers - 2) {
      m.shrinkT -= dt;
      if (m.shrinkT <= 0) {
        m.shrinkT = 14;
        const tiles = room.map.layout.tiles;
        for (let i = 0; i < tiles.length; i++) if (tiles[i].layer === m.shrinkLayer) room.warnTile(i, 3);
        m.shrinkLayer++;
        room.event({ type: 'collapse' });
      }
    }
    if (!m.boss) {
      m.bossRespawn -= dt;
      if (m.bossRespawn <= 0) {
        boss.spawnBoss(room, 2);
        room.event({ type: 'bossBack', phase: m.phase });
      }
    }
    if (m.phase >= 2) {
      m.minionT -= dt;
      const count = room.bodies.filter((b) => b.kind === 'minion').length;
      if (m.minionT <= 0) {
        m.minionT = m.phase >= 3 ? 7 : 10;
        const want = m.phase >= 3 ? 3 : 2;
        for (let i = count; i < want; i++) boss.spawnMinion(room);
      }
    }
    for (const p of room.list()) p.score = Math.round(p.stats.dmg / 100) + p.stats.finishers * 5;
  },
  onCollide(room, a, b, rel) {
    const enemy = a.kind === 'boss' || a.kind === 'minion' ? a : b.kind === 'boss' || b.kind === 'minion' ? b : null;
    const p = a.kind === 'player' ? a : b.kind === 'player' ? b : null;
    if (!enemy || !p || rel < 60) return;
    enemy.lastHitBy = p.id;
    enemy.lastHitTime = room.roundTime;
    if (enemy.kind === 'boss') {
      p.stats.dmg += rel;
      if (rel > 220) room.event({ type: 'bossHit', id: p.id, x: enemy.x, y: enemy.y, power: Math.round(rel) });
    }
  },
  onBodyFall(room, b) {
    const m = room.m;
    const finisher = b.lastHitBy && room.roundTime - b.lastHitTime < 5 ? room.players.get(b.lastHitBy) : null;
    if (b.kind === 'minion') {
      if (finisher) finisher.stats.kills++;
      room.event({ type: 'minionDown', id: finisher ? finisher.id : null, x: b.x, y: b.y });
      return;
    }
    if (b.kind !== 'boss') return;
    m.bossLives--;
    if (finisher) {
      finisher.stats.finishers++;
      finisher.kills++;
    }
    room.event({ type: 'bossDown', id: finisher ? finisher.id : null, lives: m.bossLives, x: b.x, y: b.y });
    m.boss = null;
    if (m.bossLives <= 0) {
      room.endMatch(room.list().map((p) => p.id), { coop: { win: true }, text: '成功击败巨无霸！' });
      return;
    }
    m.phase = Math.min(3, m.bossLivesMax - m.bossLives + 1);
    m.bossRespawn = 3;
    m.minionT = 2;
  },
  keepBroken: (room, id) => !!room.m.enraged && room.map.layout.tiles[id].layer < room.m.shrinkLayer,
  onPlayerFall(room, p) {
    if (room.m.lives > 0) {
      room.m.lives--;
    } else {
      p.out = true;
    }
  },
  canRespawn: (room, p) => !p.out,
  check(room) {
    const list = room.list();
    const anyoneLeft = list.some((p) => (p.alive && !p.falling) || (!p.out && p.respawn > 0) || p.falling > 0);
    if (!anyoneLeft && list.length) room.endMatch([], { coop: { win: false }, text: '全员阵亡……' });
  },
  snapshot(room) {
    const m = room.m;
    const b = m.boss;
    return {
      lives: m.lives,
      livesMax: m.livesMax,
      bossLives: m.bossLives,
      bossLivesMax: m.bossLivesMax,
      phase: m.phase,
      diff: m.diff ? m.diff.name : '',
      bossState: b ? b.state : null,
      enraged: !!m.enraged,
      bossDir: b ? { x: r1(b.dir.x), y: r1(b.dir.y) } : null,
    };
  },
  botGoal(room, p, ctx) {
    const b = room.m.boss;
    if (!b || !b.alive || b.falling) return { x: ctx.refuge.x, y: ctx.refuge.y };
    const d = dist(p, b);
    // 躲技能：蓄力冲撞时闪到侧面，砸地前跑出范围
    if (b.state === 'slamWind' && d < 290) return { x: p.x + (p.x - b.x), y: p.y + (p.y - b.y), dash: d < 200 };
    if (b.state === 'windup' && d < 450) {
      const side = Math.sign((p.x - b.x) * -b.dir.y + (p.y - b.y) * b.dir.x) || 1;
      return { x: p.x - b.dir.y * side * 100, y: p.y + b.dir.x * side * 100, dash: d < 260 };
    }
    // 从靠近中心的一侧撞过去，把 Boss 往外推；它累趴的时候全力冲
    const ox = b.x - ctx.refuge.x;
    const oy = b.y - ctx.refuge.y;
    const ol = Math.hypot(ox, oy) || 1;
    const aim = { x: b.x - (ox / ol) * (b.r + 20), y: b.y - (oy / ol) * (b.r + 20) };
    const ad = Math.hypot(aim.x - p.x, aim.y - p.y);
    if (ad < (b.state === 'tired' ? 130 : 50)) return { x: b.x, y: b.y, dash: true };
    return { x: aim.x, y: aim.y };
  },
};

const MODES = { classic, football, crown, paint, potato, boss };
module.exports = { MODES, MODE_IDS: Object.keys(MODES) };
