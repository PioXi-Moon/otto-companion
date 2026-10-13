/**
 * 24 个形象 + 桌宠内部会念到的那些动作名。
 *
 * 每条都是一个姿势（十几个数字）+ 一个可选的"动作层"（蹲跳抖甩）+ 一个可选的符号。
 * 这里写的是默认值；调参台存过的会盖掉它（data/poses.json）。
 *
 * 命名和《动作设计说明.md》一一对应，改哪条先看那份文档。
 */

const P = (o) => ({
  lean: 0, slide: 0, lift: 0, squash: 1,
  hipL: 0, hipR: 0, ankleL: 0, ankleR: 0,
  head: 0, mouthY: 0,
  lidL: 0, lidR: 0, lidTilt: 0, pupilX: 0, pupilY: 0,
  eyeShape: 0, mouthShape: 0,
  ...o,
});

export const ACTIONS = {
  /* ==========================================================
     一、基础表情

     设计原则：一次性动作的姿势 = 动作的最高点，不是中性。
     这样静态一帧也读得出来，不然十条看着都一样。
     ========================================================== */
  idle:        { label: "默认 / 待机", kind: "state", pose: P({}) },

  /* 留一个"纯的"开心，不加符号 */
happy:       { label: "开心",       kind: "once",  pose: P({ eyeShape: 1, mouthShape: 1, lift: -4, squash: 1.05 }), blush: true, ms: 2600 },

  /* 好奇 = 眼放大 + 歪头 + 圆嘴。歪头那一下是它和"靠近"的区别 */
  lean_in:     { label: "好奇",       kind: "state", pose: P({ mouthShape: 3, lift: 2, squash: 1.05, head: -7, pupilY: -0.4 }) },

  /* 惊讶 = 往后弹 + 感叹号 */
  surprise:    { label: "惊讶",       kind: "once",  pose: P({ mouthShape: 4, lift: -9, squash: 1.09, head: 3 }), extra: "!", anim: "m-shiver", ms: 1500 },

  sleepy:      { label: "困倦",       kind: "state", pose: P({ lidL: 0.55, lidR: 0.55, pupilY: 0.45, lift: 10, squash: 0.93, hipL: 6, hipR: -6 }), extra: "z" },

  /* 委屈 = 眼角下垂。和生气靠 lidTilt 和符号分开 */
  wronged:     { label: "委屈",       kind: "once",  pose: P({ lidL: 0.4, lidR: 0.4, lidTilt: 1, mouthShape: 2, lift: 7, squash: 0.95, head: -6 }), ms: 2800 },

  angry:       { label: "生气",       kind: "state", pose: P({ lidL: 0.75, lidR: 0.75, pupilX: 0.75, mouthShape: 2, lean: 10, ankleL: -15, ankleR: -15 }), extra: "💢", anim: "m-stomp" },

  proud:       { label: "得意",       kind: "once",  pose: P({ lidL: 0.62, lidR: 0.62, lift: -6, head: 7, squash: 1.03 }), extra: "✦", anim: "m-wobble", ms: 2200 },

  /* ---- 二、陪伴行为 ---- */

  /* 没有手，用身体左右摆 + 两条动作弧线代替挥手 */
  wave:        { label: "挥手",       kind: "once",  pose: P({ head: -4, mouthShape: 1, lean: -6 }), extra: "»", anim: "m-wobble", ms: 2000 },
  welcome:     { label: "欢迎",       kind: "once",  pose: P({ eyeShape: 1, mouthShape: 1, lift: -5, squash: 1.05 }), extra: "♪♪", anim: "m-hop", ms: 2200 },

  /* 探头观察 = 偷看：半眼 + 瞳孔偏 + 身体侧倾。和 03 好奇、15 靠近都不同 */
  peek:        { label: "探头观察",   kind: "state", pose: P({ pupilX: -0.65, lidL: 0.3, lidR: 0.3, lift: 3, squash: 1.04, head: 7, lean: -6 }) },

  shy:         { label: "害羞",       kind: "once",  pose: P({ pupilY: 0.65, lidL: 0.35, lidR: 0.35, lift: 9, squash: 0.93, head: -9 }), extra: "💧", blush: true, ms: 2800 },

  /* 跳跃庆祝：姿势本身就是腾空 —— 离地、拉长、腿往外踢开 */
  celebrate:   { label: "跳跃庆祝",   kind: "once",  pose: P({ eyeShape: 1, mouthShape: 1, lift: -22, squash: 1.14, hipL: 22, hipR: -22, ankleL: 16, ankleR: -16 }), extra: "✦✦✦", anim: "m-jump", ms: 1700 },

  sit:         { label: "坐着等待",   kind: "state", pose: P({ lidL: 0.35, lidR: 0.35, lift: 18, squash: 0.8, hipL: 21, hipR: -21 }) },

  /* 靠近 = 明着来：瞳孔正对、眼睛全开、幅度最大 */
  approach:    { label: "靠近",       kind: "state", pose: P({ lift: 2, squash: 1.07, head: 4, pupilY: -0.2 }) },

  /* 躲猫猫：横向挪出去半个身子 */
  hide:        { label: "躲猫猫",     kind: "once",  pose: P({ slide: -34, lean: 12, head: 9, pupilX: -0.5, lidL: 0.2, lidR: 0.2 }), ms: 2800 },

  /* ---- 三、AI 功能反馈 ---- */

  think:       { label: "思考中",     kind: "state", pose: P({ pupilX: 0.45, pupilY: -0.65, head: -5 }), anim: "m-bob", extra: "……" },
  listening:   { label: "正在听",     kind: "state", pose: P({ lift: -3, squash: 1.02, pupilY: -0.15 }), anim: "m-bob", extra: "waves-in" },
  speaking:    { label: "正在回答",   kind: "state", pose: P({ mouthShape: 1 }), anim: "m-talk", extra: "waves-out" },
  studying:    { label: "学习中",     kind: "state", pose: P({}), anim: "m-scan", extra: "</>" },

  /* 完成任务：姿势停在刚落地那一下，配对勾 */
  done:        { label: "完成任务",   kind: "once",  pose: P({ eyeShape: 1, mouthShape: 1, lift: 5, squash: 0.93 }), extra: "✓", anim: "m-hop", ms: 2200 },

  confused:    { label: "出错 / 困惑", kind: "once", pose: P({ lidL: 0.2, lidR: 0.55, pupilY: -0.55, pupilX: -0.3, head: 11, lean: 4, mouthShape: 2 }), extra: "?", ms: 3200 },

  confirm:     { label: "等待确认",   kind: "state", pose: P({ head: -11, pupilY: -0.45, lift: -2 }), extra: "◯" },

  /* 欢迎回来：侧身探出来，幅度比庆祝小一档。它高兴，但不表现得像等了你一整天 */
  welcome_back:{ label: "欢迎回来",   kind: "once",  pose: P({ slide: -26, lean: 9, head: 5, eyeShape: 1, mouthShape: 1 }), extra: "❤", anim: "m-hop", ms: 2200 },

  /* ---- 桌宠内部会念到的其余动作名，和情感模块对齐 ---- */
  stretch:     { label: "伸懒腰",     kind: "once",  pose: P({ lift: -13, squash: 1.08, ankleL: -12, ankleR: -12, eyeShape: 1, mouthShape: 1 }), ms: 2400 },
  fidget:      { label: "自己玩",     kind: "once",  pose: P({}), anim: "m-jiggle", ms: 2400 },
  tsundere:    { label: "傲娇",       kind: "once",  pose: P({ lean: 11, ankleL: -16, ankleR: -16, mouthShape: 2 }), anim: "m-wobble", ms: 2400 },
nuzzle:      { label: "撒娇蹭",     kind: "once",  pose: P({ eyeShape: 1, mouthShape: 1, lift: -2, squash: 1.04 }), anim: "m-step", blush: true, ms: 2400 },
  guilty:      { label: "心虚",       kind: "once",  pose: P({ lift: 8, squash: 0.93, hipL: 7, hipR: -7, head: 4, pupilY: 0.5, lidL: 0.3, lidR: 0.3 }), ms: 2400 },
  sulk:        { label: "闹脾气",     kind: "once",  pose: P({ lean: 9, ankleL: -14, ankleR: -14, lidL: 0.72, lidR: 0.72, pupilX: 0.7, mouthShape: 2 }), anim: "m-stomp", ms: 2200 },
  alert:       { label: "记挂",       kind: "once",  pose: P({ lift: -8, squash: 1.05, mouthShape: 3 }), ms: 2400 },
  expect:      { label: "期待",       kind: "state", pose: P({ lift: -8, squash: 1.06, ankleL: -12, ankleR: -12, head: -4 }) },
  droop:       { label: "失落",       kind: "state", pose: P({ lift: 13, squash: 0.87, hipL: 16, hipR: -16, head: 6, lidL: 0.45, lidR: 0.45, mouthShape: 2 }) },
  turn_away:   { label: "转身",       kind: "once",  pose: P({ lean: 11, ankleL: -16, ankleR: -16, pupilX: -0.8, head: 6 }), ms: 2600 },
  lie_down:    { label: "瘫倒",       kind: "state", pose: P({ lean: 74, lift: 2, squash: 0.95, ankleL: -20, ankleR: -20, lidL: 1, lidR: 1 }) },
  shake:       { label: "抖",         kind: "once",  pose: P({}), anim: "m-shiver", ms: 1200 },
  doze:        { label: "打盹",       kind: "state", pose: P({ lift: 18, squash: 0.8, hipL: 21, hipR: -21, head: 5, lidL: 1, lidR: 1 }), extra: "z" },
  offline:     { label: "离线",       kind: "state", pose: P({ lift: 11, squash: 0.9, lidL: 1, lidR: 1 }), anim: null },
};

/* 恢复中性用 */
export const NEUTRAL = ACTIONS.idle.pose;

/* 数据层给的动作名，先按这个对应到上面这些形象。
   两边名字不一样是因为：情感模块用的是"为什么"，这里用的是"长什么样" */
export const ALIAS = {
  "01-idle": "idle",
  "02-happy": "happy",
  "03-curious": "lean_in",
  "04-surprised": "surprise",
  "05-sleepy": "sleepy",
  "06-wronged": "wronged",
  "07-angry": "angry",
  "08-proud": "proud",
  "09-wave": "wave",
  "10-welcome": "welcome",
  "11-peek": "peek",
  "12-shy": "shy",
  "13-celebrate": "celebrate",
  "14-sit": "sit",
  "15-approach": "approach",
  "16-hide": "hide",
  "17-thinking": "think",
  "18-listening": "listening",
  "19-answering": "speaking",
  "20-studying": "studying",
  "21-done": "done",
  "22-confused": "confused",
  "23-confirm": "confirm",
  "24-welcome-back": "welcome_back",
};
