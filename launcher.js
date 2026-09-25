// 启动器（npm start）：运行 server.js，游戏内点了"更新"之后自动重启服务器。
// 服务器更新完文件后以退出码 75 退出，这里检查要不要重新安装依赖，然后再启动一次。
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RESTART_CODE = 75;
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
  child = spawn(process.execPath, [path.join(__dirname, 'server.js')], { stdio: 'inherit', env: { ...process.env, BB_LAUNCHER: '1' } });
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
