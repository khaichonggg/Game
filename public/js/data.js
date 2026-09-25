import { localize } from './i18n.js';
// 显示用的数据目录（和 server/catalog.js、server/modes.js 对应）
export const CHARACTERS = [
  { id: 'bean', name: '豆豆', icon: '🟠', desc: '经典碰碰球' },
  { id: 'cat', name: '喵喵', icon: '🐱', desc: '尖耳朵、长尾巴' },
  { id: 'dino', name: '小恐龙', icon: '🦖', desc: '背上一排尖刺' },
  { id: 'robot', name: '机器人', icon: '🤖', desc: '发光面罩' },
  { id: 'penguin', name: '企鹅', icon: '🐧', desc: '白肚皮小翅膀' },
  { id: 'chick', name: '小鸡', icon: '🐤', desc: '红鸡冠' },
  { id: 'panda', name: '熊猫', icon: '🐼', desc: '黑眼圈' },
  { id: 'bunny', name: '兔兔', icon: '🐰', desc: '长耳朵大门牙' },
];

export const SKINS = [
  { id: 'solid', name: '纯色' },
  { id: 'stripes', name: '条纹' },
  { id: 'dots', name: '波点' },
  { id: 'camo', name: '迷彩' },
  { id: 'rainbow', name: '彩虹', fixed: true },
  { id: 'candy', name: '糖果' },
  { id: 'gold', name: '黄金', fixed: true },
  { id: 'galaxy', name: '星空', fixed: true },
  { id: 'lava', name: '熔岩', fixed: true },
  { id: 'ice', name: '冰晶', fixed: true },
];

export const HATS = [
  { id: 'none', name: '无', icon: '🚫' },
  { id: 'crown', name: '皇冠', icon: '👑' },
  { id: 'tophat', name: '礼帽', icon: '🎩' },
  { id: 'party', name: '派对帽', icon: '🥳' },
  { id: 'propeller', name: '竹蜻蜓', icon: '🚁' },
  { id: 'horns', name: '小恶魔', icon: '😈' },
  { id: 'halo', name: '光环', icon: '😇' },
  { id: 'sprout', name: '小树苗', icon: '🌱' },
  { id: 'headphones', name: '耳机', icon: '🎧' },
  { id: 'cowboy', name: '牛仔帽', icon: '🤠' },
];

export const COLORS = ['#ff5a5f', '#ff8c42', '#ffd23f', '#9be15d', '#3ddc84', '#2ee6d6', '#3fa7ff', '#5b6cff', '#b06cff', '#ff6fb5', '#f2f2f2', '#3a3a4a'];

export const TEAM_COLORS = ['#ff4d5a', '#3f8cff'];
export const TEAM_NAMES = ['红队', '蓝队'];

export const EMOTES = ['😂', '👍', '😡', '😱', '😍', '🔥', '👋', '💀'];

export const ITEMS = {
  big: { icon: '🍄', name: '巨大化', color: '#ff5a5f', desc: '7 秒内体型变大、体重 ×3' },
  speed: { icon: '⚡', name: '加速', color: '#ffd23f', desc: '6 秒内跑得更快，冲刺冷却减半' },
  shield: { icon: '🛡️', name: '护盾', color: '#3fa7ff', desc: '6 秒内几乎推不动，不怕冰冻' },
  bomb: { icon: '💣', name: '炸弹', color: '#ff8c42', desc: '立刻引爆冲击波，震飞周围的对手' },
  freeze: { icon: '❄️', name: '冰冻', color: '#8fe3ff', desc: '把周围的对手冻成冰块 2 秒' },
  ghost: { icon: '👻', name: '幽灵', color: '#d9d2ff', desc: '5 秒内穿过一切，谁也撞不到你' },
  tornado: { icon: '🌪️', name: '龙卷风', color: '#9ff0c0', desc: '放出一个乱跑的龙卷风卷飞对手' },
  banana: { icon: '🍌', name: '香蕉皮', color: '#ffe066', desc: '身后丢 3 块香蕉皮，踩到就打滑' },
};

export const MAPS = {
  lava: { icon: '🌋', name: '熔岩浮岛', desc: '外圈一层层塌进岩浆', grad: ['#ff7a3a', '#6b1530'] },
  ice: { icon: '🧊', name: '冰川碎冰', desc: '冰面超滑，冰块随机碎裂', grad: ['#9fe3ff', '#2f6fbf'] },
  space: { icon: '🪐', name: '星际空间站', desc: '陨石雨砸穿地板', grad: ['#8a5cff', '#0d0b26'] },
  candy: { icon: '🍭', name: '糖果乐园', desc: '软糖弹簧会把人弹飞', grad: ['#ffb3d9', '#ff6fb5'] },
};

export const MODES = {
  classic: {
    icon: '🥊',
    name: '经典乱斗',
    short: '活到最后',
    desc: '把所有人撞下去，每局活到最后的人得 1 分。外圈会塌，越打场地越小。',
    targets: [3, 5, 7],
    label: '先赢',
    unit: '局',
    tag: '个人',
  },
  football: {
    icon: '⚽',
    name: '碰碰足球',
    short: '红蓝对抗',
    desc: '红蓝两队用身体把大球撞进对方球门。掉下去 1.5 秒后在自己半场复活。',
    targets: [3, 5, 7],
    label: '先进',
    unit: '球',
    tag: '团队',
  },
  crown: {
    icon: '👑',
    name: '抢皇冠',
    short: '戴冠计时',
    desc: '戴着皇冠就计时，用力撞戴冠的人就能抢过来。皇冠很沉，戴冠的人更难被撞飞。',
    targets: [20, 30, 45],
    label: '先拿满',
    unit: '秒',
    tag: '个人',
  },
  paint: {
    icon: '🎨',
    name: '涂色大战',
    short: '抢地盘',
    desc: '走过的地砖会变成你的颜色，时间到时地盘最多的人赢。炸弹能一次涂一大片。',
    targets: [60, 90, 120],
    label: '比赛',
    unit: '秒',
    tag: '个人',
  },
  potato: {
    icon: '💣',
    name: '烫手炸弹',
    short: '传炸弹',
    desc: '拿着炸弹的人撞到谁就把炸弹传给谁。引信烧完时拿着炸弹的人出局，活到最后得 1 分。',
    targets: [3, 5, 7],
    label: '先赢',
    unit: '局',
    tag: '个人',
  },
  boss: {
    icon: '🤖',
    name: '合力打 Boss',
    short: '多人协作',
    desc: '所有人一起把巨无霸推下场地！它会蓄力冲撞、跳起砸地、召唤小怪；放完大招会累趴一会儿，这时候最好推。大家共享复活次数，拖太久它会狂暴。',
    targets: [1, 2, 3],
    targetNames: { 1: '简单', 2: '普通', 3: '困难' },
    label: '难度',
    unit: '',
    tag: '协作 1-8 人',
  },
  rope: {
    icon: '🪢',
    name: '绳索闯关',
    short: '连成一串',
    desc: '全队按 1-2-3… 用绳子串在一起闯 4 关：拿钥匙开锁、同时踩住压力板、踩着闪烁地砖过河，所有人都站到终点岛才算过关。有人踩空时，站稳的队友会把他吊住拉回来。',
    targets: [1, 2, 3],
    targetNames: { 1: '简单', 2: '普通', 3: '困难' },
    label: '难度',
    unit: '',
    tag: '协作 1-8 人',
  },
};

export const BOT_LEVELS = ['简单', '普通', '困难'];

export const charInfo = (id) => CHARACTERS.find((c) => c.id === id) || CHARACTERS[0];

// 名字、说明等中文字段随语言切换（见 i18n.js）
for (const d of [CHARACTERS, SKINS, HATS, ITEMS, MAPS, MODES, TEAM_NAMES, BOT_LEVELS]) localize(d);
