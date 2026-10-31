/**
 * 角色本体：状态驱动的交互。
 *
 * 这不是"语义 → 动作"的查表，而是一条链：
 *   用户的话 → 言语行为 → 六个内部状态 → 最紧的冲突 → 意图 → 动作
 *
 * 为什么这么做：如果直接把语义映射成动作，它永远在做"当前输入下的最优解"，
 * 用户两天就能摸清。人有趣的地方是在两难里怎么选——傲娇不是情绪标签，
 * 是"想靠近"和"要面子"打架时的一种解法。
 *
 * 状态会落盘（settings 里的 ontology），所以重启之后它还记得刚才的情绪余温。
 */
import { getSetting, setSetting } from "./db.mjs";
import { getPersona, getRelation } from "./persona.mjs";
import { now } from "./clock.mjs";

/* ---------------- 六个状态维度 ---------------- */

export const DIMS = [
  { key: "attention", label: "注意力", base: 0.5 },
  { key: "energy", label: "精力", base: 0.7 },
  { key: "security", label: "安全感", base: 0.6 },
  { key: "face", label: "面子", base: 0.5 },
  { key: "curiosity", label: "好奇", base: 0.5 },
  { key: "attachment", label: "关系期待", base: 0.3 },
];

const clamp01 = (v) => Math.max(0, Math.min(1, v));

function defaultState() {
  const s = {};
  for (const d of DIMS) s[d.key] = d.base;
  s.lastAction = null;
  s.updatedAt = now();
  return s;
}

/** 读取状态，并按经过的时间做一次回落（越久没互动，越回到基线） */
export function loadState() {
  const saved = getSetting("ontology", null);
  const s = saved && typeof saved === "object" ? { ...defaultState(), ...saved } : defaultState();
  const minutes = Math.max(0, (now() - (s.updatedAt ?? now())) / 60000);
  // 半天之内完成大部分回落；不会一下子归零，避免"睡一觉人格没了"
  const k = 1 - Math.exp(-minutes / 180);
  for (const d of DIMS) s[d.key] = clamp01(s[d.key] + (d.base - s[d.key]) * k);
  s.updatedAt = now();
  return s;
}

function saveState(s) {
  s.updatedAt = now();
  setSetting("ontology", s);
}

/* ---------------- 言语行为 ---------------- */

/**
 * 十类言语行为。识别的是"他在做什么"，不是"他什么情绪"。
 * 规则是保守的：拿不准就当陈述，置信度低——宁可少归一类，也不要硬贴标签。
 */
const SPEECH_ACTS = [
  { act: "请求", re: /帮我|能不能|可以帮|请(你|帮)|往前走|过来|打开|关掉|记住|提醒我/ },
  { act: "拒绝", re: /别烦我|不想说|不要管我|别管我|走开/ },
  { act: "命令", re: /别(动|说|烦)|停下|安静|不许|闭嘴|走开/ },
  { act: "玩笑", re: /哈哈|hhh|开玩笑|逗你|你是不是傻|你傻啊/ },
  { act: "评价", re: /可爱|厉害|好看|好丑|真棒|喜欢你|讨厌你|聪明/ },
  { act: "自嘲", re: /我(又|真|太).{0,4}(笨|废|搞砸|不行|失败)|我完蛋了/ },
  { act: "试探", re: /你还记得|记不记得|你是不是|你懂吗|你确定/ },
  { act: "示弱", re: /难受|难过|累死|好累|害怕|焦虑|想哭|撑不住|睡不着/ },
  { act: "关心", re: /你怎么样|你还好吗|你今天|累不累|开心吗/ },
];

export function classifySpeechAct(text) {
  const t = String(text ?? "");
  for (const s of SPEECH_ACTS) {
    if (s.re.test(t)) return { act: s.act, confidence: 0.75 };
  }
  return { act: "陈述", confidence: t.trim() ? 0.6 : 0.2 };
}

/* ---------------- 事件 → 状态 ---------------- */

const STAGE_GAIN = { stranger: 0.6, familiar: 1.0, habit: 1.2, grown: 1.4 };

const EFFECTS = {
  请求: { attention: +0.2, energy: -0.05 },
  命令: { attention: +0.25, security: -0.2 },
  评价: { face: +0.3, security: +0.15 },
  自嘲: { security: -0.2, attachment: +0.15 },
  试探: { face: +0.15, curiosity: +0.15 },
  示弱: { security: +0.25, attention: +0.2 },
  拒绝: { security: -0.35, face: -0.1 },
  玩笑: { curiosity: +0.15, face: -0.08 },
  关心: { face: +0.2, security: +0.15 },
  陈述: { curiosity: +0.08 },
};

export function applyEvent(state, act, { stage = "stranger", confidence = 0.7 } = {}) {
  const gain = (STAGE_GAIN[stage] ?? 0.8) * confidence;
  const delta = EFFECTS[act] ?? EFFECTS.陈述;
  for (const [k, v] of Object.entries(delta)) {
    if (k in state) state[k] = clamp01(state[k] + v * gain);
  }
  return state;
}

/* ---------------- 冲突对 ---------------- */

/**
 * 冲突 = 两个维度同时被推到高位（或一高一低）时产生的张力。
 * 取最强的一对——人一次只会被一件事绊住。
 */
export function findConflict(state) {
  /* 冲突看的是"偏离基线多少"，不是绝对值。
     否则一个天生面子高的人格，每一轮都在打同一场架——用户会觉得它只会一个反应。 */
  const up = (k, base) => Math.max(0, state[k] - base);
  const down = (k, base) => Math.max(0, base - state[k]);
  const pairs = [
    { id: "approach_vs_face", label: "想靠近 × 要面子", t: up("security", 0.6) * up("face", 0.5) },
    { id: "continue_vs_tired", label: "想继续 × 累了", t: up("curiosity", 0.5) * down("energy", 0.7) * 2 },
    { id: "seen_vs_exposed", label: "想被看见 × 怕被看穿", t: up("face", 0.5) * down("security", 0.6) },
    { id: "offended_vs_bond", label: "被冒犯 × 不想撕破", t: down("security", 0.6) * state.attachment },
    { id: "curious_vs_cautious", label: "好奇 × 不想多事", t: up("curiosity", 0.5) * down("security", 0.6) },
  ];
  const top = pairs.sort((a, b) => b.t - a.t)[0];
  return top.t >= 0.03 ? top : { ...top, id: "none", label: "没有明显的拉扯", t: top.t };
}

/* ---------------- 人格系数 ---------------- */

/**
 * 人格不是形容词，是冲突的偏好解：
 * 傲娇 = 面子更重；黏人 = 关系期待更重；冷淡 = 更难被推动；好奇 = 更容易追问。
 */
export function coefficients(persona = getPersona()) {
  const d = persona?.dims ?? {};
  return {
    face: 1 + (d.expressiveness ?? 0.5) * 0.4,
    attachment: 0.6 + (d.sociability ?? 0.3) * 1.4,
    curiosity: 0.7 + (d.curiosity ?? 0.5) * 0.9,
    security: 0.7 + (d.amplitude ?? 0.4) * 0.6,
  };
}

/* ---------------- 冲突 → 意图 ---------------- */

export function resolveIntent(conflict, state, coef = coefficients()) {
  switch (conflict.id) {
    case "approach_vs_face":
      return (state.face - 0.5) * coef.face > state.security - 0.6 ? "deflect" : "approach";
    case "continue_vs_tired":
      return state.energy < 0.35 ? "settle" : "approach";
    case "seen_vs_exposed":
      return state.security < 0.4 ? "withdraw" : "show";
    case "offended_vs_bond":
      return state.attachment * coef.attachment > 0.35 ? "deflect" : "withdraw";
    case "curious_vs_cautious":
      return state.security < 0.4 ? "freeze" : "approach";
    default:
      return state.energy < 0.3 ? "settle" : "settle";
  }
}

/* ---------------- 意图 → 动作 ---------------- */

const INTENT_ACTIONS = {
  // 只用桌宠认识的动作名（ui/actions.js），否则本体一接管就会变成静默失败
  approach: ["nuzzle", "approach", "expect", "welcome_back"],
  withdraw: ["turn_away", "sulk", "hide", "droop", "sit"],
  deflect: ["tsundere", "peek", "shy", "fidget"],
  freeze: ["confused", "shake", "alert", "surprise"],
  show: ["proud", "celebrate", "happy", "wave"],
  settle: ["listening", "doze", "sit", "immersed"],
  silent: ["idle"],
};

/** 这个动作在不在该意图的候选里——给"硬约束"用 */
export function intentAllows(intent, action) {
  return (INTENT_ACTIONS[intent] ?? []).includes(action);
}

export function intentPool(intent) {
  return [...(INTENT_ACTIONS[intent] ?? [])];
}

export function chooseAction(intent, state, lastAction = null) {
  const pool = INTENT_ACTIONS[intent] ?? INTENT_ACTIONS.settle;
  // 惯性：上一次的动作在同一个意图里，加权
  const weighted = pool.map((a) => ({ a, w: a === lastAction ? 1.4 : 1 }));
  // 精力低的时候更偏向安静的动作
  for (const item of weighted) {
    if (state.energy < 0.35 && ["sit", "doze", "droop", "content"].includes(item.a)) item.w += 0.6;
    if (state.energy > 0.7 && ["excited", "celebrate", "playful", "nuzzle"].includes(item.a)) item.w += 0.4;
  }
  const total = weighted.reduce((n, x) => n + x.w, 0);
  let r = Math.random() * total;
  for (const item of weighted) {
    r -= item.w;
    if (r <= 0) return { action: item.a, pool };
  }
  return { action: weighted[0].a, pool };
}

/* ---------------- 一次完整观察 ---------------- */

/**
 * 跑一次完整链路。返回的东西既是给界面看的，也是给日志/日记用的。
 * 15% 的扰动就放在 chooseAction 里，不在这里——这里要保持可解释。
 */
export function observe(text, { stage } = {}) {
  const state = loadState();
  const speech = classifySpeechAct(text);
  const rel = (stage ? { stage } : getRelation());
  applyEvent(state, speech.act, { stage: rel.stage, confidence: speech.confidence });
  const conflict = findConflict(state);
  const coef = coefficients();
  let intent = resolveIntent(conflict, state, coef);
  /* 没有冲突的日子，也得有反应：被夸就想显摆一下，有人示弱就先凑过去。
     否则"没有明显的拉扯"会一律落到 settle，看起来像没听见。 */
  if (conflict.id === "none") {
    if (["示弱", "自嘲"].includes(speech.act)) intent = "approach";
    else if (["评价", "关心"].includes(speech.act)) intent = "show";
    else if (speech.act === "玩笑") intent = "deflect";
  }
  const { action, pool } = chooseAction(intent, state, state.lastAction);
  state.lastAction = action;
  saveState(state);

  const decision = {
    text: String(text ?? "").slice(0, 80),
    speech,
    conflict: { id: conflict.id, label: conflict.label, tension: +conflict.t.toFixed(3) },
    intent,
    action,
    pool,
    at: now(),
    reason: `${conflict.label}（张力 ${conflict.t.toFixed(2)}）→ ${intent} → ${action}`,
  };
  setSetting("ontologyLast", decision);
  return { state, decision };
}

/** 给界面和调试用的完整快照 */
export function snapshot() {
  const state = loadState();
  const conflict = findConflict(state);
  return {
    dims: DIMS.map((d) => ({ key: d.key, label: d.label, value: +state[d.key].toFixed(3), base: d.base })),
    lastAction: state.lastAction,
    conflict: { id: conflict.id, label: conflict.label, tension: +conflict.t.toFixed(3) },
    coefficients: coefficients(),
    lastDecision: getSetting("ontologyLast", null),
  };
}

/** 重置到基线（调试用） */
export function resetState() {
  const s = defaultState();
  saveState(s);
  setSetting("ontologyLast", null);
  return snapshot();
}
