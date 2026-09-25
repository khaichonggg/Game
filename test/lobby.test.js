// 大厅 / 组队功能：房主、转让、踢人、准备、队伍、设置、聊天、中途加入
const { FakeWS, makeRoom, step, check, done } = require('./helpers');

console.log('房主与权限');
{
  const { room, host } = makeRoom();
  const ws2 = new FakeWS();
  const p2 = room.addPlayer({ name: '小红', ws: ws2, token: 't2' });
  check(room.hostId === host.id, '第一个进房的人是房主');
  room.handle(p2, { t: 'settings', map: 'ice' });
  check(room.settings.map === 'lava', '非房主不能改设置');
  room.handle(p2, { t: 'kick', id: host.id });
  check(room.players.has(host.id), '非房主不能踢人');
  room.handle(host, { t: 'host', id: p2.id });
  check(room.hostId === p2.id, '房主可以把权限转让给别人');
  room.handle(host, { t: 'settings', map: 'space' });
  check(room.settings.map === 'lava', '转让后原房主失去权限');
  room.handle(p2, { t: 'settings', map: 'candy', mode: 'football', max: 6, botLevel: 2, items: false, name: '周末开黑', public: false });
  const s = room.settings;
  check(s.map === 'candy' && s.mode === 'football' && s.max === 6 && s.botLevel === 2 && s.items === false && s.name === '周末开黑' && s.public === false, '新房主可以改地图、模式、人数、机器人难度、道具开关、房间名、公开/私密');
  check(s.target === 3, '切换模式时目标重置为该模式的默认值');
  room.handle(p2, { t: 'settings', target: 99 });
  check(s.target === 3, '非法的目标值会被拒绝');
  room.handle(p2, { t: 'settings', max: 1 });
  check(s.max >= 2, '人数上限不能低于 2 和当前人数');
  // 地图切换会广播新地图数据
  check(ws2.msgs.some((m) => m.t === 'map' && m.id === 'candy'), '换地图后所有人收到新地图数据');
}

console.log('踢人 / 离开 / 自动换房主');
{
  const { room, host } = makeRoom();
  const ws2 = new FakeWS();
  const p2 = room.addPlayer({ name: '小红', ws: ws2, token: 't2' });
  room.handle(host, { t: 'kick', id: p2.id });
  check(!room.players.has(p2.id), '房主可以踢人');
  check(ws2.last('kicked'), '被踢的人收到通知');
  check(room.kicked.has('t2'), '被踢的人短时间内不能用同一身份回来');
  const p3 = room.addPlayer({ name: '阿杰', ws: new FakeWS(), token: 't3' });
  room.removePlayer(host.id);
  check(room.hostId === p3.id, '房主离开后自动由其他真人接任');
  room.handle(p3, { t: 'addBot' });
  room.removePlayer(p3.id);
  check(room.closed, '真人都走光后房间关闭（机器人不算）');
}

console.log('掉线与重连');
{
  const { room, host } = makeRoom();
  const p2 = room.addPlayer({ name: '小红', ws: new FakeWS(), token: 't2' });
  room.disconnect(host);
  check(room.hostId === host.id, '房主刚掉线时先保留房主（刷新页面不会丢房主）');
  step(room, 3);
  room.reconnect(host, new FakeWS());
  check(room.hostId === host.id, '房主几秒内回来仍然是房主');
  room.disconnect(host);
  step(room, 7);
  check(room.hostId === p2.id, '房主掉线超过 6 秒，房主转给在线的人');
  room.reconnect(host, new FakeWS());
  check(room.hostId === p2.id, '原房主回来后不会抢回房主');
  check(host.connected && room.players.has(host.id), '掉线的人可以重连回原来的位置');
  room.disconnect(p2);
  step(room, 12);
  check(!room.players.has(p2.id), '大厅里掉线超过 10 秒会被移出');
  // 游戏中掉线由 AI 托管
  room.handle(host, { t: 'addBot' });
  room.handle(host, { t: 'addBot' });
  room.startMatch();
  step(room, 4);
  room.disconnect(host);
  check(host.afk, '游戏中掉线的人由机器人托管');
  step(room, 5);
  check(room.players.has(host.id), '游戏中掉线有 60 秒宽限期');
}

console.log('准备 / 开始');
{
  const { room, host, ws } = makeRoom();
  const p2 = room.addPlayer({ name: '小红', ws: new FakeWS(), token: 't2' });
  room.handle(host, { t: 'start' });
  check(room.phase === 'lobby' && ws.last('confirmStart'), '有人没准备时，房主开始会先弹出确认');
  room.handle(p2, { t: 'ready', v: true });
  room.handle(host, { t: 'start' });
  check(room.phase === 'countdown', '所有人准备好后可以直接开始');
  const r2 = makeRoom();
  r2.room.applySettings({ mode: 'football' });
  r2.room.handle(r2.host, { t: 'start' });
  check(r2.room.phase === 'lobby' && r2.ws.last('error'), '人数不够时（足球至少 2 人）会提示');
  r2.room.handle(r2.host, { t: 'addBot' });
  r2.room.handle(r2.host, { t: 'start', force: true });
  check(r2.room.phase === 'countdown', '加机器人后可以开始');
}

console.log('队伍');
{
  const { room, host } = makeRoom();
  room.applySettings({ mode: 'football' });
  const p2 = room.addPlayer({ name: '小红', ws: new FakeWS(), token: 't2' });
  check(host.team !== p2.team, '足球模式里新加入的人自动分到人少的一队');
  room.handle(p2, { t: 'team', team: host.team });
  check(p2.team === host.team, '玩家可以自己换队');
  room.handle(host, { t: 'team', id: p2.id, team: 1 - host.team });
  check(p2.team !== host.team, '房主可以调整别人的队伍');
  for (let i = 0; i < 4; i++) room.handle(host, { t: 'addBot' });
  room.list().forEach((p) => (p.team = 0));
  room.startMatch();
  const n = [0, 0];
  room.list().forEach((p) => n[p.team]++);
  check(Math.abs(n[0] - n[1]) <= 1, '开始时如果一边没人会自动平衡队伍');
}

console.log('聊天 / 表情 / 改名 / 换装');
{
  const { room, host } = makeRoom();
  room.handle(host, { t: 'chat', text: '大家好<script>' });
  check(room.chatLog.some((c) => c.text === '大家好<script>' && c.id === host.id), '聊天消息被记录（显示时由客户端转义）');
  room.handle(host, { t: 'chat', text: '刷屏' });
  check(!room.chatLog.some((c) => c.text === '刷屏'), '发言太快会被限流');
  room.handle(host, { t: 'chat', text: 'x'.repeat(200) });
  room.events = [];
  room.handle(host, { t: 'emote', i: 3 });
  check(room.events.some((e) => e.type === 'emote' && e.i === 3), '可以发表情');
  room.handle(host, { t: 'emote', i: 99 });
  const p2 = room.addPlayer({ name: '小红', ws: new FakeWS(), token: 't2' });
  room.handle(host, { t: 'profile', name: '小红' });
  check(host.name === '房主', '不能改成房间里别人的名字');
  room.handle(host, { t: 'profile', name: '大魔王', profile: { char: 'dino', skin: 'galaxy', color: '#3fa7ff', hat: 'crown' } });
  check(host.name === '大魔王' && host.profile.char === 'dino' && host.profile.skin === 'galaxy', '可以改名和换角色 / 皮肤');
  room.handle(host, { t: 'profile', profile: { char: 'hacker', skin: '<b>', color: 'red', hat: 'x' } });
  check(host.profile.char === 'bean' && host.profile.color === '#ff5a5f', '非法外观会被重置成默认值');
  const dup = room.addPlayer({ name: '小红', ws: new FakeWS(), token: 't4' });
  check(dup.name === '小红2', '重名自动加编号');
  void p2;
}

console.log('中途加入');
{
  const { room, host } = makeRoom();
  room.handle(host, { t: 'addBot' });
  room.startMatch();
  step(room, 5);
  const late = room.addPlayer({ name: '迟到', ws: new FakeWS(), token: 't9' });
  check(!late.alive, '淘汰制模式里中途加入的人先观战');
  const r = makeRoom();
  r.room.applySettings({ mode: 'paint' });
  r.room.startMatch();
  step(r.room, 5);
  const late2 = r.room.addPlayer({ name: '迟到', ws: new FakeWS(), token: 't9' });
  step(r.room, 3);
  check(late2.alive, '可复活的模式里中途加入的人很快就能上场');
}

console.log('结算与排行榜数据');
{
  const { room, host } = makeRoom();
  host.afk = true;
  for (let i = 0; i < 3; i++) room.handle(host, { t: 'addBot' });
  room.applySettings({ mode: 'paint', target: 60 });
  room.startMatch();
  step(room, 70);
  const r = room.results;
  check(room.phase === 'gameOver' && r && r.rows.length === 4, '比赛结束后有结算数据');
  check(r && r.awards.length >= 2, `有颁奖（${r ? r.awards.map((a) => a.title).join('、') : ''}）`);
  room.handle(host, { t: 'toLobby' });
  check(room.phase === 'lobby' && room.results === r, '房主可以带大家回到大厅');
  check(room.list().filter((p) => p.bot).every((p) => p.ready), '回到大厅后机器人保持准备');
}

console.log('道具栏');
{
  const { room, host } = makeRoom();
  const ws2 = new FakeWS();
  const p2 = room.addPlayer({ name: '小红', ws: ws2, token: 't2' });
  room.handle(p2, { t: 'ready', v: true });
  room.handle(host, { t: 'start' });
  step(room, 4); // 倒计时
  check(room.phase === 'playing', '进入对局');
  const evs = [];
  const put = (type) => room.items.push({ id: 900 + room.items.length, type, x: host.x, y: host.y });
  put('speed');
  step(room, 0.1, (e) => evs.push(...e));
  check(host.item === 'speed' && host.fx.speed === 0, '捡到道具先放进道具栏，不会马上生效');
  check(evs.some((e) => e.type === 'grab' && e.id === host.id && e.item === 'speed'), '捡到时有提示事件');
  put('bomb');
  step(room, 0.1);
  check(host.item === 'speed' && room.items.some((it) => it.type === 'bomb'), '道具栏满了就不会再捡，道具留在地上');
  room.handle(host, { t: 'use' });
  check(host.item === null && host.fx.speed > 0, '按"使用"才生效，道具栏清空');
  step(room, 0.1);
  check(host.item === 'bomb', '用掉之后可以再捡');
  room.handle(p2, { t: 'use' });
  check(p2.fx.speed === 0 && !p2.item, '手上没有道具时按"使用"什么也不会发生');
  const snap = room.snapshot();
  check(snap.players.find((q) => q.id === host.id).item === 'bomb', '快照里带着每个人道具栏里的东西');
}

console.log('局域网地址（Windows 换网络时系统调用会抛错）');
{
  const os = require('os');
  const { lanAddresses } = require('../server/lan');
  const first = lanAddresses();
  const orig = os.networkInterfaces;
  os.networkInterfaces = () => {
    throw new Error('uv_interface_addresses returned Unknown system error 1');
  };
  let res;
  let threw = false;
  try {
    res = lanAddresses();
  } catch {
    threw = true;
  }
  os.networkInterfaces = orig;
  check(!threw && Array.isArray(res) && res.join() === first.join(), '取网卡地址出错时不会抛异常，沿用上一次的地址');
}

done();
