// 每个模式 × 每张地图都用 8 个 AI 打一整场，检查能正常结束、没有异常数值
const { makeRoom, step, check, done } = require('./helpers');
const { MODES } = require('../server/modes');
const { MAPS } = require('../server/maps');

const LIMIT = 900; // 模拟时间上限（秒）
const summary = [];

function runMatch(mapId, modeId, players = 8, target) {
  const { room, host } = makeRoom();
  host.afk = true; // 让 AI 托管房主
  room.applySettings({ map: mapId, mode: modeId });
  if (target) room.applySettings({ target });
  for (let i = 1; i < players; i++) room.handle(host, { t: 'addBot' });
  room.startMatch();
  const ev = {};
  let bad = null;
  let t = 0;
  while (room.phase !== 'gameOver' && t < LIMIT) {
    step(room, 5, (events) => {
      for (const e of events) ev[e.type] = (ev[e.type] || 0) + 1;
    });
    t += 5;
    for (const b of room.activeBodies()) {
      if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.vx)) bad = `${b.kind} ${b.id} 坐标异常`;
    }
    const snap = room.snapshot();
    JSON.stringify(snap); // 快照必须能序列化
  }
  return { room, ev, t, bad };
}

for (const modeId of Object.keys(MODES)) {
  for (const mapId of Object.keys(MAPS)) {
    const { room, ev, t, bad } = runMatch(mapId, modeId);
    const r = room.results;
    const ok = room.phase === 'gameOver' && r && r.rows.length === 8 && !bad;
    check(ok, `${modeId.padEnd(8)} @ ${mapId.padEnd(5)} 在 ${Math.round(room.matchTime)}s 内打完（${room.round} 局）${bad ? ' ' + bad : ''}`);
    summary.push({ modeId, mapId, time: Math.round(room.matchTime), rounds: room.round, ev, winners: r ? r.winners.length : 0, awards: r ? r.awards.map((a) => a.title).join('/') : '' });
  }
}

// 协作模式：1 人和 8 人、三种难度都能结束
for (const [n, d] of [
  [1, 1],
  [1, 3],
  [4, 2],
  [8, 3],
]) {
  const { room, t } = runMatch('lava', 'boss', n, d);
  const r = room.results;
  check(room.phase === 'gameOver' && r && r.coop, `boss ${n} 人 难度${d}：${r && r.coop ? (r.coop.win ? '胜利' : '失败') : '未结束'}，用时 ${Math.round(room.matchTime)}s`);
}

// 模式特有的事件必须真的发生过
const has = (modeId, type) => summary.filter((s) => s.modeId === modeId).some((s) => s.ev[type] > 0);
check(has('football', 'goal'), '足球：有进球');
check(has('football', 'ballOut'), '足球：球出界后能重新发球');
check(has('crown', 'crown'), '抢皇冠：有人拿到 / 抢到皇冠');
check(has('potato', 'potatoPass'), '烫手炸弹：炸弹被传递');
check(has('potato', 'potatoBoom'), '烫手炸弹：引信烧完爆炸');
check(has('boss', 'bossDown'), 'Boss：被推下场');
check(has('boss', 'bossSlam') && has('boss', 'bossCharge'), 'Boss：会冲撞和砸地');
check(has('classic', 'collapse'), '经典：外圈坍塌');
check(summary.some((s) => s.mapId === 'space' && s.ev.meteor > 0), '太空站：陨石雨');
check(summary.some((s) => s.mapId === 'candy' && s.ev.bump > 0), '糖果：弹簧');
for (const item of ['bomb', 'freeze', 'tornado', 'banana']) {
  const type = { bomb: 'shock', freeze: 'freeze', tornado: 'pickup', banana: 'slip' }[item];
  check(summary.some((s) => s.ev[type] > 0), `道具：${item} 生效`);
}

console.log('\n模式      地图   用时  局数  奖项');
for (const s of summary) console.log(`${s.modeId.padEnd(9)} ${s.mapId.padEnd(6)} ${String(s.time).padStart(4)}s ${String(s.rounds).padStart(4)}  ${s.awards}`);
done();
