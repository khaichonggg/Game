// 外网链接：用假的 cloudflared 测试"下载 → 启动 → 拿到网址 → 关闭"，以及失败提示
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { check, done } = require('./helpers');

const FAKE = path.join(__dirname, 'fixtures', 'fake-cloudflared.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-cf-'));
  process.env.BB_BIN_DIR = binDir;

  console.log('启动隧道');
  process.env.CLOUDFLARED_PATH = FAKE;
  const tunnel = require('../server/tunnel');
  let st = await tunnel.start(3000);
  check(st.status === 'running' && st.url === 'https://happy-bumper-party-test.trycloudflare.com', `拿到外网网址 ${st.url}`);
  st = await tunnel.start(3000);
  check(st.status === 'running', '重复点"生成"不会开第二个');
  tunnel.stop();
  check(tunnel.state.status === 'idle' && !tunnel.state.url, '关闭后状态恢复');

  console.log('失败时的提示');
  process.env.FAKE_CF_FAIL = '1';
  st = await tunnel.start(3000);
  check(st.status === 'error' && /cloudflared/.test(st.error), `cloudflared 出错时给出提示：${st.error}`);
  delete process.env.FAKE_CF_FAIL;

  // 自动下载：本地假服务器提供 "cloudflared-linux-amd64"（一个会打印网址的 shell 脚本）
  if (process.platform !== 'win32') {
    console.log('自动下载 cloudflared');
    delete process.env.CLOUDFLARED_PATH;
    const script = `#!/bin/sh\n"${process.execPath}" "${FAKE}" "$@"\n`;
    let hits = 0;
    const srv = http.createServer((req, res) => {
      hits++;
      if (req.url.startsWith('/dl/')) {
        res.writeHead(200, { 'Content-Length': Buffer.byteLength(script) });
        res.end(script);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise((r) => srv.listen(0, r));
    process.env.CLOUDFLARED_RELEASE_BASE = `http://127.0.0.1:${srv.address().port}/dl`;
    delete require.cache[require.resolve('../server/tunnel')];
    const t2 = require('../server/tunnel');
    // 这台机器上如果本来就装了 cloudflared，就跳过下载这一步
    const hasSystem = require('child_process').spawnSync('cloudflared', ['--version']).status === 0;
    if (!hasSystem) {
      st = await t2.start(3000);
      const bin = path.join(binDir, 'cloudflared');
      check(hits === 1 && fs.existsSync(bin) && (fs.statSync(bin).mode & 0o111) !== 0, '第一次使用时自动下载并设为可执行');
      check(st.status === 'running' && st.url.endsWith('.trycloudflare.com'), '下载后能启动并拿到网址');
      t2.stop();
      st = await t2.start(3000);
      check(hits === 1 && st.status === 'running', '第二次直接用已经下载好的，不再下载');
      t2.stop();
    }
    srv.close();
  }
  await sleep(100);
  fs.rmSync(binDir, { recursive: true, force: true });
  done();
  process.exit(0);
})();
