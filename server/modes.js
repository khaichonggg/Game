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
//   beforeRound(room)           每一局开始、摆放玩家之前（闯关模式在这里换关卡地图）
//   constrain(room, active, dt) 每帧碰撞之后（闯关模式的绳子）
//   respawnPos(room, p)         复活位置
//   keepBroken(room, tileId)    塌掉的地砖是否不再长回来
const { rand, dist, r1, emptyFx, radiusOf, massOf } = require('./util');
const { STAGES, getLevel } = require('./levels');
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

// ---------------------------------------------------------------------
// 绳索闯关（协作 1-8 人）：全队按 1-2-3-…顺序用绳子串成一串。
// 每关要拿钥匙开锁放下吊桥、同时踩住压力板、踩着闪烁地砖过河，全员站进出口才算过关。
// 有人踩空时，只要绳子另一头的队友站稳了，就会被吊在边上慢慢拉回来。
// ---------------------------------------------------------------------
const ROPE_LEN = 150; // 相邻两人之间绳子的最大长度
const ROPE_DIFF = {
  1: { lives: [8, 2], blink: 3.2, soloHold: 5, hangMax: 6, name: '简单' },
  2: { lives: [5, 1], blink: 2.6, soloHold: 4, hangMax: 4.5, name: '普通' },
  3: { lives: [3, 0.5], blink: 2.1, soloHold: 3, hangMax: 3, name: '困难' },
};
const tileCenter = (room, id) => {
  const t = room.map.layout.tiles[id];
  return { x: t.cx, y: t.cy };
};

const rope = {
  id: 'rope',
  targets: [1, 2, 3],
  defaultTarget: 2,
  minPlayers: 1,
  coop: true,
  respawn: true,
  respawnDelay: 2.5,
  roundEndDelay: 3,
  noItems: true,
  ropeLen: ROPE_LEN,
  hazards: { collapse: false, cracks: 'none', meteors: false },
  keepBroken: () => true, // 桥和闪烁地砖只由模式控制，不会自己长回来
  chain: (room) => room.list().filter((p) => p.alive && !p.falling && !p.out),
  setup(room) {
    const n = Math.max(1, room.list().length);
    const d = ROPE_DIFF[room.settings.target] || ROPE_DIFF[2];
    for (const p of room.list()) p.team = 0;
    room.m.diff = d;
    room.m.livesMax = room.m.lives = Math.round(d.lives[0] + n * d.lives[1]);
    room.m.stage = 0;
    room.m.stageTimes = [];
  },
  beforeRound(room) {
    room.m.stage = Math.min(room.round, STAGES.length - 1);
    room.m.level = getLevel(room.m.stage, room.settings.map);
  },
  startRound(room) {
    const m = room.m;
    const f = m.level.feat;
    for (const id of [...f.kBridge, ...f.pBridge, ...f.blinkB]) {
      room.tileState[id] = 2;
      room.tileTimer[id] = Infinity;
    }
    m.key = f.key ? { x: f.key.x, y: f.key.y, holder: null, done: false } : null;
    m.plates = f.plates.map((p) => ({ x: p.x, y: p.y, t: 0, on: false }));
    m.kOpen = !f.key;
    m.pOpen = !f.plates.length;
    m.blink = f.blinkA.length ? { phase: 0, t: m.diff.blink } : null;
    m.stageStart = room.matchTime;
    m.inExit = 0;
    m.need = room.list().filter((p) => !p.out).length;
    m.exitSet = new Set(f.exit);
    m.exitAt = f.exitCore.reduce((a, id) => {
      const c = tileCenter(room, id);
      return { x: a.x + c.x / f.exitCore.length, y: a.y + c.y / f.exitCore.length };
    }, { x: 0, y: 0 });
  },
  // 出生点：按蛇形顺序排，保证 1 挨着 2、2 挨着 3……
  spawn(room, p, i) {
    const tiles = room.map.layout.tiles;
    const ids = [...room.m.level.feat.spawns].sort((a, b) => tiles[a].gj - tiles[b].gj || (tiles[a].gj % 2 ? tiles[b].gi - tiles[a].gi : tiles[a].gi - tiles[b].gi));
    const slots = [];
    for (const id of ids) for (const s of [-1, 1]) slots.push({ x: tiles[id].cx + s * 17, y: tiles[id].cy });
    return slots[i % slots.length];
  },
  // 绳子：相邻两人超过长度就互相拉；踩空的人被吊住
  constrain(room, active, dt, playing) {
    const m = room.m;
    const chain = rope.chain(room);
    if (chain.length < 2) {
      for (const p of chain) p.hanging = false;
      return;
    }
    const inv = (p) => (p.hanging ? 4 : 1) / massOf(p);
    for (let it = 0; it < 3; it++) {
      for (let i = 0; i < chain.length - 1; i++) {
        const a = chain[i];
        const b = chain[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d <= ROPE_LEN || d === 0) continue;
        const nx = dx / d;
        const ny = dy / d;
        const wa = inv(a);
        const wb = inv(b);
        const sa = wa / (wa + wb);
        const sb = wb / (wa + wb);
        const ex = d - ROPE_LEN;
        a.x += nx * ex * sa;
        a.y += ny * ex * sa;
        b.x -= nx * ex * sb;
        b.y -= ny * ex * sb;
        const vr = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (vr < 0) {
          a.vx += nx * vr * sa;
          a.vy += ny * vr * sa;
          b.vx -= nx * vr * sb;
          b.vy -= ny * vr * sb;
        }
      }
    }
    if (!playing) return;
    const grounded = chain.map((p) => room.supported(p.x, p.y));
    const load = new Map();
    chain.forEach((p, i) => {
      if (grounded[i]) {
        if (p.hanging) {
          // 被队友拉回地面了
          p.hanging = false;
          const by = room.players.get(p.anchor);
          if (by && by !== p) by.stats.saves++;
          room.event({ type: 'saved', id: p.id, by: by ? by.id : null });
        }
        p.hangT = 0;
        return;
      }
      // 只有直接相邻、而且站稳了的队友才拉得住你
      const nb = [i - 1, i + 1].filter((k) => k >= 0 && k < chain.length && grounded[k] && dist(chain[k], p) <= ROPE_LEN + 20).map((k) => chain[k]);
      if (!nb.length || (p.hanging && p.hangT > m.diff.hangMax)) {
        if (p.hanging) room.event({ type: 'ropeSlip', id: p.id });
        p.hanging = false;
        p.hangT = -99; // 这次掉下去，不再抓住
        return;
      }
      if (p.hangT < 0) return;
      const a = nb.reduce((x, y) => (dist(x, p) <= dist(y, p) ? x : y));
      if (!p.hanging) {
        p.hanging = true;
        p.hangT = 0;
        p.anchor = a.id;
        room.event({ type: 'hang', id: p.id, by: a.id });
      }
      p.hangT += dt;
      // 慢慢往队友那边拉
      const dx = a.x - p.x;
      const dy = a.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      const damp = Math.max(0, 1 - 5 * dt);
      p.vx = p.vx * damp + (dx / d) * 520 * dt;
      p.vy = p.vy * damp + (dy / d) * 520 * dt;
      load.set(a, (load.get(a) || []).concat(p));
    });
    // 一个人拉两个就拉不住了，会被一起往外拖
    for (const [a, hangers] of load) {
      const k = hangers.length >= 2 ? 700 : 110;
      for (const h of hangers) {
        const dx = h.x - a.x;
        const dy = h.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        a.vx += (dx / d) * k * dt;
        a.vy += (dy / d) * k * dt;
      }
    }
  },
  update(room, dt) {
    const m = room.m;
    const f = m.level.feat;
    const standing = rope.chain(room).filter((p) => !p.hanging);
    // 钥匙：碰到就拿起来，送到锁上放下吊桥；拿钥匙的人掉下去钥匙会回到原处
    if (m.key && !m.key.done) {
      const k = m.key;
      let h = k.holder ? room.players.get(k.holder) : null;
      if (k.holder && (!h || !h.alive || h.falling || h.out)) {
        h = null;
        k.holder = null;
        k.x = f.key.x;
        k.y = f.key.y;
        room.event({ type: 'keyReset' });
      }
      if (!h) {
        const p = standing.find((q) => Math.hypot(q.x - k.x, q.y - k.y) < 42);
        if (p) {
          h = p;
          k.holder = p.id;
          room.event({ type: 'keyPick', id: p.id });
        }
      }
      if (h) {
        k.x = h.x;
        k.y = h.y;
        if (!h.hanging && Math.hypot(h.x - f.lock.x, h.y - f.lock.y) < 48) {
          k.done = true;
          k.holder = null;
          k.x = f.lock.x;
          k.y = f.lock.y;
          m.kOpen = true;
          h.stats.keys++;
          for (const id of f.kBridge) room.tileState[id] = 0;
          room.event({ type: 'unlock', id: h.id, x: f.lock.x, y: f.lock.y });
        }
      }
    }
    // 压力板：全部同时亮起才打开机关桥（一个人玩时踩过的板会亮一会儿）
    if (!m.pOpen && m.plates.length) {
      const hold = rope.chain(room).length <= 1 ? m.diff.soloHold : 0.35;
      m.plates.forEach((pl, i) => {
        const p = standing.find((q) => Math.hypot(q.x - pl.x, q.y - pl.y) < 38);
        if (p) {
          if (pl.t <= 0) {
            p.stats.plates++;
            room.event({ type: 'plate', i, id: p.id, x: pl.x, y: pl.y });
          }
          pl.t = hold;
        } else pl.t = Math.max(0, pl.t - dt);
        pl.on = pl.t > 0;
      });
      if (m.plates.every((pl) => pl.on)) {
        m.pOpen = true;
        for (const id of f.pBridge) room.tileState[id] = 0;
        const c = f.pBridge.length ? tileCenter(room, f.pBridge[Math.floor(f.pBridge.length / 2)]) : m.plates[0];
        room.event({ type: 'platesOpen', x: c.x, y: c.y });
      }
    }
    for (const p of room.list()) p.score = p.stats.keys * 5 + p.stats.plates * 2 + p.stats.saves * 3;
    // 闪烁地砖：新的一组先出现，旧的一组过 0.7 秒再消失
    if (m.blink) {
      const b = m.blink;
      b.t -= dt;
      if (b.t <= 0) {
        const show = b.phase === 0 ? f.blinkB : f.blinkA;
        const hide = b.phase === 0 ? f.blinkA : f.blinkB;
        b.phase = 1 - b.phase;
        b.t = m.diff.blink;
        for (const id of show) room.tileState[id] = 0;
        for (const id of hide) room.warnTile(id, 0.7);
        room.event({ type: 'blink' });
      }
    }
  },
  onPlayerFall(room, p) {
    if (room.m.lives > 0) room.m.lives--;
    else p.out = true;
  },
  canRespawn: (room, p) => !p.out,
  // 复活在链子上相邻的队友旁边，不会被甩到很远的地方
  respawnPos(room, p) {
    const list = room.list();
    const idx = list.indexOf(p);
    const ok = (q) => q && q !== p && q.alive && !q.falling && !q.hanging && room.safeAt(q.x, q.y);
    let near = null;
    for (let d = 1; d < list.length && !near; d++) near = [list[idx - d], list[idx + d]].find(ok) || null;
    const tiles = room.map.layout.tiles;
    const blink = new Set([...room.m.level.feat.blinkA, ...room.m.level.feat.blinkB]);
    const bodies = room.activeBodies();
    const from = near || tileCenter(room, room.m.level.feat.spawns[0]);
    let best = null;
    let bd = Infinity;
    tiles.forEach((t, i) => {
      if (room.tileState[i] !== 0 || blink.has(i)) return;
      const d = Math.hypot(t.cx - from.x, t.cy - from.y);
      if (d > 260 || d >= bd) return;
      if (bodies.some((b) => Math.hypot(b.x - t.cx, b.y - t.cy) < 40)) return;
      if ((room.map.bumpers || []).some((b) => Math.hypot(b.x - t.cx, b.y - t.cy) < b.r + 30)) return;
      best = t;
      bd = d;
    });
    return best ? { x: best.cx, y: best.cy } : null;
  },
  check(room) {
    const m = room.m;
    const list = room.list();
    const need = list.filter((p) => !p.out);
    if (!need.length || !list.some((p) => (p.alive && !p.falling) || p.falling > 0 || (!p.out && p.respawn > 0))) {
      room.endMatch([], { coop: { win: false, stage: m.stage }, text: '绳子断光了……' });
      return;
    }
    const inside = (p) => p.alive && !p.falling && !p.hanging && m.exitSet.has(room.tileAt(p.x, p.y));
    m.need = need.length;
    m.inExit = need.filter(inside).length;
    if (m.inExit === need.length) {
      m.stageTimes.push(Math.round(room.matchTime - m.stageStart));
      room.endRound({ text: `第 ${m.stage + 1} 关通过！` });
      room.event({ type: 'stageClear', stage: m.stage });
    }
  },
  matchOver(room) {
    if (room.m.stage + 1 >= STAGES.length) return { winners: room.list().map((p) => p.id), coop: { win: true, stage: room.m.stage }, text: '全部通关！' };
    return null;
  },
  snapshot(room) {
    const m = room.m;
    if (!m.level) return {};
    return {
      stage: m.stage,
      stages: STAGES.length,
      stageName: STAGES[m.stage].name,
      hint: STAGES[m.stage].hint,
      lives: m.lives,
      livesMax: m.livesMax,
      diff: m.diff.name,
      key: m.key ? { x: r1(m.key.x), y: r1(m.key.y), h: m.key.holder, d: m.key.done ? 1 : 0 } : null,
      plates: m.plates.map((p) => ({ x: p.x, y: p.y, on: p.on ? 1 : 0, t: r1(p.t) })),
      kOpen: m.kOpen ? 1 : 0,
      pOpen: m.pOpen ? 1 : 0,
      inExit: m.inExit,
      need: m.need,
      blink: m.blink ? r1(m.blink.t) : -1,
      exit: m.exitAt,
      times: m.stageTimes,
      ropeLen: ROPE_LEN,
    };
  },
  // 机器人：在地砖网格上用广度优先搜索找路，按"钥匙 → 压力板 → 出口"的顺序做任务
  botGoal(room, p, ctx) {
    const m = room.m;
    if (!m.level) return null;
    const f = m.level.feat;
    const chain = rope.chain(room);
    const idx = chain.indexOf(p);
    let target = m.exitAt;
    if (m.key && !m.key.done && (m.key.holder || rope.path(room, p, m.key).reached)) {
      target = m.key.holder ? f.lock : m.key;
    } else if (!m.pOpen && m.plates.length) {
      const n = chain.length;
      if (n <= 1) target = m.plates.reduce((a, b) => (a.t <= b.t ? a : b));
      else {
        const assigned = m.plates.map((pl, j) => Math.round((j * (n - 1)) / Math.max(1, m.plates.length - 1)));
        const mine = assigned.indexOf(idx);
        if (mine >= 0) target = m.plates[mine];
        else {
          // 中间的人站在两块板中间偏下的位置，别把队友拉走
          const cx = m.plates.reduce((s, pl) => s + pl.x, 0) / m.plates.length;
          const cy = m.plates.reduce((s, pl) => s + pl.y, 0) / m.plates.length + 76;
          target = { x: cx, y: cy };
        }
      }
    }
    const route = rope.path(room, p, target);
    // raw：路线已经只走安全地砖，不需要通用的"前方危险就退回"逻辑
    return { x: route.x, y: route.y, raw: true };
  },
  path(room, p, target) {
    const lay = room.map.layout;
    const g = lay.grid;
    const tiles = lay.tiles;
    const cellOf = (x, y) => [Math.floor((x - g.ox) / g.cell), Math.floor((y - g.oy) / g.cell)];
    const [si, sj] = cellOf(p.x, p.y);
    const [ti, tj] = cellOf(target.x, target.y);
    const key = (i, j) => i + ',' + j;
    const walk = (i, j) => {
      const id = g.index.get(key(i, j));
      return id !== undefined && room.tileState[id] === 0;
    };
    const prev = new Map([[key(si, sj), null]]);
    const q = [[si, sj]];
    let best = [si, sj];
    let bd = Math.hypot(si - ti, sj - tj);
    while (q.length) {
      const [i, j] = q.shift();
      const d = Math.hypot(i - ti, j - tj);
      if (d < bd) {
        bd = d;
        best = [i, j];
      }
      if (d === 0) break;
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const ni = i + di;
        const nj = j + dj;
        const k = key(ni, nj);
        if (prev.has(k) || !walk(ni, nj)) continue;
        prev.set(k, [i, j]);
        q.push([ni, nj]);
      }
    }
    // 从终点倒推，取路线上的第二个格子作为下一步
    const pathCells = [];
    for (let c = best; c; c = prev.get(key(c[0], c[1]))) pathCells.unshift(c);
    const reached = bd === 0;
    if (reached && pathCells.length <= 2) return { x: target.x, y: target.y, reached };
    const step = pathCells[Math.min(1, pathCells.length - 1)];
    const id = g.index.get(key(step[0], step[1]));
    if (id === undefined) return { x: target.x, y: target.y, reached };
    return { x: tiles[id].cx, y: tiles[id].cy, reached };
  },
};

const MODES = { classic, football, crown, paint, potato, boss, rope };
module.exports = { MODES, MODE_IDS: Object.keys(MODES) };
