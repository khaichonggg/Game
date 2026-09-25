// 测试用的假 cloudflared：像真的一样在 stderr 打印网址，然后一直运行；FAKE_CF_FAIL=1 时直接报错退出
if (process.env.FAKE_CF_FAIL) {
  console.error('ERR failed to request quick Tunnel: 403');
  process.exit(1);
}
const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : '';
console.error('INF Requesting new quick Tunnel on trycloudflare.com...');
setTimeout(() => {
  console.error('INF +--------------------------------------------------------------------------------------------+');
  console.error('INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |');
  console.error('INF |  https://happy-bumper-party-test.trycloudflare.com                                         |');
  console.error(`INF origin ${url}`);
}, 300);
setInterval(() => {}, 1000);
