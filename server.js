// 碰碰球大乱斗 3D —— 多人在线派对小游戏服务器
// 服务端权威物理：客户端只发送输入，服务端模拟并广播状态。
// 物理在水平面 (x, y) 上进行，客户端把 y 映射到 3D 的 z 轴。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { MAPS } = require('./maps');
const leaderboard = require('./leaderboard');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---- 基础参数 ----
const TICK_RATE = 60;
const SEND_RATE = 30;
const PLAYER_R = 24;
const DASH_IMPULSE = 680;
const DASH_COOLDOWN = 1.2;
const RESTITUTION = 1.7; // >1 让碰撞更"弹"，更有乐趣
const COUNTDOWN = 3;
const ROUND_END_DELAY = 3.5;
const RESPAWN_DELAY = 2.2;
const MAX_PLAYERS = 8;
const KO_WINDOW = 3; // 被撞后几秒内掉下去算对方击飞
const CROWN_GUARD = 1.5; // 刚拿到皇冠后的保护时间

const MODES = {
  classic: { name: '经典乱斗', targets: [3, 5, 7], respawn: false },
  team: { name: '团队对抗', targets: [3, 5, 7], respawn: false },
  crown: { name: '抢皇冠', targets: [20, 30, 45], respawn: true },
  knockout: { name: '击飞大赛', targets: [60, 90, 120], respawn: true },
};

// ---- 道具 ----
const ITEM_TYPES = ['big', 'speed', 'shield', 'bomb', 'freeze', 'ghost', 'tornado', 'banana'];
const ITEM_DURATION = { big: 7, speed: 6, shield: 6, ghost: 5 };
const ITEM_MAX = 4;
const ITEM_R = 20;
const BOMB_RADIUS = 190;
const BOMB_POWER = 900;
const FREEZE_RADIUS = 250;
const FREEZE_TIME = 2;
const SLIP_TIME = 1.3;

const COLORS = ['#ff5a5f', '#3fa7ff', '#ffd23f', '#3ddc84', '#b06cff', '#ff8c42', '#2ee6d6', '#ff6fb5'];
const BOT_NAMES = ['铁头', '弹弹', '旋风', '小胖', '闪电', '豆豆', '滚滚', '阿呆'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath.startsWith('/api/map/') && MAPS[urlPath.slice(9)]) {
    res.writeHead(200, { 'Content-Type': MIME['.json'] });
    res.end(MAPS[urlPath.slice(9)].clientDef);
    return;
  }
  if (urlPath === '/api/leaderboard') {
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(leaderboard.top(30)));
    return;
  }
  const file = path.normalize(path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
const rooms = new Map();
let nextId = 1;
let nextObjId = 1;

const rand = (a, b) => a + Math.random() * (b - a);
const lerp = (a, b, k) => a + (b - a) * Math.min(1, Math.max(0, k));

function makeRoomCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function createRoom(code) {
  const room = {
    code,
    players: new Map(),
    hostId: null,
    phase: 'lobby', // lobby | countdown | playing | roundEnd | gameOver
    timer: 0,
    roundTime: 0,
    round: 0,
    modeId: 'classic',
    target: 3,
    clock: 0,
    events: [],
    teamScore: [0, 0],
    lastWinner: null,
    winnerTeam: -1,
    participants: 0,
  };
  setMap(room, 'lava');
  rooms.set(code, room);
  return room;
}

function setMap(room, id) {
  room.mapId = id;
  room.map = MAPS[id];
  resetArena(room);
}

function resetArena(room) {
  const n = room.map.layout.tiles.length;
  room.tileState = new Uint8Array(n); // 0 正常 1 预警 2 已塌
  room.tileTimer = new Float32Array(n);
  room.collapseStep = 0;
  room.crackTimer = room.map.collapse.first;
  room.items = [];
  room.itemTimer = 3;
  room.hazards = [];
  room.traps = [];
  room.meteors = [];
  room.meteorTimer = room.map.meteors ? room.map.meteors.first : Infinity;
  room.crown = null;
}

const mode = (room) => MODES[room.modeId];
const isEnemy = (room, a, b) => a !== b && (room.modeId !== 'team' || a.team !== b.team);

// ---- 地砖 ----
function tileAt(room, x, y) {
  return room.map.layout.locate(x, y);
}
function supported(room, x, y) {
  const id = tileAt(room, x, y);
  return id >= 0 && room.tileState[id] !== 2;
}
function safeAt(room, x, y) {
  const id = tileAt(room, x, y);
  return id >= 0 && room.tileState[id] === 0;
}

function warnTile(room, id, time) {
  if (room.tileState[id] !== 0) return;
  room.tileState[id] = 1;
  room.tileTimer[id] = time;
}

function breakTile(room, id) {
  room.tileState[id] = 2;
  room.tileTimer[id] = mode(room).respawn ? 9 : Infinity; // 复活类模式里地砖会重新长回来
  room.items = room.items.filter((it) => tileAt(room, it.x, it.y) !== id);
}

// 按层坍塌时，下一层还要多少秒
function nextRingCollapse(room) {
  const c = room.map.collapse;
  if (c.type !== 'rings' || mode(room).respawn) return Infinity;
  if (room.collapseStep >= room.map.layout.layers - c.keep) return Infinity;
  return c.first + room.collapseStep * c.interval - room.roundTime;
}

function updateArena(room, dt) {
  const c = room.map.collapse;
  const tiles = room.map.layout.tiles;
  // 预警 -> 坍塌；已塌 -> 重生
  for (let i = 0; i < tiles.length; i++) {
    if (room.tileState[i] === 1) {
      room.tileTimer[i] -= dt;
      if (room.tileTimer[i] <= 0) breakTile(room, i);
    } else if (room.tileState[i] === 2 && room.tileTimer[i] !== Infinity) {
      room.tileTimer[i] -= dt;
      if (room.tileTimer[i] <= 0) room.tileState[i] = 0;
    }
  }
  if (c.type === 'rings') {
    const next = nextRingCollapse(room);
    if (next <= c.warn) {
      const layer = room.collapseStep;
      for (let i = 0; i < tiles.length; i++) if (tiles[i].layer === layer) warnTile(room, i, Math.max(0, next));
      if (next <= 0) {
        room.collapseStep++;
        room.events.push({ type: 'collapse' });
      }
    }
  } else if (c.type === 'random') {
    room.crackTimer -= dt;
    if (room.crackTimer <= 0) {
      room.crackTimer = lerp(c.interval[0], c.interval[1], room.roundTime / 45);
      const ok = [];
      for (let i = 0; i < tiles.length; i++) if (room.tileState[i] === 0) ok.push(i);
      if (ok.length > c.minTiles) {
        // 越靠外越容易碎
        const maxL = room.map.layout.layers;
        let total = 0;
        const w = ok.map((i) => {
          const v = Math.pow(maxL - tiles[i].layer, 2);
          total += v;
          return v;
        });
        let r = Math.random() * total;
        let pick = ok[0];
        for (let k = 0; k < ok.length; k++) {
          r -= w[k];
          if (r <= 0) {
            pick = ok[k];
            break;
          }
        }
        warnTile(room, pick, c.warn);
      }
    }
  }
}

// 随机挑一块安全地砖（偏向中心）
function randomSafeSpot(room, avoidPlayers = true) {
  const tiles = room.map.layout.tiles;
  const maxL = room.map.layout.layers;
  const cands = [];
  for (let i = 0; i < tiles.length; i++) {
    if (room.tileState[i] !== 0) continue;
    const t = tiles[i];
    if (avoidPlayers && [...room.players.values()].some((p) => p.alive && Math.hypot(p.x - t.cx, p.y - t.cy) < 80)) continue;
    if (room.meteors.some((m) => Math.hypot(m.x - t.cx, m.y - t.cy) < m.r + 30)) continue;
    if ((room.map.bumpers || []).some((b) => Math.hypot(b.x - t.cx, b.y - t.cy) < b.r + 40)) continue;
    cands.push({ t, w: 1 + t.layer / maxL });
  }
  if (!cands.length) return null;
  const total = cands.reduce((s, c) => s + c.w, 0);
  let r = Math.random() * total;
  for (const c of cands) {
    r -= c.w;
    if (r <= 0) return c.t;
  }
  return cands[0].t;
}

// ---- 玩家 ----
function pickColor(room) {
  const used = new Set([...room.players.values()].map((p) => p.color));
  return COLORS.find((c) => !used.has(c)) || COLORS[Math.floor(Math.random() * COLORS.length)];
}

const emptyFx = () => ({ big: 0, speed: 0, shield: 0, ghost: 0, frozen: 0, slip: 0 });

function addPlayer(room, { name, ws = null, bot = false }) {
  const p = {
    id: nextId++,
    name,
    ws,
    bot,
    color: pickColor(room),
    team: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    input: { x: 0, y: 0, dash: false },
    dashCd: 0,
    alive: false,
    falling: 0,
    respawn: 0,
    score: 0,
    kills: 0,
    fx: emptyFx(),
    lastHitBy: null,
    lastHitTime: -99,
    botThink: 0,
  };
  room.players.set(p.id, p);
  if (!bot && room.hostId === null) room.hostId = p.id;
  return p;
}

function removePlayer(room, id) {
  room.players.delete(id);
  if (room.crown && room.crown.holder === id) dropCrown(room, 0, 0);
  if (room.hostId === id) {
    const human = [...room.players.values()].find((p) => !p.bot);
    room.hostId = human ? human.id : null;
  }
  if (![...room.players.values()].some((p) => !p.bot)) rooms.delete(room.code);
}

const radiusOf = (p) => (p.fx.big > 0 ? PLAYER_R * 1.55 : PLAYER_R);
const massOf = (p) => (p.fx.big > 0 ? 3 : 1) * (p.fx.shield > 0 ? 6 : 1) * (p.fx.frozen > 0 ? 1.5 : 1);
const controllable = (p) => p.fx.frozen <= 0 && p.fx.slip <= 0;

function hitBy(room, victim, attacker) {
  victim.lastHitBy = attacker.id;
  victim.lastHitTime = room.roundTime;
}

// ---- 比赛流程 ----
function startMatch(room) {
  for (const p of room.players.values()) {
    p.score = 0;
    p.kills = 0;
  }
  room.round = 0;
  room.teamScore = [0, 0];
  room.winnerTeam = -1;
  if (room.modeId === 'team') {
    // 随机分成人数平均的两队
    const list = [...room.players.values()].sort(() => Math.random() - 0.5);
    list.forEach((p, i) => (p.team = i % 2));
  }
  room.clock = room.modeId === 'knockout' ? room.target : 0;
  startRound(room);
}

function startRound(room) {
  const list = [...room.players.values()];
  resetArena(room);
  room.phase = 'countdown';
  room.timer = COUNTDOWN;
  room.roundTime = 0;
  room.round++;
  room.lastWinner = null;
  room.winnerTeam = -1;
  room.participants = list.length;
  if (room.modeId === 'crown') {
    const blocked = (room.map.bumpers || []).some((b) => Math.hypot(b.x, b.y) < b.r + 40);
    const t = blocked ? randomSafeSpot(room, false) : null;
    room.crown = { holder: null, x: t ? t.cx : 0, y: t ? t.cy : 0, wait: 0, guard: 0 };
  }
  // 队友站在一起
  const order = room.modeId === 'team' ? [...list].sort((a, b) => a.team - b.team) : list;
  const spawnR = Math.min(230, room.map.layout.radius * 0.5);
  const offset = Math.random() * Math.PI * 2;
  order.forEach((p, i) => {
    const a = offset + (i / order.length) * Math.PI * 2;
    p.x = Math.cos(a) * spawnR;
    p.y = Math.sin(a) * spawnR;
    if (!safeAt(room, p.x, p.y) || (room.map.bumpers || []).some((b) => Math.hypot(b.x - p.x, b.y - p.y) < b.r + 30)) {
      const t = randomSafeSpot(room, false);
      if (t) {
        p.x = t.cx;
        p.y = t.cy;
      }
    }
    p.vx = p.vy = 0;
    p.alive = true;
    p.falling = 0;
    p.respawn = 0;
    p.dashCd = 0;
    p.fx = emptyFx();
    p.lastHitBy = null;
    p.input = { x: 0, y: 0, dash: false };
  });
}

function endMatch(room, winners) {
  room.phase = 'gameOver';
  room.lastWinner = winners.length === 1 ? winners[0].id : null;
  const winSet = new Set(winners.map((p) => p.id));
  leaderboard.record(
    [...room.players.values()]
      .filter((p) => !p.bot)
      .map((p) => ({ name: p.name, won: winSet.has(p.id), kos: p.kills }))
  );
}

function spawnItem(room) {
  const t = randomSafeSpot(room);
  if (!t) return;
  if (room.items.some((it) => Math.hypot(it.x - t.cx, it.y - t.cy) < 60)) return;
  const type = ITEM_TYPES[Math.floor(Math.random() * ITEM_TYPES.length)];
  room.items.push({ id: nextObjId++, type, x: t.cx, y: t.cy });
}

function applyItem(room, p, item) {
  room.events.push({ type: 'pickup', id: p.id, item: item.type, x: item.x, y: item.y });
  const others = [...room.players.values()].filter((o) => isEnemy(room, p, o) && o.alive && !o.falling && o.fx.ghost <= 0);
  switch (item.type) {
    case 'bomb':
      room.events.push({ type: 'shock', id: p.id, x: p.x, y: p.y, r: BOMB_RADIUS });
      for (const o of others) {
        const dx = o.x - p.x;
        const dy = o.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d > BOMB_RADIUS || d === 0) continue;
        const power = (BOMB_POWER * (1 - d / BOMB_RADIUS) + 250) / massOf(o);
        o.vx += (dx / d) * power;
        o.vy += (dy / d) * power;
        hitBy(room, o, p);
      }
      break;
    case 'freeze':
      room.events.push({ type: 'freeze', id: p.id, x: p.x, y: p.y, r: FREEZE_RADIUS });
      for (const o of others) {
        if (Math.hypot(o.x - p.x, o.y - p.y) > FREEZE_RADIUS || o.fx.shield > 0) continue;
        o.fx.frozen = FREEZE_TIME;
        o.vx *= 0.3;
        o.vy *= 0.3;
      }
      break;
    case 'tornado': {
      const sp = Math.hypot(p.vx, p.vy);
      const a = sp > 20 ? Math.atan2(p.vy, p.vx) : Math.random() * Math.PI * 2;
      room.hazards.push({ id: nextObjId++, type: 'tornado', x: p.x + Math.cos(a) * 70, y: p.y + Math.sin(a) * 70, a, life: 7, owner: p.id, team: p.team });
      break;
    }
    case 'banana': {
      const sp = Math.hypot(p.vx, p.vy);
      const dx = sp > 20 ? p.vx / sp : 0;
      const dy = sp > 20 ? p.vy / sp : 1;
      for (let k = -1; k <= 1; k++) {
        const bx = p.x - dx * 55 + dy * k * 40;
        const by = p.y - dy * 55 - dx * k * 40;
        room.traps.push({ id: nextObjId++, x: bx, y: by, owner: p.id, arm: 0.8, life: 25 });
      }
      break;
    }
    default:
      p.fx[item.type] = ITEM_DURATION[item.type];
  }
}

function dropCrown(room, x, y) {
  room.crown = { holder: null, x, y, wait: 1, guard: 0 };
}

// ---- 机器人 ----
function botThink(room, p, dt) {
  p.botThink -= dt;
  if (p.botThink > 0) return;
  p.botThink = rand(0.08, 0.16);
  p.input.dash = false;
  const tiles = room.map.layout.tiles;

  // 找一块最安全的落脚点：状态正常、越靠内越好、离自己越近越好
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
  const toRefuge = refuge ? [refuge.cx - p.x, refuge.cy - p.y] : [-p.x, -p.y];

  const enemies = [...room.players.values()].filter((o) => isEnemy(room, p, o) && o.alive && !o.falling && o.fx.ghost <= 0);
  let target = null;
  let targetD = Infinity;
  for (const o of enemies) {
    const d = Math.hypot(o.x - p.x, o.y - p.y);
    if (d < targetD) {
      targetD = d;
      target = o;
    }
  }
  let dir = null;
  let chase = null;

  // 躲陨石、龙卷风
  for (const m of room.meteors) {
    if (Math.hypot(p.x - m.x, p.y - m.y) < m.r + 40) dir = [p.x - m.x || 1, p.y - m.y];
  }
  for (const h of room.hazards) {
    if (h.owner !== p.id && Math.hypot(p.x - h.x, p.y - h.y) < 140) dir = [p.x - h.x || 1, p.y - h.y];
  }

  if (!dir) {
    if (room.modeId === 'crown' && room.crown) {
      if (room.crown.holder === p.id) {
        // 拿着皇冠：远离最近的敌人，往安全地带跑
        dir = target && targetD < 220 ? [p.x - target.x + toRefuge[0] * 0.5, p.y - target.y + toRefuge[1] * 0.5] : toRefuge;
        if (target && targetD < 90 && p.dashCd <= 0) p.input.dash = true;
      } else if (room.crown.holder) {
        chase = room.players.get(room.crown.holder);
      } else {
        dir = [room.crown.x - p.x, room.crown.y - p.y];
      }
    }
    if (!dir && !chase) {
      let item = null;
      let itemD = Infinity;
      for (const it of room.items) {
        const d = Math.hypot(it.x - p.x, it.y - p.y);
        if (d < itemD) {
          itemD = d;
          item = it;
        }
      }
      if (item && itemD < 220 && itemD < targetD) dir = [item.x - p.x, item.y - p.y];
      else chase = target;
    }
    if (chase && !dir) {
      // 从目标"靠内"的一侧撞过去，把它往外推
      const rx = refuge ? refuge.cx : 0;
      const ry = refuge ? refuge.cy : 0;
      const ox = chase.x - rx;
      const oy = chase.y - ry;
      const ol = Math.hypot(ox, oy) || 1;
      dir = [chase.x - (ox / ol) * 25 - p.x, chase.y - (oy / ol) * 25 - p.y];
      const scared = chase.fx.shield > 0 && p.fx.shield <= 0;
      if (scared) dir = [-dir[0], -dir[1]];
      else if (Math.hypot(chase.x - p.x, chase.y - p.y) < 115 && p.dashCd <= 0 && Math.random() < 0.5) p.input.dash = true;
    }
    if (!dir) dir = toRefuge;
  }

  // 前方不安全就回安全区；脚下在预警就冲刺逃跑
  const dl = Math.hypot(dir[0], dir[1]) || 1;
  const ax = p.x + (dir[0] / dl) * 70;
  const ay = p.y + (dir[1] / dl) * 70;
  const hereSafe = safeAt(room, p.x, p.y);
  if (!safeAt(room, ax, ay) || !hereSafe) {
    dir = toRefuge;
    p.input.dash = !hereSafe && p.dashCd <= 0 && Math.random() < 0.4;
  }
  const len = Math.hypot(dir[0], dir[1]) || 1;
  const wobble = (Math.random() - 0.5) * 0.4;
  p.input.x = dir[0] / len + wobble;
  p.input.y = dir[1] / len - wobble;
}

// ---- 模拟 ----
function simulate(room, dt) {
  const list = [...room.players.values()];
  const md = mode(room);

  if (room.phase === 'countdown') {
    room.timer -= dt;
    if (room.timer <= 0) room.phase = 'playing';
    return;
  }
  if (room.phase === 'roundEnd') {
    room.timer -= dt;
    if (room.timer <= 0) {
      let champs = [];
      if (room.modeId === 'team') {
        const t = room.teamScore.findIndex((s) => s >= room.target);
        if (t >= 0) {
          champs = list.filter((p) => p.team === t);
          room.winnerTeam = t;
        }
      } else {
        champs = list.filter((p) => p.score >= room.target);
      }
      if (champs.length) endMatch(room, champs);
      else startRound(room);
      return;
    }
  }
  if (room.phase !== 'playing' && room.phase !== 'roundEnd') return;
  const playing = room.phase === 'playing';

  if (playing) {
    room.roundTime += dt;
    updateArena(room, dt);
    room.itemTimer -= dt;
    if (room.itemTimer <= 0) {
      room.itemTimer = rand(3.5, 5.5);
      if (room.items.length < ITEM_MAX) spawnItem(room);
    }
    // 陨石雨
    const mc = room.map.meteors;
    if (mc) {
      room.meteorTimer -= dt;
      if (room.meteorTimer <= 0) {
        room.meteorTimer = lerp(mc.interval[0], mc.interval[1], room.roundTime / 50);
        const alive = list.filter((p) => p.alive && !p.falling);
        // 一半概率瞄准某个玩家附近
        let x;
        let y;
        if (alive.length && Math.random() < 0.5) {
          const v = alive[Math.floor(Math.random() * alive.length)];
          x = v.x + rand(-60, 60);
          y = v.y + rand(-60, 60);
        } else {
          const t = randomSafeSpot(room, false);
          x = t ? t.cx : 0;
          y = t ? t.cy : 0;
        }
        if (tileAt(room, x, y) >= 0) room.meteors.push({ id: nextObjId++, x, y, t: mc.warn, r: mc.radius });
      }
    }
  }

  const active = list.filter((p) => p.alive && !p.falling);
  const phys = room.map.physics;

  for (const p of active) {
    for (const k of Object.keys(p.fx)) p.fx[k] = Math.max(0, p.fx[k] - dt);
    if (p.bot && playing) botThink(room, p, dt);
    let ix = controllable(p) ? p.input.x : 0;
    let iy = controllable(p) ? p.input.y : 0;
    const il = Math.hypot(ix, iy);
    if (il > 1) {
      ix /= il;
      iy /= il;
    }
    const holder = room.crown && room.crown.holder === p.id;
    const accel = phys.accel * (p.fx.speed > 0 ? 1.7 : 1) * (holder ? 0.9 : 1);
    p.vx += ix * accel * dt;
    p.vy += iy * accel * dt;
    p.dashCd = Math.max(0, p.dashCd - dt);
    if (p.input.dash && p.dashCd <= 0 && playing && controllable(p)) {
      let dx = ix;
      let dy = iy;
      if (Math.hypot(dx, dy) < 0.1) {
        const sp = Math.hypot(p.vx, p.vy);
        dx = sp > 1 ? p.vx / sp : 0;
        dy = sp > 1 ? p.vy / sp : 0;
      }
      const dl = Math.hypot(dx, dy);
      if (dl > 0) {
        p.vx += (dx / dl) * DASH_IMPULSE;
        p.vy += (dy / dl) * DASH_IMPULSE;
        p.dashCd = p.fx.speed > 0 ? DASH_COOLDOWN * 0.45 : DASH_COOLDOWN;
        room.events.push({ type: 'dash', id: p.id });
      }
    }
    p.input.dash = false;
    // 冰冻、踩香蕉时会滑行
    const damping = p.fx.slip > 0 ? 0.35 : p.fx.frozen > 0 ? 0.8 : phys.damping;
    const damp = Math.max(0, 1 - damping * dt);
    p.vx *= damp;
    p.vy *= damp;
  }

  for (const p of active) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }

  // 球与球碰撞（考虑体重：变大、护盾时更难被推动；幽灵穿透）
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      if (a.fx.ghost > 0 || b.fx.ghost > 0) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      const minD = radiusOf(a) + radiusOf(b);
      if (d === 0 || d >= minD) continue;
      const nx = dx / d;
      const ny = dy / d;
      const ima = 1 / massOf(a);
      const imb = 1 / massOf(b);
      const share = ima / (ima + imb);
      const overlap = minD - d;
      a.x -= nx * overlap * share;
      a.y -= ny * overlap * share;
      b.x += nx * overlap * (1 - share);
      b.y += ny * overlap * (1 - share);
      const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (rel <= 0) continue;
      const jImp = ((1 + RESTITUTION) * rel) / (ima + imb);
      a.vx -= jImp * ima * nx;
      a.vy -= jImp * ima * ny;
      b.vx += jImp * imb * nx;
      b.vy += jImp * imb * ny;
      hitBy(room, a, b);
      hitBy(room, b, a);
      if (rel > 150) {
        room.events.push({ type: 'hit', a: a.id, b: b.id, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, power: Math.round(rel) });
      }
      // 抢皇冠：用力撞到持有者就把皇冠抢过来
      if (room.crown && room.crown.holder && room.crown.guard <= 0 && rel > 240 && playing && isEnemy(room, a, b)) {
        const h = room.crown.holder;
        const taker = h === a.id ? b : h === b.id ? a : null;
        if (taker) {
          room.crown.holder = taker.id;
          room.crown.guard = CROWN_GUARD;
          room.events.push({ type: 'crown', id: taker.id, from: h });
        }
      }
    }
  }

  // 软糖弹簧（静止的超弹障碍）
  (room.map.bumpers || []).forEach((bp, bi) => {
    for (const p of active) {
      const dx = p.x - bp.x;
      const dy = p.y - bp.y;
      const d = Math.hypot(dx, dy);
      const minD = bp.r + radiusOf(p);
      if (d === 0 || d >= minD) continue;
      const nx = dx / d;
      const ny = dy / d;
      p.x = bp.x + nx * minD;
      p.y = bp.y + ny * minD;
      const vn = p.vx * nx + p.vy * ny;
      const out = Math.max(420, -vn * 1.5) / Math.sqrt(massOf(p));
      p.vx += (out - vn) * nx;
      p.vy += (out - vn) * ny;
      room.events.push({ type: 'bump', i: bi, x: bp.x + nx * bp.r, y: bp.y + ny * bp.r });
    }
  });

  // 龙卷风：四处游走，把靠近的人卷起来甩出去
  for (const h of room.hazards) {
    h.life -= dt;
    h.a += rand(-2, 2) * dt;
    if (Math.hypot(h.x, h.y) > room.map.layout.radius * 0.7) h.a = Math.atan2(-h.y, -h.x) + rand(-0.5, 0.5);
    h.x += Math.cos(h.a) * 130 * dt;
    h.y += Math.sin(h.a) * 130 * dt;
    const owner = room.players.get(h.owner);
    for (const p of active) {
      if (p.id === h.owner || p.fx.ghost > 0 || (room.modeId === 'team' && p.team === h.team)) continue;
      const dx = p.x - h.x;
      const dy = p.y - h.y;
      const d = Math.hypot(dx, dy);
      if (d > 95 || d === 0) continue;
      const k = (1 - d / 95) / massOf(p);
      p.vx += ((-dy / d) * 2400 + (dx / d) * 1300) * k * dt;
      p.vy += ((dx / d) * 2400 + (dy / d) * 1300) * k * dt;
      if (owner) hitBy(room, p, owner);
    }
  }
  room.hazards = room.hazards.filter((h) => h.life > 0);

  // 香蕉皮
  for (const tr of room.traps) {
    tr.arm -= dt;
    tr.life -= dt;
    for (const p of active) {
      if ((p.id === tr.owner && tr.arm > 0) || p.fx.ghost > 0 || tr.life <= 0) continue;
      if (Math.hypot(p.x - tr.x, p.y - tr.y) < radiusOf(p) + 14) {
        tr.life = 0;
        p.fx.slip = SLIP_TIME;
        const sp = Math.hypot(p.vx, p.vy) || 1;
        p.vx += (p.vx / sp) * 250;
        p.vy += (p.vy / sp) * 250;
        const owner = room.players.get(tr.owner);
        if (owner && owner !== p) hitBy(room, p, owner);
        room.events.push({ type: 'slip', id: p.id, x: tr.x, y: tr.y });
      }
    }
  }
  room.traps = room.traps.filter((t) => t.life > 0);

  // 陨石落地
  for (const m of room.meteors) {
    m.t -= dt;
    if (m.t > 0) continue;
    room.events.push({ type: 'meteor', x: m.x, y: m.y, r: m.r });
    const id = tileAt(room, m.x, m.y);
    if (id >= 0 && room.tileState[id] !== 2) breakTile(room, id);
    for (const p of active) {
      const dx = p.x - m.x;
      const dy = p.y - m.y;
      const d = Math.hypot(dx, dy);
      if (d > m.r * 1.6 || p.fx.ghost > 0) continue;
      const power = (room.map.meteors.power * (1 - d / (m.r * 1.6)) + 200) / massOf(p);
      const nx = d > 0 ? dx / d : 1;
      const ny = d > 0 ? dy / d : 0;
      p.vx += nx * power;
      p.vy += ny * power;
    }
  }
  room.meteors = room.meteors.filter((m) => m.t > 0);

  if (playing) {
    // 捡道具
    for (const p of active) {
      const r = radiusOf(p) + ITEM_R;
      const idx = room.items.findIndex((it) => Math.hypot(it.x - p.x, it.y - p.y) < r);
      if (idx >= 0) {
        const [item] = room.items.splice(idx, 1);
        applyItem(room, p, item);
      }
    }
    // 皇冠
    const cr = room.crown;
    if (cr) {
      if (!cr.holder) {
        cr.wait -= dt;
        if (cr.wait <= 0) {
          const p = active.find((q) => q.fx.ghost <= 0 && Math.hypot(q.x - cr.x, q.y - cr.y) < radiusOf(q) + 26);
          if (p) {
            cr.holder = p.id;
            cr.guard = CROWN_GUARD;
            room.events.push({ type: 'crown', id: p.id });
          }
        }
      } else {
        cr.guard -= dt;
        const h = room.players.get(cr.holder);
        if (h) {
          h.score += dt;
          if (h.score >= room.target) {
            h.score = room.target;
            endMatch(room, [h]);
            return;
          }
        }
      }
    }
  }

  // 掉出场地
  for (const p of active) {
    if (supported(room, p.x, p.y)) continue;
    p.falling = 0.6;
    room.events.push({ type: 'fall', id: p.id });
    const killer = p.lastHitBy && room.roundTime - p.lastHitTime < KO_WINDOW ? room.players.get(p.lastHitBy) : null;
    if (killer && killer !== p && isEnemy(room, killer, p)) {
      killer.kills++;
      if (room.modeId === 'knockout') killer.score++;
      room.events.push({ type: 'ko', id: killer.id, victim: p.id });
    }
    if (room.crown && room.crown.holder === p.id) {
      const t = randomSafeSpot(room, false);
      dropCrown(room, t ? t.cx : 0, t ? t.cy : 0);
      room.events.push({ type: 'crownDrop' });
    }
  }
  for (const p of list) {
    if (p.falling > 0) {
      p.falling -= dt;
      p.x += p.vx * dt * 0.5;
      p.y += p.vy * dt * 0.5;
      if (p.falling <= 0) {
        p.falling = 0;
        p.alive = false;
        if (md.respawn) p.respawn = RESPAWN_DELAY;
      }
    } else if (!p.alive && md.respawn && p.respawn > 0 && playing) {
      p.respawn -= dt;
      if (p.respawn <= 0) {
        const t = randomSafeSpot(room);
        if (t) {
          p.x = t.cx;
          p.y = t.cy;
          p.vx = p.vy = 0;
          p.alive = true;
          p.fx = emptyFx();
          p.fx.ghost = 1.2; // 复活保护
          p.dashCd = 0;
          room.events.push({ type: 'respawn', id: p.id });
        } else {
          p.respawn = 0.5;
        }
      }
    }
  }

  if (!playing) return;

  // 胜负判定
  if (room.modeId === 'knockout') {
    room.clock -= dt;
    if (room.clock <= 0) {
      room.clock = 0;
      const top = Math.max(...list.map((p) => p.score));
      endMatch(room, list.filter((p) => p.score === top));
    }
    return;
  }
  if (md.respawn) return;

  const standing = list.filter((p) => p.alive && !p.falling);
  if (list.some((p) => p.falling > 0)) return;
  if (room.modeId === 'team') {
    const teams = new Set(standing.map((p) => p.team));
    const hadBoth = new Set(list.map((p) => p.team)).size > 1;
    if (hadBoth ? teams.size <= 1 : standing.length === 0) {
      room.phase = 'roundEnd';
      room.timer = ROUND_END_DELAY;
      room.winnerTeam = teams.size === 1 && hadBoth ? [...teams][0] : -1;
      if (room.winnerTeam >= 0) {
        room.teamScore[room.winnerTeam]++;
        for (const p of list) if (p.team === room.winnerTeam) p.score++;
      }
    }
  } else {
    const solo = room.participants <= 1;
    if (solo ? standing.length === 0 : standing.length <= 1) {
      room.phase = 'roundEnd';
      room.timer = ROUND_END_DELAY;
      const winner = standing[0];
      if (winner && !solo) {
        winner.score++;
        room.lastWinner = winner.id;
      }
    }
  }
}

// ---- 网络 ----
const r1 = (v) => Math.round(v * 10) / 10;

function snapshot(room) {
  const next = nextRingCollapse(room);
  const cr = room.crown;
  return {
    t: 'state',
    code: room.code,
    phase: room.phase,
    timer: Math.max(0, room.timer),
    map: room.mapId,
    mode: room.modeId,
    target: room.target,
    round: room.round,
    hostId: room.hostId,
    winner: room.lastWinner,
    winnerTeam: room.winnerTeam,
    teamScore: room.teamScore,
    clock: room.modeId === 'knockout' ? r1(room.phase === 'lobby' ? room.target : room.clock) : null,
    warn: room.phase === 'playing' && next <= room.map.collapse.warn ? r1(Math.max(0, next)) : -1,
    tiles: String.fromCharCode(...room.tileState.map((s) => 48 + s)),
    events: room.events,
    items: room.items.map((it) => ({ id: it.id, type: it.type, x: r1(it.x), y: r1(it.y) })),
    hazards: room.hazards.map((h) => ({ id: h.id, type: h.type, x: r1(h.x), y: r1(h.y), life: r1(h.life) })),
    traps: room.traps.map((t) => ({ id: t.id, x: r1(t.x), y: r1(t.y) })),
    meteors: room.meteors.map((m) => ({ id: m.id, x: r1(m.x), y: r1(m.y), t: r1(m.t), r: m.r })),
    crown: cr ? (cr.holder ? { h: cr.holder } : { x: r1(cr.x), y: r1(cr.y) }) : null,
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      bot: p.bot,
      team: p.team,
      x: r1(p.x),
      y: r1(p.y),
      vx: Math.round(p.vx),
      vy: Math.round(p.vy),
      r: radiusOf(p),
      alive: p.alive,
      falling: p.falling > 0,
      respawn: r1(p.respawn),
      score: r1(p.score),
      kills: p.kills,
      dashCd: Math.round(p.dashCd * 100) / 100,
      fx: Object.fromEntries(Object.entries(p.fx).map(([k, v]) => [k, r1(v)])),
    })),
  };
}

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
}

function broadcast(room, msg) {
  const data = typeof msg === 'string' ? msg : JSON.stringify(msg);
  for (const p of room.players.values()) send(p.ws, data);
}

function cleanName(name) {
  const n = String(name || '').trim().slice(0, 12);
  return n || '玩家' + Math.floor(Math.random() * 900 + 100);
}

wss.on('connection', (ws) => {
  let room = null;
  let player = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.t === 'join' && !player) {
      const code = String(msg.room || '').toUpperCase().trim();
      if (code) {
        room = rooms.get(code);
        if (!room) {
          send(ws, { t: 'error', msg: '房间不存在：' + code });
          return;
        }
      } else {
        room = createRoom(makeRoomCode());
      }
      if (room.players.size >= MAX_PLAYERS) {
        send(ws, { t: 'error', msg: '房间已满（最多 ' + MAX_PLAYERS + ' 人）' });
        room = null;
        return;
      }
      // 中途加入：本局观战，下局参与
      player = addPlayer(room, { name: cleanName(msg.name), ws });
      const blue = [...room.players.values()].filter((p) => p.team === 1).length;
      player.team = blue < (room.players.size - 1) / 2 ? 1 : 0;
      send(ws, { t: 'joined', id: player.id, code: room.code });
      send(ws, room.map.clientDef);
      return;
    }
    if (!room || !player) return;

    const isHost = player.id === room.hostId;
    const inLobby = room.phase === 'lobby' || room.phase === 'gameOver';
    switch (msg.t) {
      case 'input':
        player.input.x = Math.max(-1, Math.min(1, Number(msg.x) || 0));
        player.input.y = Math.max(-1, Math.min(1, Number(msg.y) || 0));
        if (msg.dash) player.input.dash = true;
        break;
      case 'start':
        if (isHost && inLobby) startMatch(room);
        break;
      case 'setMap':
        if (isHost && inLobby && MAPS[msg.v]) {
          setMap(room, msg.v);
          broadcast(room, room.map.clientDef);
        }
        break;
      case 'setMode':
        if (isHost && inLobby && MODES[msg.v]) {
          room.modeId = msg.v;
          room.target = MODES[msg.v].targets[0];
        }
        break;
      case 'setTarget':
        if (isHost && inLobby && mode(room).targets.includes(msg.v)) room.target = msg.v;
        break;
      case 'addBot':
        if (isHost && inLobby && room.players.size < MAX_PLAYERS) {
          const used = new Set([...room.players.values()].map((p) => p.name));
          const name = BOT_NAMES.find((n) => !used.has('🤖' + n)) || '机器人';
          addPlayer(room, { name: '🤖' + name, bot: true });
        }
        break;
      case 'removeBot':
        if (isHost && inLobby) {
          const bot = [...room.players.values()].reverse().find((p) => p.bot);
          if (bot) removePlayer(room, bot.id);
        }
        break;
      case 'toLobby':
        if (isHost && room.phase === 'gameOver') {
          room.phase = 'lobby';
          resetArena(room);
        }
        break;
    }
  });

  ws.on('close', () => {
    if (room && player) removePlayer(room, player.id);
  });
});

// 主循环
let lastSend = 0;
setInterval(() => {
  const dt = 1 / TICK_RATE;
  const now = Date.now();
  const doSend = now - lastSend >= 1000 / SEND_RATE;
  for (const room of rooms.values()) {
    simulate(room, dt);
    if (doSend) {
      broadcast(room, snapshot(room));
      room.events = [];
    }
  }
  if (doSend) lastSend = now;
}, 1000 / TICK_RATE);

server.listen(PORT, () => {
  console.log(`碰碰球大乱斗 已启动：http://localhost:${PORT}`);
});
