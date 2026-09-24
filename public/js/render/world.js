// 游戏世界：每帧更新角色、展示台、场上物体、模式特效、事件反馈和镜头
import * as THREE from 'three';
import { scene, camera, renderer, textSprite, LIQUID_Y, disposeGroup } from './core.js';
import { theme, syncTiles, updateArena, ambient, setPaint, bumperHit, resetTiles } from './arena.js';
import { sparks, dust, burst, starBurst, splash, puff, speedLines, ringWave, popText, updateEffects } from './particles.js';
import { Character } from './character.js';
import { makeItemModel, makeTornado, makeBanana, makeMeteor, makeCrown, makeBall, makeGoals, makeBoss, makeMinion, makeHotBomb, makePodium } from './objects.js';
import { sfx } from '../audio.js';
import { ITEMS, TEAM_COLORS, EMOTES } from '../data.js';
import { settings } from '../settings.js';

const DASH_COOLDOWN = 1.2;
let view = 'menu'; // menu | wardrobe | room
let state = null;
let myId = null;
let shake = 0;
let hitStop = 0;
let lastPop = 0;
let arenaRadius = 460;
let camR = 460;
let wardrobeYaw = 0;

export const setView = (v) => (view = v);
export const addShake = (v) => {
  if (settings.shake) shake = Math.max(shake, v);
};
export function setState(s, id) {
  state = s;
  myId = id;
  if (s) arenaRadius = syncTiles(s.tiles);
}
export function clearRoom() {
  if (state) {
    // 用一个"大厅"状态跑一遍同步，把场上物体全部清掉
    state = { ...state, phase: 'lobby', items: [], hazards: [], traps: [], meteors: [], bodies: [], m: {}, players: [] };
    updateObjects(0, 0);
  }
  state = null;
  for (const [id, v] of views) {
    disposeView(v);
    views.delete(id);
  }
  clearPodiums();
  resetTiles();
}

// ---------------------------------------------------------------------
// 菜单 / 衣柜里展示的自己
// ---------------------------------------------------------------------
let menuChar = null;
let menuPodium = null;
export function setMenuProfile(profile) {
  if (!menuChar) {
    menuChar = new Character(profile);
    scene.add(menuChar.root);
    menuPodium = makePodium(22, '#5b4fb0');
  } else if (menuChar.key.split('|').slice(0, 4).join('|') !== `${profile.char}|${profile.skin}|${profile.color}|${profile.hat}`) {
    menuChar.build(profile);
    menuChar.bounce(8);
    burst(0, 90, 0, profile.color, 18, 160, 7);
  }
}
export const wardrobeRotate = (dx) => (wardrobeYaw += dx * 0.012);

// ---------------------------------------------------------------------
// 玩家
// ---------------------------------------------------------------------
const views = new Map();
export const debugViews = views; // 自动化测试用
const podiums = [];

function labelText(p, s) {
  let t = p.name;
  if (s.phase === 'lobby') t = (s.hostId === p.id ? '👑 ' : '') + t + (p.ready || s.hostId === p.id ? '' : ' ⌛');
  if (!p.connected && !p.bot) t += ' (掉线)';
  return t;
}

function makeView(p, teamMode) {
  const ch = new Character(p.profile, { teamColor: teamMode ? TEAM_COLORS[p.team] : null, team: teamMode ? p.team : -1 });
  scene.add(ch.root);
  return { ch, label: null, labelKey: '', bubble: null, bubbleT: 0, x: p.x, z: p.y, yaw: 0, scale: p.r, fy: 0, fvy: 0, splashed: false, pop: 1, hop: 0, visible: true };
}
function disposeView(v) {
  scene.remove(v.ch.root);
  v.ch.dispose();
  for (const s of [v.label, v.bubble]) {
    if (!s) continue;
    scene.remove(s);
    s.material.map.dispose();
    s.material.dispose();
  }
}
function setLabel(v, text, color) {
  const key = text + color;
  if (v.labelKey === key) return;
  if (v.label) {
    scene.remove(v.label);
    v.label.material.map.dispose();
    v.label.material.dispose();
  }
  v.label = textSprite(text, { color, size: 40, height: 16 });
  v.labelKey = key;
  scene.add(v.label);
}
export function showEmote(id, i) {
  const v = views.get(id);
  if (!v) return;
  if (v.bubble) {
    scene.remove(v.bubble);
    v.bubble.material.map.dispose();
    v.bubble.material.dispose();
  }
  v.bubble = textSprite(EMOTES[i] || '❓', { size: 64, height: 34, stroke: null, bg: 'rgba(255,255,255,0.92)' });
  v.bubbleT = 2.5;
  scene.add(v.bubble);
  v.ch.bounce(5);
}

function lerpAngle(a, b, k) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

const inRound = (s) => s && (s.phase === 'countdown' || s.phase === 'playing' || s.phase === 'roundEnd');

// 展示台布局：大厅排成一排；结算时前三名上领奖台
function showcaseSlots(s) {
  const list = s.players;
  if (s.phase === 'gameOver' && s.results) {
    const order = s.results.rows.map((r) => r.id);
    const sorted = [...list].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    const places = [
      { x: 0, z: 0, h: 70, rank: 1 },
      { x: -92, z: 18, h: 48, rank: 2 },
      { x: 92, z: 18, h: 32, rank: 3 },
    ];
    const rest = sorted.slice(3);
    return sorted.map((p, i) => {
      if (i < 3) return { p, ...places[i] };
      const k = i - 3;
      return { p, x: (k - (rest.length - 1) / 2) * 72, z: -125, h: 0, rank: 0 };
    });
  }
  // 大厅：4 人以内一排，更多人分前后两排（后排站高一点）
  const n = list.length;
  const front = n > 4 ? Math.ceil(n / 2) : n;
  const gap = n > 4 ? 84 : 100;
  return list.map((p, i) => {
    const back = i >= front;
    const k = back ? i - front : i;
    const cnt = back ? n - front : front;
    const x = (k - (cnt - 1) / 2) * gap + (back && cnt === front ? gap / 2 : 0);
    return { p, x, z: back ? -95 : 0, h: back ? 46 : 20, rank: 0 };
  });
}
// 大厅 / 结算两侧有面板时，展示区只占屏幕中间一部分：frac = 可见宽度占比，offset = 可见区中心相对屏幕中心的偏移（占屏宽比例）
let showcaseFrac = 1;
let showcaseOffset = 0;
export function setShowcaseArea(frac, offset = 0) {
  showcaseFrac = Math.max(0.25, Math.min(1, frac));
  showcaseOffset = Math.max(-0.3, Math.min(0.3, offset));
}

let podiumKey = '';
function syncPodiums(slots, s) {
  const key = s.phase + slots.map((sl) => `${sl.x},${sl.h},${sl.rank}`).join(';');
  if (key === podiumKey) return;
  podiumKey = key;
  for (const p of podiums) {
    scene.remove(p);
    disposeGroup(p);
  }
  podiums.length = 0;
  for (const sl of slots) {
    if (!sl.h) continue;
    const col = sl.rank === 1 ? '#ffb020' : sl.rank === 2 ? '#aab4d6' : sl.rank === 3 ? '#d08a4a' : '#5b4fb0';
    const pod = makePodium(sl.h, col, sl.rank);
    pod.position.set(sl.x, 0, sl.z);
    podiums.push(pod);
  }
}
function clearPodiums() {
  if (!podiums.length) return;
  for (const p of podiums) {
    scene.remove(p);
    disposeGroup(p);
  }
  podiums.length = 0;
  podiumKey = '';
}

function updatePlayers(dt, t, rdt) {
  const s = state;
  const game = inRound(s);
  const teamMode = s.settings.mode === 'football';
  const k = hitStop > 0 ? 0 : 1 - Math.exp(-rdt * 18);
  const ids = new Set();
  let me = null;
  const slots = game ? null : showcaseSlots(s);
  if (slots) syncPodiums(slots, s);
  else clearPodiums();
  const coopWin = s.results && s.results.coop && s.results.coop.win;

  s.players.forEach((p, idx) => {
    ids.add(p.id);
    let v = views.get(p.id);
    const key = `${p.profile.char}|${p.profile.skin}|${p.profile.color}|${p.profile.hat}|${teamMode ? p.team : -1}`;
    if (v && v.ch.key !== key) {
      v.ch.build(p.profile, { teamColor: teamMode ? TEAM_COLORS[p.team] : null, team: teamMode ? p.team : -1 });
      v.ch.bounce(8);
    }
    if (!v) {
      v = makeView(p, teamMode);
      views.set(p.id, v);
    }
    let visible;
    let tx = p.x;
    let tz = p.y;
    let ty = 0;
    let scale = p.r;
    let yawTarget = v.yaw;
    let speed = Math.hypot(p.vx, p.vy);
    let celebrate = 0;
    if (game) {
      visible = p.alive || p.falling;
      if (speed > 25) yawTarget = Math.atan2(p.vx, p.vy);
      const won = s.phase === 'roundEnd' && (s.winner === p.id || (teamMode && s.winnerTeam === p.team));
      if (won) celebrate = Math.abs(Math.sin(t * 6)) * 0.9;
    } else {
      const sl = slots.find((x) => x.p === p) || { x: 0, z: 0, h: 20 };
      visible = true;
      tx = sl.x;
      tz = sl.z;
      ty = sl.h;
      scale = 30;
      yawTarget = Math.atan2(camera.position.x - tx, camera.position.z - tz) * 0.6;
      speed = 0;
      v.ch.dizzy = 0; // 展示台 / 领奖台上不晕
      const won = s.phase === 'gameOver' && s.results && (s.results.winners.includes(p.id) || coopWin);
      celebrate = won ? Math.abs(Math.sin(t * 5 + idx)) * 0.7 : Math.abs(Math.sin(t * 2 + idx * 1.3)) * 0.12;
    }

    if (Math.hypot(tx - v.x, tz - v.z) > 150 || !v.visible) {
      v.x = tx;
      v.z = tz;
    } else {
      v.x += (tx - v.x) * k;
      v.z += (tz - v.z) * k;
    }
    if (game && p.fx.slip > 0) v.yaw += rdt * 14;
    else v.yaw = lerpAngle(v.yaw, yawTarget, 1 - Math.exp(-rdt * 10));

    // 掉下去：有液面就溅起水花，太空里飘远变小；被炸飞的直接消失
    if (game && p.falling) {
      v.fvy -= 900 * rdt;
      v.fy += v.fvy * rdt;
      if (theme.splash) {
        if (v.fy + p.r < LIQUID_Y - p.r && !v.splashed) {
          v.splashed = true;
          splash(v.x, v.z, 30, theme.splash);
          if (p.id === myId || Math.random() < 0.5) sfx.splash();
        }
        if (v.splashed) visible = false;
      } else if (v.fy < -500) visible = false;
    } else {
      v.fy = 0;
      v.fvy = 0;
      v.splashed = false;
    }
    if (game && p.exploded) visible = false;

    const moving = game && p.fx.frozen <= 0 ? Math.min(1, speed / 250) : 0;
    v.hop += dt * (8 + moving * 10);
    const hopY = moving > 0.1 ? Math.abs(Math.sin(v.hop)) * 0.12 * moving : 0;
    const ghostFloat = game && p.fx.ghost > 0 ? 0.35 + Math.sin(t * 4) * 0.1 : 0;
    v.pop = Math.min(1, v.pop + rdt * 3);
    const popS = v.pop < 1 ? v.pop * (1 + Math.sin(v.pop * Math.PI) * 0.3) : 1;
    v.scale += (scale - v.scale) * (1 - Math.exp(-rdt * 8));
    const fade = theme.splash || !(game && p.falling) ? 1 : Math.max(0.2, 1 + v.fy / 600);
    const sc = v.scale * fade * popS;
    v.visible = visible;
    const root = v.ch.root;
    root.visible = visible;
    root.position.set(v.x, ty + sc * (1 + hopY + celebrate + ghostFloat) + v.fy, v.z);
    root.scale.setScalar(Math.max(0.01, sc));
    root.rotation.y = v.yaw;
    v.ch.update(rdt, t, {
      lean: Math.min(0.35, speed / 900),
      frozen: game && p.fx.frozen > 0,
      slip: game && p.fx.slip > 0,
      ghost: game ? p.fx.ghost : 0,
      shield: game ? p.fx.shield : 0,
      speedFx: game && p.fx.speed > 0,
      falling: game && p.falling,
    });
    if (game && p.fx.speed > 0 && speed > 80 && visible && Math.random() < rdt * 40) {
      sparks.add({ x: v.x + (Math.random() - 0.5) * 10, y: sc * 0.6, z: v.z + (Math.random() - 0.5) * 10, life: 0.35, color: '#ffd23f', size: 8 });
    }
    if (game && p.fx.big > 0 && speed > 150 && Math.random() < rdt * 12) puff(v.x, v.z, 1, '#cbb893');

    const labelColor = teamMode ? (p.team ? '#9cc4ff' : '#ff9ca4') : p.id === myId ? '#ffe066' : '#ffffff';
    setLabel(v, labelText(p, s), labelColor);
    v.label.visible = visible && (settings.names || !game || p.id === myId);
    v.label.position.set(v.x, root.position.y + sc * 1.6 + 16, v.z);
    if (v.bubble) {
      v.bubbleT -= rdt;
      v.bubble.visible = visible;
      v.bubble.position.set(v.x, root.position.y + sc * 1.6 + 46 + Math.sin(t * 4) * 3, v.z);
      if (v.bubbleT <= 0) {
        scene.remove(v.bubble);
        v.bubble.material.map.dispose();
        v.bubble.material.dispose();
        v.bubble = null;
      }
    }
    if (p.id === myId) me = { p, v, visible };
  });

  for (const [id, v] of views) {
    if (!ids.has(id)) {
      disposeView(v);
      views.delete(id);
    }
  }

  const showMe = me && me.visible && game && !me.p.falling;
  myRing.visible = myArrow.visible = !!showMe;
  if (showMe) {
    const ready = me.p.dashCd <= 0;
    myRing.position.set(me.v.x, 1.2, me.v.z);
    myRing.scale.setScalar(me.v.scale * (ready ? 1 + 0.06 * Math.sin(t * 8) : 1));
    myRing.material.color.set(ready ? '#ffd23f' : '#8a84b8');
    myRing.material.opacity = ready ? 0.95 : 0.5 + 0.4 * (1 - me.p.dashCd / DASH_COOLDOWN);
    myArrow.position.set(me.v.x, me.v.ch.root.position.y + me.v.scale * 1.6 + 36 + Math.sin(t * 5) * 3, me.v.z);
    myArrow.rotation.y = t * 2;
  }
  return me;
}

const myRing = new THREE.Mesh(new THREE.RingGeometry(1.3, 1.55, 48), new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.9, depthWrite: false }));
myRing.rotation.x = -Math.PI / 2;
scene.add(myRing);
const myArrow = new THREE.Mesh(new THREE.ConeGeometry(6, 12, 4), new THREE.MeshBasicMaterial({ color: '#ffd23f' }));
myArrow.rotation.x = Math.PI;
scene.add(myArrow);

// ---------------------------------------------------------------------
// 场上物体
// ---------------------------------------------------------------------
const itemViews = new Map();
const tornadoViews = new Map();
const trapViews = new Map();
const meteorViews = new Map();
const bodyViews = new Map();
const crownView = makeCrown();
const hotBomb = makeHotBomb();
let goals = null;
let goalsKey = '';

function syncViews(map, list, create, update, remove) {
  const ids = new Set();
  for (const o of list) {
    ids.add(o.id);
    let v = map.get(o.id);
    if (!v) {
      v = create(o);
      map.set(o.id, v);
    }
    update(v, o);
  }
  for (const [id, v] of map) {
    if (!ids.has(id)) {
      remove(v, id);
      map.delete(id);
    }
  }
}
const removeGroup = (g) => {
  scene.remove(g);
  disposeGroup(g);
};

function updateObjects(dt, t) {
  const s = state;
  const game = inRound(s);
  syncViews(
    itemViews,
    game ? s.items : [],
    (it) => {
      burst(it.x, 10, it.y, ITEMS[it.type].color, 14, 120, 6);
      return makeItemModel(it.type);
    },
    (v, it) => {
      const pop = Math.min(1, (t - v.born) * 3);
      const popScale = pop < 1 ? pop * (1 + Math.sin(pop * Math.PI) * 0.4) : 1;
      v.root.position.set(it.x, 0, it.y);
      v.float.position.y = 30 + Math.sin(t * 3 + it.id) * 5;
      v.float.rotation.y = t * 1.8;
      v.float.scale.setScalar(1.5 * popScale);
      v.glow.material.opacity = 0.55 + 0.3 * Math.sin(t * 5 + it.id);
      v.beam.material.opacity = 0.16 + 0.08 * Math.sin(t * 4 + it.id);
      if (it.type === 'bomb') {
        v.float.traverse((o) => {
          if (o.userData.spark) o.scale.setScalar(0.6 + Math.random() * 0.8);
        });
      }
    },
    (v) => removeGroup(v.root)
  );
  syncViews(
    tornadoViews,
    game ? s.hazards.filter((h) => h.type === 'tornado') : [],
    () => {
      sfx.tornado();
      return makeTornado();
    },
    (v, h) => {
      if (!v.init) {
        v.g.position.set(h.x, 0, h.y);
        v.init = true;
      }
      v.g.position.x += (h.x - v.g.position.x) * Math.min(1, dt * 10);
      v.g.position.z += (h.y - v.g.position.z) * Math.min(1, dt * 10);
      v.g.scale.setScalar(Math.max(0.05, Math.min(1, (7 - h.life) * 3, h.life * 2)));
      v.layers.forEach((l, i) => {
        l.rotation.z = t * (4 + i * 0.6);
        l.position.x = Math.sin(t * 3 + i * 0.7) * (6 + i * 2);
      });
      if (Math.random() < dt * 30) {
        const a = Math.random() * Math.PI * 2;
        dust.add({ x: v.g.position.x + Math.cos(a) * 40, y: Math.random() * 120, z: v.g.position.z + Math.sin(a) * 40, vx: -Math.sin(a) * 160, vy: 60, vz: Math.cos(a) * 160, life: 0.6, color: '#cfe8d8', size: 8, alpha: 0.6 });
      }
    },
    (v) => removeGroup(v.g)
  );
  syncViews(
    trapViews,
    game ? s.traps : [],
    (tr) => {
      const g = makeBanana(1.3);
      g.rotation.x = -Math.PI / 2;
      g.rotation.z = tr.id;
      g.position.set(tr.x, 4, tr.y);
      scene.add(g);
      return g;
    },
    () => {},
    removeGroup
  );
  syncViews(
    meteorViews,
    game ? s.meteors : [],
    () => {
      sfx.meteorWarn();
      return makeMeteor();
    },
    (v, m) => {
      const k = 1 - Math.max(0, m.t) / 1.6;
      v.warn.position.set(m.x, 2, m.y);
      v.warn.scale.setScalar(m.r);
      v.warn.material.opacity = 0.5 + 0.4 * Math.sin(t * 20);
      v.fill.position.set(m.x, 1.5, m.y);
      v.fill.scale.setScalar(Math.max(0.01, m.r * k));
      const h = Math.max(0, m.t) * 700;
      v.rock.position.set(m.x + h * 0.45, h + 20, m.y - h * 0.3);
      v.rock.rotation.x += dt * 5;
      v.rock.rotation.y += dt * 3;
      if (Math.random() < dt * 60) sparks.add({ x: v.rock.position.x, y: v.rock.position.y, z: v.rock.position.z, vx: (Math.random() - 0.5) * 30, vy: 20, vz: (Math.random() - 0.5) * 30, life: 0.5, color: Math.random() < 0.5 ? '#ff7a1a' : '#ffd23f', size: 12 });
    },
    (v) => {
      for (const o of [v.warn, v.fill, v.rock]) {
        scene.remove(o);
        o.geometry.dispose();
        o.material.dispose();
      }
    }
  );

  // 球 / Boss / 小怪
  syncViews(
    bodyViews,
    game ? s.bodies : [],
    (b) => {
      if (b.kind === 'ball') return { kind: 'ball', ...makeBall(b.r), x: b.x, z: b.y, q: new THREE.Quaternion() };
      if (b.kind === 'boss') {
        sfx.bossRoar();
        return { kind: 'boss', ...makeBoss(), x: b.x, z: b.y, yaw: 0 };
      }
      puff(b.x, b.y, 10, '#5a4a66');
      return { kind: 'minion', ...makeMinion(), x: b.x, z: b.y, yaw: 0 };
    },
    (v, b) => updateBody(v, b, dt, t),
    (v) => {
      if (v.kind === 'boss') {
        for (const o of [v.warn, v.fill]) {
          scene.remove(o);
          o.geometry.dispose();
          o.material.dispose();
        }
        removeGroup(v.root);
      } else removeGroup(v.g || v.root);
    }
  );

  // 球门
  const gk = game && s.settings.mode === 'football' && s.m.goal ? s.settings.map : '';
  if (gk !== goalsKey) {
    if (goals) removeGroup(goals);
    goals = gk ? makeGoals(s.m.goal) : null;
    goalsKey = gk;
  }
  if (goals) goals.children.forEach((c) => c.userData.pulse && (c.material.opacity = 0.22 + 0.1 * Math.sin(t * 4)));

  // 皇冠
  const cr = game && s.m.crown;
  crownView.root.visible = !!cr;
  if (cr) {
    if (cr.h) {
      const v = views.get(cr.h);
      crownView.root.visible = !!(v && v.visible);
      if (v) {
        crownView.root.position.set(v.x, v.ch.root.position.y + v.scale * 1.25, v.z);
        crownView.root.scale.setScalar((v.scale / 24) * 1.6);
      }
      crownView.beam.visible = false;
      crownView.g.rotation.y = t * 1.5;
      crownView.g.position.y = 0;
    } else {
      crownView.root.position.set(cr.x, 0, cr.y);
      crownView.root.scale.setScalar(1.4);
      crownView.beam.visible = true;
      crownView.g.position.y = 26 + Math.sin(t * 3) * 5;
      crownView.g.rotation.y = t * 2;
    }
  }

  // 烫手炸弹
  const holder = game && s.settings.mode === 'potato' && s.m.holder ? views.get(s.m.holder) : null;
  hotBomb.g.visible = !!(holder && holder.visible);
  if (holder) {
    const fuse = s.m.fuse;
    hotBomb.g.position.set(holder.x, holder.ch.root.position.y + holder.scale * 1.9 + 12, holder.z);
    hotBomb.g.rotation.y = t * 2;
    const rate = fuse < 3 ? 12 : fuse < 6 ? 6 : 3;
    const pulse = 0.5 + 0.5 * Math.sin(t * rate * Math.PI);
    hotBomb.shell.emissiveIntensity = pulse * (fuse < 3 ? 1.2 : 0.5);
    hotBomb.g.scale.setScalar(1 + pulse * (fuse < 3 ? 0.18 : 0.06));
    hotBomb.spark.scale.setScalar(0.6 + Math.random() * 0.8);
    const txt = String(Math.max(0, Math.ceil(fuse)));
    if (txt !== hotBomb.last) {
      hotBomb.last = txt;
      const old = hotBomb.label;
      hotBomb.label = textSprite(txt, { color: fuse < 3 ? '#ff5a5f' : '#ffffff', size: 48, height: 20 });
      hotBomb.label.position.set(0, 44, 0);
      hotBomb.g.add(hotBomb.label);
      hotBomb.g.remove(old);
      old.material.map.dispose();
      old.material.dispose();
      sfx.tick(fuse < 3);
    }
    if (Math.random() < dt * 30) sparks.add({ x: hotBomb.g.position.x + 5, y: hotBomb.g.position.y + 27, z: hotBomb.g.position.z, vx: (Math.random() - 0.5) * 60, vy: 60, vz: (Math.random() - 0.5) * 60, life: 0.3, color: '#ffe066', size: 6, g: 120 });
  }

  // 涂色
  if (s.settings.mode === 'paint' && s.m.paint) {
    setPaint(s.m.paint, (slot) => {
      const id = s.m.slots[slot];
      const p = s.players.find((q) => q.id === id);
      return p ? p.profile.color : null;
    });
  } else setPaint(null);
}

function updateBody(v, b, dt, t) {
  const k = 1 - Math.exp(-dt * 18);
  v.x += (b.x - v.x) * k;
  v.z += (b.y - v.z) * k;
  if (b.kind === 'ball') {
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > 1) {
      const axis = new THREE.Vector3(b.vy / sp, 0, -b.vx / sp);
      v.q.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, (sp * dt) / b.r));
    }
    v.ball.quaternion.copy(v.q);
    v.g.position.set(v.x, b.falling ? v.g.position.y - dt * 400 : b.r, v.z);
    v.ring.position.y = 1 - v.g.position.y + 1;
    v.ring.visible = !b.falling;
    return;
  }
  if (b.kind === 'minion') {
    v.root.position.set(v.x, b.falling ? v.root.position.y - dt * 400 : b.r, v.z);
    v.root.scale.setScalar(b.r);
    if (Math.hypot(b.vx, b.vy) > 20) v.yaw = lerpAngle(v.yaw, Math.atan2(b.vx, b.vy), dt * 8);
    v.root.rotation.y = v.yaw;
    return;
  }
  // Boss
  const m = state.m;
  const st = m.bossState;
  const frozen = b.fx.frozen > 0;
  let yawT = v.yaw;
  if ((st === 'windup' || st === 'charge') && m.bossDir) yawT = Math.atan2(m.bossDir.x, m.bossDir.y);
  else if (Math.hypot(b.vx, b.vy) > 20) yawT = Math.atan2(b.vx, b.vy);
  v.yaw = lerpAngle(v.yaw, yawT, dt * 6);
  // 砸地前跳起来
  if (st === 'slamWind') {
    v.vy += (260 - v.y) * dt * 8;
  } else {
    v.vy -= 2400 * dt;
  }
  v.y = Math.max(0, v.y + v.vy * dt);
  if (v.y === 0 && v.vy < 0) v.vy = 0;
  v.squashV += (-140 * v.squash - 10 * v.squashV) * Math.min(dt, 0.05);
  v.squash = Math.max(-0.3, Math.min(0.3, v.squash + v.squashV * Math.min(dt, 0.05)));
  const shakeX = st === 'windup' ? (Math.random() - 0.5) * 6 : 0;
  v.fall = b.falling ? (v.fall || 0) - dt * 500 : 0;
  v.root.position.set(v.x + shakeX, b.r + v.y + v.fall, v.z);
  v.root.scale.setScalar(b.r);
  v.root.rotation.y = v.yaw;
  v.body.scale.set(1 + v.squash * 0.4, 1 - v.squash, 1 + v.squash * 0.4);
  v.body.rotation.x = st === 'charge' ? 0.35 : st === 'windup' ? -0.2 : 0;
  v.flash = Math.max(0, v.flash - dt * 4);
  const tired = st === 'tired';
  const rage = m.enraged ? 0.25 + 0.15 * Math.sin(t * 6) : 0;
  const glow = st === 'windup' ? 0.5 + 0.5 * Math.sin(t * 30) : rage;
  v.metal.emissiveIntensity = Math.max(glow, v.flash);
  v.metal.emissive.set(v.flash > glow ? '#ffffff' : '#ff2a2a');
  // 累趴：头顶冒星星、眼睛变暗、身子歪一边
  v.stars.visible = tired;
  if (tired) v.stars.rotation.y += dt * 5;
  v.eyeMat.color.set(tired ? '#5a2020' : '#ff3b3b');
  v.body.rotation.z = tired ? Math.sin(t * 3) * 0.18 : 0;
  if (m.enraged && Math.random() < dt * 25) sparks.add({ x: v.x + (Math.random() - 0.5) * b.r * 1.6, y: b.r * (0.5 + Math.random() * 1.5), z: v.z + (Math.random() - 0.5) * b.r * 1.6, vy: 80, life: 0.5, color: Math.random() < 0.5 ? '#ff5a1a' : '#ffb347', size: 10 });
  v.ice.visible = frozen;
  v.root.visible = !(b.fx.ghost > 0 && Math.sin(t * 25) > 0.3);
  v.warn.visible = v.fill.visible = st === 'slamWind';
  if (st === 'slamWind') {
    v.warn.position.set(b.x, 2, b.y);
    v.warn.scale.setScalar(230);
    v.warn.material.opacity = 0.5 + 0.4 * Math.sin(t * 20);
    v.fill.position.set(b.x, 1.5, b.y);
    v.fill.scale.setScalar(Math.max(0.01, 230 * Math.min(1, v.y / 240)));
  }
  if (st === 'charge' && Math.random() < dt * 40) speedLines(v.x, b.r, v.z, b.vx, b.vy, '#ff9a8a');
}

// ---------------------------------------------------------------------
// 事件：视觉反馈 + 音效（UI 相关的提示由 main.js 处理）
// ---------------------------------------------------------------------
export function playEvents(events) {
  const s = state;
  if (!s) return;
  const pos = (id) => {
    const v = views.get(id);
    return v ? { x: v.x, z: v.z, y: v.ch.root.position.y } : null;
  };
  for (const ev of events) {
    switch (ev.type) {
      case 'hit': {
        const local = ev.a === myId || ev.b === myId;
        const va = views.get(ev.a);
        const vb = views.get(ev.b);
        if (va) va.ch.hit(ev.power, -ev.nx, -ev.ny);
        if (vb) vb.ch.hit(ev.power, ev.nx, ev.ny);
        starBurst(ev.x, 24, ev.y, '#fff3c4', Math.min(12, 4 + Math.floor(ev.power / 110)), 120 + Math.min(ev.power, 1200) * 0.25);
        // 漫画字只给自己的重击和全场最狠的几下，避免满屏都是字
        const now = performance.now();
        const huge = ev.power > 950;
        if ((local && ev.power > 500 && now - lastPop > 250) || (huge && now - lastPop > 450)) {
          lastPop = now;
          popText(ev.x, 70, ev.y, null, huge ? '#ff5a5f' : '#ffd23f', huge ? 34 : 26);
        }
        if (ev.power > 650) ringWave(ev.x, ev.y, 40 + Math.min(ev.power, 1400) * 0.04, '#ffffff', 0.25, 20);
        addShake(local ? Math.min(18, ev.power / 55) : Math.min(6, Math.max(0, ev.power - 600) / 90));
        if (local && ev.power > 650) hitStop = 0.07;
        sfx.hit(ev.power, local);
        break;
      }
      case 'dash': {
        const v = views.get(ev.id);
        if (v) {
          puff(v.x, v.z, 6);
          v.ch.bounce(-4);
        }
        if (ev.id === myId) sfx.dash();
        break;
      }
      case 'fall':
        if (ev.id === myId) {
          addShake(16);
          sfx.fall();
          if (!theme.splash) sfx.warp();
        } else if (Math.random() < 0.6) sfx.fall();
        break;
      case 'ko': {
        const p = pos(ev.victim);
        if (p) popText(p.x, 80, p.z, 'KO!', '#ff5a5f', 30);
        if (ev.id === myId) sfx.ko();
        break;
      }
      case 'pickup': {
        const info = ITEMS[ev.item];
        burst(ev.x, 20, ev.y, info.color, 26, 180, 8);
        sfx.pickup(ev.item);
        if (ev.item === 'ghost') sfx.ghost();
        break;
      }
      case 'shock':
        ringWave(ev.x, ev.y, ev.r);
        burst(ev.x, 15, ev.y, '#ff8c42', 60, 380, 10);
        burst(ev.x, 15, ev.y, '#ffe066', 30, 250, 8);
        puff(ev.x, ev.y, 20, '#9a8878');
        popText(ev.x, 90, ev.y, 'BOOM!', '#ff8c42', 36);
        addShake(16);
        sfx.bomb();
        break;
      case 'freeze':
        ringWave(ev.x, ev.y, ev.r, '#8fe3ff', 0.6);
        burst(ev.x, 15, ev.y, '#dff8ff', 50, 320, 8);
        sfx.freeze();
        break;
      case 'slip':
        burst(ev.x, 10, ev.y, '#ffe066', 12, 120, 6);
        sfx.slip();
        break;
      case 'bump':
        if (bumperHit(ev.i)) {
          sfx.bump();
          burst(ev.x, 20, ev.y, '#ffffff', 6, 140, 5);
        }
        break;
      case 'meteor':
        ringWave(ev.x, ev.y, ev.r * 1.6, '#ff7a3a', 0.5);
        burst(ev.x, 20, ev.y, '#ff8c42', 50, 360, 10);
        burst(ev.x, 20, ev.y, '#ffe066', 25, 250, 8);
        puff(ev.x, ev.y, 16, '#6e6a82');
        addShake(12);
        sfx.meteor();
        break;
      case 'collapse':
        addShake(8);
        sfx.collapse();
        break;
      case 'crown':
        ev.from ? sfx.steal() : sfx.crown();
        {
          const p = pos(ev.id);
          if (p) burst(p.x, p.y + 30, p.z, '#ffd23f', 24, 160, 8);
        }
        break;
      case 'respawn': {
        const v = views.get(ev.id);
        if (v) {
          v.pop = 0;
          burst(v.x, 30, v.z, '#ffffff', 16, 140, 7);
        }
        if (ev.id === myId) sfx.respawn();
        break;
      }
      case 'emote':
        showEmote(ev.id, ev.i);
        sfx.emote();
        break;
      case 'goal': {
        const col = TEAM_COLORS[ev.team];
        for (let i = 0; i < 4; i++) burst(ev.x, 40, ev.y, i % 2 ? col : '#ffffff', 30, 420, 10, 1);
        ringWave(ev.x, ev.y, 200, col, 0.7);
        popText(ev.x, 120, ev.y, 'GOAL!', col, 44);
        addShake(14);
        sfx.goal();
        break;
      }
      case 'ballOut':
        splash(ev.x, ev.y, 20, theme.splash);
        break;
      case 'ballBack':
        sfx.whistle();
        break;
      case 'potatoGive':
      case 'potatoPass': {
        const p = pos(ev.id);
        if (p) burst(p.x, p.y + 40, p.z, '#ff8c42', 18, 180, 8);
        sfx.potatoGive();
        break;
      }
      case 'potatoBoom':
        ringWave(ev.x, ev.y, 230, '#ff5a1a', 0.5);
        for (let i = 0; i < 3; i++) burst(ev.x, 30, ev.y, ['#ff5a1a', '#ffd23f', '#ffffff'][i], 50, 420, 12, 0.7);
        puff(ev.x, ev.y, 30, '#4a4050', 20);
        popText(ev.x, 110, ev.y, 'BOOM!', '#ff5a1a', 48);
        addShake(20);
        sfx.potatoBoom();
        break;
      case 'bossWindup':
        sfx.bossCharge();
        break;
      case 'bossCharge':
        sfx.bossDash();
        break;
      case 'bossSlamWind':
        sfx.bossRoar();
        break;
      case 'bossSlam':
        ringWave(ev.x, ev.y, ev.r, '#ff5a3a', 0.5);
        ringWave(ev.x, ev.y, ev.r * 0.6, '#ffd23f', 0.35);
        puff(ev.x, ev.y, 40, '#8a7a70');
        burst(ev.x, 10, ev.y, '#ffb347', 40, 380, 10);
        addShake(22);
        sfx.bossStomp();
        for (const [, v] of bodyViews) if (v.kind === 'boss') v.squashV += 10;
        break;
      case 'bossHit':
        for (const [, v] of bodyViews) {
          if (v.kind === 'boss') {
            v.flash = 1;
            v.squashV += 4;
          }
        }
        popText(ev.x, 150, ev.y, null, '#ffd23f', 30);
        break;
      case 'bossDown':
        popText(ev.x, 120, ev.y, ev.lives > 0 ? `还剩 ${ev.lives} 条命!` : '击败!', '#ffd23f', 40);
        sfx.bossDown();
        addShake(16);
        break;
      case 'bossBack':
        sfx.bossRoar();
        break;
      case 'bossTired':
        popText(ev.x, 170, ev.y, '累趴了!', '#ffe066', 30);
        sfx.bossTired();
        break;
      case 'bossEnrage':
        for (const [, v] of bodyViews) if (v.kind === 'boss') ringWave(v.x, v.z, 400, '#ff3b1a', 0.8);
        addShake(14);
        sfx.bossRoar();
        break;
      case 'minion':
        puff(ev.x, ev.y, 12, '#5a4a66');
        break;
      case 'minionDown':
        if (ev.id === myId) sfx.ko();
        break;
    }
  }
}

// ---------------------------------------------------------------------
// 镜头
// ---------------------------------------------------------------------
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3(0, 700, 900);
const CAM_DIR = new THREE.Vector3(0, Math.sin(THREE.MathUtils.degToRad(52)), Math.cos(THREE.MathUtils.degToRad(52)));

function updateCamera(dt, t, me) {
  const want = new THREE.Vector3();
  const look = new THREE.Vector3();
  const narrow = camera.aspect < 0.9;
  camR += (arenaRadius - camR) * Math.min(1, dt * 1.5);
  let speed = 3;
  if (view === 'menu' || view === 'wardrobe' || !state) {
    const near = view === 'wardrobe';
    const a = near ? 0 : Math.sin(t * 0.15) * 0.5;
    const r = near ? (narrow ? 470 : 380) : narrow ? 520 : 360;
    want.set(Math.sin(a) * r, near ? 120 : 150, Math.cos(a) * r);
    // 衣柜面板在右边（手机上在下面），角色放到空出来的那一侧
    look.set(narrow ? 0 : near ? 110 : -30, near ? (narrow ? 5 : 70) : 70, 0);
    speed = 2;
  } else if (!inRound(state)) {
    // 大厅展示台 / 结算领奖台
    const results = state.phase === 'gameOver';
    const n = state.players.length;
    const perRow = results ? Math.max(3, n - 3) : n > 4 ? Math.ceil(n / 2) : n;
    const width = Math.max(results ? 250 : 200, perRow * (results ? 72 : n > 4 ? 84 : 100));
    const tanW = Math.tan(THREE.MathUtils.degToRad(22.5)) * camera.aspect;
    const dist = Math.min(1500, Math.max(results ? 420 : 380, (width / 2 + 60) / (tanW * showcaseFrac)));
    // 可见区不在屏幕正中时，整体平移镜头
    const shiftX = -showcaseOffset * 2 * dist * tanW;
    want.set(shiftX, results ? 190 : 140 + (n > 4 ? 40 : 0), dist);
    look.set(shiftX, results ? 70 : 55, -30);
    speed = 2;
  } else {
    const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const R = camR + 40;
    let dist = Math.max(R / (tanH * camera.aspect), R * 2.2);
    let follow = 0.2;
    const cap = 1300;
    if (dist > cap) {
      follow = Math.min(0.75, (dist - cap) / dist + 0.3);
      dist = cap;
    }
    if (me && me.visible && !me.p.falling) look.set(me.v.x * follow, 0, me.v.z * follow + 60);
    else look.set(0, 0, 60);
    want.copy(look).addScaledVector(CAM_DIR, dist);
    speed = 4;
  }
  const k = 1 - Math.exp(-dt * speed);
  camPos.lerp(want, k);
  camTarget.lerp(look, k);
  shake *= Math.pow(0.02, dt);
  camera.position.copy(camPos);
  camera.position.x += (Math.random() - 0.5) * shake;
  camera.position.y += (Math.random() - 0.5) * shake;
  camera.lookAt(camTarget);
}

// ---------------------------------------------------------------------
// 每帧
// ---------------------------------------------------------------------
export function frame(rdt, t) {
  const dt = Math.min(0.05, rdt);
  hitStop = Math.max(0, hitStop - rdt);
  updateArena(rdt, t);
  ambient(rdt, camTarget.x, camTarget.z);

  const showMenu = view !== 'room' || !state;
  if (menuChar) {
    menuChar.root.visible = menuPodium.visible = showMenu;
    if (showMenu) {
      const big = view === 'wardrobe';
      const sc = big ? 58 : 46;
      if (big) wardrobeYaw += rdt * 0.3;
      menuChar.root.position.set(0, 22 + sc * (1 + Math.abs(Math.sin(t * 2.2)) * 0.1), 0);
      menuChar.root.scale.setScalar(sc);
      menuChar.root.rotation.y = big ? wardrobeYaw : Math.sin(t * 0.8) * 0.4;
      menuChar.update(rdt, t, {});
    }
  }
  let me = null;
  if (state && view === 'room') me = updatePlayers(dt, t, rdt);
  else {
    myRing.visible = myArrow.visible = false;
    clearPodiums();
  }
  if (state && view === 'room') updateObjects(rdt, t);
  updateEffects(rdt);
  updateCamera(rdt, t, me);
  renderer.render(scene, camera);
}
