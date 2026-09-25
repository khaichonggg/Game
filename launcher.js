// 启动器（npm start）：运行 server.js，游戏内点了"更新"之后自动重启服务器。
// 服务器更新完文件后以退出码 75 退出，这里检查要不要重新安装依赖，然后再启动一次。
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RESTART_CODE = 75;

// Node 太旧时给出明确提示（需要 18 或更新）
const major = Number(process.versions.node.split('.')[0]);
if (major < 18) {
  console.log(`\n  Node.js ${process.versions.node} is too old. Please install Node.js 18 or newer from https://nodejs.org/`);
  console.log(`  Node.js 版本太旧（${process.versions.node}），请到 https://nodejs.org/ 安装 18 或更新的版本。\n`);
  process.exit(1);
}
let firstStart = true;
const STATE_FILE = path.join(__dirname, 'data', 'update-state.json');
let child = null;

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function installDeps() {
  console.log('\n📦 Dependencies changed, running npm install … (依赖有变化，正在安装)');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npm, ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: __dirname, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) console.log('⚠️ npm install failed, please run it manually (npm install 没有成功，请手动运行)');
}

function start() {
  // 只有第一次启动时打开浏览器；更新后重启时，已打开的页面会自己刷新
  const env = { ...process.env, BB_LAUNCHER: '1' };
  if (!firstStart) delete env.BB_OPEN;
  firstStart = false;
  child = spawn(process.execPath, [path.join(__dirname, 'server.js')], { stdio: 'inherit', env });
  child.on('exit', (code, signal) => {
    child = null;
    if (code === RESTART_CODE) {
      const st = readState();
      if (st && st.needInstall) installDeps();
      if (st) {
        st.needInstall = false;
        try {
          fs.writeFileSync(STATE_FILE, JSON.stringify(st));
        } catch {
          /* 忽略 */
        }
      }
      console.log(`\n🔄 Updated to v${st ? st.to : '?'}, restarting… (已更新，正在重启)\n`);
      setTimeout(start, 300);
      return;
    }
    process.exit(signal ? 1 : code || 0);
  });
}

// Ctrl+C / 关闭窗口时把服务器一起关掉
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    if (child) child.kill(sig);
    else process.exit(0);
  });
}

start();
