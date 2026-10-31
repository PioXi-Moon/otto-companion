/**
 * 碎碎念。
 *
 * 它是日常状态，不是生成时的填充——我一开始想把它挂在"生成慢的时候"，
 * 那样它只是个高级一点的加载动画。放进日常状态，它才落在 7.2 那句
 * "它不出声的时候在做什么，比它回答得好不好更值得设计"上。
 *
 * 和主动发起的区别：碎碎念没有问号、不要求回应、不回应什么也不会发生。
 * 所以它可以高频，主动发起必须低频。
 *
 * 两条硬规则：
 * 一、只基于不会错的事实（时间、间隔、焦点、线头、阶段），不做情绪推断。
 *     碎碎念最容易出的事是说了一句"你怎么又熬夜了"而用户其实刚起床。
 * 二、小脾气只能表达它自己的状态，不能给用户施加义务。
 *     "我也没想你"是自嘲，"你都不来看我"是问责。
 */
import { one, getSetting, setSetting } from "./db.mjs";
import { now } from "./clock.mjs";
import { getPersona, getRelation } from "./persona.mjs";
import { listLoops } from "./openloop.mjs";
import { track } from "./events.mjs";
import { immersionEnabled } from "./immersion.mjs";

/* ---------------- 语料库 ---------------- */
/* 先写成语料库，不要每条都调模型：频率天生比对话高，成本会失控；
   质量可控，人格不会跑偏；而且它可以直接塞进基础提示词当风格示范。 */

const STAGE_ORDER = ["stranger", "familiar", "habit", "grown"];
const atLeast = (stage, min) => STAGE_ORDER.indexOf(stage) >= STAGE_ORDER.indexOf(min);

export const CORPUS = {
  // 不依赖任何东西，最安全，可以最常出现
  self: {
    minStage: "stranger",
    lines: [
      { t: "（打了个哈欠）" },
      { t: "有点困。", k: "(￣ω￣)" },
      { t: "（翻了个身）" },
      { t: "……没事，就是有点无聊。" },
      { t: "（趴着不动）" },
      { t: "刚才好像睡着了。", k: "(´-ω-`)" },
      { t: "（抖了抖）" },
      { t: "这个姿势有点不舒服。" },
    ],
  },
  // 只用时间、间隔、焦点这类事实
  presence: {
    minStage: "familiar",
    lines: [
      { t: "你回来了。" },
      { t: "这个点了。", k: "(・_・)" },
      { t: "刚才你不在，我睡了会儿。" },
      { t: "（抬头看了一眼，又趴下）" },
      { t: "天亮了。" },
      { t: "外面安静了。" },
      { t: "（往你那边挪了一点）" },
    ],
  },
  // 偶尔需要他一下，是它唯一会主动要东西的时候
  beg: {
    minStage: "habit",
    lines: [
      { t: "有吃的吗。", k: "(๑•́ ₃ •̀๑)" },
      { t: "（盯着你的桌子）" },
      { t: "就一口。" },
      { t: "我有点饿。" },
      { t: "（凑过来）" },
      { t: "你手边那个是什么。" },
    ],
  },
  // 傲娇的落点。只能表达它自己的状态，不能问责
  grumble: {
    minStage: "habit",
    lines: [
      { t: "{days} 天没来了。", k: "(￣ヘ￣)" },
      { t: "我也没想你。" },
      { t: "（转开）" },
      { t: "随便。" },
      { t: "哦。" },
      { t: "行吧。" },
    ],
  },
  // 风险最高，必须有具体的未闭合线头
  remember: {
    minStage: "familiar",
    lines: [
      { t: "今天好像是那天。", k: "(・_・?)" },
      { t: "记着这事呢。" },
      { t: "（突然抬头）" },
      { t: "{event}……应该是今天吧。" },
      { t: "好像快到了。" },
    ],
  },
};

/* ---------------- 状态 ---------------- */

export function murmurState() {
  const t = now();
  const persona = getPersona();
  const relation = getRelation();
  const hour = new Date(t).getHours();
  const lastMsg = one("select max(created_at) as ts from message")?.ts ?? null;
  const minutesSinceLast = lastMsg == null ? null : Math.floor((t - lastMsg) / 60000);
  const dayStart = new Date(t).setHours(0, 0, 0, 0);
  const openedToday =
    one("select count(*) as c from session where started_at >= ?", dayStart)?.c ?? 0;
  const loops = listLoops({ status: "open" });
  const dueSoon = loops.find((l) => l.due_at > t && l.due_at - t < 24 * 3600000) ?? null;
  const overdue = loops.find((l) => l.due_at <= t) ?? null;
  const lastFocus = getSetting("lastFocusedAt", null);

  return {
    t,
    hour,
    night: hour >= 1 && hour < 6,
    persona,
    relation,
    stage: relation.stage,
    minutesSinceLast,
    openedToday,
    dueSoon,
    overdue,
    justReturned: lastFocus != null && t - lastFocus < 2 * 60000,
    lastFocus,
  };
}

/** 频率预算：挂在活跃程度和社交倾向（9.6 说活跃程度管着主动发起的频率上限和 idle 强度） */
function dailyCap(persona) {
  const a = persona?.dims?.activity ?? 0.45;
  const s = persona?.dims?.sociability ?? 0.5;
  return Math.max(2, Math.round(2 + 6 * (0.5 * a + 0.5 * s)));
}

function murmurBookkeeping() {
  const day = new Date(now()).toDateString();
  let st = getSetting("murmur", null);
  if (!st || typeof st !== "object") st = { day: null, count: 0, lastAt: 0, used: [] };
  if (!Array.isArray(st.used)) st.used = [];
  if (st.day !== day) {
    st.day = day;
    st.count = 0;
  }
  return st;
}

/** 挑一条，返回 { category, text, key } 或 null */
export function pickMurmur() {
  // 沉浸模式不是"降低碎碎念频率"，而是完全退出自由表达。
  if (immersionEnabled()) return null;
  const s = murmurState();
  const persona = s.persona;
  if (!persona?.locked) return null;
  // 用户让它安静一会儿，就真的安静
  const quietUntil = getSetting("quietUntil", null);
  if (quietUntil && s.t < quietUntil) return null;

  const book = murmurBookkeeping();
  const cap = dailyCap(persona);
  if (book.count >= cap) return null;

  const minGapMs = (24 / (cap + 1)) * 3600000;
  if (book.lastAt && s.t - book.lastAt < minGapMs) return null;

  // 刚聊完没什么好嘟囔的
  if (s.minutesSinceLast != null && s.minutesSinceLast < 8) return null;

  // 已经有到期的线头时不嘟囔——那件事归主动发起，不能先说一遍再过一会儿正式问一遍
  if (s.overdue) return null;

  // 选类别
  let category = "self";
  if (s.justReturned && s.minutesSinceLast != null && s.minutesSinceLast > 180 && atLeast(s.stage, "familiar")) {
    category = "presence"; // 刚从不在变成在，先说这句
  } else if (s.dueSoon && atLeast(s.stage, "familiar") && Math.random() < 0.5) {
    category = "remember";
  } else if (s.night) {
    category = "self"; // 深夜只留最轻的那类
  } else if (atLeast(s.stage, "habit") && Math.random() < 0.35) {
    category = Math.random() < 0.5 ? "beg" : "grumble";
  }

  const pool = CORPUS[category];
  if (!pool || !atLeast(s.stage, pool.minStage)) category = "self";

  const lines = CORPUS[category].lines.filter((l) => !book.used.includes(l.t));
  const usable = lines.length ? lines : CORPUS[category].lines;
  const line = usable[Math.floor(Math.random() * usable.length)];

  const days = s.minutesSinceLast == null ? 0 : Math.floor(s.minutesSinceLast / 1440);
  const text = line.t
    .replace("{days}", String(Math.max(2, days)))
    .replace("{event}", s.overdue?.event ?? s.dueSoon?.event ?? "那件事");

  return { category, text, kaomoji: line.k ?? null, template: line.t };
}

export function commitMurmur(picked) {
  const st = murmurBookkeeping();
  st.count += 1;
  st.lastAt = now();
  st.used = [picked.template, ...st.used].slice(0, 24);
  setSetting("murmur", st);
  track("murmur_shown", { category: picked.category });
}

export function markFocused() {
  setSetting("lastFocusedAt", now());
}

export function murmurStats() {
  const st = murmurBookkeeping();
  const cap = dailyCap(getPersona());
  const nextEligibleAt = st.lastAt ? st.lastAt + (24 / (cap + 1)) * 3600000 : null;
  return { count: st.count, cap, lastAt: st.lastAt, nextEligibleAt };
}

/** 由定时器调用：该说就说一句，通过 SSE 推给桌宠和面板 */
export function murmurTick(broadcast) {
  const picked = pickMurmur();
  if (!picked) return null;
  commitMurmur(picked);
  const emotion = picked.category === "remember" ? "alert" : picked.category === "grumble" ? "sulk" : picked.category === "beg" ? "nuzzle" : "idle";
  broadcast("murmur", {
    text: picked.text,
    kaomoji: picked.kaomoji,
    category: picked.category,
    action: emotion,
  });
  return picked;
}
