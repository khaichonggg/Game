// 碰碰球大乱斗 —— 客户端
(() => {
  const ARENA_START = 320;
  const PLAYER_R = 20;
  const DASH_COOLDOWN = 1.2;

  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');

  let ws = null;
  let myId = null;
  let state = null;
  const view = new Map(); // id -> 渲染用的平滑位置和动画状态
  const particles = [];
  let shake = 0;
  let lastPhase = null;
  let isTouch = 'ontouchstart' in window;

  // ---------- 音效（WebAudio 小合成，无需素材） ----------
  let audio = null;
  function beep(freq, dur, type = 'square', vol = 0.08, slide = 0) {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, audio.currentTime);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), audio.currentTime + dur);
      g.gain.setValueAtTime(vol, audio.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
      o.connect(g).connect(audio.destination);
      o.start();
      o.stop(audio.currentTime + dur);
    } catch {
      /* 忽略 */
    }
  }

  // ---------- 界面 ----------
  const screens = ['menu', 'lobby', 'gameOver'];
  function show(name) {
    for (const s of screens) $(s).classList.toggle('hidden', s !== name);
    const inGame = name === null;
    $('hud').classList.toggle('hidden', !inGame);
    $('touchUI').classList.toggle('hidden', !(inGame && isTouch));
  }

  const params = new URLSearchParams(location.search);
  $('nameInput').value = localStorage.getItem('bb_name') || '';
  if (params.get('room')) $('codeInput').value = params.get('room').toUpperCase();

  function connect(code) {
    const name = $('nameInput').value.trim();
    try {
      localStorage.setItem('bb_name', name);
    } catch {
      /* 忽略 */
    }
    $('menuError').textContent = '连接中…';
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'join', room: code, name }));
    ws.onmessage = (e) => onMessage(JSON.parse(e.data));
    ws.onclose = () => {
      if (myId !== null) {
        myId = null;
        state = null;
        show('menu');
        $('menuError').textContent = '与服务器断开连接';
      }
    };
    ws.onerror = () => {
      $('menuError').textContent = '无法连接服务器';
    };
  }

  function sendMsg(msg) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  $('createBtn').onclick = () => connect('');
  $('joinBtn').onclick = () => {
    const code = $('codeInput').value.trim().toUpperCase();
    if (code.length !== 4) {
      $('menuError').textContent = '请输入 4 位房间码';
      return;
    }
    connect(code);
  };
  $('codeInput').addEventListener('keydown', (e) => e.key === 'Enter' && $('joinBtn').click());
  $('startBtn').onclick = () => sendMsg({ t: 'start' });
  $('againBtn').onclick = () => sendMsg({ t: 'start' });
  $('lobbyBtn').onclick = () => sendMsg({ t: 'toLobby' });
  $('addBotBtn').onclick = () => sendMsg({ t: 'addBot' });
  $('removeBotBtn').onclick = () => sendMsg({ t: 'removeBot' });
  $('copyBtn').onclick = async () => {
    const link = `${location.origin}${location.pathname}?room=${state.code}`;
    try {
      await navigator.clipboard.writeText(link);
      $('copyBtn').textContent = '已复制！发给朋友吧';
    } catch {
      prompt('复制这个链接发给朋友：', link);
    }
    setTimeout(() => ($('copyBtn').textContent = '复制邀请链接'), 2000);
  };

  function onMessage(msg) {
    if (msg.t === 'error') {
      $('menuError').textContent = msg.msg;
      myId = null;
      ws.close();
      return;
    }
    if (msg.t === 'joined') {
      myId = msg.id;
      $('menuError').textContent = '';
      history.replaceState(null, '', `?room=${msg.code}`);
      return;
    }
    if (msg.t === 'state') {
      state = msg;
      handleEvents(msg.events);
      updateUI();
    }
  }

  function handleEvents(events) {
    for (const ev of events) {
      if (ev.type === 'hit') {
        const n = Math.min(24, Math.floor(ev.power / 30));
        spawnParticles(ev.x, ev.y, '#ffffff', n);
        shake = Math.min(14, shake + ev.power / 80);
        beep(180 + Math.random() * 80, 0.12, 'square', 0.06, -100);
      } else if (ev.type === 'dash') {
        const v = view.get(ev.id);
        if (v) spawnParticles(v.x, v.y, v.color, 8);
        if (ev.id === myId) beep(500, 0.1, 'sawtooth', 0.04, 400);
      } else if (ev.type === 'fall') {
        beep(400, 0.5, 'triangle', 0.1, -350);
        if (ev.id === myId) shake = 16;
      }
    }
  }

  function playerLi(p, right) {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = p.color;
    const name = document.createElement('span');
    name.textContent = p.name + (p.id === myId ? '（你）' : '');
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = right;
    li.append(dot, name, tag);
    return li;
  }

  function updateUI() {
    const s = state;
    const isHost = s.hostId === myId;
    const me = s.players.find((p) => p.id === myId);

    if (s.phase !== lastPhase) {
      if (s.phase === 'countdown') beep(440, 0.15, 'square', 0.06);
      if (s.phase === 'playing') beep(880, 0.25, 'square', 0.07);
      if (s.phase === 'roundEnd') beep(660, 0.3, 'triangle', 0.08, 300);
      lastPhase = s.phase;
    }

    if (s.phase === 'lobby') {
      show('lobby');
      $('roomCode').textContent = s.code;
      $('winScoreLabel').textContent = s.winScore;
      const list = $('playerList');
      list.innerHTML = '';
      for (const p of s.players) list.append(playerLi(p, p.id === s.hostId ? '房主' : p.bot ? '机器人' : ''));
      $('hostControls').classList.toggle('hidden', !isHost);
      $('waitHost').classList.toggle('hidden', isHost);
    } else if (s.phase === 'gameOver') {
      show('gameOver');
      const champ = s.players.find((p) => p.id === s.winner);
      $('champName').textContent = champ ? `${champ.name} 获得冠军！` : '游戏结束';
      const list = $('finalList');
      list.innerHTML = '';
      [...s.players]
        .sort((a, b) => b.score - a.score || b.kills - a.kills)
        .forEach((p) => list.append(playerLi(p, `${p.score} 胜 · 撞飞 ${p.kills}`)));
      $('overHost').classList.toggle('hidden', !isHost);
      $('overWait').classList.toggle('hidden', isHost);
    } else {
      show(null);
    }

    // 计分板
    const sb = $('scoreboard');
    sb.innerHTML = `<div style="color:#b7b0e0;margin-bottom:4px">第 ${s.round} 局 · 先到 ${s.winScore} 分</div>`;
    for (const p of [...s.players].sort((a, b) => b.score - a.score)) {
      const row = document.createElement('div');
      row.className = 'row' + (p.alive ? '' : ' out');
      row.innerHTML = `<span class="dot" style="background:${p.color}"></span><span></span><span class="pts">${p.score}</span>`;
      row.children[1].textContent = p.name + (p.id === myId ? '（你）' : '');
      sb.append(row);
    }

    // 中央横幅
    let banner = '';
    if (s.phase === 'countdown') banner = Math.ceil(s.timer) || '开始！';
    else if (s.phase === 'playing' && me && !me.alive && s.round > 0) banner = '<span style="font-size:24px">你出局了，观战中…</span>';
    else if (s.phase === 'roundEnd') {
      const w = s.players.find((p) => p.id === s.winner);
      banner = w ? '' : '平局！';
      if (w) {
        const span = document.createElement('span');
        span.textContent = `${w.name} 赢了这局！`;
        banner = span.outerHTML;
      }
    }
    $('banner').innerHTML = banner;

    if (me) $('dashBtn').classList.toggle('cooling', me.dashCd > 0);
  }

  // ---------- 输入 ----------
  const keys = new Set();
  let dashQueued = false;
  const touchDir = { x: 0, y: 0 };

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') {
      if (e.key === 'Enter' && e.target.id === 'nameInput') $('createBtn').click();
      return;
    }
    keys.add(e.code);
    if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'KeyJ') {
      dashQueued = true;
      e.preventDefault();
    }
    if (e.code.startsWith('Arrow')) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  // 摇杆：左半屏任意位置按下即生成
  const stick = $('stick');
  const knob = $('knob');
  let stickTouch = null;
  let stickOrigin = null;
  window.addEventListener(
    'touchstart',
    (e) => {
      isTouch = true;
      if (!state || state.phase === 'lobby' || state.phase === 'gameOver') return;
      for (const t of e.changedTouches) {
        if (t.clientX < window.innerWidth / 2 && stickTouch === null) {
          stickTouch = t.identifier;
          stickOrigin = { x: t.clientX, y: t.clientY };
          stick.style.left = t.clientX - 65 + 'px';
          stick.style.top = t.clientY - 65 + 'px';
          stick.style.bottom = 'auto';
        }
      }
    },
    { passive: true }
  );
  window.addEventListener(
    'touchmove',
    (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== stickTouch) continue;
        let dx = t.clientX - stickOrigin.x;
        let dy = t.clientY - stickOrigin.y;
        const d = Math.hypot(dx, dy);
        const max = 50;
        if (d > max) {
          dx = (dx / d) * max;
          dy = (dy / d) * max;
        }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        touchDir.x = dx / max;
        touchDir.y = dy / max;
      }
    },
    { passive: true }
  );
  const endTouch = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickTouch) {
        stickTouch = null;
        touchDir.x = touchDir.y = 0;
        knob.style.transform = '';
      }
    }
  };
  window.addEventListener('touchend', endTouch);
  window.addEventListener('touchcancel', endTouch);
  $('dashBtn').addEventListener('touchstart', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dashQueued = true;
  });
  $('dashBtn').addEventListener('mousedown', () => (dashQueued = true));

  function readInput() {
    let x = 0;
    let y = 0;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
    if (keys.has('KeyW') || keys.has('ArrowUp')) y -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) y += 1;
    x += touchDir.x;
    y += touchDir.y;
    return { x, y };
  }

  let lastSent = '';
  setInterval(() => {
    if (!state || myId === null) return;
    const inp = readInput();
    const msg = { t: 'input', x: +inp.x.toFixed(2), y: +inp.y.toFixed(2), dash: dashQueued };
    const key = JSON.stringify(msg);
    if (key !== lastSent || dashQueued) {
      sendMsg(msg);
      lastSent = key;
    }
    dashQueued = false;
  }, 1000 / 30);

  // ---------- 渲染 ----------
  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
  }
  window.addEventListener('resize', resize);
  resize();

  function spawnParticles(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 220;
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.5 + Math.random() * 0.3, color });
    }
  }

  function drawBall(p, v, scale) {
    const r = PLAYER_R * scale;
    ctx.save();
    ctx.translate(v.x, v.y);
    // 影子
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(3, 6, r, r * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
    // 球体
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.stroke();
    // 高光
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.arc(-r * 0.35, -r * 0.35, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
    // 眼睛看向移动方向
    const sp = Math.hypot(v.vx, v.vy);
    const lx = sp > 5 ? (v.vx / sp) * r * 0.25 : 0;
    const ly = sp > 5 ? (v.vy / sp) * r * 0.25 : 0;
    for (const side of [-1, 1]) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(side * r * 0.32 + lx * 0.5, -r * 0.05 + ly * 0.5, r * 0.24, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.arc(side * r * 0.32 + lx, -r * 0.05 + ly, r * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  let lastFrame = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    const W = canvas.width;
    const H = canvas.height;

    // 背景：场地外是岩浆
    const t = now / 1000;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
    bg.addColorStop(0, '#ff6a3d');
    bg.addColorStop(1, '#6b1530');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const scale = Math.min(W, H) / (ARENA_START * 2 + 80);
    shake *= Math.pow(0.02, dt);
    const sx = (Math.random() - 0.5) * shake * scale;
    const sy = (Math.random() - 0.5) * shake * scale;
    ctx.setTransform(scale, 0, 0, scale, W / 2 + sx, H / 2 + sy);

    // 岩浆泡泡
    ctx.fillStyle = 'rgba(255,210,63,0.25)';
    for (let i = 0; i < 18; i++) {
      const a = i * 2.4 + t * 0.2;
      const rr = ARENA_START + 40 + ((i * 37) % 200);
      const bub = 6 + 4 * Math.sin(t * 2 + i);
      ctx.beginPath();
      ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, bub, 0, Math.PI * 2);
      ctx.fill();
    }

    const arenaR = state && state.phase !== 'lobby' ? state.arenaR : ARENA_START;
    // 原始边界（虚线提示缩圈）
    ctx.setLineDash([12, 12]);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, ARENA_START, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    // 场地
    ctx.fillStyle = '#2b2552';
    ctx.beginPath();
    ctx.arc(0, 0, arenaR + 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3b3370';
    ctx.beginPath();
    ctx.arc(0, 0, arenaR, 0, Math.PI * 2);
    ctx.fill();
    // 地面花纹
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 2;
    for (let r = 60; r < arenaR; r += 60) {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    // 边缘危险光圈
    ctx.strokeStyle = `rgba(255,90,95,${0.5 + 0.3 * Math.sin(t * 6)})`;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, 0, arenaR - 2, 0, Math.PI * 2);
    ctx.stroke();

    if (state) {
      const ids = new Set();
      const inRound = state.phase !== 'lobby' && state.phase !== 'gameOver';
      for (const p of state.players) {
        ids.add(p.id);
        let v = view.get(p.id);
        if (!v) {
          v = { x: p.x, y: p.y, vx: 0, vy: 0, fall: 0, color: p.color };
          view.set(p.id, v);
        }
        v.color = p.color;
        // 平滑插值到服务器位置
        const k = 1 - Math.exp(-dt * 18);
        const nx = v.x + (p.x - v.x) * k;
        const ny = v.y + (p.y - v.y) * k;
        if (dt > 0) {
          v.vx = v.vx * 0.8 + ((nx - v.x) / dt) * 0.2;
          v.vy = v.vy * 0.8 + ((ny - v.y) / dt) * 0.2;
        }
        v.x = nx;
        v.y = ny;
        if (Math.hypot(p.x - v.x, p.y - v.y) > 150) {
          v.x = p.x;
          v.y = p.y;
        }
        v.fall = p.falling ? Math.min(1, v.fall + dt / 0.6) : p.alive ? 0 : 1;
      }
      for (const id of view.keys()) if (!ids.has(id)) view.delete(id);

      if (inRound) {
        // 先画掉落中的（在下层），再画存活的
        const sorted = [...state.players].sort((a, b) => (b.falling ? 1 : 0) - (a.falling ? 1 : 0));
        for (const p of sorted) {
          const v = view.get(p.id);
          if (!p.alive && !p.falling) continue;
          const sc = 1 - v.fall * 0.8;
          ctx.globalAlpha = 1 - v.fall * 0.7;
          drawBall(p, v, sc);
          ctx.globalAlpha = 1;
        }
        // 名字 & 自己的标记
        ctx.textAlign = 'center';
        ctx.font = 'bold 14px sans-serif';
        for (const p of state.players) {
          if (!p.alive || p.falling) continue;
          const v = view.get(p.id);
          if (p.id === myId) {
            // 冲刺冷却环
            const pct = 1 - p.dashCd / DASH_COOLDOWN;
            ctx.strokeStyle = pct >= 1 ? '#ffd23f' : 'rgba(255,255,255,0.5)';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(v.x, v.y, PLAYER_R + 7, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
            ctx.stroke();
            // 头顶三角
            ctx.fillStyle = '#ffd23f';
            ctx.beginPath();
            const ty = v.y - PLAYER_R - 34 + Math.sin(t * 5) * 3;
            ctx.moveTo(v.x - 7, ty);
            ctx.lineTo(v.x + 7, ty);
            ctx.lineTo(v.x, ty + 9);
            ctx.fill();
          }
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          ctx.fillText(p.name, v.x + 1, v.y - PLAYER_R - 11);
          ctx.fillStyle = '#fff';
          ctx.fillText(p.name, v.x, v.y - PLAYER_R - 12);
        }
      } else if (state.phase === 'lobby') {
        // 大厅里让大家的球在场地上转圈，热闹一点
        state.players.forEach((p, i) => {
          const a = t * 0.6 + (i / state.players.length) * Math.PI * 2;
          const v = view.get(p.id);
          v.x = Math.cos(a) * 180;
          v.y = Math.sin(a) * 180;
          v.vx = -Math.sin(a) * 100;
          v.vy = Math.cos(a) * 100;
          drawBall(p, v, 1);
        });
      }
    }

    // 粒子
    for (let i = particles.length - 1; i >= 0; i--) {
      const pt = particles[i];
      pt.life -= dt;
      if (pt.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= 0.9;
      pt.vy *= 0.9;
      ctx.globalAlpha = Math.min(1, pt.life * 2);
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  show('menu');
})();
