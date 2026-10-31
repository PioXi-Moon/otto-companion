/**
 * 一比特互动：点一下、摸一下、把它拎起来。
 *
 * 为什么要有这个：打字对话要求用户先组织出一句话，而这个产品要解决的
 * 恰恰是"没什么值得专门说的"那些时刻。摸一下只要 1 bit，却能换到一段
 * 有内容的状态变化——这才是养宠物真实的交互密度。
 *
 * 三条规则：
 * 一、反应跟关系阶段走。刚认识它会躲，熟了才凑过来。这是"它变了"
 *     最直接的证据，比任何一页成长记录都有说服力。
 * 二、摸多了会烦。它是活的，不是按钮。
 * 三、不进对话流。你摸它一下，不等于你说了什么。
 */
import { getSetting, setSetting } from "./db.mjs";
import { now } from "./clock.mjs";
import { getRelation, getPersona, updateRelation } from "./persona.mjs";
import { track } from "./events.mjs";
import { immersionEnabled } from "./immersion.mjs";

const STAGE_ORDER = ["stranger", "familiar", "habit", "grown"];

/* 每条：t 说什么（可省）、k 颜文字（可省）、a 身体做什么。
   只做动作不出声的条目是刻意的——疏离感有一半来自"它不一定理你"。 */
const BY_STAGE = {
  stranger: [
    { t: "（看了你一眼）", a: "lean_in" },
    { t: "干嘛。", a: "turn_away" },
    { a: "turn_away" },
    { t: "……别戳。", a: "sulk", k: "(￣ヘ￣)" },
    { t: "嗯。然后呢。", a: "lean_in" },
  ],
  familiar: [
    { t: "嗯。", a: "lean_in" },
    { a: "shake" },
    { t: "干嘛。", a: "lean_in" },
    { t: "摸够了没。", a: "sulk", k: "(￣3￣)" },
    { t: "……知道了。", a: "droop" },
  ],
  habit: [
    { t: "……再摸会儿。", a: "nuzzle" },
    { t: "（把头低下来）", a: "droop" },
    { t: "就一会儿。", a: "nuzzle", k: "(´-ω-`)" },
    { t: "哼。", a: "tsundere" },
    { t: "你手挺凉。", a: "lean_in" },
  ],
  grown: [
    { t: "……嗯。", a: "expect" },
    { t: "（往你手边挪了挪）", a: "nuzzle" },
    { t: "别停。", a: "nuzzle", k: "(๑•́ ₃ •̀๑)" },
    { t: "这算你欠我的。", a: "proud" },
    { t: "今天算你乖。", a: "proud", k: "(￣ω￣)" },
  ],
};

/* 摸得太密，它会烦 */
const ANNOYED = [
  { t: "够了。", a: "sulk", k: "(￣ヘ￣)" },
  { t: "手拿开。", a: "sulk" },
  { t: "烦。", a: "turn_away" },
];

/* 从打盹里被戳醒 */
const WOKEN = [
  { t: "……！", a: "alert" },
  { t: "谁。", a: "alert" },
  { a: "alert" },
];

/* 被拎起来 */
const LIFTED = [
  { t: "……放我下来。", a: "sulk" },
  { t: "喂。", a: "sulk" },
  { t: "（在半空里蹬腿）", a: "sulk" },
];

/* 被放下 */
const DROPPED = [
  { t: "（落地，抖了抖）", a: "shake" },
  { t: "颠得我头晕。", a: "guilty", k: "(´･_･`)" },
  { a: "happy" },
];

const pick = (list) => list[Math.floor(Math.random() * list.length)];

/** 每秒摸一下算连击；8 秒窗口外的丢掉 */
function registerTouch() {
  const t = now();
  const st = getSetting("touchState", null) ?? {};
  st.taps = (Array.isArray(st.taps) ? st.taps : []).filter((x) => t - x < 8000);
  st.taps.push(t);

  // 摸也给亲密度，但有日上限——9.3 说用户影响参数"速度有上限"
  const day = new Date(t).toDateString();
  if (st.day !== day) {
    st.day = day;
    st.gained = 0;
  }
  let delta = 0;
  if ((st.gained ?? 0) < 2) {
    delta = 0.15;
    st.gained = (st.gained ?? 0) + delta;
  }
  st.taps = st.taps.slice(-12);
  setSetting("touchState", st);
  return { streak: st.taps.length, intimacyDelta: delta };
}

export function touchResponse({ kind = "tap", sleeping = false } = {}) {
  const relation = getRelation();
  const stage = STAGE_ORDER.includes(relation.stage) ? relation.stage : "stranger";
  const { streak, intimacyDelta } = registerTouch();

  let base;
  let flavor;
  if (immersionEnabled()) {
    base = { t: "（安静地看了你一眼）", a: "immersed" };
    flavor = "immersed";
  } else if (kind === "drag") {
    base = pick(LIFTED);
    flavor = "lifted";
  } else if (kind === "drop") {
    base = pick(DROPPED);
    flavor = "dropped";
  } else if (sleeping) {
    base = pick(WOKEN);
    flavor = "woken";
  } else if (streak >= 4) {
    base = pick(ANNOYED);
    flavor = "annoyed";
  } else {
    base = pick(BY_STAGE[stage]);
    flavor = stage;
  }

  if (intimacyDelta > 0 && kind === "tap") updateRelation({ intimacyDelta });

  track("pet_touched", { kind, flavor, stage, streak, sleeping });

  return {
    kind,
    flavor,
    text: base.t ?? null,
    kaomoji: base.k ?? null,
    action: base.a ?? "lean_in",
    streak,
  };
}
