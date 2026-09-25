// 绳索闯关的关卡：用字符画描述，每个字符是一块方形地砖。
// 图例：
//   #  地面          .  空（会掉下去）
//   S  出生点        E  出口（全队都站进来才算过关）
//   K  钥匙          L  锁（把钥匙送到这里）
//   k  钥匙桥（开锁后出现）
//   P  压力板（所有压力板同时被踩住）
//   p  机关桥（压力板全部亮起后出现）
//   A / B  交替闪烁的地砖（两组轮流出现）
//   O  软糖弹簧（站在地面上的障碍）
const { MAPS } = require('./maps');

const CELL = 76;

const STAGES = [
  {
    name: { zh: '钥匙吊桥', en: 'Key Bridge' },
    hint: 'key',
    rows: [
      '.....................',
      '.#####...............',
      '.#SSS#......#####....',
      '.#SSS#kkkkkk#EEE#....',
      '.#####L.....#EEE#....',
      '...#........#####....',
      '...#.................',
      '.#####...............',
      '.##K##...............',
      '.#####...............',
      '.....................',
    ],
  },
  {
    name: { zh: '双人机关', en: 'Twin Plates' },
    hint: 'plates',
    rows: [
      '..........................',
      '...........#P.P#..........',
      '.#####.....#####..........',
      '.#SSS#######...#pppppp###.',
      '.#SSS#.....#####......#E#.',
      '.#####................#E#.',
      '......................###.',
      '..........................',
    ],
  },
  {
    name: { zh: '闪烁之路', en: 'Blinking Path' },
    hint: 'blink',
    rows: [
      '...........................',
      '.#####.................###.',
      '.#SSS#AABBAABBAABBAABB#EE#.',
      '.#SSS#AABBAABBAABBAABB#EE#.',
      '.#####.................###.',
      '...........................',
    ],
  },
  {
    name: { zh: '终极挑战', en: 'Final Trial' },
    hint: 'final',
    rows: [
      '.....................................',
      '...............#P.P#.................',
      '.#####......#########......#....####.',
      '.#SSS#......#O###O###......#AABB#EE#.',
      '.#SSS#kkkkkk#########pppppp#AABB#EE#.',
      '.#####L.....#########......#AABB#EE#.',
      '...#.......................#....####.',
      '...#.................................',
      '.#####...............................',
      '.##K##...............................',
      '.#####...............................',
      '.....................................',
    ],
  },
];

// 字符画 -> 地图对象（和 maps.js 里的地图结构一致，room.js 可以直接使用）
function buildLevel(stageIndex, themeId) {
  const st = STAGES[stageIndex];
  const theme = MAPS[themeId] || MAPS.lava;
  const H = st.rows.length;
  const W = Math.max(...st.rows.map((r) => r.length));
  const ox = (-W * CELL) / 2;
  const oy = (-H * CELL) / 2;
  const tiles = [];
  const index = new Map();
  const feat = { spawns: [], exit: [], kBridge: [], pBridge: [], blinkA: [], blinkB: [], plates: [], key: null, lock: null };
  const bumpers = [];
  const grid = [];
  for (let j = 0; j < H; j++) {
    grid.push([]);
    for (let i = 0; i < W; i++) {
      const ch = st.rows[j][i] || '.';
      grid[j].push(ch);
      if (ch === '.') continue;
      const cx = ox + (i + 0.5) * CELL;
      const cy = oy + (j + 0.5) * CELL;
      const id = tiles.length;
      index.set(i + ',' + j, id);
      tiles.push({ shape: { k: 'q', x: cx, y: cy, s: CELL }, cx, cy, c: (i + j) % 2, gi: i, gj: j, ch, layer: 0 });
      const pos = { x: Math.round(cx), y: Math.round(cy) };
      if (ch === 'S') feat.spawns.push(id);
      else if (ch === 'E') feat.exit.push(id);
      else if (ch === 'k') feat.kBridge.push(id);
      else if (ch === 'p') feat.pBridge.push(id);
      else if (ch === 'A') feat.blinkA.push(id);
      else if (ch === 'B') feat.blinkB.push(id);
      else if (ch === 'P') feat.plates.push(pos);
      else if (ch === 'K') feat.key = pos;
      else if (ch === 'L') feat.lock = pos;
      else if (ch === 'O') bumpers.push({ x: pos.x, y: pos.y, r: 26 });
    }
  }
  // 出口区域：从 E 格子出发，连着的普通地面都算（整座终点岛），8 个人也站得下
  feat.exitCore = feat.exit.slice();
  {
    const zone = new Set(feat.exit);
    const q = [...feat.exit];
    while (q.length) {
      const t = tiles[q.shift()];
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const id = index.get(t.gi + di + ',' + (t.gj + dj));
        if (id === undefined || zone.has(id) || !'#E'.includes(tiles[id].ch)) continue;
        zone.add(id);
        q.push(id);
      }
    }
    feat.exit = [...zone];
  }
  // 离边缘的距离（机器人用来找"更靠里"的安全位置）
  for (const t of tiles) {
    let d = 0;
    for (let r = 1; r <= 3; r++) {
      let ok = true;
      for (let dj = -r; dj <= r && ok; dj++) {
        for (let di = -r; di <= r && ok; di++) {
          const ch = (grid[t.gj + dj] || [])[t.gi + di] || '.';
          if ('.kpAB'.includes(ch)) ok = false;
        }
      }
      if (!ok) break;
      d = r;
    }
    t.layer = d;
  }
  const locate = (x, y) => {
    const i = Math.floor((x - ox) / CELL);
    const j = Math.floor((y - oy) / CELL);
    const id = index.get(i + ',' + j);
    return id === undefined ? -1 : id;
  };
  const radius = Math.max(...tiles.map((t) => Math.hypot(Math.abs(t.cx) + CELL / 2, Math.abs(t.cy) + CELL / 2)));
  const layout = { tiles, locate, radius, layers: 4, grid: { W, H, ox, oy, cell: CELL, index } };
  const id = `rope-${themeId}-${stageIndex + 1}`;
  const map = {
    id,
    theme: themeId,
    name: theme.name,
    layout,
    physics: theme.physics,
    collapse: { type: 'none', warn: 0, first: Infinity },
    meteors: null,
    bumpers,
    goal: null,
    feat,
    stage: stageIndex,
  };
  map.clientDef = JSON.stringify({
    t: 'map',
    id,
    theme: themeId,
    level: true,
    stage: stageIndex,
    name: theme.name,
    radius,
    layers: 4,
    tiles: tiles.map((t) => ({ k: 'q', x: Math.round(t.cx), y: Math.round(t.cy), s: CELL, l: t.layer, c: t.c, cx: Math.round(t.cx), cy: Math.round(t.cy), ch: t.ch })),
    bumpers,
    goal: null,
    center: 99,
    feat,
  });
  return map;
}

const cache = new Map();
function getLevel(stageIndex, themeId) {
  const key = stageIndex + ':' + themeId;
  if (!cache.has(key)) cache.set(key, buildLevel(stageIndex, themeId));
  return cache.get(key);
}

module.exports = { STAGES, CELL, getLevel };
