// 音效 + 背景音乐：全部用 WebAudio 实时合成，不需要任何音频文件
import { settings } from './settings.js';

let ctx = null;
let master;
let sfxBus;
let musicBus;
let noiseBuf;

function init() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  master.connect(comp).connect(ctx.destination);
  sfxBus = ctx.createGain();
  musicBus = ctx.createGain();
  sfxBus.connect(master);
  musicBus.connect(master);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  applyVolumes();
  return ctx;
}

// 浏览器要求用户操作后才能出声
export function unlock() {
  // 还没有用户操作时浏览器不允许出声，等第一次点击再初始化
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  if (!init()) return;
  const go = () => {
    if (wantSong && !songTimer) startSong(wantSong);
  };
  if (ctx.state === 'suspended') ctx.resume().then(go);
  else go();
}

export function applyVolumes() {
  if (!ctx) return;
  sfxBus.gain.value = settings.sfx;
  musicBus.gain.value = settings.music * 0.5;
}

function tone({ f = 440, f2 = 0, dur = 0.2, type = 'square', vol = 0.2, attack = 0.005, at = 0, bus, lp = 0, detune = 0 }) {
  if (!ctx || (bus !== musicBus && settings.sfx <= 0)) return;
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator();
  o.type = type;
  o.detune.value = detune;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node = o;
  if (lp) {
    const fl = ctx.createBiquadFilter();
    fl.type = 'lowpass';
    fl.frequency.value = lp;
    node.connect(fl);
    node = fl;
  }
  node.connect(g).connect(bus || sfxBus);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise({ dur = 0.3, vol = 0.2, type = 'lowpass', f = 1000, f2 = 0, q = 1, at = 0, attack = 0.005, bus }) {
  if (!ctx || (bus !== musicBus && settings.sfx <= 0)) return;
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const fl = ctx.createBiquadFilter();
  fl.type = type;
  fl.Q.value = q;
  fl.frequency.setValueAtTime(f, t);
  if (f2) fl.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(fl).connect(g).connect(bus || sfxBus);
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur + 0.05);
}

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const arp = (notes, step, opts = {}) => notes.forEach((n, i) => tone({ f: midi(n), dur: opts.dur || 0.14, type: opts.type || 'square', vol: opts.vol || 0.09, at: i * step }));

// ---------------------------------------------------------------------
// 音效
// ---------------------------------------------------------------------
let lastHit = 0;
export const sfx = {
  click: () => tone({ f: 900, f2: 1300, dur: 0.06, vol: 0.07 }),
  hover: () => tone({ f: 700, dur: 0.035, type: 'sine', vol: 0.035 }),
  error: () => {
    tone({ f: 220, dur: 0.12, vol: 0.1 });
    tone({ f: 180, dur: 0.18, vol: 0.1, at: 0.12 });
  },
  join: () => arp([72, 76, 79], 0.07, { type: 'triangle', vol: 0.12 }),
  leave: () => arp([76, 69], 0.08, { type: 'triangle', vol: 0.1 }),
  chat: () => tone({ f: 1250, dur: 0.07, type: 'sine', vol: 0.07 }),
  ready: () => arp([79, 84], 0.06, { type: 'square', vol: 0.08 }),
  emote: () => tone({ f: 800, f2: 1400, dur: 0.09, type: 'sine', vol: 0.09 }),
  countdown: () => tone({ f: 523, dur: 0.16, vol: 0.12 }),
  go: () => {
    tone({ f: 1047, dur: 0.4, vol: 0.12 });
    tone({ f: 784, dur: 0.4, vol: 0.08, type: 'triangle' });
  },
  hit(power = 300, local = false) {
    const now = performance.now();
    if (now - lastHit < 40) return;
    lastHit = now;
    const k = Math.min(1, power / 1100);
    tone({ f: 170, f2: 55, dur: 0.16, type: 'sine', vol: 0.18 + k * 0.25 });
    noise({ dur: 0.08, vol: 0.08 + k * 0.12, type: 'bandpass', f: 1400 + Math.random() * 600, q: 1.2 });
    if (power > 380 || local) noise({ dur: 0.18, vol: 0.12 * k + 0.05, type: 'lowpass', f: 3500, f2: 400 });
  },
  dash: () => {
    noise({ dur: 0.22, vol: 0.12, type: 'bandpass', f: 700, f2: 3200, q: 2 });
    tone({ f: 320, f2: 640, dur: 0.1, type: 'triangle', vol: 0.05 });
  },
  fall: () => tone({ f: 800, f2: 160, dur: 0.75, type: 'triangle', vol: 0.11 }),
  splash: () => {
    noise({ dur: 0.55, vol: 0.18, type: 'lowpass', f: 1800, f2: 250 });
    for (let i = 0; i < 3; i++) tone({ f: 500 + Math.random() * 500, f2: 1200, dur: 0.08, type: 'sine', vol: 0.04, at: 0.1 + i * 0.07 });
  },
  warp: () => tone({ f: 1400, f2: 90, dur: 0.9, type: 'sine', vol: 0.1 }),
  pickup(type) {
    arp([84, 88, 91], 0.05, { vol: 0.07 });
    if (type === 'big') tone({ f: 200, f2: 90, dur: 0.4, type: 'sawtooth', vol: 0.06, lp: 900, at: 0.1 });
    if (type === 'speed') tone({ f: 600, f2: 1800, dur: 0.25, type: 'sawtooth', vol: 0.05, lp: 3000, at: 0.1 });
    if (type === 'shield') tone({ f: 523, dur: 0.5, type: 'triangle', vol: 0.08, at: 0.1 });
  },
  bomb: () => {
    noise({ dur: 1.1, vol: 0.45, type: 'lowpass', f: 1000, f2: 60 });
    tone({ f: 120, f2: 38, dur: 0.7, type: 'sine', vol: 0.35 });
  },
  freeze: () => {
    noise({ dur: 0.6, vol: 0.1, type: 'highpass', f: 3500 });
    tone({ f: 1900, f2: 900, dur: 0.55, type: 'sine', vol: 0.08 });
    tone({ f: 2400, f2: 1200, dur: 0.4, type: 'sine', vol: 0.05, at: 0.08 });
  },
  ghost: () => {
    tone({ f: 500, f2: 900, dur: 0.7, type: 'sine', vol: 0.07 });
    tone({ f: 505, f2: 910, dur: 0.7, type: 'sine', vol: 0.07, detune: 30 });
  },
  tornado: () => noise({ dur: 1.6, vol: 0.14, type: 'bandpass', f: 350, f2: 1100, q: 3, attack: 0.3 }),
  slip: () => {
    tone({ f: 300, f2: 1000, dur: 0.18, type: 'sine', vol: 0.1 });
    tone({ f: 1000, f2: 200, dur: 0.3, type: 'sine', vol: 0.08, at: 0.18 });
  },
  meteorWarn: () => tone({ f: 1600, f2: 500, dur: 1.3, type: 'sine', vol: 0.035 }),
  meteor: () => {
    noise({ dur: 0.8, vol: 0.35, type: 'lowpass', f: 800, f2: 70 });
    tone({ f: 90, f2: 35, dur: 0.5, type: 'sine', vol: 0.25 });
    noise({ dur: 0.4, vol: 0.08, type: 'highpass', f: 2500, at: 0.05 });
  },
  bump: () => {
    tone({ f: 220, f2: 560, dur: 0.14, type: 'sine', vol: 0.12 });
    tone({ f: 560, f2: 280, dur: 0.2, type: 'sine', vol: 0.08, at: 0.12 });
  },
  collapse: () => {
    noise({ dur: 1.4, vol: 0.3, type: 'lowpass', f: 260, f2: 60, attack: 0.1 });
    tone({ f: 55, f2: 40, dur: 1.2, type: 'sine', vol: 0.2 });
  },
  crown: () => arp([72, 76, 79, 84], 0.08, { type: 'square', vol: 0.09, dur: 0.18 }),
  steal: () => arp([84, 79, 88], 0.05, { type: 'square', vol: 0.09 }),
  goal: () => {
    [64, 68, 71, 76].forEach((n) => tone({ f: midi(n), dur: 1, type: 'sawtooth', vol: 0.05, lp: 2000, attack: 0.02 }));
    noise({ dur: 2, vol: 0.2, type: 'bandpass', f: 1200, q: 0.6, attack: 0.25 });
  },
  whistle: () => {
    for (let i = 0; i < 2; i++) tone({ f: 2300, f2: 2150, dur: 0.18, type: 'sine', vol: 0.1, at: i * 0.22 });
  },
  tick: (urgent) => tone({ f: urgent ? 1900 : 1500, dur: 0.035, vol: 0.06 }),
  potatoGive: () => arp([60, 67], 0.07, { type: 'sawtooth', vol: 0.06 }),
  potatoBoom: () => {
    sfx.bomb();
    tone({ f: 900, f2: 200, dur: 0.3, type: 'square', vol: 0.06, at: 0.05 });
  },
  bossRoar: () => {
    tone({ f: 95, f2: 55, dur: 1.1, type: 'sawtooth', vol: 0.2, lp: 700 });
    tone({ f: 98, f2: 57, dur: 1.1, type: 'sawtooth', vol: 0.15, lp: 700, detune: 25 });
    noise({ dur: 0.9, vol: 0.12, type: 'bandpass', f: 400, q: 2 });
  },
  bossCharge: () => tone({ f: 110, f2: 420, dur: 0.9, type: 'sawtooth', vol: 0.1, lp: 1500 }),
  bossDash: () => noise({ dur: 0.5, vol: 0.2, type: 'bandpass', f: 500, f2: 2000, q: 1.5 }),
  bossStomp: () => {
    tone({ f: 75, f2: 30, dur: 0.5, type: 'sine', vol: 0.4 });
    noise({ dur: 0.5, vol: 0.25, type: 'lowpass', f: 500, f2: 60 });
  },
  keyPick: () => arp([76, 83, 88], 0.06, { type: 'triangle', vol: 0.1 }),
  unlock: () => {
    arp([72, 76, 79, 84, 88], 0.07, { type: 'square', vol: 0.08 });
    noise({ dur: 0.4, vol: 0.06, type: 'bandpass', f: 600, f2: 200, q: 3, at: 0.1 });
  },
  plate: () => {
    tone({ f: 300, f2: 220, dur: 0.12, type: 'square', vol: 0.08, lp: 1200 });
    tone({ f: 880, dur: 0.08, type: 'sine', vol: 0.06, at: 0.08 });
  },
  blink: () => tone({ f: 660, f2: 990, dur: 0.1, type: 'sine', vol: 0.04 }),
  rope: () => {
    noise({ dur: 0.25, vol: 0.08, type: 'bandpass', f: 400, f2: 900, q: 4 });
    tone({ f: 220, f2: 180, dur: 0.2, type: 'triangle', vol: 0.06 });
  },
  land: () => {
    tone({ f: 140, f2: 60, dur: 0.12, type: 'sine', vol: 0.12 });
    noise({ dur: 0.08, vol: 0.05, type: 'lowpass', f: 900 });
  },
  bossTired: () => {
    tone({ f: 420, f2: 120, dur: 0.6, type: 'sawtooth', vol: 0.06, lp: 900 });
    for (let i = 0; i < 3; i++) tone({ f: 1500 + i * 300, dur: 0.08, type: 'sine', vol: 0.05, at: 0.15 + i * 0.1 });
  },
  bossDown: () => {
    arp([67, 64, 60, 55], 0.1, { type: 'sawtooth', vol: 0.07, dur: 0.25 });
    sfx.splash();
  },
  victory: () => {
    arp([72, 76, 79, 84], 0.12, { type: 'square', vol: 0.1, dur: 0.2 });
    [72, 76, 79, 84].forEach((n) => tone({ f: midi(n), dur: 1.2, type: 'triangle', vol: 0.06, at: 0.5 }));
  },
  defeat: () => arp([67, 66, 65, 64], 0.25, { type: 'triangle', vol: 0.1, dur: 0.35 }),
  respawn: () => tone({ f: 400, f2: 1300, dur: 0.3, type: 'sine', vol: 0.08 }),
  ko: () => arp([88, 93], 0.06, { type: 'square', vol: 0.09 }),
  kick: () => tone({ f: 260, f2: 90, dur: 0.12, type: 'sine', vol: 0.22 }),
};

// ---------------------------------------------------------------------
// 背景音乐：和弦进行 + 琶音旋律 + 贝斯 + 鼓，按 16 分音符调度
// ---------------------------------------------------------------------
const _ = null;
const LEADS = {
  bounce: [0, _, 2, _, 1, _, 2, 3, _, 2, _, 1, 2, _, 1, _],
  drive: [0, _, 0, 2, _, 0, 1, _, 0, _, 2, _, 3, _, 2, 1],
  bell: [3, _, _, 2, _, _, 1, _, 2, _, _, 4, _, _, 3, _],
  arp16: [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1, 0, 1],
  calm: [2, _, _, _, 1, _, 0, _, _, _, 1, _, 2, _, _, _],
};
const DRUMS = {
  pop: { k: [0, 8, 10], s: [4, 12], h: [0, 2, 4, 6, 8, 10, 12, 14] },
  rock: { k: [0, 3, 8, 10], s: [4, 12], h: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
  light: { k: [0, 8], s: [], h: [4, 12] },
  synth: { k: [0, 4, 8, 12], s: [4, 12], h: [2, 6, 10, 14] },
  none: { k: [], s: [], h: [] },
};
const SONGS = {
  menu: { bpm: 112, chords: [[60, 0], [57, 1], [53, 0], [55, 0]], lead: 'bounce', drums: 'pop', lt: 'square', bt: 'triangle' },
  lobby: { bpm: 100, chords: [[53, 0], [57, 1], [58, 0], [60, 0]], lead: 'calm', drums: 'light', lt: 'triangle', bt: 'triangle' },
  lava: { bpm: 128, chords: [[57, 1], [53, 0], [55, 0], [52, 0]], lead: 'drive', drums: 'rock', lt: 'sawtooth', bt: 'sawtooth' },
  ice: { bpm: 108, chords: [[53, 0], [57, 1], [58, 0], [60, 0]], lead: 'bell', drums: 'light', lt: 'triangle', bt: 'triangle' },
  space: { bpm: 120, chords: [[50, 1], [58, 0], [53, 0], [57, 1]], lead: 'arp16', drums: 'synth', lt: 'square', bt: 'sawtooth' },
  candy: { bpm: 126, chords: [[55, 0], [52, 1], [48, 0], [50, 0]], lead: 'bounce', drums: 'pop', lt: 'square', bt: 'triangle' },
  boss: { bpm: 146, chords: [[52, 1], [52, 1], [48, 0], [50, 0]], lead: 'drive', drums: 'rock', lt: 'sawtooth', bt: 'sawtooth' },
};

let wantSong = null;
let song = null;
let songTimer = null;
let step = 0;
let nextTime = 0;
let loops = 0;

function chordTones(root, minor) {
  const third = minor ? 3 : 4;
  return [root, root + third, root + 7, root + 12, root + 12 + third, root + 19];
}

function scheduleStep(t) {
  const bar = Math.floor(step / 16) % song.chords.length;
  const s = step % 16;
  const [root, minor] = song.chords[bar];
  const tones = chordTones(root, minor);
  const stepDur = 60 / song.bpm / 4;
  const at = t - ctx.currentTime;
  // 旋律：第二遍往上一个八度，增加变化
  const li = LEADS[song.lead][s];
  if (li !== null) {
    const up = loops % 2 === 1 && bar >= 2 ? 12 : 0;
    tone({ f: midi(tones[li % tones.length] + 12 + up), dur: stepDur * 1.8, type: song.lt, vol: song.lt === 'sawtooth' ? 0.035 : 0.05, at, bus: musicBus, lp: song.lt === 'sawtooth' ? 2200 : 0 });
  }
  if (s === 0 || s === 8 || (song.drums === 'rock' && (s === 6 || s === 14))) {
    tone({ f: midi(root - 12), dur: stepDur * 3, type: song.bt, vol: 0.09, at, bus: musicBus, lp: 700 });
  }
  const d = DRUMS[song.drums];
  if (d.k.includes(s)) tone({ f: 150, f2: 45, dur: 0.14, type: 'sine', vol: 0.3, at, bus: musicBus });
  if (d.s.includes(s)) noise({ dur: 0.11, vol: 0.12, type: 'bandpass', f: 1900, q: 0.8, at, bus: musicBus });
  if (d.h.includes(s)) noise({ dur: 0.035, vol: 0.035, type: 'highpass', f: 7500, at, bus: musicBus });
}

function startSong(name) {
  if (!ctx || ctx.state !== 'running') return;
  song = SONGS[name] || SONGS.menu;
  step = 0;
  loops = 0;
  nextTime = ctx.currentTime + 0.1;
  clearInterval(songTimer);
  songTimer = setInterval(() => {
    if (!song || ctx.state !== 'running') return;
    const stepDur = 60 / song.bpm / 4;
    while (nextTime < ctx.currentTime + 0.15) {
      scheduleStep(nextTime);
      nextTime += stepDur;
      step++;
      if (step % (16 * song.chords.length) === 0) loops++;
    }
  }, 25);
}

export function playMusic(name) {
  if (wantSong === name) return;
  wantSong = name;
  if (ctx && ctx.state === 'running') startSong(name);
}

export function stopMusic() {
  wantSong = null;
  clearInterval(songTimer);
  songTimer = null;
}
