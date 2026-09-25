// 外网链接：用 Cloudflare 免费的 Quick Tunnel 给游戏生成一个 https://xxx.trycloudflare.com 网址，
// 不在同一个 Wi-Fi 的朋友也能打开。不需要注册账号；第一次使用时自动下载 cloudflared（约 20~40MB）。
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawn, spawnSync } = require('child_process');
const { get, untar } = require('./updater');

const BIN_DIR = process.env.BB_BIN_DIR || path.join(__dirname, '..', 'data', 'bin');
const RELEASE = process.env.CLOUDFLARED_RELEASE_BASE || 'https://github.com/cloudflare/cloudflared/releases/latest/download';
const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

const state = { status: 'idle', url: '', error: '', progress: 0 };
let child = null;

function assetName() {
  const { platform, arch } = process;
  if (platform === 'win32') return arch === 'ia32' ? 'cloudflared-windows-386.exe' : 'cloudflared-windows-amd64.exe';
  if (platform === 'darwin') return arch === 'arm64' ? 'cloudflared-darwin-arm64.tgz' : 'cloudflared-darwin-amd64.tgz';
  if (platform === 'linux') return { arm64: 'cloudflared-linux-arm64', arm: 'cloudflared-linux-arm', ia32: 'cloudflared-linux-386' }[arch] || 'cloudflared-linux-amd64';
  return null;
}
const localBin = () => path.join(BIN_DIR, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');

// 找 cloudflared：环境变量指定的 > 系统里已经装了的 > 之前下载过的 > 现在下载
async function findBinary() {
  if (process.env.CLOUDFLARED_PATH) return process.env.CLOUDFLARED_PATH;
  try {
    if (spawnSync('cloudflared', ['--version'], { timeout: 5000, windowsHide: true }).status === 0) return 'cloudflared';
  } catch {
    /* 没装 */
  }
  if (fs.existsSync(localBin())) return localBin();
  const asset = assetName();
  if (!asset) throw new Error('这个系统不支持自动下载 cloudflared');
  state.status = 'downloading';
  state.progress = 0;
  const buf = await get(`${RELEASE}/${asset}`, {
    timeout: 300000,
    onProgress: (got, total) => (state.progress = total ? Math.round((got / total) * 100) : 0),
  });
  let bin = buf;
  if (asset.endsWith('.tgz')) {
    const f = untar(zlib.gunzipSync(buf)).find((x) => path.basename(x.name) === 'cloudflared');
    if (!f) throw new Error('下载的 cloudflared 压缩包不完整');
    bin = f.data;
  }
  fs.mkdirSync(BIN_DIR, { recursive: true });
  const tmp = localBin() + '.part';
  fs.writeFileSync(tmp, bin);
  fs.chmodSync(tmp, 0o755);
  fs.renameSync(tmp, localBin());
  return localBin();
}

async function start(port) {
  if (state.status === 'running' || state.status === 'starting' || state.status === 'downloading') return state;
  state.error = '';
  state.url = '';
  try {
    const bin = await findBinary();
    state.status = 'starting';
    await new Promise((resolve, reject) => {
      // .js 结尾的是测试用的假 cloudflared，用 node 运行
      const [cmd, pre] = bin.endsWith('.js') ? [process.execPath, [bin]] : [bin, []];
      const p = spawn(cmd, [...pre, 'tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`], { windowsHide: true });
      child = p;
      const timer = setTimeout(() => {
        p.kill();
        reject(new Error('等了 60 秒还没拿到网址，可能是网络连不上 Cloudflare'));
      }, 60000);
      let log = '';
      const onData = (d) => {
        log = (log + d).slice(-4000);
        const m = String(d).match(URL_RE) || log.match(URL_RE);
        if (m && !state.url) {
          state.url = m[0];
          state.status = 'running';
          clearTimeout(timer);
          resolve();
        }
      };
      p.stdout.on('data', onData);
      p.stderr.on('data', onData);
      p.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      p.on('exit', (code) => {
        clearTimeout(timer);
        if (child === p) child = null;
        if (state.status === 'running') {
          state.status = 'idle';
          state.url = '';
        } else {
          const last = log.trim().split('\n').slice(-2).join(' ').slice(0, 200);
          reject(new Error(`cloudflared 退出了（${code}）${last ? '：' + last : ''}`));
        }
      });
    });
  } catch (e) {
    state.status = 'error';
    state.error = e.message;
    if (child) child.kill();
    child = null;
  }
  return state;
}

function stop() {
  if (child) child.kill();
  child = null;
  state.status = 'idle';
  state.url = '';
  state.error = '';
  return state;
}

// 服务器退出时把 cloudflared 一起关掉
for (const ev of ['exit', 'SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(ev, () => {
    if (child) child.kill();
    if (ev !== 'exit') process.exit(0);
  });
}

module.exports = { start, stop, state, assetName };
