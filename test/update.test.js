// 自动更新：版本号比较、解压 GitHub 源码包（含 PAX 长文件名）
const zlib = require('zlib');
const { check, done } = require('./helpers');
const { cmpVersion, untar } = require('../server/updater');

console.log('版本号比较');
check(cmpVersion('2.1.0', '2.0.9') === 1, '2.1.0 比 2.0.9 新');
check(cmpVersion('2.10.0', '2.9.9') === 1, '2.10.0 比 2.9.9 新（按数字比，不按字符串）');
check(cmpVersion('2.1', '2.1.0') === 0, '2.1 和 2.1.0 相同');
check(cmpVersion('1.9.9', '2.0.0') === -1, '1.9.9 比 2.0.0 旧');

// 手写一个 tar 包：全局头 + 普通文件 + PAX 长文件名
function header(name, size, type = '0') {
  const h = Buffer.alloc(512);
  h.write(name.slice(0, 100), 0);
  h.write('0000644\0', 100);
  h.write(size.toString(8).padStart(11, '0') + '\0', 124);
  h.write(type, 156);
  h.write('ustar\0', 257);
  h.write('00', 263);
  h.write('        ', 148);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return h;
}
const pad = (b) => Buffer.concat([b, Buffer.alloc((512 - (b.length % 512)) % 512)]);
function entry(name, data, type) {
  const d = Buffer.from(data);
  return Buffer.concat([header(name, d.length, type), pad(d)]);
}
function paxRecord(key, value) {
  const body = ` ${key}=${value}\n`;
  let len = body.length + 1;
  while (String(len).length + body.length !== len) len++;
  return len + body;
}

const longName = 'Game-main/public/js/render/' + 'a'.repeat(120) + '.js';
const tarBuf = Buffer.concat([
  entry('pax_global_header', paxRecord('comment', 'abc123'), 'g'),
  entry('Game-main/package.json', '{"version":"9.9.9"}'),
  entry('PaxHeader', paxRecord('path', longName), 'x'),
  entry('Game-main/placeholder', 'long file content'),
  Buffer.alloc(1024),
]);

console.log('解压源码包');
const files = untar(zlib.gunzipSync(zlib.gzipSync(tarBuf)));
check(files.length === 2, '读出 2 个文件（跳过全局头和 PAX 头）');
check(files[0].name === 'Game-main/package.json' && files[0].data.toString() === '{"version":"9.9.9"}', '普通文件内容正确');
check(files[1] && files[1].name === longName && files[1].data.toString() === 'long file content', 'PAX 长文件名正确');
done();
