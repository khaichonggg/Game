// 房间：大厅管理（房主、准备、队伍、聊天、设置、踢人、掉线重连）+ 比赛流程 + 物理模拟。
// 服务端权威：客户端只发输入，这里模拟后广播状态。物理在水平面 (x, y) 上进行。
const K = require('./constants');
const { MAPS } = require('./maps');
const { MODES } = require('./modes');
const bots = require('./bots');
const catalog = require('./catalog');
const leaderboard = require('./leaderboard');
const { rand, lerp, clamp, r1, emptyFx, emptyStats, radiusOf, massOf, controllable, ghosted } = require('./util');

let nextPlayerId = 1;

class Room {
  constructor(code, opts = {}) {
    this.code = code;
    this.settings = {
      name: String(opts.name || '').slice(0, 16),
      public: opts.public !== false,
      max: K.MAX_PLAYERS,
      map: 'lava',
      mode: 'classic',
      target: 3,
      botLevel: 1,
      items: true,
    };
    this.players = new Map();
    this.hostId = null;
    this.phase = 'lobby'; // lobby | countdown | playing | roundEnd | gameOver
    this.timer = 0;
    this.roundTime = 0;
    this.matchTime = 0;
    this.round = 0;
    this.teamScore = [0, 0];
    this.lastWinner = null;
    this.winnerTeam = -1;
    this.roundText = '';
    this.participants = 0;
    this.events = [];
    this.chatLog = [];
    this.chatSeq = 0;
    this.kicked = new Set();
    this.results = null;
    this.m = {};
    this.bodies = [];
    this.nextObj = 1;
    this.created = Date.now();
    this.closed = false;
    this.resetArena();
  }

  // 当前地图：闯关模式由模式提供关卡地图，其他模式用房间设置里选的地图
  get map() {
    return (this.m && this.m.level) || MAPS[this.settings.map];
  }
  // 地图变了就广播给所有人（换地图、闯关换关卡、回到大厅）
  syncMap() {
    const def = this.map.clientDef;
    if (def === this.sentDef) return;
    this.sentDef = def;
    this.broadcast(def);
  }
  get mode() {
    return MODES[this.settings.mode];
  }
  get inGame() {
    return this.phase === 'countdown' || this.phase === 'playing' || this.phase === 'roundEnd';
  }
  list() {
    return [...this.players.values()];
  }
  humans() {
    return this.list().filter((p) => !p.bot);
  }
  event(e) {
    this.events.push(e);
  }

  // ------------------------------------------------------------------
  // 发送
  // ------------------------------------------------------------------
  send(p, msg) {
    if (p.ws && p.connected && p.ws.readyState === 1) p.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  broadcast(msg) {
    const data = typeof msg === 'string' ? msg : JSON.stringify(msg);
    for (const p of this.players.values()) this.send(p, data);
  }
  sys(text) {
    this.chat(null, text);
  }
  chat(p, text) {
    const msg = { type: 'chat', n: ++this.chatSeq, id: p ? p.id : 0, name: p ? p.name : '', text, sys: !p };
    this.chatLog.push(msg);
    if (this.chatLog.length > 40) this.chatLog.shift();
    this.event(msg);
  }

  // ------------------------------------------------------------------
  // 玩家进出
  // ------------------------------------------------------------------
  addPlayer({ name, profile, ws = null, bot = false, token = null }) {
    const p = {
      id: nextPlayerId++,
      kind: 'player',
      token,
      name: catalog.sanitizeName(name, bot ? '机器人' : '玩家' + Math.floor(Math.random() * 900 + 100)),
      profile: catalog.sanitizeProfile(profile),
      ws,
      bot,
      connected: true,
      dc: 0,
      afk: false,
      ready: bot,
      team: 0,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      input: { x: 0, y: 0, dash: false },
      dashCd: 0,
      alive: false,
      falling: 0,
      respawn: 0,
      out: false,
      exploded: false,
      score: 0,
      kills: 0,
      fx: emptyFx(),
      lastHitBy: null,
      lastHitTime: -99,
      botThink: 0,
      stats: emptyStats(),
      chatT: 0,
      emoteT: 0,
    };
    // 重名自动加编号
    const names = new Set(this.list().map((q) => q.name));
    if (names.has(p.name)) {
      let k = 2;
      while (names.has(`${p.name}${k}`)) k++;
      p.name = `${p.name}${k}`;
    }
    if (this.mode.teams) p.team = this.smallerTeam();
    this.players.set(p.id, p);
    if (!bot && this.hostId === null) this.hostId = p.id;
    // 比赛进行中加入：可复活的模式稍后直接上场，淘汰制下一局再上
    if (this.inGame && this.mode.respawn) p.respawn = 1.5;
    this.sys(`${p.name} ${bot ? '（机器人）' : ''}加入了房间`);
    return p;
  }

  removePlayer(id, reason = 'leave') {
    const p = this.players.get(id);
    if (!p) return;
    if (this.mode.onLeave) this.mode.onLeave(this, p);
    this.players.delete(id);
    if (reason === 'kick') {
      if (p.token) this.kicked.add(p.token);
      this.send(p, { t: 'kicked', msg: '你被房主移出了房间' });
    }
    const why = { kick: '被移出了房间', timeout: '掉线了', leave: '离开了房间' }[reason] || '离开了房间';
    this.sys(`${p.name} ${why}`);
    if (this.hostId === id) this.pickNewHost();
    if (!this.humans().length) this.closed = true;
  }

  pickNewHost() {
    const cand = this.humans()
      .filter((p) => p.connected)
      .sort((a, b) => a.id - b.id)[0];
    this.hostId = cand ? cand.id : null;
    if (cand) this.sys(`${cand.name} 成为了新房主`);
  }

  disconnect(p) {
    p.connected = false;
    p.ws = null;
    p.dc = 0;
    p.afk = this.inGame;
    // 房主掉线先等几秒（刷新页面很快就回来），超时再交给别人，见 tick()
  }

  reconnect(p, ws) {
    p.ws = ws;
    p.connected = true;
    p.dc = 0;
    p.afk = false;
    p.input = { x: 0, y: 0, dash: false };
    if (this.hostId === null) this.hostId = p.id;
    this.sys(`${p.name} 重新连接`);
  }

  smallerTeam() {
    const n = [0, 0];
    for (const p of this.players.values()) n[p.team]++;
    return n[0] <= n[1] ? 0 : 1;
  }

  balanceTeams() {
    const list = this.list();
    const n = [0, 0];
    for (const p of list) n[p.team]++;
    // 一边为空，或者两边差距超过 1 人时，从多的一边挪人（优先挪机器人）
    while (Math.abs(n[0] - n[1]) > 1 || (list.length > 1 && (n[0] === 0 || n[1] === 0))) {
      const from = n[0] > n[1] ? 0 : 1;
      const mover = list.filter((p) => p.team === from).sort((a, b) => Number(b.bot) - Number(a.bot))[0];
      if (!mover) break;
      mover.team = 1 - from;
      n[from]--;
      n[1 - from]++;
    }
  }

  // ------------------------------------------------------------------
  // 处理客户端消息
  // ------------------------------------------------------------------
  handle(p, msg) {
    const isHost = p.id === this.hostId;
    const inLobby = this.phase === 'lobby' || this.phase === 'gameOver';
    switch (msg.t) {
      case 'input':
        p.input.x = clamp(Number(msg.x) || 0, -1, 1);
        p.input.y = clamp(Number(msg.y) || 0, -1, 1);
        if (msg.dash) p.input.dash = true;
        p.afk = false;
        break;
      case 'profile':
        if (msg.name !== undefined) {
          const n = catalog.sanitizeName(msg.name, p.name);
          if (n !== p.name && !this.list().some((q) => q !== p && q.name === n)) {
            this.sys(`${p.name} 改名为 ${n}`);
            p.name = n;
          }
        }
        if (msg.profile) p.profile = catalog.sanitizeProfile(msg.profile);
        break;
      case 'ready':
        if (inLobby) p.ready = !!msg.v;
        break;
      case 'chat': {
        const text = String(msg.text || '')
          .replace(/[\u0000-\u001f\u007f]/g, '')
          .trim()
          .slice(0, K.CHAT_MAX);
        const now = Date.now();
        if (text && now - p.chatT > 600) {
          p.chatT = now;
          this.chat(p, text);
        }
        break;
      }
      case 'emote': {
        const i = Number(msg.i);
        const now = Date.now();
        if (Number.isInteger(i) && i >= 0 && i < K.EMOTE_COUNT && now - p.emoteT > 900) {
          p.emoteT = now;
          this.event({ type: 'emote', id: p.id, i });
        }
        break;
      }
      case 'team': {
        if (!inLobby || !this.mode.teams) break;
        const target = msg.id && isHost ? this.players.get(msg.id) : p;
        if (target && (msg.team === 0 || msg.team === 1)) target.team = msg.team;
        break;
      }
      case 'shuffle':
        if (isHost && inLobby && this.mode.teams) {
          const list = this.list().sort(() => Math.random() - 0.5);
          list.forEach((q, i) => (q.team = i % 2));
          this.sys('房主重新随机分了队');
        }
        break;
      case 'settings':
        if (isHost && inLobby) this.applySettings(msg);
        break;
      case 'addBot':
        if (isHost && inLobby && this.players.size < this.settings.max) {
          const used = new Set(this.list().map((q) => q.name));
          const name = K.BOT_NAMES.find((n) => !used.has('🤖' + n)) || '机器人';
          const b = this.addPlayer({ name: '🤖' + name, profile: catalog.randomProfile(this.nextObj++), bot: true });
          b.ready = true;
        }
        break;
      case 'removeBot':
        if (isHost && inLobby) {
          const b = this.list()
            .reverse()
            .find((q) => q.bot);
          if (b) this.removePlayer(b.id);
        }
        break;
      case 'kick': {
        const target = this.players.get(msg.id);
        if (isHost && target && target !== p) this.removePlayer(target.id, 'kick');
        break;
      }
      case 'host': {
        const target = this.players.get(msg.id);
        if (isHost && target && !target.bot && target.connected && target !== p) {
          this.hostId = target.id;
          this.sys(`${p.name} 把房主转让给了 ${target.name}`);
        }
        break;
      }
      case 'start':
        if (isHost && inLobby) this.tryStart(p, !!msg.force);
        break;
      case 'toLobby':
        if (isHost && this.phase === 'gameOver') this.toLobby();
        break;
      case 'abort':
        // 房主中途结束比赛，所有人回到房间
        if (isHost && this.inGame) {
          this.toLobby();
          this.sys(`${p.name} 结束了这场比赛`);
        }
        break;
    }
  }

  applySettings(s) {
    const st = this.settings;
    if (typeof s.name === 'string') st.name = s.name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
    if (typeof s.public === 'boolean') st.public = s.public;
    if (Number.isInteger(s.max)) st.max = clamp(s.max, Math.max(2, this.players.size), K.MAX_PLAYERS);
    if (Number.isInteger(s.botLevel)) st.botLevel = clamp(s.botLevel, 0, 2);
    if (typeof s.items === 'boolean') st.items = s.items;
    if (s.map && MAPS[s.map] && s.map !== st.map) {
      st.map = s.map;
      this.resetArena();
      this.syncMap();
    }
    if (s.mode && MODES[s.mode] && s.mode !== st.mode) {
      st.mode = s.mode;
      st.target = this.mode.defaultTarget;
      if (this.mode.teams) this.balanceTeams();
    }
    if (Number.isInteger(s.target) && this.mode.targets.includes(s.target)) st.target = s.target;
  }

  tryStart(host, force) {
    const need = this.mode.minPlayers || 1;
    if (this.players.size < need) {
      this.send(host, { t: 'error', msg: `这个模式至少需要 ${need} 名玩家（可以添加机器人）` });
      return;
    }
    const notReady = this.humans().filter((q) => q.id !== this.hostId && q.connected && !q.ready);
    if (notReady.length && !force) {
      this.send(host, { t: 'confirmStart', names: notReady.map((q) => q.name) });
      return;
    }
    this.startMatch();
  }

  toLobby() {
    this.phase = 'lobby';
    this.bodies = [];
    this.m = {};
    this.resetArena();
    this.syncMap();
    for (const p of this.list()) {
      p.ready = p.bot;
      p.alive = false;
      p.falling = 0;
      p.respawn = 0;
      p.exploded = false;
      p.out = false;
      p.fx = emptyFx();
      p.massMul = 1;
      p.input = { x: 0, y: 0, dash: false };
    }
  }

  // ------------------------------------------------------------------
  // 地砖与场地
  // ------------------------------------------------------------------
  resetArena() {
    const n = this.map.layout.tiles.length;
    this.tileState = new Uint8Array(n); // 0 正常 1 预警 2 已塌
    this.tileTimer = new Float32Array(n);
    this.collapseStep = 0;
    this.crackTimer = this.map.collapse.first;
    this.items = [];
    this.itemTimer = 3;
    this.hazards = [];
    this.traps = [];
    this.meteors = [];
    this.meteorTimer = this.map.meteors ? this.map.meteors.first : Infinity;
  }
  tileAt(x, y) {
    return this.map.layout.locate(x, y);
  }
  supported(x, y) {
    const id = this.tileAt(x, y);
    return id >= 0 && this.tileState[id] !== 2;
  }
  safeAt(x, y) {
    const id = this.tileAt(x, y);
    return id >= 0 && this.tileState[id] === 0;
  }
  warnTile(id, time) {
    if (this.tileState[id] !== 0) return;
    this.tileState[id] = 1;
    this.tileTimer[id] = time;
  }
  breakTile(id) {
    const hz = this.mode.hazards;
    this.tileState[id] = 2;
    // 非淘汰模式里地砖会重新长回来（模式可以指定某些地砖永久塌掉）
    this.tileTimer[id] = hz.collapse || (this.mode.keepBroken && this.mode.keepBroken(this, id)) ? Infinity : 9;
    this.items = this.items.filter((it) => this.tileAt(it.x, it.y) !== id);
    if (this.mode.onTileBreak) this.mode.onTileBreak(this, id);
  }
  nextRingCollapse() {
    const c = this.map.collapse;
    if (c.type !== 'rings' || !this.mode.hazards.collapse) return Infinity;
    if (this.collapseStep >= this.map.layout.layers - c.keep) return Infinity;
    return c.first + this.collapseStep * c.interval - this.roundTime;
  }
  updateArena(dt) {
    const c = this.map.collapse;
    const hz = this.mode.hazards;
    const tiles = this.map.layout.tiles;
    for (let i = 0; i < tiles.length; i++) {
      if (this.tileState[i] === 1) {
        this.tileTimer[i] -= dt;
        if (this.tileTimer[i] <= 0) this.breakTile(i);
      } else if (this.tileState[i] === 2 && this.tileTimer[i] !== Infinity) {
        this.tileTimer[i] -= dt;
        if (this.tileTimer[i] <= 0) this.tileState[i] = 0;
      }
    }
    if (c.type === 'rings') {
      const next = this.nextRingCollapse();
      if (next <= c.warn) {
        for (let i = 0; i < tiles.length; i++) if (tiles[i].layer === this.collapseStep) this.warnTile(i, Math.max(0, next));
        if (next <= 0) {
          this.collapseStep++;
          this.event({ type: 'collapse' });
        }
      }
    } else if (c.type === 'random' && hz.cracks !== 'none') {
      this.crackTimer -= dt;
      if (this.crackTimer <= 0) {
        this.crackTimer = lerp(c.interval[0], c.interval[1], this.roundTime / 45) * (hz.collapse ? 1 : 1.6);
        const ok = [];
        for (let i = 0; i < tiles.length; i++) if (this.tileState[i] === 0) ok.push(i);
        if (ok.length > c.minTiles) {
          const maxL = this.map.layout.layers;
          const w = ok.map((i) => Math.pow(maxL - tiles[i].layer, 2));
          let r = Math.random() * w.reduce((a, b) => a + b, 0);
          let pick = ok[0];
          for (let k = 0; k < ok.length; k++) {
            r -= w[k];
            if (r <= 0) {
              pick = ok[k];
              break;
            }
          }
          this.warnTile(pick, c.warn);
        }
      }
    }
  }

  // 随机挑一块安全地砖（偏向中心）
  safeSpot(avoidPlayers = true) {
    const tiles = this.map.layout.tiles;
    const maxL = this.map.layout.layers;
    const cands = [];
    const bodies = this.activeBodies();
    for (let i = 0; i < tiles.length; i++) {
      if (this.tileState[i] !== 0) continue;
      const t = tiles[i];
      if (avoidPlayers && bodies.some((b) => Math.hypot(b.x - t.cx, b.y - t.cy) < radiusOf(b) + 60)) continue;
      if (this.meteors.some((m) => Math.hypot(m.x - t.cx, m.y - t.cy) < m.r + 30)) continue;
      if ((this.map.bumpers || []).some((b) => Math.hypot(b.x - t.cx, b.y - t.cy) < b.r + 40)) continue;
      cands.push({ t, w: 1 + t.layer / maxL });
    }
    if (!cands.length) return null;
    let r = Math.random() * cands.reduce((s, c) => s + c.w, 0);
    for (const c of cands) {
      r -= c.w;
      if (r <= 0) return c.t;
    }
    return cands[0].t;
  }

  activeBodies() {
    const out = [];
    for (const p of this.players.values()) if (p.alive && !p.falling) out.push(p);
    for (const b of this.bodies) if (b.alive && !b.falling) out.push(b);
    return out;
  }

  // 敌我关系：团队模式按队伍，协作模式里只有 Boss 和小怪是敌人，球是中立的
  isEnemy(a, b) {
    if (a === b || a.kind === 'ball' || b.kind === 'ball') return false;
    const ap = a.kind === 'player';
    const bp = b.kind === 'player';
    if (ap && bp) {
      if (this.mode.coop) return false;
      if (this.mode.teams) return a.team !== b.team;
      return true;
    }
    return ap !== bp;
  }

  hitBy(victim, attacker) {
    if (!attacker || attacker.kind !== 'player') return;
    victim.lastHitBy = attacker.id;
    victim.lastHitTime = this.roundTime;
  }

  // 以 (x, y) 为中心的冲击波；filter 为 true 的物体才受影响
  knock(x, y, radius, power, owner, filter) {
    for (const o of this.activeBodies()) {
      if (o === owner || ghosted(o) || (filter && !filter(o))) continue;
      const dx = o.x - x;
      const dy = o.y - y;
      const d = Math.hypot(dx, dy);
      if (d > radius) continue;
      const k = (power * (1 - d / radius) + 250) / massOf(o);
      const nx = d > 0 ? dx / d : Math.random() - 0.5;
      const ny = d > 0 ? dy / d : Math.random() - 0.5;
      o.vx += nx * k;
      o.vy += ny * k;
      this.hitBy(o, owner);
    }
  }

  // ------------------------------------------------------------------
  // 比赛流程
  // ------------------------------------------------------------------
  startMatch() {
    for (const p of this.list()) {
      p.score = 0;
      p.kills = 0;
      p.stats = emptyStats();
      p.out = false;
    }
    this.round = 0;
    this.matchTime = 0;
    this.teamScore = [0, 0];
    this.winnerTeam = -1;
    this.results = null;
    this.m = {};
    this.bodies = [];
    if (this.mode.setup) this.mode.setup(this);
    this.startRound();
    this.event({ type: 'matchStart' });
  }

  startRound() {
    const list = this.list();
    if (this.mode.beforeRound) this.mode.beforeRound(this);
    this.resetArena();
    this.syncMap();
    this.bodies = [];
    this.phase = 'countdown';
    this.timer = this.round > 0 && this.mode.id === 'football' ? 2 : K.COUNTDOWN;
    this.roundTime = 0;
    this.round++;
    this.lastWinner = null;
    this.winnerTeam = -1;
    this.roundText = '';
    this.participants = list.length;
    const order = this.mode.teams ? [...list].sort((a, b) => a.team - b.team) : list;
    const spawnR = Math.min(230, this.map.layout.radius * 0.5);
    const offset = Math.random() * Math.PI * 2;
    order.forEach((p, i) => {
      let pos;
      if (this.mode.spawn) pos = this.mode.spawn(this, p, i, order);
      else {
        const a = offset + (i / order.length) * Math.PI * 2;
        pos = { x: Math.cos(a) * spawnR, y: Math.sin(a) * spawnR };
      }
      if (!this.safeAt(pos.x, pos.y) || (this.map.bumpers || []).some((b) => Math.hypot(b.x - pos.x, b.y - pos.y) < b.r + 30)) {
        const t = this.safeSpot(false);
        if (t) pos = { x: t.cx, y: t.cy };
      }
      this.placePlayer(p, pos.x, pos.y);
    });
    if (this.mode.startRound) this.mode.startRound(this);
  }

  placePlayer(p, x, y) {
    p.x = x;
    p.y = y;
    p.vx = p.vy = 0;
    p.alive = !p.out;
    p.falling = 0;
    p.respawn = 0;
    p.exploded = false;
    p.dashCd = 0;
    p.fx = emptyFx();
    p.massMul = 1;
    p.hanging = false;
    p.hangT = 0;
    p.lastHitBy = null;
    p.input = { x: 0, y: 0, dash: false };
  }

  endRound({ winnerId = null, winnerTeam = -1, text = '' }) {
    this.phase = 'roundEnd';
    this.timer = this.mode.roundEndDelay || K.ROUND_END_DELAY;
    this.lastWinner = winnerId;
    this.winnerTeam = winnerTeam;
    this.roundText = text;
    this.event({ type: 'roundEnd', id: winnerId, team: winnerTeam });
  }

  endMatch(winners, extra = {}) {
    this.phase = 'gameOver';
    const winSet = new Set(winners);
    const mode = this.mode;
    const list = this.list();
    const rows = list
      .map((p) => ({
        id: p.id,
        name: p.name,
        profile: p.profile,
        bot: p.bot,
        team: p.team,
        score: r1(p.score),
        kills: p.kills,
        falls: p.stats.falls,
        hits: p.stats.hits,
        items: p.stats.items,
        won: winSet.has(p.id),
      }))
      .sort((a, b) => Number(b.won) - Number(a.won) || b.score - a.score || b.kills - a.kills);
    // 颁奖
    const awards = [];
    const best = (key, icon, title, unit, min = 1, lowest = false) => {
      const vals = list.map((p) => ({ p, v: key(p) }));
      const pick = vals.sort((a, b) => (lowest ? a.v - b.v : b.v - a.v))[0];
      if (pick && (lowest || pick.v >= min)) awards.push({ icon, title, id: pick.p.id, value: `${Math.round(pick.v * 10) / 10}${unit}` });
    };
    best((p) => p.kills, '💥', '击飞王', ' 次');
    best((p) => p.stats.hits, '🔨', '大力士', ' 次重击', 3);
    best((p) => p.stats.items, '🎁', '道具达人', ' 个', 2);
    if (mode.id === 'football') best((p) => p.stats.goals, '⚽', '射手王', ' 球');
    if (mode.id === 'paint') best((p) => p.stats.tiles, '🎨', '涂色大师', ' 块');
    if (mode.id === 'boss') best((p) => p.stats.dmg / 100, '🤖', '最佳输出', ' 点');
    if (mode.id === 'crown') best((p) => p.stats.crown, '👑', '戴冠最久', ' 秒');
    if (mode.id === 'potato') best((p) => p.stats.passes, '💣', '传球高手', ' 次');
    if (mode.id === 'rope') {
      best((p) => p.stats.keys, '🔑', '开锁达人', ' 把');
      best((p) => p.stats.plates, '🟢', '机关达人', ' 次');
      best((p) => p.stats.saves, '🪢', '救援高手', ' 次');
    }
    if (list.length > 1) best((p) => p.stats.falls, '🛡️', '不倒翁', ' 次掉落', 0, true);
    this.winnerTeam = extra.winnerTeam !== undefined ? extra.winnerTeam : this.winnerTeam;
    this.results = {
      mode: mode.id,
      map: this.settings.map,
      winners,
      winnerTeam: mode.teams ? this.winnerTeam : -1,
      teamScore: this.teamScore.slice(),
      coop: extra.coop || null,
      text: extra.text || '',
      duration: Math.round(this.matchTime),
      rows,
      awards,
    };
    leaderboard.record(list.filter((p) => !p.bot).map((p) => ({ name: p.name, won: winSet.has(p.id), kos: p.kills })));
    this.event({ type: 'matchEnd' });
  }

  // ------------------------------------------------------------------
  // 每帧
  // ------------------------------------------------------------------
  tick(dt) {
    for (const p of this.list()) {
      if (p.bot || p.connected) continue;
      p.dc += dt;
      if (p.id === this.hostId && p.dc > K.HOST_DC_GRACE && p.dc - dt <= K.HOST_DC_GRACE) this.pickNewHost();
      if (p.dc > (this.inGame ? K.GAME_DC_GRACE : K.LOBBY_DC_GRACE)) this.removePlayer(p.id, 'timeout');
    }
    if (this.phase === 'countdown') {
      this.timer -= dt;
      if (this.timer <= 0) this.phase = 'playing';
      return;
    }
    if (this.phase === 'playing' || this.phase === 'roundEnd') this.simulate(dt);
  }

  simulate(dt) {
    const mode = this.mode;
    if (this.phase === 'roundEnd') {
      this.timer -= dt;
      if (this.timer <= 0) {
        const over = mode.matchOver ? mode.matchOver(this) : null;
        if (over) this.endMatch(over.winners, over);
        else this.startRound();
        return;
      }
    }
    const playing = this.phase === 'playing';

    if (playing) {
      this.roundTime += dt;
      this.matchTime += dt;
      this.updateArena(dt);
      if (this.settings.items && !mode.noItems) {
        this.itemTimer -= dt;
        if (this.itemTimer <= 0) {
          this.itemTimer = rand(3.5, 5.5);
          if (this.items.length < K.ITEM_MAX) this.spawnItem();
        }
      }
      this.updateMeteorSpawn(dt);
    }

    const active = this.activeBodies();
    const phys = this.map.physics;

    // 控制 + 加速 + 冲刺 + 阻尼
    for (const b of active) {
      for (const k of Object.keys(b.fx)) b.fx[k] = Math.max(0, b.fx[k] - dt);
      if (b.kind === 'player') {
        if ((b.bot || b.afk || !b.connected) && playing) bots.think(this, b, dt);
        this.movePlayer(b, dt, playing);
      } else if (b.kind !== 'ball') {
        if (playing && mode.control) mode.control(this, b, dt);
        if (controllable(b)) {
          b.vx += b.input.x * b.accel * dt;
          b.vy += b.input.y * b.accel * dt;
        }
      }
      let damping = b.kind === 'ball' ? phys.ballDamping : b.damping ? b.damping * (phys.damping / 2.4) : phys.damping;
      if (b.fx.slip > 0) damping = 0.35;
      else if (b.fx.frozen > 0) damping = 0.8;
      const damp = Math.max(0, 1 - damping * dt);
      b.vx *= damp;
      b.vy *= damp;
    }
    for (const b of active) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }

    this.collide(active);
    this.applyBumpers(active);
    if (mode.constrain) mode.constrain(this, active, dt, playing);
    this.updateTornados(active, dt);
    this.updateTraps(active, dt);
    this.updateMeteors(active, dt);

    if (playing) {
      for (const p of active) {
        if (p.kind !== 'player') continue;
        const r = radiusOf(p) + K.ITEM_R;
        const idx = this.items.findIndex((it) => Math.hypot(it.x - p.x, it.y - p.y) < r);
        if (idx >= 0) {
          const [item] = this.items.splice(idx, 1);
          this.applyItem(p, item);
        }
      }
      if (mode.update) mode.update(this, dt);
      if (this.phase !== 'playing') return;
    }

    this.updateFalls(active, dt, playing);
    if (this.phase === 'playing' && mode.check) mode.check(this);
  }

  movePlayer(p, dt, playing) {
    const ctrl = controllable(p);
    // 一局结束后的停顿里不再接受操作，大家滑行停下（否则机器人会沿着最后的方向一直走）
    // 被绳子吊在边上的时候也动不了，只能等队友拉上来
    let ix = ctrl && playing && !p.hanging ? p.input.x : 0;
    let iy = ctrl && playing && !p.hanging ? p.input.y : 0;
    const il = Math.hypot(ix, iy);
    if (il > 1) {
      ix /= il;
      iy /= il;
    }
    const accel = this.map.physics.accel * (p.fx.speed > 0 ? 1.7 : 1) * (this.mode.accelMul ? this.mode.accelMul(this, p) : 1);
    p.vx += ix * accel * dt;
    p.vy += iy * accel * dt;
    p.dashCd = Math.max(0, p.dashCd - dt);
    if (p.input.dash && p.dashCd <= 0 && playing && ctrl && !p.hanging) {
      let dx = ix;
      let dy = iy;
      if (Math.hypot(dx, dy) < 0.1) {
        const sp = Math.hypot(p.vx, p.vy);
        dx = sp > 1 ? p.vx / sp : 0;
        dy = sp > 1 ? p.vy / sp : 0;
      }
      const dl = Math.hypot(dx, dy);
      if (dl > 0) {
        p.vx += (dx / dl) * K.DASH_IMPULSE;
        p.vy += (dy / dl) * K.DASH_IMPULSE;
        p.dashCd = p.fx.speed > 0 ? K.DASH_COOLDOWN * 0.45 : K.DASH_COOLDOWN;
        this.event({ type: 'dash', id: p.id });
      }
    }
    p.input.dash = false;
  }

  // 物体两两碰撞（考虑体重；幽灵穿透）
  collide(active) {
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i];
        const b = active[j];
        if (ghosted(a) || ghosted(b)) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const minD = radiusOf(a) + radiusOf(b);
        if (d === 0 || d >= minD) continue;
        const nx = dx / d;
        const ny = dy / d;
        const ima = 1 / massOf(a);
        const imb = 1 / massOf(b);
        const share = ima / (ima + imb);
        const overlap = minD - d;
        a.x -= nx * overlap * share;
        a.y -= ny * overlap * share;
        b.x += nx * overlap * (1 - share);
        b.y += ny * overlap * (1 - share);
        const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (rel <= 0) continue;
        // 球弹一点；Boss / 小怪撞起来更"实"（玩家撞上去不会被自己的力道弹飞）；玩家之间最弹
        // 协作模式里队友之间只是轻轻挤一下，不会把队友撞下去
        let e = K.RESTITUTION;
        if (a.kind === 'ball' || b.kind === 'ball') e = 1.3;
        else if (a.kind === 'boss' || b.kind === 'boss') e = 0.3;
        else if (a.kind === 'minion' || b.kind === 'minion') e = 1.1;
        else if (this.mode.coop) e = 0.3;
        const jImp = ((1 + e) * rel) / (ima + imb);
        a.vx -= jImp * ima * nx;
        a.vy -= jImp * ima * ny;
        b.vx += jImp * imb * nx;
        b.vy += jImp * imb * ny;
        this.hitBy(a, b);
        this.hitBy(b, a);
        if (rel > 150 && (a.kind === 'player' || b.kind === 'player')) {
          // 速度快的一方算"出手"的人
          const va = Math.hypot(a.vx, a.vy);
          const vb = Math.hypot(b.vx, b.vy);
          const striker = rel > K.STRONG_HIT ? (va >= vb ? b : a) : null;
          if (striker && striker.kind === 'player') striker.stats.hits++;
          this.event({ type: 'hit', a: a.id, b: b.id, x: r1((a.x + b.x) / 2), y: r1((a.y + b.y) / 2), power: Math.round(rel), nx: r1(nx), ny: r1(ny) });
        }
        if (this.mode.onCollide) this.mode.onCollide(this, a, b, rel);
      }
    }
  }

  applyBumpers(active) {
    (this.map.bumpers || []).forEach((bp, bi) => {
      for (const p of active) {
        const dx = p.x - bp.x;
        const dy = p.y - bp.y;
        const d = Math.hypot(dx, dy);
        const minD = bp.r + radiusOf(p);
        if (d === 0 || d >= minD) continue;
        const nx = dx / d;
        const ny = dy / d;
        p.x = bp.x + nx * minD;
        p.y = bp.y + ny * minD;
        const vn = p.vx * nx + p.vy * ny;
        const out = Math.max(420, -vn * 1.5) / Math.sqrt(massOf(p));
        p.vx += (out - vn) * nx;
        p.vy += (out - vn) * ny;
        this.event({ type: 'bump', i: bi, x: r1(bp.x + nx * bp.r), y: r1(bp.y + ny * bp.r) });
      }
    });
  }

  // 龙卷风：四处游走，把靠近的人卷起来甩出去
  updateTornados(active, dt) {
    for (const h of this.hazards) {
      h.life -= dt;
      h.a += rand(-2, 2) * dt;
      if (Math.hypot(h.x, h.y) > this.map.layout.radius * 0.7) h.a = Math.atan2(-h.y, -h.x) + rand(-0.5, 0.5);
      h.x += Math.cos(h.a) * 130 * dt;
      h.y += Math.sin(h.a) * 130 * dt;
      const owner = this.players.get(h.owner);
      for (const p of active) {
        if (p === owner || ghosted(p) || (owner && p.kind === 'player' && !this.isEnemy(owner, p))) continue;
        const dx = p.x - h.x;
        const dy = p.y - h.y;
        const d = Math.hypot(dx, dy);
        if (d > 95 || d === 0) continue;
        const k = (1 - d / 95) / massOf(p);
        p.vx += ((-dy / d) * 2400 + (dx / d) * 1300) * k * dt;
        p.vy += ((dx / d) * 2400 + (dy / d) * 1300) * k * dt;
        this.hitBy(p, owner);
      }
    }
    this.hazards = this.hazards.filter((h) => h.life > 0);
  }

  updateTraps(active, dt) {
    for (const tr of this.traps) {
      tr.arm -= dt;
      tr.life -= dt;
      for (const p of active) {
        if (p.kind === 'ball' || (p.id === tr.owner && tr.arm > 0) || ghosted(p) || tr.life <= 0) continue;
        if (Math.hypot(p.x - tr.x, p.y - tr.y) < radiusOf(p) + 14) {
          tr.life = 0;
          p.fx.slip = K.SLIP_TIME;
          const sp = Math.hypot(p.vx, p.vy) || 1;
          p.vx += (p.vx / sp) * 250;
          p.vy += (p.vy / sp) * 250;
          const owner = this.players.get(tr.owner);
          if (owner && owner !== p) this.hitBy(p, owner);
          this.event({ type: 'slip', id: p.id, x: r1(tr.x), y: r1(tr.y) });
        }
      }
    }
    this.traps = this.traps.filter((t) => t.life > 0);
  }

  updateMeteorSpawn(dt) {
    const mc = this.map.meteors;
    if (!mc || !this.mode.hazards.meteors) return;
    this.meteorTimer -= dt;
    if (this.meteorTimer > 0) return;
    this.meteorTimer = lerp(mc.interval[0], mc.interval[1], this.roundTime / 50) * (this.mode.id === 'football' ? 1.8 : 1);
    const alive = this.list().filter((p) => p.alive && !p.falling);
    let x;
    let y;
    // 一半概率瞄准某个玩家附近
    if (alive.length && Math.random() < 0.5) {
      const v = alive[Math.floor(Math.random() * alive.length)];
      x = v.x + rand(-60, 60);
      y = v.y + rand(-60, 60);
    } else {
      const t = this.safeSpot(false);
      x = t ? t.cx : 0;
      y = t ? t.cy : 0;
    }
    if (this.tileAt(x, y) >= 0) this.meteors.push({ id: this.nextObj++, x, y, t: mc.warn, r: mc.radius });
  }

  updateMeteors(active, dt) {
    for (const m of this.meteors) {
      m.t -= dt;
      if (m.t > 0) continue;
      this.event({ type: 'meteor', x: r1(m.x), y: r1(m.y), r: m.r });
      const id = this.tileAt(m.x, m.y);
      if (id >= 0 && this.tileState[id] !== 2) this.breakTile(id);
      this.knock(m.x, m.y, m.r * 1.6, this.map.meteors.power, null);
    }
    this.meteors = this.meteors.filter((m) => m.t > 0);
  }

  spawnItem() {
    const t = this.safeSpot();
    if (!t || this.items.some((it) => Math.hypot(it.x - t.cx, it.y - t.cy) < 60)) return;
    const types = this.mode.itemTypes || K.ITEM_TYPES;
    const type = types[Math.floor(Math.random() * types.length)];
    this.items.push({ id: this.nextObj++, type, x: t.cx, y: t.cy });
  }

  applyItem(p, item) {
    p.stats.items++;
    this.event({ type: 'pickup', id: p.id, item: item.type, x: r1(item.x), y: r1(item.y) });
    switch (item.type) {
      case 'bomb':
        this.event({ type: 'shock', id: p.id, x: r1(p.x), y: r1(p.y), r: K.BOMB_RADIUS });
        this.knock(p.x, p.y, K.BOMB_RADIUS, K.BOMB_POWER, p, (o) => o.kind === 'ball' || this.isEnemy(p, o));
        break;
      case 'freeze':
        this.event({ type: 'freeze', id: p.id, x: r1(p.x), y: r1(p.y), r: K.FREEZE_RADIUS });
        for (const o of this.activeBodies()) {
          if (!this.isEnemy(p, o) || ghosted(o) || o.fx.shield > 0) continue;
          if (Math.hypot(o.x - p.x, o.y - p.y) > K.FREEZE_RADIUS) continue;
          o.fx.frozen = K.FREEZE_TIME;
          o.vx *= 0.3;
          o.vy *= 0.3;
        }
        break;
      case 'tornado': {
        const sp = Math.hypot(p.vx, p.vy);
        const a = sp > 20 ? Math.atan2(p.vy, p.vx) : Math.random() * Math.PI * 2;
        this.hazards.push({ id: this.nextObj++, type: 'tornado', x: p.x + Math.cos(a) * 70, y: p.y + Math.sin(a) * 70, a, life: 7, owner: p.id });
        break;
      }
      case 'banana': {
        const sp = Math.hypot(p.vx, p.vy);
        const dx = sp > 20 ? p.vx / sp : 0;
        const dy = sp > 20 ? p.vy / sp : 1;
        for (let k = -1; k <= 1; k++) {
          this.traps.push({ id: this.nextObj++, x: p.x - dx * 55 + dy * k * 40, y: p.y - dy * 55 - dx * k * 40, owner: p.id, arm: 0.8, life: 25 });
        }
        break;
      }
      default:
        p.fx[item.type] = K.ITEM_DURATION[item.type];
    }
    if (this.mode.onItem) this.mode.onItem(this, p, item);
  }

  // 掉出场地、掉落动画、复活
  updateFalls(active, dt, playing) {
    const mode = this.mode;
    for (const b of active) {
      if (this.supported(b.x, b.y) || b.hanging) continue;
      b.falling = 0.6;
      b.hanging = false;
      if (b.kind === 'player') {
        b.stats.falls++;
        this.event({ type: 'fall', id: b.id });
        const killer = b.lastHitBy && this.roundTime - b.lastHitTime < K.KO_WINDOW ? this.players.get(b.lastHitBy) : null;
        if (killer && killer !== b && this.isEnemy(killer, b)) {
          killer.kills++;
          killer.stats.kills++;
          this.event({ type: 'ko', id: killer.id, victim: b.id });
        }
        if (mode.onPlayerFall) mode.onPlayerFall(this, b, killer);
      } else {
        this.event({ type: 'bodyFall', id: b.id, kind: b.kind });
        if (mode.onBodyFall) mode.onBodyFall(this, b);
      }
    }
    for (const p of this.list()) {
      if (p.falling > 0) {
        p.falling -= dt;
        p.x += p.vx * dt * 0.5;
        p.y += p.vy * dt * 0.5;
        if (p.falling <= 0) {
          p.falling = 0;
          p.alive = false;
          if (mode.respawn && (!mode.canRespawn || mode.canRespawn(this, p))) p.respawn = mode.respawnDelay || 2;
        }
      } else if (!p.alive && mode.respawn && p.respawn > 0 && playing && !p.out) {
        p.respawn -= dt;
        if (p.respawn <= 0) this.respawnPlayer(p);
      }
    }
    for (const b of this.bodies) {
      if (b.falling > 0) {
        b.falling -= dt;
        b.x += b.vx * dt * 0.5;
        b.y += b.vy * dt * 0.5;
        if (b.falling <= 0) b.alive = false;
      }
    }
    this.bodies = this.bodies.filter((b) => b.alive);
  }

  respawnPlayer(p) {
    let pos = this.mode.respawnPos ? this.mode.respawnPos(this, p) : null;
    if (this.mode.teams && this.map.goal) {
      // 足球：在自己半场复活
      const side = p.team === 0 ? -1 : 1;
      for (let k = 0; k < 8 && !pos; k++) {
        const x = side * rand(80, this.map.goal.x * 0.8);
        const y = rand(-150, 150);
        if (this.safeAt(x, y)) pos = { x, y };
      }
    }
    if (!pos) {
      const t = this.safeSpot();
      if (t) pos = { x: t.cx, y: t.cy };
    }
    if (!pos) {
      p.respawn = 0.5;
      return;
    }
    this.placePlayer(p, pos.x, pos.y);
    p.fx.ghost = 1.2; // 复活保护
    this.event({ type: 'respawn', id: p.id });
  }

  // ------------------------------------------------------------------
  // 快照
  // ------------------------------------------------------------------
  snapshot() {
    const next = this.nextRingCollapse();
    const st = this.settings;
    return {
      t: 'state',
      code: this.code,
      settings: st,
      hostId: this.hostId,
      phase: this.phase,
      timer: r1(Math.max(0, this.timer)),
      round: this.round,
      roundText: this.roundText,
      winner: this.lastWinner,
      winnerTeam: this.winnerTeam,
      teamScore: this.teamScore,
      matchTime: Math.round(this.matchTime),
      warn: this.phase === 'playing' && next <= this.map.collapse.warn ? r1(Math.max(0, next)) : -1,
      tiles: String.fromCharCode(...this.tileState.map((s) => 48 + s)),
      events: this.events,
      items: this.items.map((it) => ({ id: it.id, type: it.type, x: r1(it.x), y: r1(it.y) })),
      hazards: this.hazards.map((h) => ({ id: h.id, type: h.type, x: r1(h.x), y: r1(h.y), life: r1(h.life) })),
      traps: this.traps.map((t) => ({ id: t.id, x: r1(t.x), y: r1(t.y) })),
      meteors: this.meteors.map((m) => ({ id: m.id, x: r1(m.x), y: r1(m.y), t: r1(m.t), r: m.r })),
      bodies: this.bodies.map((b) => ({ id: b.id, kind: b.kind, x: r1(b.x), y: r1(b.y), vx: Math.round(b.vx), vy: Math.round(b.vy), r: b.r, falling: b.falling > 0, fx: { frozen: r1(b.fx.frozen), slip: r1(b.fx.slip), ghost: r1(b.fx.ghost) } })),
      m: this.inGame || this.phase === 'gameOver' ? (this.mode.snapshot ? this.mode.snapshot(this) : {}) : {},
      players: this.list().map((p) => ({
        id: p.id,
        name: p.name,
        profile: p.profile,
        bot: p.bot,
        team: p.team,
        ready: p.ready,
        connected: p.connected,
        afk: p.afk,
        x: r1(p.x),
        y: r1(p.y),
        vx: Math.round(p.vx),
        vy: Math.round(p.vy),
        r: radiusOf(p),
        alive: p.alive,
        falling: p.falling > 0,
        hang: p.hanging ? 1 : 0,
        exploded: p.exploded,
        respawn: r1(p.respawn),
        out: p.out,
        score: r1(p.score),
        kills: p.kills,
        dashCd: Math.round(p.dashCd * 100) / 100,
        fx: Object.fromEntries(Object.entries(p.fx).map(([k, v]) => [k, r1(v)])),
      })),
      results: this.phase === 'gameOver' ? this.results : null,
    };
  }

  // 房间列表里显示的信息
  summary() {
    const host = this.players.get(this.hostId);
    return {
      code: this.code,
      name: this.settings.name || (host ? `${host.name}的房间` : '房间'),
      host: host ? host.name : '',
      players: this.players.size,
      humans: this.humans().length,
      max: this.settings.max,
      mode: this.settings.mode,
      map: this.settings.map,
      phase: this.phase,
    };
  }
}

module.exports = { Room };
