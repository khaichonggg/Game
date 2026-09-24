// 游戏常量（服务端各模块共用）
module.exports = {
  TICK_RATE: 60,
  SEND_RATE: 30,
  PLAYER_R: 24,
  DASH_IMPULSE: 680,
  DASH_COOLDOWN: 1.2,
  RESTITUTION: 1.7, // >1 让碰撞更"弹"，更有乐趣
  COUNTDOWN: 3,
  ROUND_END_DELAY: 3.5,
  KO_WINDOW: 3, // 被撞后几秒内掉下去算对方击飞
  MAX_PLAYERS: 8,
  STRONG_HIT: 260, // 超过这个相对速度算一次"重击"

  ITEM_TYPES: ['big', 'speed', 'shield', 'bomb', 'freeze', 'ghost', 'tornado', 'banana'],
  ITEM_DURATION: { big: 7, speed: 6, shield: 6, ghost: 5 },
  ITEM_MAX: 4,
  ITEM_R: 20,
  BOMB_RADIUS: 190,
  BOMB_POWER: 900,
  FREEZE_RADIUS: 250,
  FREEZE_TIME: 2,
  SLIP_TIME: 1.3,

  LOBBY_DC_GRACE: 10, // 大厅里掉线多少秒后移出房间
  GAME_DC_GRACE: 60, // 游戏中掉线多少秒后移出（期间由机器人托管）
  CHAT_MAX: 50,
  EMOTE_COUNT: 8,

  BOT_NAMES: ['铁头', '弹弹', '旋风', '小胖', '闪电', '豆豆', '滚滚', '阿呆', '咕咕', '团子'],
  // 机器人难度：思考间隔、冲刺概率、瞄准误差、安全意识
  BOT_LEVELS: [
    { think: 0.28, dash: 0.25, noise: 0.8, safety: 45 },
    { think: 0.14, dash: 0.45, noise: 0.4, safety: 70 },
    { think: 0.08, dash: 0.6, noise: 0.2, safety: 90 },
  ],
};
