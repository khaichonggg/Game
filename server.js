// 碰碰球大乱斗 —— 多人在线派对小游戏服务器
// 服务端权威物理：客户端只发送输入，服务端模拟并广播状态。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---- 游戏参数 ----
const TICK_RATE = 60;
const SEND_RATE = 30;
const ARENA_START = 320;
const ARENA_MIN = 110;
const SHRINK_TIME = 45; // 秒内缩到最小
const PLAYER_R = 20;
const ACCEL = 1100;
const DAMPING = 2.4;
const DASH_IMPULSE = 650;
const DASH_COOLDOWN = 1.2;
const BOUNCE = 1.35; // >1 让碰撞更"弹"，更有乐趣
const COUNTDOWN = 3;
const ROUND_END_DELAY = 3.5;
const MAX_PLAYERS = 8;
const WIN_SCORE = 5;

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
    arenaR: ARENA_START,
    roundTime: 0,
    round: 0,
    lastWinner: null,
    events: [],
  };
  rooms.set(code, room);
  return room;
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
    lastHitBy: null,
    lastHitTime: 0,
    kills: 0,
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

function startRound(room) {
  const list = [...room.players.values()];
  room.phase = 'countdown';
  room.timer = COUNTDOWN;
  room.arenaR = ARENA_START;
  room.roundTime = 0;
  room.round++;
  room.lastWinner = null;
  room.participants = list.length;
  const spawnR = ARENA_START * 0.5;
  const offset = Math.random() * Math.PI * 2;
  list.forEach((p, i) => {
    const a = offset + (i / list.length) * Math.PI * 2;
    p.x = Math.cos(a) * spawnR;
    p.y = Math.sin(a) * spawnR;
    p.vx = p.vy = 0;
    p.alive = true;
    p.falling = 0;
    p.dashCd = 0;
    p.lastHitBy = null;
    p.input = { x: 0, y: 0, dash: false };
  });
}

function botThink(room, p, dt) {
  p.botThink -= dt;
  if (p.botThink > 0) return;
  p.botThink = 0.08 + Math.random() * 0.08;

  const others = [...room.players.values()].filter((o) => o !== p && o.alive && !o.falling);
  const distCenter = Math.hypot(p.x, p.y);
  let tx = 0;
  let ty = 0;
  // 太靠边就往中心跑
  if (distCenter > room.arenaR - 70) {
    tx = -p.x;
    ty = -p.y;
  } else if (others.length) {
    let target = others[0];
    let best = Infinity;
    for (const o of others) {
      const d = Math.hypot(o.x - p.x, o.y - p.y);
      if (d < best) {
        best = d;
        target = o;
      }
    }
    // 从目标的"内侧"撞过去，把它往外推
    const tCenter = Math.hypot(target.x, target.y) || 1;
    const aimX = target.x - (target.x / tCenter) * 25;
    const aimY = target.y - (target.y / tCenter) * 25;
    tx = aimX - p.x;
    ty = aimY - p.y;
    const dist = Math.hypot(tx, ty);
    p.input.dash = dist < 110 && p.dashCd <= 0 && Math.random() < 0.5;
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
    // 结束阶段也继续让球滑动，看着更自然
  }
  if (room.phase === 'roundEnd' && room.timer <= 0) {
    const champ = list.find((p) => p.score >= WIN_SCORE);
    if (champ) {
      room.phase = 'gameOver';
      room.lastWinner = champ.id;
    } else {
      startRound(room);
    }
    return;
  }
  if (room.phase !== 'playing' && room.phase !== 'roundEnd') return;

  if (room.phase === 'playing') {
    room.roundTime += dt;
    const k = Math.min(1, room.roundTime / SHRINK_TIME);
    room.arenaR = ARENA_START - (ARENA_START - ARENA_MIN) * k;
  }

  const active = list.filter((p) => p.alive && !p.falling);

  for (const p of active) {
    if (p.bot && room.phase === 'playing') botThink(room, p, dt);
    let ix = p.input.x;
    let iy = p.input.y;
    const il = Math.hypot(ix, iy);
    if (il > 1) {
      ix /= il;
      iy /= il;
    }
    p.vx += ix * ACCEL * dt;
    p.vy += iy * ACCEL * dt;
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
        p.dashCd = DASH_COOLDOWN;
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

  // 球与球碰撞
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d === 0 || d >= PLAYER_R * 2) continue;
      const nx = dx / d;
      const ny = dy / d;
      const overlap = PLAYER_R * 2 - d;
      a.x -= nx * overlap * 0.5;
      a.y -= ny * overlap * 0.5;
      b.x += nx * overlap * 0.5;
      b.y += ny * overlap * 0.5;
      const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (rel <= 0) continue;
      const impulse = (rel * BOUNCE);
      a.vx -= impulse * nx;
      a.vy -= impulse * ny;
      b.vx += impulse * nx;
      b.vy += impulse * ny;
      a.lastHitBy = b.id;
      b.lastHitBy = a.id;
      a.lastHitTime = b.lastHitTime = room.roundTime;
      if (rel > 150) room.events.push({ type: 'hit', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, power: rel });
    }
  }

  // 掉出场地
  for (const p of active) {
    if (Math.hypot(p.x, p.y) > room.arenaR) {
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

function snapshot(room) {
  return {
    t: 'state',
    code: room.code,
    phase: room.phase,
    timer: Math.max(0, room.timer),
    arenaR: room.arenaR,
    round: room.round,
    hostId: room.hostId,
    winner: room.lastWinner,
    winScore: WIN_SCORE,
    events: room.events,
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      bot: p.bot,
      x: Math.round(p.x * 10) / 10,
      y: Math.round(p.y * 10) / 10,
      alive: p.alive,
      falling: p.falling > 0,
      score: p.score,
      kills: p.kills,
      dashCd: Math.round(p.dashCd * 100) / 100,
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
      player = addPlayer(room, { name: cleanName(msg.name), ws });
      // 中途加入：本局观战，下局参与
      send(ws, { t: 'joined', id: player.id, code: room.code });
      return;
    }
    if (!room || !player) return;

    switch (msg.t) {
      case 'input': {
        const x = Number(msg.x) || 0;
        const y = Number(msg.y) || 0;
        player.input.x = Math.max(-1, Math.min(1, x));
        player.input.y = Math.max(-1, Math.min(1, y));
        if (msg.dash) player.input.dash = true;
        break;
      }
      case 'start':
        if (player.id === room.hostId && (room.phase === 'lobby' || room.phase === 'gameOver')) {
          for (const p of room.players.values()) {
            p.score = 0;
            p.kills = 0;
          }
          room.round = 0;
          startRound(room);
        }
        break;
      case 'addBot':
        if (player.id === room.hostId && room.phase === 'lobby' && room.players.size < MAX_PLAYERS) {
          const used = new Set([...room.players.values()].map((p) => p.name));
          const name = BOT_NAMES.find((n) => !used.has('🤖' + n)) || '机器人';
          addPlayer(room, { name: '🤖' + name, bot: true });
        }
        break;
      case 'removeBot':
        if (player.id === room.hostId && room.phase === 'lobby') {
          const bot = [...room.players.values()].reverse().find((p) => p.bot);
          if (bot) removePlayer(room, bot.id);
        }
        break;
      case 'toLobby':
        if (player.id === room.hostId && room.phase === 'gameOver') {
          room.phase = 'lobby';
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
