/**
 * 人格初始化（9.4）：用一段对话完成，不用问卷。
 * 问的是"你喜欢被怎么对待"，不是"你想要什么功能"。
 */
import { getSetting, setSetting } from "./db.mjs";
import { chatJson } from "./llm.mjs";
import { DEFAULT_DIMS, savePersona, lockPersona, getPersona, getPetName } from "./persona.mjs";
import { clamp, log } from "./util.mjs";
import { addTimeline } from "./timeline.mjs";
import { track } from "./events.mjs";

export function initQuestions() {
  return [
    `先说明一下：我是${getPetName()}，不是人，我不会假装自己是。\n\n接下来这几句不是给你填表，是我用来认识你的。\n\n如果有一天你心情不太好，又不想解释原因，你希望我怎么对你？`,
    "如果我说话太软你可能会烦，太直接又可能扎人。你更希望我往哪边偏一点？",
    "你会希望我有自己的看法吗，还是我说什么都顺着你比较好？",
    "最后一个。你想让我安静点、想起来了再来找你，还是希望我常在你旁边晃一晃？",
  ];
}

export function initState() {
  return getSetting("init", { answered: 0, answers: [], done: false, started: false });
}

export function startInit() {
  const st = { answered: 0, answers: [], done: false, started: true };
  setSetting("init", st);
  track("persona_init_started", {});
  return { state: st, question: initQuestions()[0] };
}

/** 记录一条回答，返回下一句或 done */
export function pushAnswer(text) {
  const st = initState();
  st.answers = [...(st.answers ?? []), text];
  st.answered = (st.answered ?? 0) + 1;
  const qs = initQuestions();
  const done = st.answered >= qs.length;
  setSetting("init", st);
  return { state: st, done, question: done ? null : qs[st.answered] };
}

const INFER_SYSTEM = `你是人格推断模块。根据用户和 Otto 的初始化对话，推断 5 个维度上的取值，并写一句角色描述。

维度（每条轴 0 到 1，0 是靠"低"那一端，1 是靠"高"那一端）：
- activity 活跃程度：0 安静 / 1 好动
- sociability 社交倾向：0 独立 / 1 粘人
- expressiveness 表达方式：0 含蓄 / 1 直接
- amplitude 情绪反馈模式：0 平稳 / 1 外放
- curiosity 好奇心：0 守成 / 1 探索

注意：这是从用户"希望被怎么对待"里推断这个人格应该长什么样，不是给用户打分。
如果某一项用户没说清楚，取 0.5 附近，不要编造极端值。

只输出 JSON：{"activity":0.0,"sociability":0.0,"expressiveness":0.0,"amplitude":0.0,"curiosity":0.0,"description":"一句话角色描述，30 字以内"} `;

export async function inferPersona(answers) {
  let dims = { ...DEFAULT_DIMS };
  let description = "";
  try {
    const out = await chatJson({
      messages: [
        { role: "system", content: INFER_SYSTEM },
        { role: "user", content: `对话内容：\n${answers.map((a, i) => `${i + 1}. ${a}`).join("\n")}` },
      ],
    });
    for (const k of Object.keys(DEFAULT_DIMS)) {
      if (typeof out[k] === "number") dims[k] = clamp(out[k], 0, 1);
    }
    description = String(out.description || "").slice(0, 60);
  } catch (e) {
    log("人格推断失败，用默认值：", e.message);
  }
  savePersona({ dims, description });
  const st = initState();
  st.infered = true;
  setSetting("init", st);
  return getPersona();
}

export function adjustDimension(key, value) {
  const p = getPersona();
  if (!p) return null;
  const adjusted = new Set(getSetting("initAdjusted", []));
  if (adjusted.has(key)) return { error: "每个维度只能微调一次" };
  p.dims[key] = clamp(value, 0, 1);
  savePersona({ dims: p.dims, description: p.description });
  adjusted.add(key);
  setSetting("initAdjusted", [...adjusted]);
  return { persona: getPersona(), adjusted: [...adjusted] };
}

export function finishInit() {
  lockPersona();
  const st = initState();
  st.done = true;
  setSetting("init", st);
  track("persona_init_locked", {});
  addTimeline({
    kind: "milestone",
    title: "你们认识了",
    detail: "人格初始化完成，第一条关系记录",
  });
  return getPersona();
}

export function resetPersona() {
  setSetting("init", { step: 0, answers: [], done: false });
  setSetting("initAdjusted", []);
  return true;
}
