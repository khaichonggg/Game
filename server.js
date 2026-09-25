// 碰碰球大乱斗 3D —— 服务器入口：静态文件 + HTTP 接口 + WebSocket + 主循环
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Room } = require('./server/room');
const { MAPS } = require('./server/maps');
const { fmt } = require('./server/util');
const K = require('./server/constants');
const leaderboard = require('./server/leaderboard');
const updater = require('./server/updater');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const VERSION = require('./package.json').version;
const UNDER_LAUNCHER = !!process.env.BB_LAUNCHER;
const RESTART_CODE = 75;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const rooms = new Map();

// 本机的局域网 IPv4 地址，方便同一 Wi-Fi 下的朋友加入
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  // 常见家用网段排前面
  return out.sort((a, b) => Number(!/^192\.168\./.test(a)) - Number(!/^192\.168\./.test(b)));
}

function json(res, data, code = 200) {
  res.writeHead(code, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function publicRooms() {
  return [...rooms.values()]
    .filter((r) => !r.closed && r.settings.public && r.humans().some((p) => p.connected))
    .map((r) => r.summary())
    .sort((a, b) => Number(a.phase !== 'lobby') - Number(b.phase !== 'lobby') || b.humans - a.humans);
}

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (urlPath === '/api/info') return json(res, { version: VERSION, port: PORT, lan: lanAddresses(), launcher: UNDER_LAUNCHER });
  if (urlPath === '/api/update') return handleUpdate(req, res);
  if (urlPath === '/api/rooms') return json(res, publicRooms());
  if (urlPath === '/api/leaderboard') return json(res, leaderboard.top(30));
  if (urlPath.startsWith('/api/map/')) {
    const m = MAPS[urlPath.slice(9)];
    if (!m) return json(res, { error: 'not found' }, 404);
    res.writeHead(200, { 'Content-Type': MIME['.json'] });
    res.end(m.clientDef);
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
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// 只有开服的这台电脑自己才能点更新（局域网里的朋友不能远程重启你的服务器）
function isLocal(req) {
  const a = req.socket.remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}
const busyGames = () => [...rooms.values()].filter((r) => !r.closed && r.inGame && r.humans().some((p) => p.connected)).length;

async function handleUpdate(req, res) {
  const local = isLocal(req);
  if (req.method === 'GET') {
    const force = /[?&]force=1/.test(req.url);
    const info = await updater.check(force);
    return json(res, { ...info, canUpdate: local, canRestart: UNDER_LAUNCHER, busyGames: busyGames() });
  }
  if (req.method !== 'POST') return json(res, { error: 'method' }, 405);
  // 自定义请求头：挡住其他网页偷偷发来的跨站请求
  if (!local || req.headers['x-bb-update'] !== '1') return json(res, { ok: false, error: '只能在开服的电脑上更新' }, 403);
  try {
    const r = await updater.apply((msg) => console.log('[更新]', msg));
    json(res, { ...r, restarting: UNDER_LAUNCHER });
    if (UNDER_LAUNCHER) {
      // 通知所有玩家，然后退出让启动器重启
      const note = JSON.stringify({ t: 'server', kind: 'restart', to: r.to });
      for (const room of rooms.values()) {
        room.sys('服务器正在更新到 v{v}，马上回来…', { v: r.to });
        room.broadcast(room.snapshot());
        room.broadcast(note);
      }
      setTimeout(() => process.exit(RESTART_CODE), 1200);
    }
  } catch (e) {
    json(res, { ok: false, error: e.message }, 500);
  }
}

function makeRoomCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function createRoom(opts) {
  const room = new Room(makeRoomCode(), opts);
  rooms.set(room.code, room);
  return room;
}

const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });

wss.on('connection', (ws) => {
  let room = null;
  let player = null;
  const send = (msg) => ws.readyState === 1 && ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));

  function enter(r, msg) {
    const token = typeof msg.token === 'string' ? msg.token.slice(0, 64) : null;
    if (token && r.kicked.has(token)) return send({ t: 'error', key: '你已被这个房间的房主移出', msg: '你已被这个房间的房主移出' });
    // 断线重连：同一个身份令牌回到原来的位置
    const existing = token && r.list().find((p) => p.token === token && !p.bot);
    if (existing) {
      if (existing.ws && existing.ws !== ws && existing.ws.readyState === 1) {
        existing.ws.send(JSON.stringify({ t: 'kicked', key: '你在另一个页面进入了房间', msg: '你在另一个页面进入了房间' }));
        existing.ws.close();
      }
      r.reconnect(existing, ws);
      player = existing;
    } else {
      if (r.players.size >= r.settings.max) return send({ t: 'error', key: '房间已满（{n} 人）', p: { n: r.settings.max }, msg: fmt('房间已满（{n} 人）', { n: r.settings.max }) });
      player = r.addPlayer({ name: msg.name, profile: msg.profile, ws, token });
    }
    room = r;
    send({ t: 'joined', id: player.id, code: r.code, name: player.name });
    send(r.map.clientDef);
    send({ t: 'chatlog', list: r.chatLog });
  }

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'ping') return send({ t: 'pong', c: msg.c });

    if (msg.t === 'join' && !player) {
      if (msg.quick) {
        // 快速开始：找一个等待中的公开房间，没有就新建
        const r = [...rooms.values()]
          .filter((x) => !x.closed && x.settings.public && x.phase === 'lobby' && x.players.size < x.settings.max && x.humans().some((p) => p.connected))
          .sort((a, b) => b.humans().length - a.humans().length)[0];
        return enter(r || createRoom({ public: true }), msg);
      }
      const code = String(msg.room || '').toUpperCase().trim();
      if (!code) return enter(createRoom({ name: msg.roomName, public: msg.public !== false }), msg);
      const r = rooms.get(code);
      if (!r || r.closed) return send({ t: 'error', key: '房间不存在：{code}', p: { code }, msg: fmt('房间不存在：{code}', { code }) });
      return enter(r, msg);
    }
    if (!room || !player) return;
    if (msg.t === 'leave') {
      room.removePlayer(player.id);
      room = null;
      player = null;
      send({ t: 'left' });
      return;
    }
    room.handle(player, msg);
  });

  ws.on('close', () => {
    if (!room || !player || player.ws !== ws) return;
    room.disconnect(player);
  });
});

// 主循环：60Hz 模拟，30Hz 广播
let lastSend = 0;
setInterval(() => {
  const dt = 1 / K.TICK_RATE;
  const now = Date.now();
  const doSend = now - lastSend >= 1000 / K.SEND_RATE - 1;
  for (const room of rooms.values()) {
    if (room.closed) {
      rooms.delete(room.code);
      continue;
    }
    room.tick(dt);
    if (doSend) {
      room.broadcast(room.snapshot());
      room.events = [];
    }
  }
  if (doSend) lastSend = now;
}, 1000 / K.TICK_RATE);

server.listen(PORT, () => {
  console.log(`Bumper Brawl v${VERSION} running at http://localhost:${PORT}   (碰碰球大乱斗 已启动)`);
  for (const ip of lanAddresses()) console.log(`  Friends on your network can open: http://${ip}:${PORT}   (局域网内的朋友可以访问)`);
});

