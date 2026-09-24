// 测试工具：假的 WebSocket、快速推进房间时间
process.env.LEADERBOARD_FILE = process.env.LEADERBOARD_FILE || 'off';
const { Room } = require('../server/room');
const K = require('../server/constants');

class FakeWS {
  constructor() {
    this.readyState = 1;
    this.msgs = [];
  }
  send(data) {
    this.msgs.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
  }
  last(t) {
    for (let i = this.msgs.length - 1; i >= 0; i--) if (this.msgs[i].t === t) return this.msgs[i];
    return null;
  }
}

// 以最快速度推进 seconds 秒（每 1/60 秒一帧），同时收集事件
function step(room, seconds, onEvents) {
  const dt = 1 / K.TICK_RATE;
  const n = Math.round(seconds * K.TICK_RATE);
  for (let i = 0; i < n; i++) {
    room.tick(dt);
    if (i % 2 === 0) {
      if (onEvents) onEvents(room.events);
      room.events = [];
    }
    if (room.phase === 'gameOver') break;
  }
}

function makeRoom(opts = {}) {
  const room = new Room('TEST', opts);
  const ws = new FakeWS();
  const host = room.addPlayer({ name: '房主', ws, token: 'tok-host' });
  return { room, host, ws };
}

let failures = 0;
function check(cond, msg) {
  if (cond) console.log('  ✓ ' + msg);
  else {
    failures++;
    console.log('  ✗ ' + msg);
  }
}
const done = () => {
  if (failures) {
    console.log(`\n${failures} 项失败`);
    process.exit(1);
  }
  console.log('\n全部通过');
};

module.exports = { FakeWS, step, makeRoom, check, done, Room };
