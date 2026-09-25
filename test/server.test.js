// 联网集成测试：真实启动服务器，用 WebSocket 客户端走一遍组队流程
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const WebSocket = require('../server/vendor/ws'); // 自带的 ws，不需要 npm install
const { check, done } = require('./helpers');

const PORT = 3000 + Math.floor(Math.random() * 900) + 50;
const URL = `ws://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(joinMsg) {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL);
    const c = { ws, msgs: [], state: null, events: [] };
    c.last = (t) => [...c.msgs].reverse().find((m) => m.t === t);
    c.send = (m) => ws.send(JSON.stringify(m));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.t === 'state') {
        c.state = m;
        c.events.push(...(m.events || []));
      }
      else c.msgs.push(m);
    });
    ws.on('open', () => {
      c.send({ t: 'join', ...joinMsg });
      setTimeout(() => resolve(c), 250);
    });
  });
}
const api = async (p) => (await fetch(`http://127.0.0.1:${PORT}${p}`)).json();

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(PORT), LEADERBOARD_FILE: 'off' }, stdio: 'pipe' });
  let out = '';
  srv.stdout.on('data', (d) => (out += d));
  for (let i = 0; i < 40 && !out.includes('已启动'); i++) await sleep(100);
  try {
    // 服务器和客户端的贴图列表要一致
    const clientIds = [...fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'stickers.js'), 'utf8').matchAll(/id: '(\w+)'/g)].map((m) => m[1]);
    const { STICKERS } = require('../server/catalog');
    check(clientIds.length >= 12 && clientIds.slice().sort().join() === STICKERS.slice().sort().join(), `服务器和客户端的贴图列表一致（${STICKERS.length} 个）`);

    const info = await api('/api/info');
    check(Array.isArray(info.lan) && info.port === PORT, `/api/info 返回局域网地址（${info.lan.join(', ') || '无网卡'}）`);

    // 外网链接 / 更新接口：只有开服电脑能操作；经过 Cloudflare 隧道来的请求（带转发头）不算本机
    const t1 = await api('/api/tunnel');
    check(t1.status === 'idle' && t1.canControl === true, '本机可以控制外网链接');
    const viaTunnel = { 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '203.0.113.9' };
    const t2 = await (await fetch(`http://127.0.0.1:${PORT}/api/tunnel`, { headers: viaTunnel })).json();
    check(t2.canControl === false, '通过外网链接访问的人看不到控制按钮');
    const t3 = await fetch(`http://127.0.0.1:${PORT}/api/tunnel`, { method: 'POST', headers: { ...viaTunnel, 'x-bb-update': '1' } });
    check(t3.status === 403, '通过外网链接的人不能开关外网链接');
    const u1 = await fetch(`http://127.0.0.1:${PORT}/api/update`, { method: 'POST', headers: { ...viaTunnel, 'x-bb-update': '1' } });
    check(u1.status === 403, '通过外网链接的人不能触发更新');
    const u2 = await fetch(`http://127.0.0.1:${PORT}/api/update`, { method: 'POST' });
    check(u2.status === 403, '没有自定义请求头的跨站请求不能触发更新');

    const a = await client({ room: '', name: '小明', token: 'A', profile: { char: 'cat' }, roomName: '小明的派对' });
    const code = a.last('joined').code;
    check(/^[A-Z]{4}$/.test(code), `创建房间得到 4 位房间码 ${code}`);
    check(a.last('map') && a.last('chatlog'), '进房后收到地图数据和聊天记录');
    let rooms = await api('/api/rooms');
    check(rooms.some((r) => r.code === code && r.name === '小明的派对'), '公开房间出现在房间列表里');

    const b = await client({ room: code, name: '小红', token: 'B' });
    await sleep(100);
    check(b.state && b.state.players.length === 2, '第二个人用房间码加入');

    const q = await client({ quick: true, name: '路人', token: 'Q' });
    check(q.last('joined') && q.last('joined').code === code, '快速开始会加入已有的公开房间');

    a.send({ t: 'settings', public: false });
    await sleep(150);
    rooms = await api('/api/rooms');
    check(!rooms.some((r) => r.code === code), '设为私密后不在房间列表里显示');

    // 断线重连：同一个 token 回来还是同一个人
    const bId = b.last('joined').id;
    b.ws.terminate();
    await sleep(200);
    const b2 = await client({ room: code, name: '小红', token: 'B' });
    check(b2.last('joined').id === bId, '断线后用同一身份重连，回到原来的位置');
    // 同一身份开第二个页面：旧页面被挤下线
    const b3 = await client({ room: code, name: '小红', token: 'B' });
    await sleep(100);
    check(b2.last('kicked') && b3.last('joined').id === bId, '同一身份在新页面进入时，旧页面被挤下线');

    a.send({ t: 'kick', id: q.last('joined').id });
    await sleep(150);
    check(q.last('kicked'), '房主踢人后对方收到通知');
    const q2 = await client({ room: code, name: '路人', token: 'Q' });
    check(q2.last('error') && !q2.last('joined'), '被踢的人不能马上用同一身份回来');

    a.send({ t: 'host', id: bId });
    await sleep(150);
    check(b3.state.hostId === bId, '房主转让在所有客户端生效');

    const bad = await client({ room: 'ZZZZ', name: 'x', token: 'X' });
    check(bad.last('error'), '房间码不存在时提示错误');

    b3.send({ t: 'ping', c: 123 });
    await sleep(100);
    check(b3.last('pong') && b3.last('pong').c === 123, '延迟测量 ping/pong');

    // 贴图：所有人都收到；连发会被限速；乱写的 id 会被忽略
    b3.send({ t: 'sticker', s: 'lol' });
    b3.send({ t: 'sticker', s: 'bleh' });
    b3.send({ t: 'sticker', s: '<img onerror=x>' });
    await sleep(200);
    const stk = a.events.filter((e) => e.type === 'chat' && e.sticker);
    check(stk.length === 1 && stk[0].sticker === 'lol' && stk[0].id === bId, '贴图发给房间里所有人，1.5 秒内连发只算一个');
    const q3 = await client({ room: code, name: '后来的', token: 'L' });
    check(q3.last('chatlog') && q3.last('chatlog').list.some((l) => l.sticker === 'lol'), '贴图会留在聊天记录里，后进来的人也看得到');
    await sleep(1500);
    b3.send({ t: 'sticker', s: 'nope' });
    b3.send({ t: 'sticker', s: 'gg' });
    await sleep(200);
    check(a.events.filter((e) => e.sticker).map((e) => e.sticker).join() === 'lol,gg', '不存在的贴图 id 被忽略');

    for (const c of [a, b2, b3, q, q2, q3, bad]) c.ws.close();
  } finally {
    srv.kill();
  }
  done();
})();
