/**
 * 动作组合层：主动作表达当前意图，副动作表达没被满足的次级需要。
 *
 * 组合不是固定连招，而是从动作向量里找“既有反差、又不矛盾”的第二拍。
 * 例：退开时关系期待还高，就 turn_away → peek → sit。
 */
import { ACTION_VECTORS, rankActions } from "./action-semantics.mjs";

const RULES = {
  approach: {
    chance: 0.9,
    accents: ["nuzzle", "lean_in", "expect", "welcome_back", "happy"],
    endings: ["happy", "sit"],
    twist: { closeness: 0.12, warmth: 0.12, playfulness: 0.18 },
    label: "靠近之后又忍不住多贴一下",
  },
  show: {
    chance: 0.94,
    accents: ["wave", "happy", "proud", "peek"],
    endings: ["happy", "sit"],
    twist: { vulnerability: 0.16, playfulness: 0.22 },
    label: "先得意，随后露一点不好意思",
  },
  deflect: {
    chance: 0.86,
    accents: ["peek", "shy", "fidget", "happy"],
    endings: ["sit", "happy"],
    twist: { warmth: 0.2, closeness: 0.16 },
    label: "嘴硬一下，又偷偷看回来",
  },
  freeze: {
    chance: 0.72,
    accents: ["peek", "lean_in", "shake"],
    endings: ["sit"],
    twist: { curiosity: 0.18, initiative: 0.16 },
    label: "先僵住，再试探着靠近",
  },
  settle: {
    chance: 0.58,
    accents: ["fidget", "stretch", "listening", "doze"],
    endings: ["sit", "idle"],
    twist: { playfulness: 0.18, energy: 0.12 },
    label: "安静待着，又给自己找点小动静",
  },
  withdraw: {
    chance: 0.46,
    accents: ["peek", "sulk", "turn_away"],
    endings: ["sit"],
    twist: { closeness: 0.45, warmth: 0.34 },
    label: "转过身，过一会儿又偷看",
  },
  silent: {
    chance: 0.24,
    accents: ["fidget", "stretch"],
    endings: ["idle", "sit"],
    twist: { energy: 0.16 },
    label: "不说话，只自己动了一下",
  },
};

const clamp = (value, min = -1, max = 1) => Math.max(min, Math.min(max, value));

function shiftedTarget(target, twist) {
  const next = { ...target };
  for (const [key, value] of Object.entries(twist ?? {})) {
    if (key in next) next[key] = clamp(next[key] + value);
  }
  return next;
}

function chooseWeighted(items, rng) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let point = rng() * total;
  for (const item of items) {
    point -= item.weight;
    if (point <= 0) return item;
  }
  return items[0];
}

export function planGestureCombo({
  primary,
  intent,
  target,
  lastAction,
  energy = 0.5,
  immersion = false,
  rng = Math.random,
}) {
  if (immersion || !target) return null;
  const rule = RULES[intent] ?? RULES.settle;
  const dynamicChance = clamp(
    rule.chance +
      (energy - 0.5) * 0.24 +
      target.playfulness * 0.08 +
      target.initiative * 0.06,
    0.08,
    0.98
  );
  if (rng() > dynamicChance) return null;

  const secondaryTarget = shiftedTarget(target, rule.twist);
  const accentRank = rankActions({
    intent,
    pool: rule.accents.filter((action) => action !== primary),
    state: { energy },
    lastAction,
    target: secondaryTarget,
  });
  if (!accentRank.length) return null;

  const shortlist = accentRank.slice(0, Math.min(3, accentRank.length));
  const accent = chooseWeighted(
    shortlist.map((item) => ({ ...item, weight: Math.max(0.01, item.fit) })),
    rng
  ).action;
  const endingPool = rule.endings.filter((action) => action !== accent);
  const ending = endingPool[Math.floor(rng() * endingPool.length)] ?? null;

  const steps = [{ action: accent, atMs: 1250 }];
  if (ending) steps.push({ action: ending, atMs: 2550 });

  const contrast =
    Math.abs((ACTION_VECTORS[accent]?.closeness ?? 0) - target.closeness) +
    Math.abs((ACTION_VECTORS[accent]?.warmth ?? 0) - target.warmth);

  return {
    label: rule.label,
    chance: +dynamicChance.toFixed(3),
    contrast: +contrast.toFixed(3),
    secondaryTarget,
    accentCandidates: shortlist.map((item) => ({
      action: item.action,
      fit: item.fit,
    })),
    steps,
  };
}

export function scheduleCombo(combo, run, { skipAction = null, baseDelay = 0 } = {}) {
  if (!combo?.steps?.length) return [];
  return combo.steps
    .filter((step) => step.action !== skipAction)
    .map((step) => {
      const timer = setTimeout(() => run(step.action, step), Math.max(0, baseDelay + step.atMs));
      return { action: step.action, timer };
    });
}
