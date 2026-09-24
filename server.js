// 碰碰球大乱斗 3D —— 多人在线派对小游戏服务器
// 服务端权威物理：客户端只发送输入，服务端模拟并广播状态。
// 物理在水平面 (x, y) 上进行，客户端把 y 映射到 3D 的 z 轴。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---- 游戏参数 ----
const TICK_RATE = 60;
const SEND_RATE = 30;
// 场地由一圈圈地砖组成，外圈会按时间依次坍塌
const RING_RADII = [320, 278, 236, 194, 152, 110];
const FIRST_COLLAPSE = 10; // 开局多少秒后第一圈坍塌
const COLLAPSE_INTERVAL = 7; // 之后每隔多少秒坍塌一圈
const COLLAPSE_WARN = 3; // 坍塌前预警秒数
const PLAYER_R = 20;
const ACCEL = 1100;
const DAMPING = 2.4;
const DASH_IMPULSE = 650;
const DASH_COOLDOWN = 1.2;
const RESTITUTION = 1.7; // >1 让碰撞更"弹"，更有乐趣
const COUNTDOWN = 3;
const ROUND_END_DELAY = 3.5;
const MAX_PLAYERS = 8;
const WIN_OPTIONS = [3, 5, 7];

// ---- 道具 ----
const ITEM_TYPES = ['big', 'speed', 'shield', 'bomb'];
const ITEM_DURATION = { big: 7, speed: 6, shield: 6 };
const ITEM_MAX = 3;
const ITEM_FIRST = 3;
const ITEM_R = 18;
const BOMB_RADIUS = 180;
const BOMB_POWER = 900;

const COLORS = ['#ff5a5f', '#3fa7ff', '#ffd23f', '#3ddc84', '#b06cff', '#ff8c42', '#2ee6d6', '#ff6fb5'];
const BOT_NAMES = ['铁头', '弹弹', '旋风', '小胖', '闪电', '豆豆', '滚滚', '阿呆'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
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
let nextItemId = 1;

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
    collapsed: 0,
    items: [],
    itemTimer: ITEM_FIRST,
    winScore: WIN_OPTIONS[0],
    participants: 0,
    lastWinner: null,
    events: [],
  };
  rooms.set(code, room);
  return room;
}

function arenaR(room) {
  return RING_RADII[room.collapsed];
}

// 距离下一圈坍塌还有几秒（没有更多可塌的圈时返回 Infinity）
function nextCollapseIn(room) {
  if (room.collapsed >= RING_RADII.length - 1) return Infinity;
  return FIRST_COLLAPSE + room.collapsed * COLLAPSE_INTERVAL - room.roundTime;
}

function pickColor(room) {
  const used = new Set([...room.players.values()].map((p) => p.color));
  return COLORS.find((c) => !used.has(c)) || COLORS[Math.floor(Math.random() * COLORS.length)];
}

function addPlayer(room, { name, ws = null, bot = false }) {
  const p = {
    id: nextId++,
    name,
    ws,
    bot,
    color: pickColor(room),
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    input: { x: 0, y: 0, dash: false },
    dashCd: 0,
    alive: false,
    falling: 0,
    score: 0,
    kills: 0,
    fx: { big: 0, speed: 0, shield: 0 },
    lastHitBy: null,
    lastHitTime: 0,
    botThink: 0,
  };
  room.players.set(p.id, p);
  if (!bot && room.hostId === null) room.hostId = p.id;
  return p;
}

function removePlayer(room, id) {
  room.players.delete(id);
  if (room.hostId === id) {
    const human = [...room.players.values()].find((p) => !p.bot);
    room.hostId = human ? human.id : null;
  }
  if (![...room.players.values()].some((p) => !p.bot)) {
    rooms.delete(room.code);
  }
}

const radiusOf = (p) => (p.fx.big > 0 ? PLAYER_R * 1.6 : PLAYER_R);
const massOf = (p) => (p.fx.big > 0 ? 3 : 1) * (p.fx.shield > 0 ? 6 : 1);

function startRound(room) {
  const list = [...room.players.values()];
  room.phase = 'countdown';
  room.timer = COUNTDOWN;
  room.roundTime = 0;
  room.collapsed = 0;
  room.items = [];
  room.itemTimer = ITEM_FIRST;
  room.round++;
  room.lastWinner = null;
  room.participants = list.length;
  const spawnR = RING_RADII[0] * 0.5;
  const offset = Math.random() * Math.PI * 2;
  list.forEach((p, i) => {
    const a = offset + (i / list.length) * Math.PI * 2;
    p.x = Math.cos(a) * spawnR;
    p.y = Math.sin(a) * spawnR;
    p.vx = p.vy = 0;
    p.alive = true;
    p.falling = 0;
    p.dashCd = 0;
    p.fx = { big: 0, speed: 0, shield: 0 };
    p.lastHitBy = null;
    p.input = { x: 0, y: 0, dash: false };
  });
}

// 道具只刷在不会马上坍塌的区域
function spawnItem(room) {
  const next = nextCollapseIn(room);
  const safeR = RING_RADII[room.collapsed + (next < 6 ? 1 : 0)] - 30;
  for (let tries = 0; tries < 10; tries++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * safeR;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    const blocked = [...room.players.values()].some((p) => p.alive && Math.hypot(p.x - x, p.y - y) < 60);
    if (blocked) continue;
    const type = ITEM_TYPES[Math.floor(Math.random() * ITEM_TYPES.length)];
    room.items.push({ id: nextItemId++, type, x, y });
    return;
  }
}

function applyItem(room, p, item) {
  room.events.push({ type: 'pickup', id: p.id, item: item.type, x: item.x, y: item.y });
  if (item.type === 'bomb') {
    room.events.push({ type: 'shock', id: p.id, x: p.x, y: p.y, r: BOMB_RADIUS });
    for (const o of room.players.values()) {
      if (o === p || !o.alive || o.falling) continue;
      const dx = o.x - p.x;
      const dy = o.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > BOMB_RADIUS || d === 0) continue;
      const power = (BOMB_POWER * (1 - d / BOMB_RADIUS) + 250) / massOf(o);
      o.vx += (dx / d) * power;
      o.vy += (dy / d) * power;
      o.lastHitBy = p.id;
      o.lastHitTime = room.roundTime;
    }
  } else {
    p.fx[item.type] = ITEM_DURATION[item.type];
  }
}

function botThink(room, p, dt) {
  p.botThink -= dt;
  if (p.botThink > 0) return;
  p.botThink = 0.08 + Math.random() * 0.08;

  const others = [...room.players.values()].filter((o) => o !== p && o.alive && !o.falling);
  const distCenter = Math.hypot(p.x, p.y);
  const next = nextCollapseIn(room);
  const safeR = next < COLLAPSE_WARN + 0.5 ? RING_RADII[room.collapsed + 1] - 40 : arenaR(room) - 70;
  let tx = 0;
  let ty = 0;
  p.input.dash = false;

  let nearestItem = null;
  let itemDist = Infinity;
  for (const it of room.items) {
    const d = Math.hypot(it.x - p.x, it.y - p.y);
    if (d < itemDist && Math.hypot(it.x, it.y) < safeR + 20) {
      itemDist = d;
      nearestItem = it;
    }
  }

  let target = null;
  let best = Infinity;
  for (const o of others) {
    const d = Math.hypot(o.x - p.x, o.y - p.y);
    if (d < best) {
      best = d;
      target = o;
    }
  }

  if (distCenter > safeR) {
    // 太靠边（或脚下要塌了）就往中心跑
    tx = -p.x;
    ty = -p.y;
    if (distCenter > safeR + 30 && p.dashCd <= 0 && Math.random() < 0.3) p.input.dash = true;
  } else if (nearestItem && itemDist < 200 && itemDist < best) {
    tx = nearestItem.x - p.x;
    ty = nearestItem.y - p.y;
  } else if (target) {
    // 从目标的"内侧"撞过去，把它往外推
    const tCenter = Math.hypot(target.x, target.y) || 1;
    const aimX = target.x - (target.x / tCenter) * 25;
    const aimY = target.y - (target.y / tCenter) * 25;
    tx = aimX - p.x;
    ty = aimY - p.y;
    const dist = Math.hypot(tx, ty);
    // 对方开着护盾就别硬撞
    const scared = target.fx.shield > 0 && p.fx.shield <= 0;
    if (scared) {
      tx = -tx;
      ty = -ty;
    }
    p.input.dash = !scared && dist < 110 && p.dashCd <= 0 && Math.random() < 0.5;
  }
  const len = Math.hypot(tx, ty) || 1;
  const wobble = (Math.random() - 0.5) * 0.5;
  p.input.x = tx / len + wobble;
  p.input.y = ty / len - wobble;
}

function simulate(room, dt) {
  const list = [...room.players.values()];

  if (room.phase === 'countdown') {
    room.timer -= dt;
    if (room.timer <= 0) room.phase = 'playing';
    return;
  }
  if (room.phase === 'roundEnd') {
    room.timer -= dt;
    if (room.timer <= 0) {
      const champ = list.find((p) => p.score >= room.winScore);
      if (champ) {
        room.phase = 'gameOver';
        room.lastWinner = champ.id;
      } else {
        startRound(room);
      }
      return;
    }
  }
  if (room.phase !== 'playing' && room.phase !== 'roundEnd') return;

  if (room.phase === 'playing') {
    room.roundTime += dt;
    if (nextCollapseIn(room) <= 0) {
      room.collapsed++;
      room.events.push({ type: 'collapse', ring: room.collapsed - 1 });
      room.items = room.items.filter((it) => Math.hypot(it.x, it.y) < arenaR(room) - 10);
    }
    room.itemTimer -= dt;
    if (room.itemTimer <= 0) {
      room.itemTimer = 4 + Math.random() * 2;
      if (room.items.length < ITEM_MAX) spawnItem(room);
    }
  }

  const active = list.filter((p) => p.alive && !p.falling);

  for (const p of active) {
    for (const k of Object.keys(p.fx)) p.fx[k] = Math.max(0, p.fx[k] - dt);
    if (p.bot && room.phase === 'playing') botThink(room, p, dt);
    let ix = p.input.x;
    let iy = p.input.y;
    const il = Math.hypot(ix, iy);
    if (il > 1) {
      ix /= il;
      iy /= il;
    }
    const accel = ACCEL * (p.fx.speed > 0 ? 1.7 : 1);
    p.vx += ix * accel * dt;
    p.vy += iy * accel * dt;
    p.dashCd = Math.max(0, p.dashCd - dt);
    if (p.input.dash && p.dashCd <= 0 && room.phase === 'playing') {
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
    const damp = Math.max(0, 1 - DAMPING * dt);
    p.vx *= damp;
    p.vy *= damp;
  }

  for (const p of active) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }

  // 球与球碰撞（考虑体重：变大、护盾时更难被推动）
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
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
      a.lastHitBy = b.id;
      b.lastHitBy = a.id;
      a.lastHitTime = b.lastHitTime = room.roundTime;
      if (rel > 150) {
        room.events.push({ type: 'hit', a: a.id, b: b.id, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, power: Math.round(rel) });
      }
    }
  }

  // 捡道具
  if (room.phase === 'playing') {
    for (const p of active) {
      const r = radiusOf(p) + ITEM_R;
      const idx = room.items.findIndex((it) => Math.hypot(it.x - p.x, it.y - p.y) < r);
      if (idx >= 0) {
        const [item] = room.items.splice(idx, 1);
        applyItem(room, p, item);
      }
    }
  }

  // 掉出场地
  const R = arenaR(room);
  for (const p of active) {
    if (Math.hypot(p.x, p.y) > R) {
      p.falling = 0.6;
      room.events.push({ type: 'fall', id: p.id });
      if (p.lastHitBy && room.roundTime - p.lastHitTime < 3) {
        const killer = room.players.get(p.lastHitBy);
        if (killer) killer.kills++;
      }
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
      }
    }
  }

  if (room.phase === 'playing') {
    const standing = list.filter((p) => p.alive && !p.falling);
    const anyFalling = list.some((p) => p.falling > 0);
    const solo = room.participants <= 1;
    if (!anyFalling && (solo ? standing.length === 0 : standing.length <= 1)) {
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

const r1 = (v) => Math.round(v * 10) / 10;

function snapshot(room) {
  const next = nextCollapseIn(room);
  return {
    t: 'state',
    code: room.code,
    phase: room.phase,
    timer: Math.max(0, room.timer),
    collapsed: room.collapsed,
    warn: room.phase === 'playing' && next <= COLLAPSE_WARN ? r1(Math.max(0, next)) : -1,
    round: room.round,
    hostId: room.hostId,
    winner: room.lastWinner,
    winScore: room.winScore,
    events: room.events,
    items: room.items.map((it) => ({ id: it.id, type: it.type, x: r1(it.x), y: r1(it.y) })),
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      bot: p.bot,
      x: r1(p.x),
      y: r1(p.y),
      vx: Math.round(p.vx),
      vy: Math.round(p.vy),
      r: radiusOf(p),
      alive: p.alive,
      falling: p.falling > 0,
      score: p.score,
      kills: p.kills,
      dashCd: Math.round(p.dashCd * 100) / 100,
      fx: { big: r1(p.fx.big), speed: r1(p.fx.speed), shield: r1(p.fx.shield) },
    })),
  };
}

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg) {
  const data = JSON.stringify(msg);
  for (const p of room.players.values()) {
    if (p.ws && p.ws.readyState === p.ws.OPEN) p.ws.send(data);
  }
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
      send(ws, { t: 'joined', id: player.id, code: room.code, rings: RING_RADII });
      return;
    }
    if (!room || !player) return;

    const isHost = player.id === room.hostId;
    switch (msg.t) {
      case 'input': {
        player.input.x = Math.max(-1, Math.min(1, Number(msg.x) || 0));
        player.input.y = Math.max(-1, Math.min(1, Number(msg.y) || 0));
        if (msg.dash) player.input.dash = true;
        break;
      }
      case 'start':
        if (isHost && (room.phase === 'lobby' || room.phase === 'gameOver')) {
          for (const p of room.players.values()) {
            p.score = 0;
            p.kills = 0;
          }
          room.round = 0;
          startRound(room);
        }
        break;
      case 'setWin':
        if (isHost && room.phase === 'lobby' && WIN_OPTIONS.includes(msg.v)) room.winScore = msg.v;
        break;
      case 'addBot':
        if (isHost && room.phase === 'lobby' && room.players.size < MAX_PLAYERS) {
          const used = new Set([...room.players.values()].map((p) => p.name));
          const name = BOT_NAMES.find((n) => !used.has('🤖' + n)) || '机器人';
          addPlayer(room, { name: '🤖' + name, bot: true });
        }
        break;
      case 'removeBot':
        if (isHost && room.phase === 'lobby') {
          const bot = [...room.players.values()].reverse().find((p) => p.bot);
          if (bot) removePlayer(room, bot.id);
        }
        break;
      case 'toLobby':
        if (isHost && room.phase === 'gameOver') room.phase = 'lobby';
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
