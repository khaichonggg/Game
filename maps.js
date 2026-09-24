// 地图定义：每张地图由一块块地砖拼成，服务端用它判断脚下有没有地面，
// 客户端用同样的数据建模。坐标是水平面 (x, y)，客户端把 y 映射到 3D 的 z 轴。
const TAU = Math.PI * 2;
const SQRT3 = Math.sqrt(3);

// 同心圆环 + 扇形地砖（熔岩浮岛）
function ringsLayout(radii, segLen) {
  const tiles = [];
  const rings = [];
  const n = radii.length;
  for (let k = 0; k < n; k++) {
    const isCenter = k === n - 1;
    const rOut = radii[k];
    const rIn = isCenter ? 0 : radii[k + 1];
    const segs = isCenter ? 6 : Math.max(8, Math.round((TAU * rOut) / segLen));
    const offset = k * 0.37;
    rings.push({ segs, offset, start: tiles.length });
    for (let i = 0; i < segs; i++) {
      const a0 = offset + (i / segs) * TAU;
      const a1 = offset + ((i + 1) / segs) * TAU;
      const am = (a0 + a1) / 2;
      const rm = isCenter ? rOut * 0.55 : (rIn + rOut) / 2;
      tiles.push({ layer: k, shape: { k: 's', rIn, rOut, a0, a1 }, cx: Math.cos(am) * rm, cy: Math.sin(am) * rm, c: (i + k) % 2 });
    }
  }
  function locate(x, y) {
    const r = Math.hypot(x, y);
    if (r >= radii[0]) return -1;
    let k = n - 1;
    for (let i = 0; i < n - 1; i++) {
      if (r >= radii[i + 1]) {
        k = i;
        break;
      }
    }
    const ring = rings[k];
    let a = Math.atan2(y, x) - ring.offset;
    a = ((a % TAU) + TAU) % TAU;
    return ring.start + Math.min(ring.segs - 1, Math.floor(a / (TAU / ring.segs)));
  }
  return { tiles, locate, radius: radii[0], layers: n };
}

// 圆形范围内的方格（冰川）
function gridCircleLayout(R, cell) {
  const tiles = [];
  const index = new Map();
  const n = Math.ceil(R / cell);
  for (let i = -n; i < n; i++) {
    for (let j = -n; j < n; j++) {
      const cx = (i + 0.5) * cell;
      const cy = (j + 0.5) * cell;
      const d = Math.hypot(cx, cy);
      if (d > R - cell * 0.4) continue;
      index.set(i + ',' + j, tiles.length);
      tiles.push({ shape: { k: 'q', x: cx, y: cy, s: cell }, cx, cy, d, c: (i + j + 2 * n) % 2 });
    }
  }
  const maxD = Math.max(...tiles.map((t) => t.d));
  for (const t of tiles) {
    t.layer = Math.floor((maxD - t.d) / cell);
    delete t.d;
  }
  const layers = Math.max(...tiles.map((t) => t.layer)) + 1;
  const locate = (x, y) => {
    const id = index.get(Math.floor(x / cell) + ',' + Math.floor(y / cell));
    return id === undefined ? -1 : id;
  };
  const radius = Math.max(...tiles.map((t) => Math.hypot(Math.abs(t.cx) + cell / 2, Math.abs(t.cy) + cell / 2)));
  return { tiles, locate, radius, layers };
}

// 六边形蜂窝（太空站），尖顶朝上的轴坐标
function hexLayout(N, size) {
  const tiles = [];
  const index = new Map();
  for (let q = -N; q <= N; q++) {
    for (let r = Math.max(-N, -q - N); r <= Math.min(N, -q + N); r++) {
      const dist = (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
      const cx = size * SQRT3 * (q + r / 2);
      const cy = size * 1.5 * r;
      index.set(q + ',' + r, tiles.length);
      tiles.push({ layer: N - dist, shape: { k: 'h', x: cx, y: cy, r: size }, cx, cy, c: (((q - r) % 3) + 3) % 3 });
    }
  }
  function locate(x, y) {
    const fq = ((SQRT3 / 3) * x - y / 3) / size;
    const fr = ((2 / 3) * y) / size;
    const fs = -fq - fr;
    let q = Math.round(fq);
    let r = Math.round(fr);
    const s = Math.round(fs);
    const dq = Math.abs(q - fq);
    const dr = Math.abs(r - fr);
    const ds = Math.abs(s - fs);
    if (dq > dr && dq > ds) q = -r - s;
    else if (dr > ds) r = -q - s;
    const id = index.get(q + ',' + r);
    return id === undefined ? -1 : id;
  }
  return { tiles, locate, radius: N * size * SQRT3 + size * 0.9, layers: N + 1 };
}

// 方形棋盘，去掉四个角（糖果乐园）
function squareLayout(cellsPerSide, cell) {
  const tiles = [];
  const index = new Map();
  const half = cellsPerSide / 2;
  for (let i = 0; i < cellsPerSide; i++) {
    for (let j = 0; j < cellsPerSide; j++) {
      const ci = i - half + 0.5;
      const cj = j - half + 0.5;
      const edge = half - 0.5;
      if (Math.abs(ci) === edge && Math.abs(cj) === edge) continue;
      const d = Math.max(Math.abs(ci), Math.abs(cj)) - 0.5;
      const cx = ci * cell;
      const cy = cj * cell;
      index.set(i + ',' + j, tiles.length);
      tiles.push({ layer: Math.round(edge - 0.5 - d), shape: { k: 'q', x: cx, y: cy, s: cell }, cx, cy, c: (i + j) % 2 });
    }
  }
  const locate = (x, y) => {
    const i = Math.floor(x / cell + half);
    const j = Math.floor(y / cell + half);
    const id = index.get(i + ',' + j);
    return id === undefined ? -1 : id;
  };
  return { tiles, locate, radius: half * cell * 1.3, layers: Math.max(...tiles.map((t) => t.layer)) + 1 };
}

const MAPS = {
  lava: {
    name: '熔岩浮岛',
    icon: '🌋',
    desc: '外圈一层层坍塌进岩浆',
    layout: ringsLayout([460, 405, 350, 295, 240, 185, 130], 84),
    physics: { accel: 1100, damping: 2.4 },
    collapse: { type: 'rings', first: 10, interval: 6, warn: 3, keep: 1 },
  },
  ice: {
    name: '冰川碎冰',
    icon: '🧊',
    desc: '冰面超滑，冰块会随机碎裂沉底',
    layout: gridCircleLayout(455, 82),
    physics: { accel: 760, damping: 1.4 },
    collapse: { type: 'random', first: 5, interval: [1.5, 0.45], warn: 2, minTiles: 10 },
  },
  space: {
    name: '星际空间站',
    icon: '🪐',
    desc: '陨石雨砸穿地板，还会把人炸飞',
    layout: hexLayout(5, 52),
    physics: { accel: 1100, damping: 2.4 },
    collapse: { type: 'rings', first: 22, interval: 9, warn: 3, keep: 2 },
    meteors: { first: 5, interval: [2.6, 1.1], warn: 1.6, radius: 80, power: 750 },
  },
  candy: {
    name: '糖果乐园',
    icon: '🍭',
    desc: '软糖弹簧会把人弹飞，外圈会塌',
    layout: squareLayout(10, 84),
    physics: { accel: 1100, damping: 2.4 },
    collapse: { type: 'rings', first: 14, interval: 8, warn: 3, keep: 1 },
    bumpers: [
      { x: 0, y: 0, r: 36 },
      { x: -200, y: -200, r: 30 },
      { x: 200, y: -200, r: 30 },
      { x: -200, y: 200, r: 30 },
      { x: 200, y: 200, r: 30 },
    ],
  },
};

// 发给客户端的地图数据（不含函数）
for (const [id, m] of Object.entries(MAPS)) {
  m.id = id;
  m.clientDef = JSON.stringify({
    t: 'map',
    id,
    name: m.name,
    radius: m.layout.radius,
    layers: m.layout.layers,
    tiles: m.layout.tiles.map((t) => {
      const shape = {};
      for (const [k, v] of Object.entries(t.shape)) shape[k] = typeof v === 'number' ? Math.round(v * 10000) / 10000 : v;
      return { ...shape, l: t.layer, c: t.c, cx: Math.round(t.cx), cy: Math.round(t.cy) };
    }),
    bumpers: m.bumpers || [],
    center: m.collapse.type === 'rings' ? m.layout.layers - m.collapse.keep : 99,
  });
}

module.exports = { MAPS, MAP_IDS: Object.keys(MAPS) };
