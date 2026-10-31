/**
 * 动作语义层。
 *
 * 意图只回答"它想靠近还是退开"，动作语义回答"靠近时是撒娇、期待，还是嘴硬"。
 * 每个动作落在八个连续维度上，最终动作由当前状态产生的目标向量决定。
 */

export const ACTION_DIMS = [
  { key: "closeness", label: "靠近" },
  { key: "energy", label: "能量" },
  { key: "warmth", label: "温度" },
  { key: "assertiveness", label: "主导" },
  { key: "vulnerability", label: "暴露" },
  { key: "clarity", label: "清晰" },
  { key: "initiative", label: "主动" },
  { key: "playfulness", label: "玩心" },
];

const D = (closeness, energy, warmth, assertiveness, vulnerability, clarity, initiative, playfulness) => ({
  closeness,
  energy,
  warmth,
  assertiveness,
  vulnerability,
  clarity,
  initiative,
  playfulness,
});

export const ACTION_VECTORS = {
  idle: D(0, -0.2, 0.1, 0, 0.1, 0.2, -0.1, 0),
  immersed: D(0.15, -0.75, 0.55, -0.2, 0.25, 0.45, -0.1, 0.1),

  nuzzle: D(0.95, 0.35, 0.95, 0.15, 0.55, 0.8, 0.65, 0.45),
  approach: D(0.85, 0.25, 0.75, 0.45, 0.35, 0.9, 0.7, 0.25),
  expect: D(0.55, 0.25, 0.7, 0.2, 0.5, 0.7, 0.6, 0.45),
  welcome_back: D(0.8, 0.45, 0.9, 0.25, 0.4, 0.9, 0.8, 0.5),
  lean_in: D(0.6, 0.3, 0.6, 0.25, 0.45, 0.8, 0.65, 0.35),
  listening: D(0.25, -0.4, 0.75, -0.2, 0.3, 0.65, 0.3, 0.15),

  turn_away: D(-0.9, -0.2, -0.5, 0.45, 0.65, 0.9, -0.2, -0.1),
  sulk: D(-0.7, 0.25, -0.4, 0.6, 0.4, 0.8, 0.2, 0.3),
  hide: D(-0.8, 0.1, -0.3, -0.2, 0.85, 0.8, -0.6, 0.3),
  droop: D(-0.5, -0.5, -0.2, -0.5, 0.8, 0.7, -0.2, -0.4),
  sit: D(-0.1, -0.6, 0.45, -0.1, 0.35, 0.5, -0.1, 0),

  tsundere: D(-0.35, 0.35, 0.35, 0.7, 0.75, 0.7, 0.3, 0.65),
  peek: D(-0.4, 0.15, 0.25, -0.2, 0.65, 0.55, 0.1, 0.55),
  shy: D(-0.3, 0.25, 0.55, -0.3, 0.9, 0.75, -0.1, 0.4),
  fidget: D(0, 0.6, 0.2, -0.2, 0.35, 0.45, 0.15, 0.7),
  guilty: D(-0.2, -0.2, 0.35, -0.45, 0.85, 0.65, -0.2, 0.15),

  confused: D(-0.15, 0.35, 0.25, -0.25, 0.65, 0.9, 0.1, 0.25),
  shake: D(-0.5, 0.7, -0.1, -0.5, 0.85, 0.9, -0.3, 0.15),
  alert: D(0.15, 0.65, 0.35, 0.4, 0.6, 0.95, 0.5, 0.2),
  surprise: D(0, 0.8, 0.3, -0.2, 0.9, 0.95, 0.2, 0.3),

  proud: D(0.35, 0.55, 0.6, 0.9, 0.2, 0.9, 0.7, 0.55),
  celebrate: D(0.55, 0.95, 0.85, 0.55, 0.25, 0.95, 0.8, 0.9),
  happy: D(0.55, 0.6, 0.9, 0.2, 0.35, 0.9, 0.5, 0.75),
  wave: D(0.35, 0.45, 0.8, 0.15, 0.25, 0.9, 0.7, 0.5),

  doze: D(-0.1, -0.95, 0.35, -0.2, 0.65, 0.4, -0.4, 0),
  sleepy: D(-0.1, -0.8, 0.35, -0.25, 0.6, 0.45, -0.3, 0),
  stretch: D(0.05, 0.35, 0.55, 0.05, 0.3, 0.7, 0.2, 0.3),
};

const PRESETS = {
  approach: D(0.7, 0.25, 0.82, 0.1, 0.35, 0.8, 0.65, 0.32),
  withdraw: D(-0.82, -0.3, -0.35, 0.35, 0.55, 0.7, -0.35, 0.05),
  deflect: D(-0.18, 0.35, 0.35, 0.62, 0.65, 0.55, 0.15, 0.58),
  freeze: D(0, 0.5, 0.2, -0.2, 0.82, 0.9, -0.1, 0.2),
  show: D(0.35, 0.7, 0.7, 0.88, 0.2, 0.9, 0.72, 0.55),
  settle: D(0.1, -0.7, 0.55, -0.1, 0.3, 0.45, -0.15, 0.15),
  silent: D(0, -0.8, 0.2, 0, 0.2, 0.25, -0.4, 0),
};

const WEIGHTS = {
  closeness: 0.24,
  energy: 0.16,
  warmth: 0.18,
  assertiveness: 0.1,
  vulnerability: 0.1,
  clarity: 0.07,
  initiative: 0.1,
  playfulness: 0.05,
};

const clamp = (value, min = -1, max = 1) => Math.max(min, Math.min(max, value));

function rounded(vector) {
  return Object.fromEntries(
    Object.entries(vector).map(([key, value]) => [key, +clamp(value).toFixed(3)])
  );
}

export function buildTargetVector({ intent, state, speech, relation, persona }) {
  const target = { ...(PRESETS[intent] ?? PRESETS.settle) };
  const dims = persona?.dims ?? {};
  const stage = relation?.stage ?? "stranger";
  const stageLift = { stranger: -0.1, familiar: 0.03, habit: 0.1, grown: 0.16 }[stage] ?? 0;

  target.closeness += (state.attachment - 0.3) * 0.28 + stageLift;
  target.warmth += (state.security - 0.6) * 0.35 + (dims.sociability ?? 0.4) * 0.12;
  target.assertiveness += (state.face - 0.5) * 0.35 + (dims.expressiveness ?? 0.5) * 0.15;
  target.vulnerability += (0.6 - state.security) * 0.28 + (state.face - 0.5) * 0.18;
  target.energy += (state.energy - 0.7) * 0.38 + ((dims.amplitude ?? 0.4) - 0.4) * 0.3;
  target.initiative += (state.attachment - 0.3) * 0.35 + (state.curiosity - 0.5) * 0.2;
  target.playfulness += (state.curiosity - 0.5) * 0.35 + (dims.activity ?? 0.5) * 0.12;

  const act = speech?.act;
  if (act === "示弱" || act === "自嘲") {
    target.warmth += 0.12;
    target.vulnerability -= 0.08;
    target.energy -= 0.08;
  } else if (act === "评价") {
    target.assertiveness += 0.08;
    target.playfulness += 0.06;
  } else if (act === "玩笑") {
    target.playfulness += 0.16;
    target.clarity -= 0.06;
  } else if (act === "拒绝" || act === "命令") {
    target.warmth -= 0.12;
    target.closeness -= 0.08;
  }

  return rounded(target);
}

export function rankActions({ intent, pool, state, lastAction = null, target }) {
  return pool
    .map((action) => {
      const vector = ACTION_VECTORS[action] ?? ACTION_VECTORS.idle;
      let distance = 0;
      for (const [key, weight] of Object.entries(WEIGHTS)) {
        distance += weight * (vector[key] - target[key]) ** 2;
      }
      let fit = Math.exp(-2.35 * distance);

      if (action === lastAction) fit *= 0.5;
      if (state.energy < 0.3 && vector.energy > 0.45) fit *= 0.55;
      if (state.energy > 0.75 && vector.energy < -0.55) fit *= 0.72;
      if (intent === "withdraw" && vector.warmth > 0.7) fit *= 0.62;
      if (intent === "show" && vector.assertiveness < 0) fit *= 0.62;

      return {
        action,
        fit: +fit.toFixed(4),
        vector,
      };
    })
    .sort((a, b) => b.fit - a.fit);
}

export function chooseSemanticAction({ intent, pool, state, lastAction, target, rng = Math.random }) {
  const ranked = rankActions({ intent, pool, state, lastAction, target });
  const top = ranked.slice(0, Math.min(3, ranked.length));
  const total = top.reduce((sum, item) => sum + item.fit, 0);
  let pick = rng() * total;
  let chosen = top[0];
  for (const item of top) {
    pick -= item.fit;
    if (pick <= 0) {
      chosen = item;
      break;
    }
  }
  return {
    action: chosen.action,
    target,
    candidates: ranked,
    fitFloor: +(ranked[0].fit - 0.12).toFixed(4),
  };
}

/** 模型提了动作也要过同一套语义门槛，不能只在意图池里就放行。 */
export function actionFitsDecision(decision, proposed) {
  if (!decision?.pool?.includes(proposed)) return false;
  if (!Array.isArray(decision.candidates)) return true;
  const candidate = decision.candidates.find((item) => item.action === proposed);
  return !!candidate && candidate.fit >= decision.fitFloor;
}
