/**
 * 长期变化：性格不是定死的参数，会被相处慢慢改。
 *
 * 规则刻意做得慢：每 N 次同类事件才动 0.02，且离初始值不超过 0.2。
 * 这样用户翻两个月的本子能看出"它跟刚认识时不一样了"，
 * 但不会因为一天聊了二十句就人格突变。
 */
import { getSetting, setSetting } from "./db.mjs";
import { getPersona, savePersona, updateRelation } from "./persona.mjs";
import { addTimeline } from "./timeline.mjs";

const MAX_DRIFT = 0.2;

export const RULES = {
  correction: {
    every: 3,
    dim: "sociability",
    delta: +0.02,
    title: "它开始愿意多问一句了",
    tag: "更愿意开口",
  },
  vulnerable: {
    every: 3,
    dim: "attachment",
    delta: +0.02,
    title: "它开始惦记你什么时候回来",
    tag: "更惦记你",
  },
  rejection: {
    every: 5,
    dim: "amplitude",
    delta: -0.02,
    title: "它把情绪收得更紧了",
    tag: "更收着",
  },
  praise: {
    every: 3,
    dim: "expressiveness",
    delta: +0.02,
    title: "它在你面前更敢显摆了",
    tag: "更敢显摆",
  },
};

export function counts() {
  const c = getSetting("growthCounts", {});
  return c && typeof c === "object" ? c : {};
}

/**
 * 记一次事件。达到阈值就改一点性格，并在关系记录里留一句话。
 * 返回这次发生的变化（没到阈值就返回 null）。
 */
export function noteEvent(kind) {
  const rule = RULES[kind];
  const persona = getPersona();
  if (!rule || !persona?.dims) return null;

  const c = counts();
  c[kind] = (c[kind] ?? 0) + 1;
  setSetting("growthCounts", c);

  // 每一次真实的相处都算一点"更了解"，但每次只加一点点
  updateRelation({ intimacyDelta: 0.5 });

  if (c[kind] % rule.every !== 0) return null;

  const baseline = getSetting("growthBaseline", null) ?? persona.dims;
  if (!getSetting("growthBaseline", null)) setSetting("growthBaseline", baseline);

  const dims = { ...persona.dims };
  const current = dims[rule.dim] ?? 0.5;
  const base = baseline[rule.dim] ?? 0.5;
  const next = Math.max(0.1, Math.min(0.9, current + rule.delta));
  if (Math.abs(next - base) > MAX_DRIFT || Math.abs(next - current) < 0.001) return null;

  dims[rule.dim] = +next.toFixed(3);
  savePersona({ dims, description: persona.description });
  addTimeline({
    kind: "growth",
    title: rule.title,
    detail: `${rule.tag}｜第 ${c[kind]} 次${kind === "correction" ? "被纠正" : "相处"}之后`,
  });
  updateRelation({ intimacyDelta: 2 });

  /* 留一个"下次提起"的钩子：变化不能只躺在页面里，要能在下一次相处时被说出来 */
  setSetting("pendingGrowth", { title: rule.title, tag: rule.tag, kind, at: Date.now() });

  return { kind, dim: rule.dim, from: current, to: dims[rule.dim], title: rule.title };
}

export function summary() {
  const c = counts();
  const baseline = getSetting("growthBaseline", null);
  const persona = getPersona();
  const deltas = {};
  if (baseline && persona?.dims) {
    for (const k of Object.keys(persona.dims)) {
      const d = +(persona.dims[k] - (baseline[k] ?? persona.dims[k])).toFixed(3);
      if (Math.abs(d) >= 0.01) deltas[k] = d;
    }
  }
  return { counts: c, baseline, deltas, pending: getSetting("pendingGrowth", null) };
}

export function resetGrowth() {
  setSetting("growthCounts", {});
  setSetting("growthBaseline", null);
  setSetting("pendingGrowth", null);
  return summary();
}
