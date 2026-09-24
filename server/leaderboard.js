// 排行榜：按昵称累计真人玩家的战绩，保存在 data/leaderboard.json
const fs = require('fs');
const path = require('path');

// 测试时用 LEADERBOARD_FILE=off 关闭写盘，或者指定别的文件
const FILE = process.env.LEADERBOARD_FILE || path.join(__dirname, '..', 'data', 'leaderboard.json');
const DISABLED = FILE === 'off';
let stats = {};
let saveTimer = null;

try {
  if (!DISABLED) stats = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch {
  stats = {};
}

function save() {
  if (DISABLED) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdir(path.dirname(FILE), { recursive: true }, () => {
      fs.writeFile(FILE, JSON.stringify(stats, null, 1), () => {});
    });
  }, 500);
}

// results: [{ name, won, kos }]
function record(results) {
  for (const r of results) {
    const s = stats[r.name] || (stats[r.name] = { name: r.name, games: 0, wins: 0, kos: 0 });
    s.games++;
    if (r.won) s.wins++;
    s.kos += r.kos;
    s.last = Date.now();
  }
  save();
}

function top(n = 20) {
  return Object.values(stats)
    .sort((a, b) => b.wins - a.wins || b.kos - a.kos || a.games - b.games)
    .slice(0, n);
}

module.exports = { record, top };
