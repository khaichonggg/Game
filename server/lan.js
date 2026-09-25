// 局域网相关的小工具：找本机局域网地址、在控制台打印二维码、打开浏览器
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');

// 虚拟网卡（虚拟机、WSL、Docker、VPN）的地址朋友连不上，排到最后
const VIRTUAL = /vEthernet|WSL|Hyper-V|VirtualBox|VMware|vmnet|vboxnet|docker|br-|veth|virbr|utun|tun|tap|ZeroTier|Tailscale|Loopback|Bluetooth|蓝牙/i;
const REAL = /^(Wi-?Fi|WLAN|Ethernet|以太网|无线|en\d|eth\d|wlan\d|wlp|enp|eno)/i;

function privateScore(ip) {
  if (/^192\.168\./.test(ip)) return 3;
  if (/^10\./.test(ip)) return 2;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 1;
  return 0;
}

// 返回按"最可能是 Wi-Fi / 网线地址"排序的 IPv4 列表
// Windows 上刚换网络 / 开着 VPN 时，os.networkInterfaces() 偶尔会直接抛错
// （uv_interface_addresses returned Unknown system error），这时用上一次的结果，绝不能让服务器崩掉
let lastLan = [];
function interfaces() {
  try {
    return os.networkInterfaces();
  } catch {
    return null;
  }
}
function lanAddresses() {
  const ifs = interfaces();
  if (!ifs) return lastLan;
  const out = [];
  for (const [name, list] of Object.entries(ifs)) {
    for (const a of list || []) {
      // Node 18.0~18.3 里 family 是数字 4
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal && !a.address.startsWith('169.254.')) {
        const score = (VIRTUAL.test(name) ? -10 : 0) + (REAL.test(name) ? 5 : 0) + privateScore(a.address);
        out.push({ ip: a.address, score });
      }
    }
  }
  const list = out.sort((a, b) => b.score - a.score).map((x) => x.ip);
  // 电脑有很多网卡、显示的地址不对时，可以用 LAN_IP=192.168.1.5 手动指定
  const forced = (process.env.LAN_IP || '').trim();
  lastLan = forced ? [forced, ...list.filter((ip) => ip !== forced)] : list;
  return lastLan;
}

// 在控制台用方块字符画二维码（黑白用 ANSI 颜色，手机扫得出来）
let qrLib = null;
async function terminalQR(text) {
  if (!qrLib) qrLib = (await import(pathToFileURL(path.join(__dirname, '..', 'public', 'vendor', 'qrcode.mjs')).href)).default;
  const qr = qrLib(0, 'L');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const m = 2; // 留白
  const dark = (r, c) => r >= 0 && c >= 0 && r < n && c < n && qr.isDark(r, c);
  const lines = [];
  for (let r = -m; r < n + m; r += 2) {
    let line = '\x1b[30;47m';
    for (let c = -m; c < n + m; c++) {
      const top = dark(r, c);
      const bottom = dark(r + 1, c);
      line += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' ';
    }
    lines.push('  ' + line + '\x1b[0m');
  }
  return lines.join('\n');
}

// 打开默认浏览器（双击 start.bat / start.command 启动时用）
function openBrowser(url) {
  try {
    const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    const p = spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true, windowsHide: true });
    p.on('error', () => {});
    p.unref();
  } catch {
    /* 打不开就算了，控制台里有地址 */
  }
}

module.exports = { lanAddresses, terminalQR, openBrowser };
