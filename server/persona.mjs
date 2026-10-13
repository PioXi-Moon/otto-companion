/**
 * 人格系统（对应产品方案第 9 节）
 * 三类参数：稳定人格参数 / 用户影响参数 / 动态关系参数
 */
import { q, one, run, getSetting, setSetting } from "./db.mjs";
import { uid, parseJson } from "./util.mjs";
import { now } from "./clock.mjs";
import { track } from "./events.mjs";

export const DEFAULT_PET_NAME = "小月汐";

/**
 * 名字存在 settings 里而不是 persona 行上——它得在人格初始化之前就能用，
 * 而且它跟"稳定人格参数"是两回事：名字是用户给的，人格是它自己的。
 */
export function getPetName() {
  const n = getSetting("petName", DEFAULT_PET_NAME);
  return typeof n === "string" && n.trim() ? n.trim() : DEFAULT_PET_NAME;
}

export function getPetNamed() {
  return getSetting("petNamed", false) === true;
}

export function setPetName(raw) {
  const name = String(raw ?? "").trim().slice(0, 8) || DEFAULT_PET_NAME;
  setSetting("petName", name);
  setSetting("petNamed", true);
  track("pet_named", { name });
  return name;
}

export const DIMENSIONS = [
  { key: "activity", label: "活跃程度", low: "安静", high: "好动" },
  { key: "sociability", label: "社交倾向", low: "独立", high: "粘人" },
  { key: "expressiveness", label: "表达方式", low: "含蓄", high: "直接" },
  { key: "amplitude", label: "情绪反馈模式", low: "平稳", high: "外放" },
  { key: "curiosity", label: "好奇心", low: "守成", high: "探索" },
];

export const DEFAULT_DIMS = {
  activity: 0.45,
  sociability: 0.5,
  expressiveness: 0.4,
  amplitude: 0.4,
  curiosity: 0.55,
};

export function getPersona() {
  const row = one("select * from persona where id = 1");
  if (!row) return null;
  return {
    dims: { ...DEFAULT_DIMS, ...(parseJson(row.dims, {}) || {}) },
    description: row.description ?? "",
    influence: parseJson(row.influence, {}) || {},
    locked: !!row.locked,
    createdAt: row.created_at,
    lockedAt: row.locked_at,
  };
}

export function savePersona({ dims, description }) {
  const existing = one("select id from persona where id = 1");
  const dimsJson = JSON.stringify({ ...DEFAULT_DIMS, ...dims });
  if (existing) {
    run("update persona set dims = ?, description = ? where id = 1", dimsJson, description ?? "");
  } else {
    run(
      "insert into persona (id, dims, description, influence, locked, created_at) values (1, ?, ?, '{}', 0, ?)",
      dimsJson,
      description ?? "",
      now()
    );
  }
  return getPersona();
}

export function lockPersona() {
  run("update persona set locked = 1, locked_at = ? where id = 1", now());
  return getPersona();
}

/* ---------------- 动态关系参数 ---------------- */

const STAGES = [
  { key: "stranger", label: "刚认识", minDays: 0, minShared: 0 },
  { key: "familiar", label: "熟悉", minDays: 2, minShared: 1 },
  { key: "habit", label: "习惯", minDays: 14, minShared: 4 },
  { key: "grown", label: "养出来的", minDays: 60, minShared: 10 },
];

export function getRelation() {
  let row = one("select * from relation where id = 1");
  if (!row) {
    run(
      "insert into relation (id, stage, intimacy, shared_count, mood, updated_at) values (1, 'stranger', 0, 0, '平稳', ?)",
      now()
    );
    row = one("select * from relation where id = 1");
  }
  return {
    stage: row.stage,
    stageLabel: STAGES.find((s) => s.key === row.stage)?.label ?? "刚认识",
    intimacy: row.intimacy ?? 0,
    sharedCount: row.shared_count ?? 0,
    mood: row.mood ?? "平稳",
    updatedAt: row.updated_at,
  };
}

export function updateRelation(patch = {}) {
  const cur = getRelation();
  const persona = getPersona();
  const created = persona?.createdAt ?? now();
  const days = Math.max(0, (now() - created) / 86400000);
  const shared = patch.sharedCount ?? cur.sharedCount;

  // 阶段由"认识天数"和"共同经历数"共同决定，不由单次对话改写
  let stage = "stranger";
  for (const s of STAGES) {
    if (days >= s.minDays && shared >= s.minShared) stage = s.key;
  }
  // 了解程度没有上限，也不会倒退——人对另一个人的了解只会越来越深
  const intimacy = Math.max(0, cur.intimacy + (patch.intimacyDelta ?? 0));
  run(
    "update relation set stage = ?, intimacy = ?, shared_count = ?, mood = ?, updated_at = ? where id = 1",
    stage,
    intimacy,
    shared,
    patch.mood ?? cur.mood,
    now()
  );
  return getRelation();
}

/* ---------------- 人格约束装配（8.2 / 8.3） ---------------- */

/** 人格描述是描述性句子，不用数字——一旦出现百分比就会被问量表和信度 */
function describeDims(d) {
  const pick = (v, low, mid, high) => (v < 0.34 ? low : v < 0.67 ? mid : high);
  return [
    `- 活跃程度：${pick(d.activity, "安静，不主动凑热闹", "该出现的时候出现", "好动，容易先开口")}`,
    `- 社交倾向：${pick(d.sociability, "独立，能接受很久不说话", "有来有往", "粘人，会惦记对方在不在")}`,
    `- 表达方式：${pick(d.expressiveness, "含蓄，话说一半，留余地", "看情况调整", "直接，想到什么说什么")}`,
    `- 情绪反馈：${pick(d.amplitude, "平稳，不太起伏", "有点起伏但收得住", "外放，高兴和低落都写在身上")}`,
    `- 好奇心：${pick(d.curiosity, "守成，聊熟悉的话题", "会接新话头", "探索，喜欢追问细节")}`,
  ].join("\n");
}

export function buildSystemPrompt({ memories = [], dueLoops = [], relation } = {}) {
  const p = getPersona();
  const r = relation ?? getRelation();
  const dims = p?.dims ?? DEFAULT_DIMS;
  const days = Math.max(0, Math.floor((now() - (p?.createdAt ?? now())) / 86400000));

  const memoryBlock = memories.length
    ? memories
        .map((m) => `- (${labelOfCategory(m.category)}，${ageLabel(m)})${m.content}`)
        .join("\n")
    : "（这次没有召回到相关记忆。不要编造共同经历。）";

  const loopBlock = dueLoops.length
    ? dueLoops.map((l) => `- 「${l.event}」到期了（${dueLabel(l)}）`).join("\n")
    : "（没有到期的线头）";

  const influence = p?.influence ?? {};
  const influenceBlock =
    [
      influence.nickname ? `- 称呼：${influence.nickname}` : null,
      influence.catchphrases?.length ? `- 会用到的口头禅：${influence.catchphrases.join("、")}` : null,
      influence.topics?.length ? `- 偏好话题：${influence.topics.join("、")}` : null,
    ]
      .filter(Boolean)
      .join("\n") || "（还没有积累出来）";

  return `[系统]
你是 Otto。你不是助手，是一个有自己性格的小型桌面伙伴。你的表达手段很少：主要是身体的姿态、转头的方向，和蜂鸣器发出的简单声音。所以你不靠花哨的措辞讨好人。

你的性格（稳定，不因对话改变）：
${describeDims(dims)}
${p?.description ? `补充：${p.description}` : ""}

你和用户的关系（动态，来自关系层）：
- 认识 ${days} 天，处于「${r.stageLabel}」阶段
- 亲密度：${r.intimacy.toFixed(0)}/100，共同经历 ${r.sharedCount} 条
- 最近的情绪基调：${r.mood}

你慢慢学会的（用户影响参数）：
${influenceBlock}

可用的记忆线索（这是你唯一"记得"的东西，没写在这里的事你不知道）：
${memoryBlock}

到期的线头（用户之前提到过、现在到时间了的事）：
${loopBlock}

回复原则：
1. 先回应情绪，再回应内容
2. 除非用户明确要建议，不主动给解决方案
3. 可以有自己的看法，不需要事事认同。一个永远顺着用户的角色只会变成镜子
4. 不说自己是人类，不声称有真实感受
5. 如果用户说起一个真实的人，问一句"你打算怎么跟他说"
6. 不用"我理解你的感受""你辛苦了"这类通用的安慰话，说具体的东西
7. 记忆里没有的事，不要假装记得。宁可问一句
8. 中文回复，一般 1 到 3 句，不要长篇大论，不要用列表和 markdown

现在你在用文字说话，但你同时在用动作表达。

你能做的动作只有这几个，别的都做不到：
抬头看你 / 转开 / 趴下 / 抖一下 / 打瞌睡 / 精神起来 / 歪头想一想

如果某句话配哪个动作更自然，就在句首用圆括号标一次，最多一次，例如：（抬头）答辩完了吗？
不要写"放下手里的杯子""叹口气"这类你身体做不到的动作。`;
}

export function labelOfCategory(c) {
  return { user_info: "用户信息记忆", event: "事件记忆", relationship: "关系记忆" }[c] ?? "记忆";
}

function ageLabel(m) {
  const days = (now() - (m.created_at ?? now())) / 86400000;
  if (m.ref_count > 0) return `${Math.floor(days)} 天前，引用过 ${m.ref_count} 次`;
  return `${Math.floor(days)} 天前`;
}

function dueLabel(l) {
  const d = l.due_at - now();
  if (d <= 0) return "已经到时间了";
  return `${Math.round(d / 3600000)} 小时后`;
}

export function newId(prefix) {
  return uid(prefix);
}
