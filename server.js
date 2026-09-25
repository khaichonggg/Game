// 碰碰球大乱斗 3D —— 服务器入口：静态文件 + HTTP 接口 + WebSocket + 主循环
const http = require('http');
const fs = require('fs');
const path = require('path');
// ws 已经放在 server/vendor/ws 里（MIT 协议），下载下来直接 node server.js 就能跑，不需要 npm install
const { WebSocketServer } = require('./server/vendor/ws');
const { Room } = require('./server/room');
const { MAPS } = require('./server/maps');
const { fmt } = require('./server/util');
const K = require('./server/constants');
const leaderboard = require('./server/leaderboard');
const updater = require('./server/updater');
const { lanAddresses, terminalQR, openBrowser } = require('./server/lan');
const tunnel = require('./server/tunnel');

const FIXED_PORT = !!process.env.PORT; // 云平台指定的端口不能换
let PORT = Number(process.env.PORT) || 3000;
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
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
};

const rooms = new Map();


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
  try {
    serve(req, res);
  } catch (e) {
    logCrash(`http ${String(req.url).slice(0, 60)}`, e);
    try {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end('{"error":"server error"}');
    } catch {
      /* 连接已经断了 */
    }
  }
});
function serve(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (urlPath === '/api/info') return json(res, { version: VERSION, port: PORT, lan: lanAddresses(), launcher: UNDER_LAUNCHER });
  if (urlPath === '/api/update') return handleUpdate(req, res);
  if (urlPath === '/api/tunnel') return handleTunnel(req, res);
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
}

// 只有开服的这台电脑自己才能点更新（局域网里的朋友不能远程重启你的服务器）
function isLocal(req) {
  // 通过外网链接（Cloudflare 隧道）进来的请求，在服务器看来也来自 127.0.0.1，要靠转发头认出来
  const h = req.headers;
  if (h['cf-connecting-ip'] || h['cf-ray'] || h['x-forwarded-for'] || h['x-real-ip'] || h['forwarded']) return false;
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

// 外网链接：谁都可以看当前链接，只有开服的电脑能开 / 关
async function handleTunnel(req, res) {
  const local = isLocal(req);
  if (req.method === 'GET') return json(res, { ...tunnel.state, canControl: local, supported: !!tunnel.assetName() });
  if (req.method !== 'POST') return json(res, { error: 'method' }, 405);
  if (!local || req.headers['x-bb-update'] !== '1') return json(res, { ok: false, error: '只能在开服的电脑上操作' }, 403);
  const action = /[?&]action=stop/.test(req.url) ? 'stop' : 'start';
  if (action === 'stop') return json(res, { ...tunnel.stop(), canControl: true });
  // 开始后立刻返回，客户端轮询 GET 查看进度
  tunnel.start(PORT).then((st) => {
    if (st.status === 'running') console.log(`\n  🌍 Online link / 外网链接: ${st.url}\n`);
    else if (st.error) console.log(`\n  🌍 Online link failed / 外网链接失败: ${st.error}\n`);
  });
  json(res, { ...tunnel.state, canControl: true });
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
// 监听端口的错误（比如端口被占用）在下面 server.on('error') 里处理，ws 会把同一个错误再抛一次，这里忽略
wss.on('error', () => {});

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
    try {
      room.handle(player, msg);
    } catch (e) {
      logCrash(`message ${String(msg.t).slice(0, 20)} in room ${room.code}`, e);
    }
  });

  ws.on('close', () => {
    if (!room || !player || player.ws !== ws) return;
    room.disconnect(player);
  });
});

// 主循环：60Hz 模拟，30Hz 广播
let lastSend = 0;
// 出错兜底：记到 data/crash.log，这个房间回到大厅，服务器继续运行（别让一个 bug 把所有人踢下线）
const CRASH_LOG = path.join(__dirname, 'data', 'crash.log');
function logCrash(where, e) {
  const line = `[${new Date().toISOString()}] v${VERSION} ${where}: ${(e && e.stack) || e}\n`;
  console.error('⚠️ ' + line.trim().split('\n')[0]);
  try {
    fs.mkdirSync(path.dirname(CRASH_LOG), { recursive: true });
    fs.appendFileSync(CRASH_LOG, line);
  } catch {
    /* 写不了日志也没关系 */
  }
}
function recoverRoom(room, e) {
  logCrash(`room ${room.code} (${room.settings.mode}/${room.settings.map}, ${room.phase})`, e);
  try {
    room.events = [];
    room.toLobby();
    const key = '游戏出了点小问题，已经回到房间，可以重新开始';
    room.chat(null, key, key);
  } catch (e2) {
    logCrash(`room ${room.code} recovery`, e2);
  }
}
process.on('uncaughtException', (e) => logCrash('uncaught', e));
process.on('unhandledRejection', (e) => logCrash('unhandledRejection', e));

setInterval(() => {
  const dt = 1 / K.TICK_RATE;
  const now = Date.now();
  const doSend = now - lastSend >= 1000 / K.SEND_RATE - 1;
  for (const room of rooms.values()) {
    if (room.closed) {
      rooms.delete(room.code);
      continue;
    }
    try {
      room.tick(dt);
      if (doSend) {
        room.broadcast(room.snapshot());
        room.events = [];
      }
    } catch (e) {
      recoverRoom(room, e);
    }
  }
  if (doSend) lastSend = now;
}, 1000 / K.TICK_RATE);

// 启动：端口被占用时自动试下一个（最多试 10 个）
let tries = 0;
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && !FIXED_PORT && tries < 10) {
    console.log(`Port ${PORT} is busy, trying ${PORT + 1}…   (端口 ${PORT} 被占用，换一个)`);
    tries++;
    PORT++;
    setTimeout(() => server.listen(PORT), 100);
    return;
  }
  console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use. (端口 ${PORT} 已被占用)` : e);
  process.exit(1);
});
server.on('listening', async () => {
  const lan = lanAddresses();
  const line = '─'.repeat(64);
  console.log(`\n${line}`);
  console.log(`  🎱 Bumper Brawl v${VERSION} is running!   (碰碰球大乱斗 已启动)`);
  console.log(`\n  This computer / 本机:            http://localhost:${PORT}`);
  if (lan.length) {
    console.log(`  Friends on the same Wi-Fi / 同一 Wi-Fi 的朋友:  http://${lan[0]}:${PORT}`);
    for (const ip of lan.slice(1)) console.log(`     (other network / 其他网卡: http://${ip}:${PORT})`);
    if (process.stdout.isTTY) {
      try {
        console.log('\n  Scan with a phone to join / 手机扫码加入:\n');
        console.log(await terminalQR(`http://${lan[0]}:${PORT}`));
      } catch {
        /* 画不出二维码也没关系 */
      }
    }
  } else console.log('  (No LAN address found — is this computer on Wi-Fi? / 没找到局域网地址，电脑连网了吗？)');
  console.log('\n  Keep this window open while playing. Press Ctrl+C to stop.');
  console.log('  玩的时候不要关掉这个窗口，按 Ctrl+C 停止。');
  if (process.platform === 'win32') {
    console.log('  Windows: if a firewall prompt appears, allow "Private networks". / 弹出防火墙提示时请点「允许访问」。');
    console.log('  Don\'t click inside this window - it pauses the game. If the title says "Select", press Esc.');
    console.log('  不要点这个黑色窗口里面，点了游戏会暂停；标题出现「选择」时按 Esc 恢复。');
  }
  console.log(line + '\n');
  if (process.env.BB_OPEN === '1') openBrowser(`http://localhost:${PORT}`);
});
server.listen(PORT);
