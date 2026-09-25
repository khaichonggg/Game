// 碰碰球大乱斗 —— 客户端入口：联网、页面流程、房间大厅、HUD、结算
import qrcode from 'qrcode';
import { t as tr, lang, setLang, onLangChange, applyStatic } from './i18n.js';
import * as world from './render/world.js';
import { applyMap, mapDef } from './render/arena.js';
import { applyQuality, bloom, scene as renderScene, camera as renderCamera } from './render/core.js';
import { sfx, unlock, applyVolumes, playMusic } from './audio.js';
import { settings, saveSettings, profile, saveProfile, playerName, setPlayerName, token, lastRoom, isTouch } from './settings.js';
import { CHARACTERS, SKINS, HATS, COLORS, MAPS, MODES, ITEMS, TEAM_COLORS, TEAM_NAMES, BOT_LEVELS, charInfo } from './data.js';
import { input } from './input.js';
import { STICKER_MAP, stickerSVG } from './stickers.js';
import { CHANGELOG } from './changelog.js';
import { $, esc, fmtTime, show, current, avatarHTML, notice, modal, closeModal, modalOpen, initEmotes, toggleEmotes, hideEmotes, copyText, setHTML } from './ui.js';

const MAP_IDS = Object.keys(MAPS);
const MODE_IDS = Object.keys(MODES);
const RANDOM_NAMES = {
  zh: ['快乐豆', '弹弹怪', '冲冲冲', '圆滚滚', '撞墙王', '小旋风', '不倒翁', '铁头娃', '胖嘟嘟', '闪电侠', '奶茶君', '大力丸', '小可爱', '暴走团', '咕噜噜', '软糖糖'],
  en: ['Bouncy', 'Bumpy', 'Zoomer', 'Roly', 'Crasher', 'Whirly', 'Wobbly', 'Tank', 'Chonk', 'Flash', 'Boba', 'Muscle', 'Cutie', 'Rampage', 'Gummy', 'Pudding'],
};
const inRound = (ph) => ph === 'countdown' || ph === 'playing' || ph === 'roundEnd';

// ---------------------------------------------------------------------
// 联网
// ---------------------------------------------------------------------
let ws = null;
let myId = null;
let roomCode = null; // 当前（或正在重连的）房间
let inRoom = false; // 已经收到 joined
let joining = false;
let leaving = false;
let retry = 0;
let retryTimer = null;
let state = null;
let ping = 0;
let info = null;
const mapDefs = {};

function send(msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function connect(join) {
  clearTimeout(retryTimer);
  if (ws) {
    ws.onclose = null;
    ws.close();
  }
  joining = true;
  leaving = false;
  const sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  ws = sock;
  sock.onopen = () => sock.send(JSON.stringify({ t: 'join', name: playerName, profile, token, ...join }));
  sock.onmessage = (e) => {
    let m;
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    if (ws === sock) onMessage(m);
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null;
    onDisconnect();
  };
}

function onDisconnect() {
  const wasJoining = joining && !inRoom;
  inRoom = false;
  joining = false;
  if (leaving || serverRestarting) return;
  if (roomCode) {
    // 意外断线：自动重连回原来的房间（服务器会保留你的位置一段时间）
    if (retry === 0) notice(tr('连接断开，正在重连…'), true);
    retry++;
    if (retry > 12) {
      exitRoom();
      connectionHelp();
      return;
    }
    retryTimer = setTimeout(() => connect({ room: roomCode }), Math.min(4000, 600 * retry));
  } else if (wasJoining) {
    menuError(tr('连接服务器失败，请确认服务器正在运行'));
    connectionHelp();
  }
}

// 连不上的时候告诉玩家该检查什么（开服的电脑 / 朋友的设备看到的内容不一样）
function connectionHelp() {
  if (modalOpen()) return;
  const host = isLocalHost(location.hostname);
  const steps = host
    ? [
        tr('<b>黑色窗口还开着吗？</b>关掉了就再双击 <code>start.bat</code>'),
        tr('<b>窗口标题前面有「选择」两个字？</b>在黑色窗口里按一下 <kbd>Esc</kbd>，游戏就会继续'),
        tr('<b>窗口里有红字或报错？</b>截图发给开发者，或者双击游戏文件夹里的 <code>diagnose.bat</code> 生成诊断报告'),
        tr('<b>端口变了？</b>窗口里写的是 3001 之类的其他端口，就打开窗口里显示的那个网址'),
      ]
    : [
        tr('<b>开服的电脑还在运行吗？</b>黑色窗口不能关，电脑不能睡眠'),
        tr('<b>在同一个 Wi-Fi 吗？</b>换过网络后网址会变，请房主在主菜单顶部重新复制网址'),
        tr('<b>防火墙：</b>开服的电脑要把网络设成「专用网络」，或者在防火墙提示里点「允许访问」'),
        tr('<b>公共 Wi-Fi 连不上？</b>学校 / 公司 / 咖啡店的 Wi-Fi 常常禁止设备互连，请房主用「邀请 → 外网链接」'),
      ];
  const box = document.createElement('div');
  box.className = 'conn-help';
  box.innerHTML = `<p>${host ? tr('这台电脑上的游戏服务器没有响应。') : tr('连不上开服的电脑。')}</p><ol>${steps.map((x) => `<li>${x}</li>`).join('')}</ol>`;
  modal({ title: tr('📡 连不上服务器'), body: box, actions: [{ label: tr('🔄 重试'), cls: 'btn-yellow', onClick: () => location.reload() }, { label: tr('关闭') }] });
}

function onMessage(m) {
  switch (m.t) {
    case 'joined': {
      const again = roomCode === m.code && retry > 0;
      myId = m.id;
      roomCode = m.code;
      inRoom = true;
      joining = false;
      retry = 0;
      lastRoom.set(m.code);
      history.replaceState(null, '', `?room=${m.code}`);
      stopMenuCycle();
      menuError('');
      if (again) notice(tr('已重新连接 ✔'));
      else {
        chatLines = [];
        killfeedClear();
        if (m.name !== playerName) notice(tr('名字重复，已自动改为「{0}」', m.name));
        sfx.join();
      }
      break;
    }
    case 'map':
      mapDefs[m.id] = m;
      applyMap(m);
      break;
    case 'chatlog':
      chatLines = m.list.slice(-40);
      lastChatN = chatLines.reduce((a, c) => Math.max(a, c.n || 0), 0);
      renderChat();
      break;
    case 'state':
      onState(m);
      break;
    case 'error':
      if (!inRoom) {
        // 加入失败
        joining = false;
        leaving = true;
        if (ws) ws.close();
        if (roomCode) exitRoom();
        lastRoom.set('');
        history.replaceState(null, '', location.pathname);
        menuError(srvText(m));
        notice(srvText(m), true);
      } else notice(srvText(m), true);
      break;
    case 'confirmStart':
      modal({
        title: tr('还有人没准备好'),
        body: tr('<p>{0} 还没有点准备。</p><p>要直接开始吗？</p>', m.names.map((n) => `<b>${esc(n)}</b>`).join(tr('、'))),
        actions: [
          { label: tr('直接开始'), cls: 'btn-yellow', onClick: () => send({ t: 'start', force: true }) },
          { label: tr('再等等'), cls: 'btn-ghost' },
        ],
      });
      break;
    case 'kicked':
      leaving = true;
      exitRoom();
      sfx.kick();
      modal({ title: tr('已离开房间'), body: esc(srvText(m)) });
      break;
    case 'pong':
      ping = Math.round(performance.now() - m.c);
      break;
    case 'server':
      if (m.kind === 'restart') waitForRestart(m.to);
      break;
  }
}

// 服务器消息：有 key 就按当前语言翻译，没有就用服务器给的中文
const srvText = (m) => (m.key ? tr(m.key, m.p || {}) : m.msg);
const chatText = (c) => (c.key ? tr(c.key, c.p || {}) : c.text);

function joinRoom(join) {
  if (joining) return;
  unlock();
  menuError('');
  if (join.room) roomCode = null;
  connect(join);
}

function leaveRoom() {
  send({ t: 'leave' });
  leaving = true;
  exitRoom();
  sfx.leave();
}

// 回到主菜单（离开 / 被踢 / 房间没了）
function exitRoom() {
  clearTimeout(retryTimer);
  retry = 0;
  roomCode = null;
  inRoom = false;
  joining = false;
  myId = null;
  state = null;
  lastRoom.set('');
  history.replaceState(null, '', location.pathname);
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  closeModal(true);
  input.reset();
  world.clearRoom();
  world.setView('menu');
  document.body.classList.remove('is-host', 'not-host');
  banner('', 0);
  show('menu');
  updateTouchUI(null);
  playMusic('menu');
  startMenuCycle();
  refreshRoomCount();
}

setInterval(() => {
  if (inRoom) send({ t: 'ping', c: performance.now() });
}, 2000);

// ---------------------------------------------------------------------
// 收到服务器状态
// ---------------------------------------------------------------------
let isHost = false;
let lastCount = -1;
let aliveThisRound = false;
let resultsShown = null;

const screenForPhase = (ph) => (ph === 'lobby' ? 'lobby' : ph === 'gameOver' ? 'results' : 'game');
const me = () => (state ? state.players.find((p) => p.id === myId) : null);
const nameOf = (id) => {
  if (id === 'boss') return tr('巨无霸');
  if (typeof id === 'string') return tr('小怪');
  const p = state && state.players.find((q) => q.id === id);
  return p ? p.name : '???';
};
// 深色的身体颜色在深色界面上看不清，名字改用浅色
function readable(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  if (Number.isNaN(n)) return '#ffffff';
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum < 0.35 ? '#c9c3e8' : hex;
}
const colorOf = (id) => {
  const p = state && state.players.find((q) => q.id === id);
  if (!p) return '#ffffff';
  return readable(state.settings.mode === 'football' ? TEAM_COLORS[p.team] : p.profile.color);
};
const nameTag = (id) => `<b style="color:${esc(colorOf(id))}">${esc(nameOf(id))}</b>`;

function onState(s) {
  const prev = state;
  state = s;
  world.setState(s, myId);
  const wasHost = isHost;
  isHost = s.hostId === myId;
  document.body.classList.toggle('is-host', isHost);
  document.body.classList.toggle('not-host', !isHost);
  document.body.dataset.mode = s.settings.mode;

  world.playEvents(s.events);
  uiEvents(s.events);

  if (!prev || prev.phase !== s.phase) onPhase(prev ? prev.phase : null, s.phase);
  if (prev && !wasHost && isHost) notice(tr('你现在是房主了 👑 可以修改设置和开始游戏'));
  if (prev && (s.phase === 'lobby' || s.phase === 'gameOver')) {
    const before = new Set(prev.players.map((p) => p.id));
    const now = new Set(s.players.map((p) => p.id));
    if (s.players.some((p) => !before.has(p.id))) sfx.join();
    else if (prev.players.some((p) => !now.has(p.id))) sfx.leave();
  }

  const m = me();
  if (m && m.alive && inRound(s.phase)) aliveThisRound = true;
  if (current === 'lobby') renderLobby();
  if (current === 'game') renderHUD();
  if (current === 'results' && !resultsShown) renderResults();
  updateTouchUI(m);
}

function onPhase(from, to) {
  if (to === 'lobby') {
    resultsShown = null;
    if (['game', 'results', 'menu', 'rooms'].includes(current)) {
      closeModal(true);
      show('lobby');
    }
    world.setView(current === 'wardrobe' ? 'wardrobe' : 'room');
    playMusic('lobby');
    if (from && inRound(from)) notice(tr('比赛已结束，回到房间'));
  } else if (inRound(to)) {
    if (!from || !inRound(from)) {
      // 比赛开始（或中途加入）
      if (current === 'wardrobe') closeWardrobe(false);
      closeModal(true);
      hideEmotes();
      input.reset();
      killfeedClear();
      banner('', 0);
      show('game');
      world.setView('room');
      playMusic(state.settings.mode === 'boss' ? 'boss' : state.settings.map);
      resultsShown = null;
    }
    if (to === 'countdown') {
      lastCount = -1;
      aliveThisRound = false;
      faceObjective();
      if (state.settings.mode === 'rope') setTimeout(() => ropeHint(), 900);
    }
    if (to === 'playing' && from === 'countdown') {
      banner(tr('<span class="pop">开始！</span>'), 900);
      sfx.go();
    }
  } else if (to === 'gameOver') {
    if (current === 'wardrobe') closeWardrobe(false);
    closeModal(true);
    input.reset();
    show('results');
    world.setView('room');
    renderResults();
    playMusic('lobby');
  }
}

// 事件里需要界面提示的部分（画面和音效在 world.js 里）
function uiEvents(events) {
  const s = state;
  const koVictims = new Set(events.filter((e) => e.type === 'ko').map((e) => e.victim));
  for (const ev of events) {
    switch (ev.type) {
      case 'chat':
        // 进房时收到的聊天记录和下一帧事件可能重复
        if (ev.n <= lastChatN) break;
        lastChatN = ev.n;
        chatLines.push(ev);
        if (chatLines.length > 40) chatLines.shift();
        renderChat();
        if (ev.sticker) {
          world.showSticker(ev.id, ev.sticker);
          sfx.sticker(STICKER_MAP[ev.sticker] && STICKER_MAP[ev.sticker].snd);
          if (current === 'game') killfeed(`${nameTag(ev.id)} <span class="kf-sticker">${stickerSVG(ev.sticker, { label: false })}</span> ${esc(stickerName(ev.sticker))}`, false, 4000);
          break;
        }
        if (!ev.sys && ev.id !== myId) sfx.chat();
        if (current === 'game') killfeed(ev.sys ? `<span style="color:#b9b0e8">${esc(chatText(ev))}</span>` : tr('💬 {0}：{1}', nameTag(ev.id), esc(ev.text)), false, 5000);
        break;
      case 'ko': {
        const victim = typeof ev.victim === 'string' ? (ev.victim === 'boss' ? tr('<b style="color:#ff5a5f">巨无霸</b>') : tr('小怪')) : nameTag(ev.victim);
        killfeed(`${nameTag(ev.id)} 💥 ${victim}`, ev.id === myId || ev.victim === myId);
        break;
      }
      case 'fall':
        if (!koVictims.has(ev.id) && typeof ev.id === 'number') killfeed(tr('💧 {0} 掉下去了', nameTag(ev.id)), ev.id === myId);
        if (ev.id === myId && s.settings.mode === 'boss' && s.m.lives === 0) toast(tr('共享复活次数用完了！'), 2000);
        break;
      case 'potatoBoom':
        killfeed(tr('💣 {0} 被炸出局', nameTag(ev.id)), ev.id === myId);
        break;
      case 'potatoGive':
      case 'potatoPass':
        if (ev.id === myId) toast(tr('<span style="color:#ff8c42">💣 炸弹在你手上！快去撞别人！</span>'), 1800);
        else if (ev.from === myId) toast(tr('甩掉啦 😎'), 900);
        break;
      case 'goal': {
        const who = ev.id ? nameTag(ev.id) : TEAM_NAMES[ev.team];
        killfeed(`⚽ ${who} ${ev.own ? tr('乌龙球 😅') : tr('进球！')}`, ev.id === myId);
        break;
      }
      case 'crown':
        if (ev.id === myId) toast(tr('👑 你戴上了皇冠！别被撞到！'), 1500);
        else if (ev.from === myId) toast(tr('<span style="color:#ff5a5f">皇冠被抢走了！快抢回来！</span>'), 1500);
        killfeed(`👑 ${nameTag(ev.id)} ${ev.from ? tr('抢走了皇冠') : tr('拿到了皇冠')}`, ev.id === myId || ev.from === myId);
        break;
      case 'crownDrop':
        killfeed(tr('👑 {0} 掉了皇冠', nameTag(ev.id)));
        break;
      case 'grab':
        if (ev.id === myId) {
          const it = ITEMS[ev.item];
          toast(`${it.icon} ${it.name}<br><small>${it.desc}<br>${isTouch ? tr('点右下角的道具按钮使用') : tr('按 F 使用（或点左下角的道具栏）')}</small>`, 2200);
        }
        break;
      case 'bossWindup':
        toast(tr('<span style="color:#ff8c42">⚠️ 巨无霸在蓄力冲撞，快闪开！</span>'), 1200);
        break;
      case 'bossSlamWind':
        toast(tr('<span style="color:#ff5a5f">⚠️ 它要砸地了！跑出红圈！</span>'), 1200);
        break;
      case 'bossDown':
        killfeed(tr('🤖 {0} 把巨无霸推下去了！', ev.id ? nameTag(ev.id) : tr('大家')), ev.id === myId);
        if (ev.lives > 0) banner(tr('<span class="pop">干得漂亮！</span><small>巨无霸还剩 {0} 条命</small>', ev.lives), 2000);
        break;
      case 'bossTired':
        toast(tr('<span style="color:#ffe066">💫 巨无霸累趴了！快冲过去推它！</span>'), 1300);
        break;
      case 'bossEnrage':
        banner(tr('<span class="pop" style="color:#ff5a3a">🔥 巨无霸狂暴了！</span><small>它变得更快更凶，速战速决！</small>'), 2500);
        break;
      case 'bossBack':
        toast(tr('<span style="color:#ff5a5f">巨无霸回来了！{0}</span>', ev.phase >= 2 ? tr('还带来了小怪！') : ''), 1600);
        break;
      case 'minionDown':
        if (ev.id) killfeed(tr('👾 {0} 击落小怪', nameTag(ev.id)), ev.id === myId);
        break;
      case 'keyPick':
        killfeed(tr('🔑 {0} 拿到了钥匙', nameTag(ev.id)), ev.id === myId);
        if (ev.id === myId) toast(tr('🔑 你拿到了钥匙！快送到锁台上'), 1800);
        break;
      case 'keyReset':
        toast(tr('<span style="color:#ff8c42">钥匙掉了，回到了原来的地方</span>'), 1500);
        break;
      case 'unlock':
        banner(tr('<span class="pop">🔓 吊桥放下了！</span>'), 1600);
        killfeed(tr('🔓 {0} 打开了锁', nameTag(ev.id)), ev.id === myId);
        break;
      case 'plate':
        if (ev.id === myId && s.m.plates && s.m.plates.length > 1 && s.players.length === 1) toast(tr('压力板会亮几秒，快去踩另一块！'), 1400);
        break;
      case 'platesOpen':
        banner(tr('<span class="pop">🟢 机关桥打开了！</span>'), 1600);
        break;
      case 'hang':
        if (ev.id === myId) toast(tr('<span style="color:#ffe066">🪢 {0} 拉住了你！别急，正在把你拉上来</span>', nameTag(ev.by)), 1600);
        else if (ev.by === myId) toast(tr('<span style="color:#ffe066">🪢 你拉住了 {0}！站稳别乱跑</span>', nameTag(ev.id)), 1600);
        killfeed(tr('🪢 {0} 拉住了 {1}', nameTag(ev.by), nameTag(ev.id)), ev.id === myId || ev.by === myId);
        break;
      case 'saved':
        if (ev.by) killfeed(tr('💪 {0} 把 {1} 拉了上来', nameTag(ev.by), nameTag(ev.id)), ev.id === myId || ev.by === myId);
        break;
      case 'ropeSlip':
        killfeed(tr('😱 {0} 没抓住，掉下去了', nameTag(ev.id)), ev.id === myId);
        break;
      case 'roundEnd':
        $('toast').style.opacity = '0';
        if (s.roundText) banner(`<span class="pop">${esc(s.roundKey ? tr(s.roundKey, s.roundP || {}) : s.roundText)}</span>${roundScoreLine()}`, 3000);
        if (ev.id === myId || (ev.team >= 0 && me() && me().team === ev.team)) sfx.victory();
        else sfx.ready();
        break;
      case 'matchStart':
        killfeedClear();
        break;
    }
  }
}

// 第一人称：每局开始时面向场地中心（闯关模式面向出口）
function faceObjective() {
  const m = me();
  if (!m) return;
  const tgt = state.settings.mode === 'rope' && state.m.exit ? state.m.exit : { x: 0, y: 0 };
  if (Math.hypot(tgt.x - m.x, tgt.y - m.y) > 1) world.faceTowards(tgt.x, tgt.y, m.x, m.y);
}

// 切换第一 / 第三人称
function toggleView() {
  settings.view = settings.view === '1p' ? '3p' : '1p';
  saveSettings();
  world.setCameraMode(settings.view);
  if (settings.view === '1p') {
    faceObjective();
    notice(isTouch ? tr('第一人称：左边摇杆移动，右半屏左右拖动转向') : tr('第一人称：WASD 移动，按住鼠标左右拖动 / ←→ / Q E 转向（点一下画面可以锁定鼠标，Esc 解锁）'));
  } else {
    if (document.pointerLockElement) document.exitPointerLock();
    notice(tr('已切换到第三人称'));
  }
}
$('btnView').onclick = () => toggleView();
document.getElementById('game').addEventListener('click', (e) => {
  const cv = e.currentTarget;
  if (world.isFirstPerson() && !isTouch && !document.pointerLockElement && cv.requestPointerLock) {
    const r = cv.requestPointerLock();
    if (r && r.catch) r.catch(() => {});
  }
});

// 绳索闯关：每关开始时的提示
function ropeHint() {
  const m = state && state.m;
  if (!m || !m.hint) return;
  const solo = state.players.length === 1;
  const text = {
    key: tr('拿到钥匙 🔑 送到锁台上，吊桥就会放下'),
    plates: solo ? tr('一个人玩：踩过的压力板会亮几秒，趁亮着赶紧去踩另一块') : tr('两块压力板要同时有人踩住，机关桥才会打开'),
    blink: tr('橙色和蓝色地砖轮流出现，看准时机一起冲过去'),
    final: tr('钥匙、压力板、闪烁地砖全都有，最后一关加油！'),
  }[m.hint];
  const tip = m.stage === 0 && !solo ? tr('<br><small>你们被绳子串在一起：有人踩空时，旁边站稳的队友会把他吊住拉回来</small>') : '';
  toast(`${text}${tip}`, 4200);
}

function roundScoreLine() {
  const s = state;
  const mode = s.settings.mode;
  if (mode === 'football') return `<small>${TEAM_NAMES[0]} ${s.teamScore[0]} : ${s.teamScore[1]} ${TEAM_NAMES[1]}</small>`;
  if (mode === 'rope' && s.m.times) return tr('<small>用时 {0} · 剩余复活 {1}</small>', fmtTime(s.m.times[s.m.times.length - 1] || 0), s.m.lives);
  if (mode === 'classic' || mode === 'potato') {
    const top = [...s.players].sort((a, b) => b.score - a.score).slice(0, 3);
    return tr('<small>{0}（先赢 {1} 局）</small>', top.map((p) => `${esc(p.name)} ${p.score}`).join(' · '), s.settings.target);
  }
  return '';
}

// ---------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------
let bannerTimer = 0;
function banner(html, dur = 1500) {
  $('banner').innerHTML = html;
  clearTimeout(bannerTimer);
  if (dur) bannerTimer = setTimeout(() => ($('banner').innerHTML = ''), dur);
}
let toastTimer = 0;
function toast(html, dur = 1500) {
  const el = $('toast');
  el.innerHTML = html;
  el.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.style.opacity = '0'), dur);
}
function killfeed(html, mine = false, dur = 4200) {
  const el = document.createElement('div');
  el.className = 'kf' + (mine ? ' me' : '');
  el.innerHTML = html;
  $('killfeed').appendChild(el);
  while ($('killfeed').children.length > 6) $('killfeed').firstChild.remove();
  setTimeout(() => (el.style.opacity = '0'), dur);
  setTimeout(() => el.remove(), dur + 500);
}
function killfeedClear() {
  $('killfeed').innerHTML = '';
}

function scoreText(p, mode) {
  if (mode === 'crown') return `${p.score.toFixed(1)}s`;
  if (mode === 'paint') {
    const total = mapDef ? mapDef.tiles.length : 1;
    return `${Math.round((p.score / total) * 100)}%`;
  }
  return String(p.score);
}

function renderHUD() {
  const s = state;
  const m = me();
  const mode = s.settings.mode;
  const info = MODES[mode];
  const players = s.players;

  // 倒计时
  if (s.phase === 'countdown') {
    const n = Math.ceil(s.timer);
    if (n !== lastCount && n > 0) {
      lastCount = n;
      const roundTxt = ['classic', 'potato'].includes(mode)
        ? tr('第 {0} 局', s.round)
        : mode === 'rope' && s.m.stageName
          ? tr('第 {0} 关 · {1}', s.m.stage + 1, s.m.stageName[lang] || s.m.stageName.zh)
          : mode === 'football' && s.round > 1
            ? tr('重新开球')
            : `${info.icon} ${info.name}`;
      banner(`<span class="pop">${n}</span><small>${roundTxt}</small>`, 0);
      sfx.countdown();
    }
  }

  // 左上：记分板
  let rows;
  let head;
  if (mode === 'football') {
    head = tr('先进 {0} 球获胜', s.settings.target);
    rows = [0, 1]
      .map((t) =>
        players
          .filter((p) => p.team === t)
          .map((p) => sbRow(p, TEAM_COLORS[t], p.score ? `⚽${p.score}` : ''))
          .join('')
      )
      .join('<div style="height:6px"></div>');
  } else if (mode === 'rope') {
    head = tr('绳子顺序');
    const km = s.m.key;
    rows = players
      .map((p, i) => {
        const st = p.out ? '💀' : p.hang ? '🪢' : !p.alive || p.falling ? (p.respawn > 0 ? `⏳${Math.ceil(p.respawn)}` : '💧') : km && km.h === p.id ? '🔑' : '';
        return sbRow({ ...p, name: `${i + 1}. ${p.name}` }, p.profile.color, st);
      })
      .join('');
  } else if (mode === 'boss') {
    head = tr('合力把巨无霸推下去');
    rows = players
      .map((p) => {
        const st = p.alive && !p.falling ? '' : p.out ? '💀' : p.respawn > 0 ? `⏳${Math.ceil(p.respawn)}` : '💧';
        return sbRow(p, p.profile.color, st || (p.score ? `⭐${p.score}` : ''));
      })
      .join('');
  } else {
    head = mode === 'paint' ? tr('地盘占比') : `${info.label} ${s.settings.target} ${info.unit}`;
    const sorted = [...players].sort((a, b) => b.score - a.score);
    rows = sorted
      .map((p) => {
        let bar = '';
        if (mode === 'crown') bar = `<div class="bar" style="width:${Math.min(100, (p.score / s.settings.target) * 100) * 0.8}%;background:${esc(p.profile.color)}"></div>`;
        return sbRow(p, p.profile.color, scoreText(p, mode)) + bar;
      })
      .join('');
  }
  setHTML($('scoreboard'), `<div class="head">${info.icon} ${esc(head)}</div>${rows}`);

  // 顶部中间
  let top = '';
  if (mode === 'football') {
    top = `<div class="hud-pill"><span style="color:${TEAM_COLORS[0]}">${TEAM_NAMES[0]} ${s.teamScore[0]}</span> : <span style="color:${TEAM_COLORS[1]}">${s.teamScore[1]} ${TEAM_NAMES[1]}</span> <small>${fmtTime(s.matchTime)}</small></div>`;
  } else if (mode === 'boss') {
    const b = s.m;
    if (b.bossLivesMax) {
      const pips = Array.from({ length: b.bossLivesMax }, (_, i) => `<i class="${i < b.bossLives ? '' : 'gone'}"></i>`).join('');
      const stateTxt =
        b.bossState === 'tired' ? tr('<b style="color:#ffe066">💫 累趴了！快推！</b>') : b.bossState === 'windup' ? tr('⚡ 蓄力中') : b.bossState === 'charge' ? tr('💨 冲撞！') : b.bossState === 'slamWind' ? tr('⬆️ 跳起砸地') : b.phase >= 2 ? tr('第 {0} 阶段', b.phase) : '';
      const bossName = tr('🤖 巨无霸 · {0}', esc(tr(b.diff)));
      const livesTxt = tr('❤️ 共享复活 {0}', b.lives);
      top = `<div class="boss-bar"><div class="top"><span>${bossName}${b.enraged ? tr(' <b style="color:#ff5a3a">🔥狂暴</b>') : ''}</span><span>${stateTxt}</span><span>${livesTxt}</span></div><div class="lives">${pips}</div></div>`;
    }
  } else if (mode === 'rope') {
    const m = s.m;
    if (m.stages) {
      const tasks = [];
      if (m.key) tasks.push(`🔑 ${m.kOpen ? '✔' : m.key.h ? tr('搬运中') : '✗'}`);
      if (m.plates && m.plates.length) tasks.push(`🟢 ${m.pOpen ? '✔' : `${m.plates.filter((p) => p.on).length}/${m.plates.length}`}`);
      tasks.push(`🚪 ${m.inExit || 0}/${m.need || players.length}`);
      const stageTxt = tr('第 {0}/{1} 关', m.stage + 1, m.stages);
      const stageName = m.stageName ? m.stageName[lang] || m.stageName.zh : '';
      top = `<div class="hud-pill">${stageTxt} · ${esc(stageName)} <small>${esc(tr(m.diff))}</small></div><div class="hud-pill" style="font-size:16px">${tasks.join('  ')}  ❤️ ${m.lives}</div>`;
    }
  } else if (mode === 'crown') {
    const cr = s.m.crown;
    const who = cr && cr.h ? tr('{0} 戴着皇冠', nameTag(cr.h)) : tr('皇冠在地上，快去抢！');
    top = `<div class="hud-pill">👑 ${who}</div>`;
  } else if (mode === 'paint') {
    const clock = s.m.clock != null ? s.m.clock : s.settings.target;
    top = `<div class="hud-pill" style="${clock < 10 ? 'color:#ff5a5f' : ''}">⏱ ${fmtTime(Math.ceil(clock))}</div>${paintBar()}`;
  } else {
    const alive = players.filter((p) => p.alive && !p.falling).length;
    let extra = '';
    if (mode === 'potato' && s.m.holder) extra = ` · 💣 ${nameTag(s.m.holder)} <small>${Math.ceil(s.m.fuse)}s</small>`;
    top = tr('<div class="hud-pill">第 {0} 局 <small>剩 {1} 人</small>{2}</div>', s.round, alive, extra);
  }
  if (s.warn >= 0) top += tr('<div class="hud-pill" style="color:#ffb347;font-size:16px">⚠️ 外圈 {0} 秒后坍塌</div>', Math.ceil(s.warn));
  setHTML($('topHud'), top);

  // 我的状态效果
  let fx = '';
  if (m && m.alive) {
    const f = m.fx;
    if (f.big > 0) fx += tr('<div class="fx">🍄 巨大化 {0}</div>', Math.ceil(f.big));
    if (f.speed > 0) fx += tr('<div class="fx">⚡ 加速 {0}</div>', Math.ceil(f.speed));
    if (f.shield > 0) fx += tr('<div class="fx">🛡️ 护盾 {0}</div>', Math.ceil(f.shield));
    if (f.ghost > 0) fx += tr('<div class="fx">👻 幽灵 {0}</div>', Math.ceil(f.ghost));
    if (f.frozen > 0) fx += tr('<div class="fx">🧊 被冻住了</div>');
    if (f.slip > 0) fx += tr('<div class="fx">🍌 打滑中</div>');
  }
  setHTML($('effects'), fx);

  // 观战 / 复活提示
  let spec = '';
  if (m && !m.alive && !m.falling && s.phase !== 'countdown') {
    if (m.out) spec = tr('😵 复活次数用完了，观战中…');
    else if (['crown', 'paint', 'football', 'boss', 'rope'].includes(mode)) spec = m.respawn > 0 ? tr('⏳ {0} 秒后{1}复活', Math.ceil(m.respawn), mode === 'rope' ? tr('在队友身边') : '') : '';
    else spec = aliveThisRound ? tr('👀 你出局了，观战中…') : tr('⌛ 比赛进行中，下一局上场');
  }
  setHTML($('spectate'), spec);
}

function sbRow(p, color, pts) {
  const out = !(p.alive || p.falling) && state.phase !== 'countdown';
  return `<div class="row ${out ? 'out' : ''} ${p.id === myId ? 'me' : ''}"><span class="dot" style="background:${esc(color)}"></span><span class="nm">${esc(p.name)}</span><span class="pts">${esc(pts)}</span></div>`;
}

function paintBar() {
  const s = state;
  if (!s.m.paint || !s.m.slots) return '';
  const counts = new Array(s.m.slots.length).fill(0);
  let total = 0;
  for (const ch of s.m.paint) {
    total++;
    if (ch !== '.') counts[ch.charCodeAt(0) - 97]++;
  }
  const segs = s.m.slots
    .map((id, i) => {
      const p = s.players.find((q) => q.id === id);
      return p && counts[i] ? `<i style="width:${(counts[i] / total) * 100}%;background:${esc(p.profile.color)}"></i>` : '';
    })
    .join('');
  return `<div class="paint-bar">${segs}</div>`;
}

// 道具栏：捡到的道具放在这里，按 F / 点一下才用
let slotItem = '';
function updateItemSlot(m) {
  const s = state;
  const on = current === 'game' && s && inRound(s.phase) && s.settings.items && s.settings.mode !== 'rope' && m && m.alive;
  const el = $('itemSlot');
  el.classList.toggle('hidden', !on);
  if (!on) return;
  const it = m.item || '';
  if (it === slotItem) return;
  slotItem = it;
  el.classList.toggle('has', !!it);
  el.querySelector('.ico').textContent = it ? ITEMS[it].icon : '';
  el.title = it ? `${ITEMS[it].name}：${ITEMS[it].desc}（F）` : tr('道具栏（捡到的道具会放在这里）');
  if (it) {
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }
}
function useItem() {
  if (!state || !inRound(state.phase) || !slotItem) return;
  send({ t: 'use' });
}
$('itemSlot').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  useItem();
});

function updateTouchUI(m) {
  updateItemSlot(m);
  const show = isTouch && current === 'game' && state && inRound(state.phase) && m && m.alive;
  $('touchUI').classList.toggle('hidden', !show);
  document.body.classList.toggle('touch', isTouch);
  if (show) $('dashBtn').classList.toggle('cooling', m.dashCd > 0);
}

// ---------------------------------------------------------------------
// 结算
// ---------------------------------------------------------------------
function renderResults(silent = false) {
  const s = state;
  const r = s && s.results;
  if (!r) return;
  resultsShown = r;
  const my = r.rows.find((x) => x.id === myId);
  let title;
  let lose = false;
  if (r.coop) {
    title = r.coop.win ? (r.mode === 'rope' ? tr('🎉 全部通关！') : tr('🎉 挑战成功！')) : r.mode === 'rope' ? tr('💀 倒在了第 {0} 关', (r.coop.stage || 0) + 1) : tr('💀 挑战失败');
    lose = !r.coop.win;
  } else if (r.winnerTeam >= 0) {
    title = tr('{0}获胜！', TEAM_NAMES[r.winnerTeam]);
    lose = !my || my.team !== r.winnerTeam;
  } else if (r.winners.includes(myId)) {
    title = r.winners.length > 1 ? tr('🤝 并列第一！') : tr('🏆 你赢了！');
  } else {
    const w = r.rows.filter((x) => x.won);
    title = w.length ? tr('{0} 获胜！', esc(w.map((x) => x.name).join(tr('、')))) : tr('比赛结束');
    lose = true;
  }
  $('resTitle').innerHTML = title;
  $('resTitle').className = 'results-title' + (lose ? ' lose' : '');
  const mode = MODES[r.mode];
  const parts = [];
  if (r.text) parts.push(esc(tr(r.text)));
  if (r.mode === 'football') parts.push(tr('比分 {0} : {1}', r.teamScore[0], r.teamScore[1]));
  parts.push(`${mode.icon} ${mode.name}`, `${MAPS[r.map].icon} ${MAPS[r.map].name}`, tr('用时 {0}', fmtTime(r.duration)));
  $('resSub').innerHTML = parts.join(' · ');

  $('awards').innerHTML = r.awards
    .map((a, i) => {
      const row = r.rows.find((x) => x.id === a.id);
      return `<div class="award" style="animation-delay:${0.15 + i * 0.12}s"><span class="ico">${a.icon}</span><div><b>${esc(tr(a.title))}</b><span>${esc(row ? row.name : '')}</span><small>${esc(a.n !== undefined ? `${a.n}${tr(a.unit)}` : a.value)}</small></div></div>`;
    })
    .join('');

  const scoreHead = { classic: tr('胜局'), potato: tr('胜局'), crown: tr('戴冠'), paint: tr('地盘'), football: tr('进球'), boss: tr('得分'), rope: tr('贡献') }[r.mode];
  const total = mapDef ? mapDef.tiles.length : 1;
  const fmtScore = (x) => (r.mode === 'crown' ? `${x.score}s` : r.mode === 'paint' ? `${Math.round((x.score / total) * 100)}%` : x.score);
  $('resTable').innerHTML =
    `<tr><th>#</th><th style="text-align:left">${tr('玩家')}</th><th>${scoreHead}</th><th>${tr('击飞')}</th><th>${tr('掉落')}</th></tr>` +
    r.rows
      .map((x, i) => {
        const medal = x.won ? '🏆' : ['🥇', '🥈', '🥉'][i] || i + 1;
        const team = r.mode === 'football' ? `<span class="dot" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${TEAM_COLORS[x.team]}"></span>` : '';
        return `<tr class="${x.won ? 'win' : ''}"><td>${medal}</td><td class="name"><div>${avatarHTML(x.profile, 'sm')}${team}${esc(x.name)}${x.id === myId ? tr(' <small>(我)</small>') : ''}</div></td><td>${fmtScore(x)}</td><td>${x.kills}</td><td>${x.falls}</td></tr>`;
      })
      .join('');
  updateShowcaseArea();
  if (silent) return;
  if (lose) sfx.defeat();
  else sfx.victory();
}

$('resLobby').onclick = () => send({ t: 'toLobby' });
$('resAgain').onclick = () => send({ t: 'start' });
$('resLeave').onclick = () => confirmLeave();
$('resBoard').onclick = () => openBoard();

// ---------------------------------------------------------------------
// 房间大厅
// ---------------------------------------------------------------------
let chatLines = [];
let lastChatN = 0;

// 聊天记录默认停在最新一条；自己往上翻了就不自动滚。
// 进房时聊天记录是在大厅还没显示（高度为 0）时收到的，所以显示出来 / 尺寸变化时再滚一次
let chatStick = true;
$('chatLog').addEventListener('scroll', (e) => {
  const el = e.target;
  if (el.clientHeight) chatStick = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
});
new ResizeObserver(() => chatStick && ($('chatLog').scrollTop = $('chatLog').scrollHeight)).observe($('chatLog'));

function renderChat() {
  const el = $('chatLog');
  el.innerHTML = chatLines
    .map((c) =>
      c.sys
        ? `<div class="sys">${esc(chatText(c))}</div>`
        : `<div><b style="color:${esc(colorOf(c.id))}">${esc(c.name)}</b>${c.sticker ? `<span class="chat-sticker">${stickerSVG(c.sticker)}</span>` : esc(c.text)}</div>`
    )
    .join('');
  if (chatStick) el.scrollTop = el.scrollHeight;
}

// 两侧面板之间露出来的区域，决定 3D 展示台 / 领奖台的镜头远近和偏移
function updateShowcaseArea() {
  const sel = current === 'results' ? ['#awards', '.results-table'] : ['.lobby-left', '.lobby-right'];
  const l = document.querySelector(sel[0]).getBoundingClientRect();
  const r = document.querySelector(sel[1]).getBoundingClientRect();
  const w = window.innerWidth;
  if (r.left > l.right + 100) world.setShowcaseArea((r.left - l.right - 20) / w, ((l.right + r.left) / 2 - w / 2) / w);
  else world.setShowcaseArea(1, 0);
}
window.addEventListener('resize', () => (current === 'lobby' || current === 'results') && updateShowcaseArea());

function renderLobby() {
  const s = state;
  if (!s) return;
  updateShowcaseArea();
  const st = s.settings;
  const host = s.players.find((p) => p.id === s.hostId);
  setHTML($('roomName'), esc(st.name || (host ? tr('{0}的房间', host.name) : tr('房间'))));
  setHTML($('roomTag'), `${st.public ? tr('🌐 公开') : tr('🔒 私密')} · 📶 ${ping}ms`);
  setHTML($('roomCode'), esc(s.code));

  setHTML(
    $('mapCards'),
    MAP_IDS.map((id) => {
      const mp = MAPS[id];
      return `<button class="card map-card ${st.map === id ? 'on' : ''}" data-map="${id}" style="background:linear-gradient(135deg,${mp.grad[0]},${mp.grad[1]})"><span class="ico">${mp.icon}</span><b>${mp.name}</b><small>${mp.desc}</small></button>`;
    }).join('')
  );
  setHTML(
    $('modeCards'),
    MODE_IDS.map((id) => {
      const md = MODES[id];
      const cls = id === 'boss' ? 'coop' : id === 'football' ? 'team' : '';
      return `<button class="card mode-card ${cls} ${st.mode === id ? 'on' : ''}" data-mode="${id}"><span class="ico">${md.icon}</span><b>${md.name}</b><span class="tag">${md.tag}</span></button>`;
    }).join('')
  );
  const md = MODES[st.mode];
  const need = ['classic', 'potato', 'football'].includes(st.mode)
    ? tr('<br>💡 至少 2 人（人不够可以加机器人）')
    : st.mode === 'boss'
      ? tr('<br>💡 1~8 人都能玩，人越多 Boss 越重')
      : st.mode === 'rope'
        ? tr('<br>💡 1~8 人都能玩，地图决定关卡的主题和手感（冰面很滑！）')
        : '';
  setHTML($('modeDesc'), `<b>${md.icon} ${md.name}</b>${tr('：')}${md.desc}${need}`);
  setHTML($('targetLabel'), md.label);
  setHTML($('targetSeg'), md.targets.map((t) => `<button data-target="${t}" class="${st.target === t ? 'on' : ''}">${md.targetNames ? md.targetNames[t] : t + md.unit}</button>`).join(''));
  setHTML($('maxVal'), String(st.max));
  setHTML($('botSeg'), BOT_LEVELS.map((n, i) => `<button data-bot="${i}" class="${st.botLevel === i ? 'on' : ''}">${n}</button>`).join(''));
  $('itemsToggle').classList.toggle('on', !!st.items);
  $('publicToggle').classList.toggle('on', !!st.public);
  document.querySelector('.lobby-left').classList.toggle('locked', !isHost);

  // 玩家列表
  const n = s.players.length;
  setHTML($('playerCount'), `${n}/${st.max}`);
  const teams = st.mode === 'football';
  $('btnShuffle').style.display = teams && isHost ? '' : 'none';
  $('btnRemoveBot').disabled = !s.players.some((p) => p.bot);
  $('btnAddBot').disabled = n >= st.max;
  const invite = n < st.max ? tr('<div class="player-row empty" data-invite="1">＋ 邀请朋友（还能进 {0} 人）</div>', st.max - n) : '';
  let list;
  if (teams) {
    const m = me();
    list = `<div class="team-cols">${[0, 1]
      .map((t) => {
        const ps = s.players.filter((p) => p.team === t);
        const join = m && m.team !== t ? tr('<button class="btn btn-mini" data-team="{0}">加入</button>', t) : '';
        return `<div class="team-col team-${t}"><h4><span style="color:${TEAM_COLORS[t]}">${TEAM_NAMES[t]} (${ps.length})</span>${join}</h4>${ps.map(playerRow).join('')}</div>`;
      })
      .join('')}</div>${invite}`;
  } else list = s.players.map(playerRow).join('') + invite;
  setHTML($('playerList'), list);

  // 开始 / 准备按钮
  const m = me();
  const btn = $('btnMain');
  const others = s.players.filter((p) => !p.bot && p.id !== s.hostId && p.connected);
  const readyN = others.filter((p) => p.ready).length;
  if (isHost) {
    btn.textContent = tr('开始游戏');
    btn.className = 'btn btn-yellow btn-xl' + (readyN === others.length ? ' pulse' : '');
    setHTML($('readyInfo'), others.length ? tr('✔ 已准备 {0}/{1}', readyN, others.length) : n < 2 ? tr('可以添加机器人一起玩') : '');
  } else if (m) {
    btn.textContent = m.ready ? tr('✔ 已准备') : tr('准备！');
    btn.className = 'btn btn-xl ' + (m.ready ? 'btn-green is-ready' : 'btn-green pulse');
    btn.title = m.ready ? tr('再点一下取消准备') : '';
    setHTML($('readyInfo'), m.ready ? tr('等待房主开始…（再点一下取消准备）') : tr('点「准备」告诉房主你好了'));
  }
}

function playerRow(p) {
  const s = state;
  const badges = [];
  if (p.id === s.hostId) badges.push(tr('<span class="badge host">👑 房主</span>'));
  if (p.bot) badges.push(`<span class="badge">🤖 ${BOT_LEVELS[s.settings.botLevel]}</span>`);
  else if (!p.connected) badges.push(tr('<span class="badge off">掉线</span>'));
  else if (p.id !== s.hostId) badges.push(p.ready ? tr('<span class="badge ready">✔ 准备</span>') : tr('<span class="badge wait">未准备</span>'));
  return `<div class="player-row ${p.id === myId ? 'me' : ''}" data-id="${p.id}">${avatarHTML(p.profile, 'sm')}<span class="pname">${esc(p.name)}${p.id === myId ? tr(' <small>(我)</small>') : ''}</span><span class="badges">${badges.join('')}</span></div>`;
}

const hostOnly = () => {
  if (!isHost) notice(tr('只有房主可以修改设置'), true);
  return isHost;
};
$('mapCards').onclick = (e) => {
  const b = e.target.closest('[data-map]');
  if (b && hostOnly()) send({ t: 'settings', map: b.dataset.map });
};
$('modeCards').onclick = (e) => {
  const b = e.target.closest('[data-mode]');
  if (b && hostOnly()) send({ t: 'settings', mode: b.dataset.mode });
};
$('targetSeg').onclick = (e) => {
  const b = e.target.closest('[data-target]');
  if (b && hostOnly()) send({ t: 'settings', target: Number(b.dataset.target) });
};
$('botSeg').onclick = (e) => {
  const b = e.target.closest('[data-bot]');
  if (b && hostOnly()) send({ t: 'settings', botLevel: Number(b.dataset.bot) });
};
$('maxDown').onclick = () => {
  if (!hostOnly()) return;
  if (state.settings.max <= Math.max(2, state.players.length)) return notice(tr('人数上限不能少于房间里现有的人数'), true);
  send({ t: 'settings', max: state.settings.max - 1 });
};
$('maxUp').onclick = () => hostOnly() && send({ t: 'settings', max: state.settings.max + 1 });
$('itemsToggle').onclick = () => hostOnly() && send({ t: 'settings', items: !state.settings.items });
$('publicToggle').onclick = () => hostOnly() && send({ t: 'settings', public: !state.settings.public });
$('btnAddBot').onclick = () => send({ t: 'addBot', lang });
$('btnRemoveBot').onclick = () => send({ t: 'removeBot' });
$('btnShuffle').onclick = () => send({ t: 'shuffle' });
$('btnLeave').onclick = () => confirmLeave();
$('btnInvite').onclick = () => openInvite();
$('btnWardrobe2').onclick = () => openWardrobe();
$('btnRename').onclick = () => {
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.maxLength = 16;
  inp.value = state.settings.name || '';
  inp.placeholder = tr('例如：周五开黑局');
  const go = () => send({ t: 'settings', name: inp.value });
  inp.onkeydown = (e) => e.key === 'Enter' && (closeModal(true), go());
  modal({ title: tr('修改房间名'), body: inp, actions: [{ label: tr('确定'), cls: 'btn-yellow', onClick: go }, { label: tr('取消') }] });
};
$('btnMain').onclick = () => {
  if (!state) return;
  if (isHost) send({ t: 'start' });
  else {
    const m = me();
    send({ t: 'ready', v: !(m && m.ready) });
    sfx.ready();
  }
};
$('playerList').onclick = (e) => {
  const tb = e.target.closest('[data-team]');
  if (tb) {
    send({ t: 'team', team: Number(tb.dataset.team) });
    return;
  }
  if (e.target.closest('[data-invite]')) return openInvite();
  const row = e.target.closest('[data-id]');
  if (row) playerMenu(Number(row.dataset.id));
};

function playerMenu(id) {
  const s = state;
  const p = s.players.find((q) => q.id === id);
  if (!p) return;
  const c = charInfo(p.profile.char);
  const skin = SKINS.find((x) => x.id === p.profile.skin);
  const hat = HATS.find((x) => x.id === p.profile.hat);
  const skinTxt = skin ? tr('{0}皮肤', skin.name) : '';
  const body = `<div style="font-size:15px">${avatarHTML(p.profile)}<div style="margin-top:8px">${c.icon} ${c.name} · ${skinTxt} · ${hat ? hat.icon + ' ' + hat.name : ''}</div>${p.bot ? tr('<div class="hint">机器人玩家</div>') : ''}</div>`;
  const actions = [];
  const teams = s.settings.mode === 'football';
  if (id === myId) {
    actions.push({ label: tr('👕 换装 / 改名'), cls: 'btn-purple', onClick: openWardrobe });
    if (teams) actions.push({ label: tr('🔀 换到{0}', TEAM_NAMES[1 - p.team]), cls: 'btn-blue', onClick: () => send({ t: 'team', team: 1 - p.team }) });
  } else if (isHost) {
    if (!p.bot && p.connected) {
      actions.push({
        label: tr('👑 转让房主'),
        cls: 'btn-yellow',
        onClick: () =>
          modal({
            title: tr('转让房主'),
            body: tr('确定把房主转让给 <b>{0}</b> 吗？<br><span class="hint">转让后你将不能修改设置和开始游戏</span>', esc(p.name)),
            actions: [{ label: tr('确定转让'), cls: 'btn-yellow', onClick: () => send({ t: 'host', id }) }, { label: tr('取消') }],
          }),
      });
    }
    if (teams) actions.push({ label: tr('🔀 换到{0}', TEAM_NAMES[1 - p.team]), cls: 'btn-blue', onClick: () => send({ t: 'team', id, team: 1 - p.team }) });
    actions.push({
      label: p.bot ? tr('🗑️ 移除机器人') : tr('🚪 踢出房间'),
      cls: 'btn-red',
      onClick: () =>
        p.bot
          ? send({ t: 'kick', id })
          : modal({
              title: tr('踢出玩家'),
              body: tr('确定把 <b>{0}</b> 踢出房间吗？<br><span class="hint">被踢出的玩家不能再进入这个房间</span>', esc(p.name)),
              actions: [{ label: tr('踢出'), cls: 'btn-red', onClick: () => send({ t: 'kick', id }) }, { label: tr('取消') }],
            }),
    });
  }
  actions.push({ label: tr('关闭') });
  modal({ title: p.name + (id === s.hostId ? ' 👑' : ''), body, actions });
}

function confirmLeave() {
  modal({
    title: tr('离开房间？'),
    body: isHost && state && state.players.some((p) => !p.bot && p.id !== myId) ? tr('你是房主，离开后房主会自动交给下一位玩家。') : tr('确定要离开这个房间吗？'),
    actions: [{ label: tr('离开'), cls: 'btn-red', onClick: leaveRoom }, { label: tr('取消') }],
  });
}

// 聊天
function sendChat() {
  const v = $('chatInput').value.trim();
  if (!v) return;
  send({ t: 'chat', text: v });
  $('chatInput').value = '';
}
$('btnSend').onclick = sendChat;
$('chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChat();
  if (e.key === 'Escape') $('chatInput').blur();
});
$('btnEmoteLobby').onclick = (e) => toggleEmotes(e.currentTarget);
$('btnEmote').onclick = (e) => toggleEmotes(e.currentTarget);
$('btnEmoteRes').onclick = (e) => toggleEmotes(e.currentTarget);
// 贴图：记住上一次用的，按 T 快速再发一次（嘲讽专用）
let lastSticker = 'bleh';
try {
  lastSticker = localStorage.getItem('bb_last_sticker') || 'bleh';
} catch {
  /* 无痕模式 */
}
function sendSticker(id) {
  if (!STICKER_MAP[id]) return;
  send({ t: 'sticker', s: id });
  lastSticker = id;
  try {
    localStorage.setItem('bb_last_sticker', id);
  } catch {
    /* 无痕模式 */
  }
}
const stickerName = (id) => (STICKER_MAP[id] ? STICKER_MAP[id].name : '');
initEmotes((i) => send({ t: 'emote', i }), sendSticker);

// 邀请
// 局域网地址会变（换了 Wi-Fi / 网线），所以几秒没问就重新问一次服务器
let infoAt = 0;
async function getInfo() {
  if (!info || Date.now() - infoAt > 5000) {
    const fresh = await fetch('/api/info').then((r) => r.json()).catch(() => null);
    if (fresh) {
      info = fresh;
      infoAt = Date.now();
    } else if (!info) info = { lan: [], port: location.port };
  }
  return info;
}
const isLocalHost = (h) => h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
function lanBase(inf) {
  if (!isLocalHost(location.hostname) || !inf.lan.length) return location.origin;
  return `${location.protocol}//${inf.lan[0]}:${location.port || inf.port}`;
}
const qrDataURL = (text) => {
  try {
    const q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    return q.createDataURL(5, 2);
  } catch {
    return '';
  }
};
const qrBlock = (text) => {
  const src = qrDataURL(text);
  return src ? tr('<div class="qr"><img alt="二维码" src="{0}"></div>', src) : '';
};

// 邀请：「同一 Wi-Fi」用局域网地址；「外网链接」用 Cloudflare 生成的公网网址
let invitePoll = 0;
async function openInvite(tab) {
  if (!roomCode) return;
  const inf = await getInfo();
  const lanUrl = `${lanBase(inf)}/?room=${roomCode}`;
  const viaTunnel = /\.trycloudflare\.com$/i.test(location.hostname);
  let cur = tab || (viaTunnel ? 'online' : 'lan');
  let copyUrl = lanUrl;
  const box = document.createElement('div');
  box.innerHTML = `<div class="big-code">${esc(roomCode)}</div><p class="hint">${tr('朋友打开游戏后，在主菜单输入房间码')}</p><div class="seg invite-tabs"><button data-tab="lan">${tr('📶 同一 Wi-Fi')}</button><button data-tab="online">${tr('🌍 外网链接')}</button></div><div class="invite-body"></div>`;
  const body = box.querySelector('.invite-body');
  const setTabs = () => box.querySelectorAll('.invite-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === cur));

  const renderLan = () => {
    copyUrl = lanUrl;
    const noLan = isLocalHost(location.hostname) && !inf.lan.length ? tr('<p class="hint">⚠️ 没检测到局域网地址，请确认这台电脑连着 Wi-Fi / 网线</p>') : '';
    const more = inf.lan.length > 1 && isLocalHost(location.hostname) ? tr('<p class="hint">其他网卡地址：{0}</p>', inf.lan.slice(1).map((ip) => `${ip}:${location.port || inf.port}`).join(tr('、'))) : '';
    body.innerHTML = `${qrBlock(lanUrl)}<p class="hint">${tr('同一 Wi-Fi 下，手机扫码直接进房')}</p><div class="link-box">${esc(lanUrl)}</div>${noLan}${more}`;
  };

  const renderOnline = async () => {
    clearTimeout(invitePoll);
    if (cur !== 'online' || !box.isConnected) return;
    let st = null;
    try {
      st = await fetch('/api/tunnel', { cache: 'no-store' }).then((r) => r.json());
    } catch {
      st = null;
    }
    if (cur !== 'online' || !box.isConnected) return;
    copyUrl = lanUrl;
    if (!st) {
      body.innerHTML = `<p>${tr('连不上服务器')}</p>`;
      return;
    }
    if (st.status === 'running' && st.url) {
      const url = `${st.url}/?room=${roomCode}`;
      copyUrl = url;
      body.innerHTML =
        `${qrBlock(url)}<p class="hint">${tr('不在同一个 Wi-Fi 的朋友，用手机或电脑打开这个链接就能进房')}</p><div class="link-box">${esc(url)}</div>` +
        `<p class="hint">${tr('链接在开服窗口关掉后失效，每次生成的网址都不一样。')}</p>` +
        (st.canControl ? `<button class="btn btn-mini btn-ghost" data-act="stop">${tr('⏹ 关闭外网链接')}</button>` : '');
    } else if (st.status === 'downloading' || st.status === 'starting') {
      const msg = st.status === 'downloading' ? tr('第一次使用，正在下载 Cloudflare 组件… {0}%', st.progress || 0) : tr('正在生成外网链接…');
      body.innerHTML = `<div class="spinner"></div><p>${msg}</p>`;
      invitePoll = setTimeout(renderOnline, 1000);
    } else {
      const err = st.status === 'error' && st.error ? `<p style="color:#ff8a8e">${esc(tr(st.error))}</p>` : '';
      const how = st.canControl
        ? `<button class="btn btn-green" data-act="start">${tr('🌍 生成外网链接')}</button>`
        : `<p style="color:#ffb347">${tr('只有开服的电脑能生成外网链接：在那台电脑上打开 http://localhost:{0} 再点「邀请」。', esc(location.port || inf.port))}</p>`;
      body.innerHTML = `<p class="hint" style="text-align:left">${tr('用 Cloudflare 免费生成一个公网网址，不在同一个 Wi-Fi 的朋友也能一起玩。不需要注册账号，第一次使用会自动下载一个小组件（约 20~40MB）。')}</p>${err}${st.supported === false ? `<p>${tr('这个系统不支持自动生成外网链接')}</p>` : how}`;
    }
  };

  const render = () => {
    setTabs();
    if (cur === 'lan') renderLan();
    else renderOnline();
  };
  box.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) {
      cur = t.dataset.tab;
      render();
      return;
    }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    act.disabled = true;
    await fetch('/api/tunnel' + (act.dataset.act === 'stop' ? '?action=stop' : ''), { method: 'POST', headers: { 'x-bb-update': '1' } }).catch(() => {});
    renderOnline();
  });
  modal({
    title: tr('📨 邀请朋友'),
    body: box,
    onClose: () => clearTimeout(invitePoll),
    actions: [
      {
        label: tr('📋 复制邀请链接'),
        cls: 'btn-blue',
        keep: true,
        onClick: async () => notice((await copyText(copyUrl)) ? tr('邀请链接已复制 ✔') : tr('复制失败，请手动复制'), false),
      },
      { label: tr('关闭'), onClick: () => clearTimeout(invitePoll) },
    ],
  });
  render();
}

// ---------------------------------------------------------------------
// 主菜单
// ---------------------------------------------------------------------
function menuError(t) {
  $('menuError').textContent = t || '';
}
function refreshProfileChip() {
  $('menuAvatar').outerHTML = avatarHTML(profile).replace('class="avatar ', 'id="menuAvatar" class="avatar ');
  $('menuName').textContent = playerName;
}

let menuCycle = null;
let menuMapIdx = Math.floor(Math.random() * MAP_IDS.length);
async function loadMap(id) {
  if (!mapDefs[id]) mapDefs[id] = await fetch('/api/map/' + id).then((r) => r.json());
  return mapDefs[id];
}
function startMenuCycle() {
  stopMenuCycle();
  const step = async () => {
    try {
      const def = await loadMap(MAP_IDS[menuMapIdx++ % MAP_IDS.length]);
      if (!roomCode && !joining) applyMap(def);
    } catch {
      /* 服务器没开时忽略 */
    }
  };
  step();
  menuCycle = setInterval(step, 14000);
}
function stopMenuCycle() {
  clearInterval(menuCycle);
  menuCycle = null;
}

async function refreshRoomCount() {
  try {
    const list = await fetch('/api/rooms').then((r) => r.json());
    const open = list.filter((r) => r.phase === 'lobby' && r.players < r.max).length;
    $('roomCountHint').textContent = list.length ? tr('附近有 {0} 个房间{1}', list.length, open ? tr('，{0} 个在等人', open) : '') : tr('看看附近有谁在玩');
  } catch {
    $('roomCountHint').textContent = tr('看看附近有谁在玩');
  }
}
setInterval(() => {
  if (current === 'menu') refreshRoomCount();
  if (current === 'rooms') refreshRooms();
}, 4000);

$('btnQuick').onclick = () => joinRoom({ quick: true });
$('btnCreate').onclick = () => joinRoom({ room: '', public: true });
$('btnRooms').onclick = () => {
  show('rooms');
  refreshRooms();
};
$('btnJoin').onclick = () => {
  const code = $('codeInput').value.trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(code)) {
    menuError(tr('房间码是 4 个英文字母'));
    sfx.error();
    return;
  }
  joinRoom({ room: code });
};
$('codeInput').addEventListener('input', (e) => (e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '')));
$('codeInput').addEventListener('keydown', (e) => e.key === 'Enter' && $('btnJoin').click());
$('menuProfile').onclick = () => openWardrobe();
$('btnBoard').onclick = () => openBoard();
$('btnHelp').onclick = () => openHelp();
$('btnSettings').onclick = () => openSettings();
$('btnLang').onclick = () => setLang(lang === 'zh' ? 'en' : 'zh');
function updateLangButton() {
  $('btnLang').textContent = lang === 'zh' ? 'EN' : '中';
  $('btnLang').title = lang === 'zh' ? 'Switch to English' : '切换到中文';
}
// 切换语言后，把当前页面重新渲染一遍
onLangChange(() => {
  updateLangButton();
  refreshProfileChip();
  showLanHint();
  refreshRoomCount();
  if (current === 'lobby') renderLobby();
  if (current === 'game') renderHUD();
  if (current === 'results') renderResults(true);
  if (current === 'help') renderHelp();
  if (current === 'wardrobe') renderWardrobe();
  if (current === 'rooms') refreshRooms();
  if (current === 'board') openBoard();
  renderChat();
  if (updInfo && updInfo.hasUpdate) $('updVer').textContent = 'v' + updInfo.latest;
});
$('btnUpdate').onclick = () => openUpdate();

// 换网络后主菜单顶部的网址自动更新
setInterval(() => current === 'menu' && document.visibilityState === 'visible' && showLanHint(), 15000);
window.addEventListener('online', () => setTimeout(showLanHint, 1500));
async function showLanHint() {
  const inf = await getInfo();
  const el = $('lanHint');
  // 开服的电脑：页面顶部显示局域网地址，一键复制发给朋友
  const lanUrl = isLocalHost(location.hostname) && inf.lan.length ? `http://${inf.lan[0]}:${location.port || inf.port}` : '';
  $('lanPill').classList.toggle('hidden', !lanUrl);
  $('scr-menu').classList.toggle('has-lan', !!lanUrl);
  $('lanUrl').textContent = lanUrl.replace('http://', '');
  $('lanPill').dataset.url = lanUrl;
  if (!isLocalHost(location.hostname)) el.innerHTML = tr('已连接到 <b>{0}</b> · v{1}', esc(location.host), esc(inf.version || ''));
  else el.innerHTML = `v${esc(inf.version || '')}`;
}
$('lanCopy').onclick = async () => {
  const url = $('lanPill').dataset.url;
  if (!url) return;
  await copyText(url);
  const b = $('lanCopy');
  b.textContent = tr('✔ 已复制');
  b.classList.add('done'); // 按钮本身变成「✔ 已复制」，不再弹通知（通知会挡住网址条）
  setTimeout(() => {
    b.textContent = tr('📋 复制');
    b.classList.remove('done');
  }, 1800);
};
$('lanQR').onclick = () => {
  const url = $('lanPill').dataset.url;
  if (!url) return;
  const box = document.createElement('div');
  box.className = 'invite-box';
  box.innerHTML = `${qrBlock(url)}<p class="hint">${tr('同一 Wi-Fi 下，手机扫码就能打开游戏')}</p><div class="link-box">${esc(url)}</div>`;
  modal({ title: tr('📶 邀请同一 Wi-Fi 的朋友'), body: box, actions: [{ label: tr('📋 复制'), cls: 'btn-blue', onClick: () => copyText(url).then(() => notice(tr('网址已复制，粘贴发给同一个 Wi-Fi 的朋友吧'))) }, { label: tr('关闭') }] });
};

// ---------------------------------------------------------------------
// 局域网房间列表
// ---------------------------------------------------------------------
async function refreshRooms() {
  let list;
  try {
    list = await fetch('/api/rooms').then((r) => r.json());
  } catch {
    setHTML($('roomList'), tr('<div class="empty"><div class="big">📡</div>连接服务器失败</div>') + `<div class="empty-sub"><button class="btn btn-blue" data-help="1">${tr('❓ 为什么连不上？')}</button><p class="hint">${tr('每 4 秒会自动重试')}</p></div>`);
    return;
  }
  if (current !== 'rooms') return;
  if (!list.length) {
    setHTML($('roomList'), tr('<div class="empty"><div class="big">🏝️</div>附近还没有公开房间<br><button class="btn btn-blue" data-create="1">🏠 自己开一个</button></div>'));
  } else {
    setHTML(
      $('roomList'),
      list
        .map((r) => {
          const mp = MAPS[r.map] || MAPS.lava;
          const md = MODES[r.mode] || MODES.classic;
          const full = r.players >= r.max;
          const phase = r.phase === 'lobby' ? tr('<span class="pill green">等待中</span>') : tr('<span class="pill orange">游戏中</span>');
          const hostTxt = tr('房主 {0}', esc(r.host));
          const roomName = esc(r.name || tr('{0}的房间', r.host));
          return `<div class="room-item"><div class="map-thumb" style="background:linear-gradient(135deg,${mp.grad[0]},${mp.grad[1]})">${mp.icon}</div><div class="info"><b>${roomName}</b><span>${phase}${md.icon} ${md.name} · ${mp.name} · ${hostTxt}</span></div><div class="pill">${r.players}/${r.max}</div><button class="btn ${full ? 'btn-ghost' : 'btn-green'}" data-code="${esc(r.code)}" ${full ? 'disabled' : ''}>${full ? tr('已满') : tr('加入')}</button></div>`;
        })
        .join('')
    );
  }
  setHTML($('roomsHint'), tr('只显示同一台服务器上的公开房间；私密房间需要房主给你房间码。'));
}
$('roomList').onclick = (e) => {
  if (e.target.closest('[data-help]')) return connectionHelp();
  const b = e.target.closest('[data-code]');
  if (b) joinRoom({ room: b.dataset.code });
  if (e.target.closest('[data-create]')) joinRoom({ room: '', public: true });
};
$('roomsBack').onclick = () => show('menu');
$('roomsRefresh').onclick = () => refreshRooms();

// ---------------------------------------------------------------------
// 衣柜
// ---------------------------------------------------------------------
let wardTab = 'char';
let wardOrig = null;
let wardName = '';
function openWardrobe() {
  closeModal(true);
  wardOrig = { ...profile };
  wardName = playerName;
  $('nameInput').value = playerName;
  renderWardrobe();
  show('wardrobe');
  world.setView('wardrobe');
  world.setMenuProfile(profile);
}
function closeWardrobe(save) {
  if (save) {
    const n = $('nameInput').value.trim();
    if (!n) {
      notice(tr('名字不能为空'), true);
      return;
    }
    setPlayerName(n);
    saveProfile();
    if (inRoom) send({ t: 'profile', name: playerName, profile });
    notice(tr('已保存 ✔'));
  } else {
    Object.assign(profile, wardOrig);
    $('nameInput').value = wardName;
  }
  world.setMenuProfile(profile);
  refreshProfileChip();
  if (inRoom && state) {
    world.setView('room');
    show(screenForPhase(state.phase));
  } else {
    world.setView('menu');
    show('menu');
  }
}

function skinCSS(id, color) {
  switch (id) {
    case 'stripes':
      return `repeating-linear-gradient(45deg,${color} 0 7px,#ffffff 7px 11px)`;
    case 'dots':
      return `radial-gradient(circle,#ffffff 3px,transparent 4px) 0 0/12px 12px,${color}`;
    case 'camo':
      return `radial-gradient(circle at 30% 30%,rgba(0,0,0,.35) 6px,transparent 7px),radial-gradient(circle at 70% 60%,rgba(255,255,255,.3) 7px,transparent 8px),radial-gradient(circle at 40% 80%,rgba(0,0,0,.25) 5px,transparent 6px),${color}`;
    case 'rainbow':
      return 'linear-gradient(180deg,#ff5a5f,#ffd23f,#3ddc84,#3fa7ff,#b06cff)';
    case 'candy':
      return `repeating-linear-gradient(-45deg,${color} 0 6px,#fff0f7 6px 12px)`;
    case 'gold':
      return 'radial-gradient(circle at 35% 30%,#fff6b0,#ffc83d 45%,#b07800)';
    case 'galaxy':
      return 'radial-gradient(circle at 30% 30%,#fff 1px,transparent 2px) 0 0/9px 9px,radial-gradient(circle at 60% 40%,#8a5cff,#1a0f3d 70%)';
    case 'lava':
      return 'radial-gradient(circle at 30% 35%,#ffd23f 3px,transparent 5px),radial-gradient(circle at 65% 65%,#ff7a1a 5px,transparent 7px),#3a1a1a';
    case 'ice':
      return 'linear-gradient(135deg,#ffffff,#bdefff 40%,#6cc8f0)';
    default:
      return color;
  }
}

function renderWardrobe() {
  document.querySelectorAll('#wardTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === wardTab));
  const grid = $('wardGrid');
  let html = '';
  if (wardTab === 'char') {
    html = CHARACTERS.map((c) => `<button class="opt ${profile.char === c.id ? 'on' : ''}" data-v="${c.id}" title="${c.desc}"><span class="big">${c.icon}</span>${c.name}</button>`).join('');
  } else if (wardTab === 'skin') {
    html = SKINS.map((s) => `<button class="opt ${profile.skin === s.id ? 'on' : ''}" data-v="${s.id}"><span class="swatch" style="background:${skinCSS(s.id, profile.color)}"></span>${s.name}</button>`).join('');
  } else if (wardTab === 'color') {
    const fixed = SKINS.find((s) => s.id === profile.skin && s.fixed);
    html =
      (fixed ? tr('<div class="hint" style="grid-column:1/-1">「{0}」皮肤自带配色，颜色只影响头像和名字</div>', fixed.name) : '') +
      COLORS.map((c) => `<button class="opt ${profile.color === c ? 'on' : ''}" data-v="${c}"><span class="swatch" style="background:${c}"></span></button>`).join('');
  } else {
    html = HATS.map((h) => `<button class="opt ${profile.hat === h.id ? 'on' : ''}" data-v="${h.id}"><span class="big">${h.icon}</span>${h.name}</button>`).join('');
  }
  grid.innerHTML = html;
}
$('wardTabs').onclick = (e) => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  wardTab = b.dataset.tab;
  renderWardrobe();
};
$('wardGrid').onclick = (e) => {
  const b = e.target.closest('[data-v]');
  if (!b) return;
  const key = { char: 'char', skin: 'skin', color: 'color', hat: 'hat' }[wardTab];
  profile[key] = b.dataset.v;
  world.setMenuProfile(profile);
  renderWardrobe();
};
$('btnRandomLook').onclick = () => {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  profile.char = pick(CHARACTERS).id;
  profile.skin = pick(SKINS).id;
  profile.color = pick(COLORS);
  profile.hat = pick(HATS).id;
  world.setMenuProfile(profile);
  renderWardrobe();
};
$('btnRandomName').onclick = () => {
  const pool = RANDOM_NAMES[lang];
  $('nameInput').value = pool[Math.floor(Math.random() * pool.length)] + Math.floor(Math.random() * 90 + 10);
};
$('nameInput').addEventListener('keydown', (e) => e.key === 'Enter' && closeWardrobe(true));
$('wardSave').onclick = () => closeWardrobe(true);
$('wardBack').onclick = () => closeWardrobe(false);

// 拖动旋转角色
let dragX = null;
const canvasEl = document.getElementById('game');
canvasEl.addEventListener('pointerdown', (e) => {
  if (current === 'wardrobe') dragX = e.clientX;
});
window.addEventListener('pointermove', (e) => {
  if (dragX === null) return;
  world.wardrobeRotate(e.clientX - dragX);
  dragX = e.clientX;
});
window.addEventListener('pointerup', () => (dragX = null));

// ---------------------------------------------------------------------
// 排行榜 / 玩法说明 / 设置
// ---------------------------------------------------------------------
let overlayReturn = 'menu';
function backFromOverlay() {
  if (inRoom && state) show(screenForPhase(state.phase));
  else show(overlayReturn === 'rooms' ? 'rooms' : 'menu');
}

async function openBoard() {
  overlayReturn = current;
  show('board');
  $('boardTable').innerHTML = tr('<tr><td class="hint">加载中…</td></tr>');
  let list = [];
  try {
    list = await fetch('/api/leaderboard').then((r) => r.json());
  } catch {
    list = null;
  }
  if (!list) {
    $('boardTable').innerHTML = tr('<tr><td class="hint">加载失败</td></tr>');
    return;
  }
  if (!list.length) {
    $('boardTable').innerHTML = tr('<tr><td><div class="empty"><div class="big">🏆</div>还没有记录，快去赢一局吧！</div></td></tr>');
    return;
  }
  $('boardTable').innerHTML =
    `<tr><th>#</th><th style="text-align:left">${tr('玩家')}</th><th>${tr('夺冠')}</th><th>${tr('场次')}</th><th>${tr('胜率')}</th><th>${tr('击飞')}</th></tr>` +
    list
      .map((r, i) => `<tr class="${r.name === playerName ? 'win' : ''}"><td>${['🥇', '🥈', '🥉'][i] || i + 1}</td><td class="name">${esc(r.name)}</td><td>${r.wins}</td><td>${r.games}</td><td>${r.games ? Math.round((r.wins / r.games) * 100) : 0}%</td><td>${r.kos}</td></tr>`)
      .join('');
}
$('boardBack').onclick = backFromOverlay;

let helpTab = 'controls';
function openHelp() {
  overlayReturn = current;
  show('help');
  renderHelp();
}
async function renderHelp() {
  document.querySelectorAll('#helpTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === helpTab));
  const card = (ico, title, text) => `<div class="help-card"><span class="ico">${ico}</span><b>${title}</b>${text}</div>`;
  let html = '';
  if (helpTab === 'controls') {
    html = [
      card('⌨️', tr('电脑'), tr('<span class="keys">W</span><span class="keys">A</span><span class="keys">S</span><span class="keys">D</span> 或方向键移动<br><span class="keys">空格</span> / <span class="keys">Shift</span> / <span class="keys">J</span> 冲刺<br><span class="keys">F</span> 使用道具　<span class="keys">1</span>~<span class="keys">8</span> 发表情　<span class="keys">T</span> 嘲讽贴图　<span class="keys">Esc</span> 菜单<br>大厅里按 <span class="keys">回车</span> 聊天')),
      card('📱', tr('手机'), tr('左半边屏幕按住拖动 = 摇杆<br>右下角红色大按钮 = 冲刺<br>横屏玩体验更好')),
      card('💥', tr('撞人技巧'), tr('冲刺撞人最狠，冷却 1.2 秒。脚下光圈<b style="display:inline;color:#ffd23f">变黄</b>就能再冲。<br>速度越快、体重越大，撞得越远。')),
      card('🧠', tr('小心'), tr('冰面很滑，停不下来；香蕉皮会让你打滑；被冻住时谁都能推你。靠近边缘时别乱冲！')),
      card('😜', tr('表情 & 嘲讽贴图'), tr('点 😀 按钮选表情、贴图或动图，发出来会冒在你头顶，角色还会跟着做动作。按 T 快速再发一次上一个贴图，结算画面也能嘲讽！')),
      card('🔄', tr('掉线重连'), tr('刷新页面或网络断开后会自动回到原来的房间；比赛中 60 秒内回来，机器人会先帮你顶着。')),
    ].join('');
  } else if (helpTab === 'modes') {
    html = MODE_IDS.map((id) => card(MODES[id].icon, `${MODES[id].name} <small style="color:#b9b0e8">${MODES[id].tag}</small>`, MODES[id].desc)).join('');
  } else if (helpTab === 'items') {
    html = Object.values(ITEMS)
      .map((it) => card(it.icon, it.name, it.desc))
      .join('');
    html += card('❓', tr('说明'), tr('道具会随机刷在场地上，碰到就放进道具栏，按 F（手机点道具按钮）才会用出来。一次只能拿一个，掉下去就没了。房主可以在房间设置里关闭道具。'));
  } else if (helpTab === 'maps') {
    html = MAP_IDS.map((id) => card(MAPS[id].icon, MAPS[id].name, MAPS[id].desc)).join('');
  } else {
    const inf = await getInfo();
    const port = location.port || inf.port;
    const addrs = inf.lan.length ? inf.lan.map((ip) => `<b style="display:inline;color:#ffd23f">http://${esc(ip)}:${esc(port)}</b>`).join('<br>') : tr('（没检测到局域网地址）');
    html = [
      card('1️⃣', tr('开服'), tr('找一台电脑，双击游戏文件夹里的 <span class="keys">start.bat</span>（苹果电脑是 start.command，也可以运行 npm start）。这台电脑就是服务器，不要关掉窗口，窗口里会显示朋友用的地址和二维码。')),
      card('2️⃣', tr('连同一个 Wi-Fi'), tr('朋友的电脑 / 手机连上同一个 Wi-Fi，用浏览器打开：<br>{0}', addrs)),
      card('3️⃣', tr('开房邀请'), tr('点「创建房间」当房主，再点「邀请」：朋友可以扫二维码、输入 4 位房间码，或者在「局域网房间」列表里直接加入。')),
      card('🌍', tr('不在同一个 Wi-Fi？'), tr('房主在「邀请」里切到「🌍 外网链接」，点一下就能生成一个公网网址（免费，不用注册），发给任何地方的朋友都能打开。')),
      card('🛡️', tr('连不上？'), tr('Windows 第一次运行时会弹出防火墙提示，请勾选「专用网络」并点「允许访问」。公司 / 学校网络可能禁止设备互访。')),
      card('👑', tr('房主权限'), tr('房主可以选地图、模式、目标分数、人数上限、机器人难度、道具开关，能踢人、转让房主、分队、中途结束比赛。房主离开时自动交给下一位。')),
      card('🔒', tr('私密房间'), tr('关掉「公开房间」后，房间不会出现在列表里，只有知道房间码的人能进。')),
    ].join('');
  }
  $('helpBody').innerHTML = `<div class="help-grid">${html}</div>`;
}
$('helpTabs').onclick = (e) => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  helpTab = b.dataset.tab;
  renderHelp();
};
$('helpBack').onclick = backFromOverlay;

function openSettings() {
  const box = document.createElement('div');
  const range = (label, key) => {
    const row = document.createElement('div');
    row.className = 'range-row';
    row.innerHTML = `<span>${label}</span><input type="range" min="0" max="1" step="0.05" value="${settings[key]}">`;
    row.querySelector('input').oninput = (e) => {
      settings[key] = Number(e.target.value);
      applyVolumes();
      saveSettings();
    };
    return row;
  };
  const toggle = (label, key, after) => {
    const row = document.createElement('div');
    row.className = 'range-row';
    row.innerHTML = `<span>${label}</span><span style="flex:1"></span><button class="toggle ${settings[key] ? 'on' : ''}"><i></i></button>`;
    const b = row.querySelector('button');
    b.onclick = () => {
      settings[key] = !settings[key];
      b.classList.toggle('on', settings[key]);
      saveSettings();
      if (after) after();
    };
    return row;
  };
  const lg = document.createElement('div');
  lg.className = 'range-row';
  lg.innerHTML = `<span>🌐 ${lang === 'en' ? 'Language' : '语言'}</span><span style="flex:1"></span><div class="seg"><button data-l="zh" class="${lang === 'zh' ? 'on' : ''}">中文</button><button data-l="en" class="${lang === 'en' ? 'on' : ''}">English</button></div>`;
  lg.querySelector('.seg').onclick = (e) => {
    const b = e.target.closest('[data-l]');
    if (!b || b.dataset.l === lang) return;
    setLang(b.dataset.l);
    closeModal(true);
    openSettings();
  };
  box.appendChild(lg);
  box.appendChild(range(tr('🎵 音乐'), 'music'));
  box.appendChild(range(tr('🔊 音效'), 'sfx'));
  const q = document.createElement('div');
  q.className = 'range-row';
  q.innerHTML = `<span>${tr('🖥️ 画质')}</span><span style="flex:1"></span><div class="seg">${[
    ['high', tr('高')],
    ['medium', tr('中')],
    ['low', tr('低')],
  ]
    .map(([v, n]) => `<button data-q="${v}" class="${settings.quality === v ? 'on' : ''}">${n}</button>`)
    .join('')}</div>`;
  q.querySelector('.seg').onclick = (e) => {
    const b = e.target.closest('[data-q]');
    if (!b) return;
    settings.quality = b.dataset.q;
    settings.autoQuality = false; // 手动选过就不再自动调整
    q.querySelectorAll('[data-q]').forEach((x) => x.classList.toggle('on', x === b));
    saveSettings();
    applyQuality();
    document.body.dataset.quality = settings.quality;
  };
  box.appendChild(q);
  box.appendChild(toggle(tr('📳 屏幕震动'), 'shake'));
  box.appendChild(toggle(tr('🏷️ 显示名字'), 'names'));
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = tr('画面卡顿时把画质调到「中」或「低」。');
  box.appendChild(hint);
  const ver = document.createElement('div');
  ver.className = 'range-row';
  ver.innerHTML = `<span>${tr('ℹ️ 版本')}</span><span style="flex:1">v${esc((info && info.version) || '')}</span><button class="btn btn-mini btn-green">${tr('🔄 检查更新')}</button>`;
  ver.querySelector('button').onclick = () => {
    closeModal(true);
    openUpdate(true);
  };
  box.appendChild(ver);
  const wn = document.createElement('div');
  wn.className = 'range-row';
  wn.innerHTML = `<span>${tr("📰 更新内容")}</span><span style="flex:1"></span><button class="btn btn-mini btn-purple">${tr('看看更新了什么')}${whatsNewUnseen() ? ' <b class="new-tag">NEW</b>' : ''}</button>`;
  wn.querySelector('button').onclick = () => {
    closeModal(true);
    openWhatsNew();
  };
  box.appendChild(wn);
  const actions = [{ label: tr('完成'), cls: 'btn-yellow' }];
  if (document.fullscreenEnabled) {
    actions.unshift({
      label: document.fullscreenElement ? tr('退出全屏') : tr('⛶ 全屏'),
      cls: 'btn-blue',
      onClick: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {})),
    });
  }
  modal({ title: tr('⚙️ 设置'), body: box, actions });
}

// ---------------------------------------------------------------------
// 更新内容（What's New）
// ---------------------------------------------------------------------
const SEEN_KEY = 'bb_seen_version';
const latestLog = CHANGELOG[0].v;
function seenVersion() {
  try {
    return localStorage.getItem(SEEN_KEY) || '';
  } catch {
    return latestLog;
  }
}
const whatsNewUnseen = () => seenVersion() !== latestLog;
function markWhatsNewSeen() {
  try {
    localStorage.setItem(SEEN_KEY, latestLog);
  } catch {
    /* 无痕模式 */
  }
  $('btnSettings').classList.remove('has-new');
}
function openWhatsNew() {
  const box = document.createElement('div');
  box.className = 'whats-new';
  box.innerHTML = CHANGELOG.map((e, i) => {
    const items = (lang === 'en' ? e.en : e.zh).map((x) => `<li>${esc(x)}</li>`).join('');
    const head = `<span class="wn-ver">v${esc(e.v)}</span>${i === 0 ? `<span class="wn-latest">${tr('最新')}</span>` : ''}<span class="wn-date">${esc(e.date)}</span>`;
    return i === 0 ? `<section class="wn-entry latest"><h4>${head}</h4><ul>${items}</ul></section>` : `<details class="wn-entry"><summary>${head}</summary><ul>${items}</ul></details>`;
  }).join('');
  markWhatsNewSeen();
  modal({ title: tr("📰 更新内容"), body: box, actions: [{ label: tr('好的'), cls: 'btn-yellow' }] });
}
// 第一次打开游戏不打扰；更新到新版本后自动弹一次，设置按钮上也有小红点
function checkWhatsNew() {
  const seen = seenVersion();
  if (!seen) return markWhatsNewSeen();
  if (seen === latestLog) return;
  $('btnSettings').classList.add('has-new');
  if (current === 'menu' && !modalOpen()) setTimeout(() => current === 'menu' && !modalOpen() && openWhatsNew(), 1200);
}

function openPause() {
  if (!state) return;
  if (document.pointerLockElement) document.exitPointerLock();
  const actions = [
    { label: tr('▶ 继续游戏'), cls: 'btn-yellow' },
    { label: settings.view === '1p' ? tr('🎥 切换到第三人称') : tr('👁️ 切换到第一人称'), cls: 'btn-green', onClick: toggleView },
    { label: tr('⚙️ 设置'), cls: 'btn-blue', onClick: openSettings },
    { label: tr('❓ 玩法说明'), cls: 'btn-purple', onClick: () => (closeModal(true), openHelp()) },
  ];
  if (isHost && inRound(state.phase)) {
    actions.push({
      label: tr('🏁 结束比赛，回到房间'),
      cls: 'btn-ghost',
      onClick: () =>
        modal({ title: tr('结束比赛？'), body: tr('所有人会回到房间，这场比赛不计成绩。'), actions: [{ label: tr('结束比赛'), cls: 'btn-red', onClick: () => send({ t: 'abort' }) }, { label: tr('取消') }] }),
    });
  }
  actions.push({ label: tr('🚪 离开房间'), cls: 'btn-red', onClick: confirmLeave });
  modal({ title: tr('暂停菜单'), body: tr('<p class="hint">房间 <b>{0}</b> · 延迟 {1}ms<br>（联机游戏不会真的暂停哦）</p>', esc(roomCode), ping), actions });
}
$('btnPause').onclick = openPause;

// ---------------------------------------------------------------------
// 自动更新：GitHub 上有新版本时，在开服的电脑上点一下就能更新并自动重启
// ---------------------------------------------------------------------
let serverRestarting = false;
let updInfo = null;
async function checkUpdate(force = false) {
  try {
    updInfo = await fetch('/api/update' + (force ? '?force=1' : '')).then((r) => r.json());
  } catch {
    updInfo = null;
  }
  const show = !!(updInfo && updInfo.ok && updInfo.hasUpdate);
  $('btnUpdate').classList.toggle('hidden', !show);
  if (show) $('updVer').textContent = 'v' + updInfo.latest;
  return updInfo;
}
async function openUpdate(force = false) {
  modal({ title: tr('🔄 检查更新'), body: tr('<div class="spinner"></div><p class="hint">正在连接 GitHub…</p>'), actions: [{ label: tr('取消') }] });
  const u = await checkUpdate(force);
  if (!u || !u.ok) {
    modal({ title: tr('检查更新失败'), body: tr('<p>{0}</p><p class="hint">需要能访问 GitHub（github.com）。如果你平时要开代理，请在运行游戏前设置 HTTPS_PROXY 环境变量。</p>', esc(u && u.error ? tr(u.error) : tr('连不上服务器'))) });
    return;
  }
  if (!u.hasUpdate) {
    modal({ title: tr('已经是最新版本 ✔'), body: tr('<div class="upd-versions">v{0}</div><p class="hint">来源：github.com/{1}（{2} 分支）</p>', esc(u.current), esc(u.repo), esc(u.branch)) });
    return;
  }
  const warn = u.busyGames ? tr('<p style="color:#ffb347">⚠️ 现在有 {0} 个房间正在比赛，更新时所有人会断开几秒钟。</p>', u.busyGames) : '';
  const where = u.canUpdate ? '' : tr('<p style="color:#ffb347">只能在开服的那台电脑上更新：在那台电脑的浏览器里打开 <b>http://localhost:') + esc(location.port || '3000') + tr('</b> 再点更新。</p>');
  const restart = u.canUpdate && !u.canRestart ? tr('<p class="hint">你是用 node server.js 启动的，更新完需要手动重新运行 npm start。</p>') : '';
  modal({
    title: tr('🆕 发现新版本'),
    body: `<div class="upd-versions"><span>v${esc(u.current)}</span>→<span class="new">v${esc(u.latest)}</span></div>${u.notes ? `<div class="upd-note">${esc(u.notes)}</div>` : ''}${warn}${where}${restart}<p class="hint">${tr('排行榜等数据会保留。')}</p>`,
    actions: u.canUpdate ? [{ label: tr('⬇️ 立即更新'), cls: 'btn-green', onClick: doUpdate }, { label: tr('以后再说') }] : [{ label: tr('知道了') }],
  });
}
async function doUpdate() {
  modal({ title: tr('正在更新…'), body: tr('<div class="spinner"></div><p>正在下载并安装新版本，请不要关闭开服的窗口</p>'), actions: [], dismissable: false });
  let r;
  try {
    r = await fetch('/api/update', { method: 'POST', headers: { 'x-bb-update': '1' } }).then((x) => x.json());
  } catch (e) {
    r = { ok: false, error: e.message };
  }
  if (!r.ok) {
    modal({ title: tr('更新失败'), body: `<p>${esc(r.error ? tr(r.error) : tr('未知错误'))}</p>` });
    return;
  }
  if (r.restarting) waitForRestart(r.to);
  else modal({ title: tr('更新完成 ✔'), body: tr('<p>已更新到 v{0}。</p><p>请关闭开服的窗口，重新运行 <b>npm start</b>。</p>', esc(r.to)) });
}
// 服务器重启期间：等它回来，版本号变了就刷新页面
function waitForRestart(to) {
  serverRestarting = true;
  modal({ title: tr('服务器正在更新'), body: tr('<div class="spinner"></div><p>正在更新到 v{0}，完成后会自动刷新页面…</p>', esc(to)), actions: [], dismissable: false });
  const t0 = Date.now();
  const poll = async () => {
    try {
      const inf = await fetch('/api/info', { cache: 'no-store' }).then((x) => x.json());
      if (inf.version === to) {
        location.reload();
        return;
      }
    } catch {
      /* 还在重启 */
    }
    if (Date.now() - t0 > 90000) {
      serverRestarting = false;
      modal({ title: tr('更新好像卡住了'), body: tr('<p>请看一下开服电脑上的窗口有没有报错，然后手动重新运行 npm start。</p>') });
      return;
    }
    setTimeout(poll, 1200);
  };
  setTimeout(poll, 1500);
}

// ---------------------------------------------------------------------
// 键盘快捷键
// ---------------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  const typing = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
  if (e.key === 'Escape') {
    if (modalOpen()) {
      if ($('modal').dataset.dismissable) closeModal();
      return;
    }
    if (!$('emotePicker').classList.contains('hidden')) return hideEmotes();
    if (current === 'game') return openPause();
    if (current === 'wardrobe') return closeWardrobe(false);
    if (current === 'board' || current === 'help') return backFromOverlay();
    if (current === 'rooms') return show('menu');
    return;
  }
  if (typing || modalOpen()) return;
  if (/^Digit[1-8]$/.test(e.code) && inRoom && (current === 'game' || current === 'lobby' || current === 'results')) {
    send({ t: 'emote', i: Number(e.code.slice(5)) - 1 });
    hideEmotes();
  }
  if (e.code === 'KeyV' && inRoom && current === 'game') toggleView();
  if (e.code === 'KeyF' && inRoom && current === 'game') useItem();
  if (e.code === 'KeyT' && inRoom && (current === 'game' || current === 'lobby' || current === 'results')) {
    sendSticker(lastSticker);
    hideEmotes();
  }
  if (e.key === 'Enter' && current === 'lobby') {
    $('chatInput').focus();
    e.preventDefault();
  }
});

// ---------------------------------------------------------------------
// 输入发送（30Hz）
// ---------------------------------------------------------------------
input.setActive(() => inRoom && current === 'game' && !modalOpen() && !!state && inRound(state.phase));
let lastInput = '';
let sinceInput = 0;
setInterval(() => {
  if (!inRoom || !state) return;
  const active = current === 'game' && inRound(state.phase) && !modalOpen();
  const fp = world.isFirstPerson();
  let inp = active ? input.read(fp) : { x: 0, y: 0 };
  if (fp) {
    // 第一人称：W 是"朝我看的方向走"，换算成世界方向再发给服务器
    const yaw = world.getFpYaw();
    const fx = Math.sin(yaw);
    const fy = -Math.cos(yaw);
    inp = { x: Math.cos(yaw) * inp.x - fx * inp.y, y: Math.sin(yaw) * inp.x - fy * inp.y };
  }
  const dash = input.takeDash() && active;
  const msg = { t: 'input', x: Math.round(inp.x * 100) / 100, y: Math.round(inp.y * 100) / 100 };
  if (dash) msg.dash = true;
  const key = `${msg.x},${msg.y}`;
  sinceInput++;
  if (key !== lastInput || dash || sinceInput > 30) {
    send(msg);
    lastInput = key;
    sinceInput = 0;
  }
}, 1000 / 30);

// ---------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------
document.addEventListener(
  'click',
  (e) => {
    const b = e.target.closest('button');
    if (b && !b.disabled && b.id !== 'dashBtn') sfx.click();
  },
  true
);
const unlockOnce = () => unlock();
window.addEventListener('pointerdown', unlockOnce);
window.addEventListener('keydown', unlockOnce);

setTimeout(checkWhatsNew, 1500);
document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
// 手机上没有"回车"，聊天框提示改短一点（要在 applyStatic 记录原文之前改）
if (isTouch) $('chatInput').setAttribute('placeholder', '说点什么…');
applyStatic();
updateLangButton();
applyQuality();
document.body.dataset.quality = settings.quality;
world.setCameraMode(settings.view);
input.setFirstPerson(() => world.isFirstPerson());
world.setMenuProfile(profile);
refreshProfileChip();
show('menu');
playMusic('menu');
startMenuCycle();
refreshRoomCount();
showLanHint();
setTimeout(() => checkUpdate(), 1500);

// 邀请链接 / 刷新页面：自动进入房间
{
  const params = new URLSearchParams(location.search);
  const code = (params.get('room') || lastRoom.get() || '').toUpperCase().trim();
  if (/^[A-Z]{4}$/.test(code)) {
    let hasName = false;
    try {
      hasName = !!localStorage.getItem('bb_name');
    } catch {
      hasName = false;
    }
    if (hasName || lastRoom.get() === code) joinRoom({ room: code });
    else {
      // 第一次打开邀请链接：先起个名字
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.maxLength = 12;
      inp.value = playerName;
      const go = () => {
        setPlayerName(inp.value);
        refreshProfileChip();
        joinRoom({ room: code });
      };
      inp.onkeydown = (e) => e.key === 'Enter' && (closeModal(true), go());
      const box = document.createElement('div');
      box.innerHTML = tr('<p>朋友邀请你加入房间 <b style="color:#ffd23f">{0}</b></p><p class="hint">先给自己起个名字吧（之后可以在「换装」里修改）</p>', code);
      box.appendChild(inp);
      modal({
        title: tr('👋 欢迎来到碰碰球大乱斗'),
        body: box,
        dismissable: false,
        actions: [
          { label: tr('进入房间'), cls: 'btn-yellow', onClick: go },
          { label: tr('先逛逛'), cls: 'btn-ghost', onClick: () => history.replaceState(null, '', location.pathname) },
        ],
      });
    }
  }
}

// 自动画质：比赛中持续卡顿就降一档（每次打开页面最多降两次）
const perf = { t: 0, frames: 0, drops: 0 };
function watchPerf(rdt) {
  if (!settings.autoQuality || perf.drops >= 2 || current !== 'game' || document.hidden) {
    perf.t = perf.frames = 0;
    return;
  }
  perf.t += rdt;
  perf.frames++;
  if (perf.t < 4) return;
  const fps = perf.frames / perf.t;
  perf.t = perf.frames = 0;
  const next = settings.quality === 'high' && fps < 38 ? 'medium' : settings.quality === 'medium' && fps < 26 ? 'low' : null;
  if (!next) return;
  perf.drops++;
  settings.quality = next;
  saveSettings();
  applyQuality();
  document.body.dataset.quality = next;
  notice(tr('画面有点卡，已自动切换到「{0}」画质（可在设置里改回）', next === 'medium' ? tr('中') : tr('低')));
}

let last = performance.now();
let booted = false;
function loop(now) {
  const rdt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (world.isFirstPerson() && !modalOpen()) {
    const tr = input.takeTurn();
    world.turnFirstPerson(tr.keys * 2.6 * rdt + tr.px * 0.0045);
  } else input.takeTurn();
  $('crosshair').classList.toggle('hidden', !world.isFirstPerson());
  if (!world.isFirstPerson() && document.pointerLockElement) document.exitPointerLock();
  world.frame(rdt, now / 1000);
  watchPerf(rdt);
  if (!booted) {
    booted = true;
    $('loading').classList.add('hidden');
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// 调试 / 自动化测试用
window.__game = { get state() { return state; }, get myId() { return myId; }, send, get screen() { return current; }, views: world.debugViews, bloom, scene: renderScene, camera: renderCamera };
