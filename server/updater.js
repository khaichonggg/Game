// 自动更新：检查 GitHub 上的新版本，下载并覆盖游戏文件，然后让启动器重启服务器。
// - 版本号来自 package.json 的 version
// - 仓库和分支来自 package.json 的 update.repo / update.branch（分支留空 = 仓库默认分支）
// - 如果游戏目录是 git 仓库，优先用 git pull；否则下载 GitHub 的源码压缩包覆盖
// - data/（排行榜）、node_modules/、.git/ 不会被覆盖
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const tls = require('tls');
const zlib = require('zlib');
const { execFile } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA, 'update-state.json');
const KEEP = new Set(['data', 'node_modules', '.git']);

const readPkg = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const cfg = () => {
  const u = readPkg().update || {};
  return { repo: process.env.UPDATE_REPO || u.repo || 'khaichonggg/Game', branch: process.env.UPDATE_BRANCH || u.branch || '', fallback: u.fallbackBranch || '' };
};
// 测试时可以把 GitHub 的三个地址换成本地假服务器
const BASE = {
  api: process.env.UPDATE_API_BASE || 'https://api.github.com',
  raw: process.env.UPDATE_RAW_BASE || 'https://raw.githubusercontent.com',
  code: process.env.UPDATE_CODELOAD_BASE || 'https://codeload.github.com',
};

// 版本号比较：'2.10.0' > '2.9.1'
function cmpVersion(a, b) {
  const pa = String(a).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

// HTTPS GET，支持重定向和 HTTPS_PROXY 代理（很多人要开代理才能访问 GitHub）
function proxyTunnel(target) {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.ALL_PROXY || process.env.all_proxy;
  if (!proxy || target.protocol !== 'https:') return Promise.resolve(null);
  const noProxy = (process.env.NO_PROXY || process.env.no_proxy || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (noProxy.some((h) => h === '*' || target.hostname === h || target.hostname.endsWith('.' + h.replace(/^\*?\./, '')))) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const p = new URL(proxy);
    const lib = p.protocol === 'https:' ? https : http;
    const port = target.port || 443;
    const headers = { Host: `${target.hostname}:${port}` };
    if (p.username) headers['Proxy-Authorization'] = 'Basic ' + Buffer.from(`${decodeURIComponent(p.username)}:${decodeURIComponent(p.password)}`).toString('base64');
    const req = lib.request({ host: p.hostname, port: p.port || (p.protocol === 'https:' ? 443 : 80), method: 'CONNECT', path: `${target.hostname}:${port}`, headers });
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`代理连接失败（${res.statusCode}）`));
        return;
      }
      socket.on('error', () => {}); // 连接中途断开不能让整个游戏服务器崩溃
      resolve(socket);
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('代理连接超时')));
    req.end();
  });
}

async function get(url, { json = false, redirects = 5, timeout = 20000 } = {}) {
  const u = new URL(url);
  const tunnel = await proxyTunnel(u);
  const lib = u.protocol === 'http:' ? http : https;
  const opts = { headers: { 'User-Agent': 'bumper-balls-updater', Accept: json ? 'application/json' : '*/*' } };
  if (tunnel) {
    opts.agent = false;
    opts.createConnection = () => {
      const t = tls.connect({ socket: tunnel, servername: u.hostname });
      t.on('error', () => {});
      return t;
    };
  }
  return new Promise((resolve, reject) => {
    const req = lib.get(u, opts, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        resolve(get(new URL(res.headers.location, u).toString(), { json, redirects: redirects - 1, timeout }));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}：${u.hostname}${u.pathname}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (!json) return resolve(buf);
        try {
          resolve(JSON.parse(buf.toString('utf8')));
        } catch {
          reject(new Error('返回的数据不是 JSON'));
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => req.destroy(new Error('连接 GitHub 超时')));
  });
}

async function resolveBranch() {
  const { repo, branch, fallback } = cfg();
  if (branch) return branch;
  try {
    const info = await get(`${BASE.api}/repos/${repo}`, { json: true });
    if (info.default_branch) return info.default_branch;
  } catch {
    /* GitHub API 有访问频率限制，失败时按常见分支名挨个试 */
  }
  for (const b of [fallback, 'main', 'master'].filter(Boolean)) {
    try {
      await get(`${BASE.raw}/${repo}/${b}/package.json`, { json: true });
      return b;
    } catch {
      /* 试下一个 */
    }
  }
  throw new Error('找不到可以更新的分支');
}

let cache = null;
let cacheAt = 0;
async function check(force = false) {
  if (!force && cache && Date.now() - cacheAt < 10 * 60 * 1000) return cache;
  const current = readPkg().version;
  const { repo } = cfg();
  try {
    const branch = await resolveBranch();
    const remote = await get(`${BASE.raw}/${repo}/${branch}/package.json`, { json: true });
    cache = { ok: true, current, latest: remote.version, hasUpdate: cmpVersion(remote.version, current) > 0, repo, branch, notes: remote.releaseNotes || '' };
  } catch (e) {
    cache = { ok: false, current, error: e.message, repo };
  }
  cacheAt = Date.now();
  return cache;
}

// ---- 解压 GitHub 源码包（tar.gz），不依赖第三方库 ----
function untar(buf) {
  const files = [];
  let off = 0;
  let paxPath = null;
  let longName = null;
  const str = (h, a, n) => h.subarray(a, a + n).toString('utf8').replace(/\0[\s\S]*$/, '');
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    let name = str(h, 0, 100);
    const size = parseInt(str(h, 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    const prefix = h.subarray(257, 262).toString() === 'ustar' ? str(h, 345, 155) : '';
    if (prefix) name = prefix + '/' + name;
    const data = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      // PAX 扩展头：长文件名
      const text = data.toString('utf8');
      let i = 0;
      while (i < text.length) {
        const sp = text.indexOf(' ', i);
        const len = parseInt(text.slice(i, sp), 10);
        if (!len) break;
        const rec = text.slice(sp + 1, i + len - 1);
        const eq = rec.indexOf('=');
        if (rec.slice(0, eq) === 'path') paxPath = rec.slice(eq + 1);
        i += len;
      }
      continue;
    }
    if (type === 'g') continue;
    if (type === 'L') {
      longName = data.toString('utf8').replace(/\0[\s\S]*$/, '');
      continue;
    }
    if (paxPath) name = paxPath;
    if (longName) name = longName;
    paxPath = longName = null;
    if (type === '0' || type === '7') files.push({ name, data });
  }
  return files;
}

// 路径安全检查：去掉最外层目录，不允许 .. 和绝对路径
function safeRel(name) {
  const parts = name.split('/').slice(1).filter(Boolean);
  if (!parts.length || parts.some((p) => p === '..' || p.includes('\\') || p.includes(':'))) return null;
  return parts.join('/');
}

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: ROOT, timeout: 120000, windowsHide: true }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout) + String(stderr) }));
  });
}

let busy = false;
async function apply(log = () => {}) {
  if (busy) throw new Error('正在更新中');
  busy = true;
  try {
    const info = await check(true);
    if (!info.ok) throw new Error(info.error);
    if (!info.hasUpdate) throw new Error('已经是最新版本');
    const oldPkg = readPkg();
    let method = 'download';
    if (fs.existsSync(path.join(ROOT, '.git'))) {
      log('发现 git 仓库，正在 git pull…');
      const r = await run('git', ['pull', '--ff-only', 'origin', info.branch]);
      if (r.ok) method = 'git';
      else log('git pull 失败，改用下载源码包：' + r.out.trim().split('\n').pop());
    }
    if (method === 'download') {
      log(`正在下载 ${info.repo}@${info.branch}…`);
      const gz = await get(`${BASE.code}/${info.repo}/tar.gz/refs/heads/${encodeURIComponent(info.branch)}`, { timeout: 120000 });
      log('正在解压…');
      const files = untar(zlib.gunzipSync(gz))
        .map((f) => ({ rel: safeRel(f.name), data: f.data }))
        .filter((f) => f.rel && !KEEP.has(f.rel.split('/')[0]));
      if (!files.some((f) => f.rel === 'package.json') || !files.some((f) => f.rel === 'server.js')) throw new Error('下载的文件不完整');
      // 先全部写到临时目录，确认没问题再覆盖，避免更新到一半坏掉
      const tmp = path.join(DATA, 'update-tmp');
      fs.rmSync(tmp, { recursive: true, force: true });
      for (const f of files) {
        const dest = path.join(tmp, f.rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, f.data);
      }
      log(`正在安装 ${files.length} 个文件…`);
      for (const f of files) {
        const dest = path.join(ROOT, f.rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(path.join(tmp, f.rel), dest);
      }
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    const newPkg = readPkg();
    const needInstall = JSON.stringify(oldPkg.dependencies || {}) !== JSON.stringify(newPkg.dependencies || {});
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ from: oldPkg.version, to: newPkg.version, needInstall, method, at: Date.now() }));
    cache = null;
    log(`更新完成：${oldPkg.version} → ${newPkg.version}`);
    return { ok: true, from: oldPkg.version, to: newPkg.version, method, needInstall };
  } finally {
    busy = false;
  }
}

module.exports = { check, apply, cmpVersion, untar, STATE_FILE };
