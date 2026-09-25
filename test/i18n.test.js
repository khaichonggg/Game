// 双语：所有界面文字、数据目录、服务器消息都要有英文翻译
const fs = require('fs');
const path = require('path');
const { check, done } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const CJK = /[　-〿一-鿿＀-￯]/;
// i18n.js 是 ES 模块，这里用简单的方式读出英文词典
const src = fs.readFileSync(path.join(ROOT, 'public/js/i18n.js'), 'utf8');
const dictSrc = src.slice(src.indexOf('const EN = {') + 11, src.indexOf('\n};\n') + 2);
const EN = new Function(`return ${dictSrc}`)();

const need = new Map();
const add = (k, where) => CJK.test(k) && !need.has(k) && need.set(k, where);
// 1. 客户端代码里的 t('...')
for (const f of ['public/js/main.js', 'public/js/ui.js', 'public/js/render/world.js']) {
  const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const m of code.matchAll(/(?<![\w.])tr?\('((?:[^'\\]|\\.)*)'/g)) add(m[1].replace(/\\(.)/g, (x, c) => (c === 'n' ? '\n' : c)), f);
}
// 2. 数据目录里的中文字段
const dataSrc = fs.readFileSync(path.join(ROOT, 'public/js/data.js'), 'utf8');
for (const m of dataSrc.matchAll(/'([^'\n]*[一-鿿][^'\n]*)'/g)) add(m[1], 'data.js');
// 3. 页面里写死的文字
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
for (const m of html.matchAll(/>([^<>]*[一-鿿][^<>]*)</g)) add(m[1].trim(), 'index.html');
for (const m of html.matchAll(/(?:placeholder|title|alt)="([^"]*[一-鿿][^"]*)"/g)) add(m[1], 'index.html');
// 4. 服务器发来的消息模板 / 结算文字 / 奖项
for (const f of ['server/room.js', 'server/modes.js', 'server.js']) {
  const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const m of s.matchAll(/(?:sys|key:|key =|text:)\s*\(?\s*(?:[a-z]+ \? )?'([^'\n]*[一-鿿][^'\n]*)'/g)) add(m[1], f);
  for (const m of s.matchAll(/best\([^,]+, '[^']*', '([^']+)', '([^']*)'/g)) {
    add(m[1], f);
    add(m[2].trim(), f);
  }
}
for (const m of fs.readFileSync(path.join(ROOT, 'server/room.js'), 'utf8').matchAll(/'(\{name\}[^'\n]*)'/g)) add(m[1], 'room.js');

const missing = [...need].filter(([k]) => EN[k] === undefined);
check(need.size > 300, `找到 ${need.size} 条需要翻译的文字`);
check(missing.length === 0, `全部有英文翻译${missing.length ? '，缺少：\n    ' + missing.map(([k, w]) => `${w}: ${k}`).join('\n    ') : ''}`);
// 占位符要一致
const badPh = Object.entries(EN).filter(([k, v]) => {
  const ph = (x) => (x.match(/\{\w+\}/g) || []).sort().join();
  return ph(k) !== ph(v);
});
check(badPh.length === 0, `翻译里的 {占位符} 和原文一致${badPh.length ? '：' + badPh.map(([k]) => k).join(' | ') : ''}`);
done();
