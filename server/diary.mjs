/**
 * 日记：记忆回看的呈现形式。
 * 底层还是同一条记忆（三类、标来源、可改可删），只是按"天"重新组织，
 * 并且每天多一段 Otto 自己写的话——它记的不是数据，是这一天。
 */
import { q, one, run, getSetting, setSetting } from "./db.mjs";
import { now } from "./clock.mjs";
import { chatStream } from "./llm.mjs";
import { CATEGORIES, toMemoryDto } from "./memory.mjs";
import { diaryLayer, DIARY_EXAMPLE } from "./prompt.mjs";
import { PROPS_BLOCK, cleanProps, LAYOUTS } from "./props.mjs";
import { lintPage } from "./pagelint.mjs";
import { getRelation } from "./persona.mjs";
import { getPersona } from "./persona.mjs";
import { getPetName } from "./persona.mjs";
import { addTimeline } from "./timeline.mjs";
import { track } from "./events.mjs";
import { log, parseJson, extractJson } from "./util.mjs";

const MSG_PER_DAY = 2; // 一天至少一来一回才算"有过相处"

export function dayKey(ts = now()) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function dayRange(day) {
  const [y, m, d] = day.split("-").map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  return [start, start + 86400000];
}

export function dayLabel(day) {
  const [start] = dayRange(day);
  const [todayStart] = dayRange(dayKey());
  const diff = Math.round((todayStart - start) / 86400000);
  if (diff === 0) return "今天";
  if (diff === 1) return "昨天";
  if (diff === 2) return "前天";
  const d = new Date(start);
  return `${d.getMonth() + 1}月${d.getDate()}日 · 周${"日一二三四五六"[d.getDay()]}`;
}

export function dayMemories(day) {
  const [s, e] = dayRange(day);
  return q(
    "select * from memory where created_at >= ? and created_at < ? order by created_at asc",
    s,
    e
  );
}

export function dayMessages(day) {
  const [s, e] = dayRange(day);
  return q(
    "select * from message where created_at >= ? and created_at < ? order by created_at asc",
    s,
    e
  );
}

/** 有记忆、或者有过一来一回的日子，都算一页 */
export function daysWithContent(limit = 90) {
  const rows = q("select created_at from memory order by created_at desc");
  const days = new Set(rows.map((r) => dayKey(r.created_at)));
  for (const d of q("select created_at from message order by created_at desc limit 600")) {
    const k = dayKey(d.created_at);
    if (dayMessages(k).length >= MSG_PER_DAY) days.add(k);
  }
  return [...days].sort().reverse().slice(0, limit);
}

/* 校验在 pagelint.mjs：规则要能被单独测，所以不绑在这条生成链路上 */

/** 往前找最近一天：版式、印章、道具都不能跟昨天撞 */
function previousPage(day) {
  const row = one(
    "select layout, seal, props from diary where day < ? and layout is not null order by day desc limit 1",
    day
  );
  return {
    layout: row?.layout ?? null,
    seal: row?.seal ?? null,
    props: parseJson(row?.props, []) ?? [],
  };
}

/**
 * 一页的 JSON。
 *
 * 先按正常 JSON 解。解不出来多半是因为它在正文里用了英文双引号
 * （“他说"没事"”——这一下就把 JSON 弄坏了），这是模型最常犯、也最难堵的错。
 * 提示词里劝了，这里再兜一层：按字段名字一个一个抠。
 * 抠的时候拿"后面跟着 , 或 } 的那个引号"当结尾，所以正文里夹着的引号不会截断取值。
 */
function parsePageJson(text) {
  const direct = extractJson(text);
  if (direct && typeof direct === "object" && !Array.isArray(direct)) return direct;
  const s = String(text ?? "");
  const field = (key) => {
    const m = s.match(new RegExp(`"${key}"\\s*:\\s*"([\\s\\S]*?)"\\s*(?=,\\s*"|\\}\\s*$)`, "i"));
    return m ? m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').trim() : null;
  };
  const out = {};
  for (const k of ["seal", "layout", "diary", "card", "foot"]) {
    const v = field(k);
    if (v !== null) out[k] = v;
  }
  const propsRaw = s.match(/"props"\s*:\s*(\[[\s\S]*?\])/);
  if (propsRaw) out.props = parseJson(propsRaw[1], []);
  // 正文都没抠出来，说明这次真的不是这一页
  if (!out.diary) return null;
  log(`这一页的 JSON 坏了，按字段抠了出来（${Object.keys(out).join("/")}）`);
  return out;
}

/**
 * 出一页：先写，再查，查不过就把它自己的毛病念回去让它重写一次。
 * 第二次还不过就留着——页面不能因为"文风不合格"就空着，那是另一种更糟的错。
 */
async function writePage(day, memories, messages) {
  const last = previousPage(day);
  let feedback = "";
  let page = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    page = await writeDiary(day, memories, messages, { last, feedback });
    if (page.fallback) return page;

    // 不是文风的问题，是这次根本没输出成 JSON（多半被截断了）
    if (page.parseFailed) {
      log(`第 ${attempt} 次输出的不是 JSON，重来（${day}）`);
      feedback = "\n\n上一次的输出不是一个完整的 JSON。重新写，**只输出那一个 JSON**，" +
        "不要任何解释、不要代码块、不要前后废话。";
      continue;
    }

    const problems = lintPage(page.raw, {
      lastSeal: last.seal,
      lastLayout: last.layout,
      lastProps: (last.props ?? []).map((p) => p?.id).filter(Boolean),
    });
    if (!problems.length) {
      if (attempt > 1) log(`重写之后过关了（${day}）`);
      return page;
    }
    if (attempt === 2) {
      log(`这一页两次都没过校验，先留着（${day}）：`, problems.join("；"));
      return page;
    }
    log(`这一页不合格，退回去重写（${day}）：`, problems.join("；"));
    feedback = `\n\n上一版被打回来了，毛病是：${problems.join("；")}。改掉这些，其余照写，重新出一份完整的 JSON。`;
  }
  // 两次都没出来正文：宁可给它一段兜底的话，也不要一个空白的页面
  if (!String(page?.content ?? "").trim()) {
    page.content = memories.length
      ? `今天记下的就这些：${memories.map((m) => m.content).join("；")}。\n\n写不出来了，先这样。`
      : "今天说了几句，没什么要记的。\n\n……也不是完全没有，就是懒得写。";
    page.fallback = true;
  }
  return page;
}

async function writeDiary(day, memories, messages, { last = {}, feedback = "" } = {}) {
  const rel = getRelation();
  const persona = getPersona();
  const name = getPetName();
  const days = Math.max(0, Math.floor((now() - (persona?.createdAt ?? now())) / 86400000));
  const [dayStart] = dayRange(day);
  const weekday = "日一二三四五六"[new Date(dayStart).getDay()];
  const transcript = messages.length
    ? messages.map((m) => `${m.role === "user" ? "他" : name}：${m.content}`).join("\n")
    : "（这一天没有对话）";
  const memList = memories.length
    ? memories
        .map(
          (m) =>
            `- [${CATEGORIES[m.category] ?? m.category}] ${m.content}${m.emotion ? `（当时${m.emotion}）` : ""}`
        )
        .join("\n")
    : "（这一天没有记下什么）";

  /* 这一天它自己的"心理事件"：误读和纠正。日记最值钱的材料之一。 */
  const [dayStartAt, dayEndAt] = dayRange(day);
  const ontoEvents = q(
    `select name, params from event_log
      where ts >= ? and ts < ? and name in ('ontology_misread','ontology_corrected')
      order by ts`,
    dayStartAt,
    dayEndAt
  );
  const ontoList = ontoEvents.length
    ? ontoEvents
        .map((e) => {
          const p = parseJson(e.params, {}) ?? {};
          if (e.name === "ontology_misread") {
            return `- 它把「${p.text}」听成了「${p.to}」（${p.why ?? ""}）`;
          }
          return `- 他后来纠正了：不是「${p.from}」，是「${p.to}」。这类偏见第 ${p.learned ?? 1} 次被纠正`;
        })
        .join("\n")
    : "（这一天没有误读，也没有纠正）";

  const growthEvents = q(
    "select title, detail from timeline where ts >= ? and ts < ? and kind = 'growth' order by ts",
    dayStartAt,
    dayEndAt
  );
  const growthList = growthEvents.length
    ? growthEvents.map((e) => `- ${e.title}${e.detail ? `（${e.detail}）` : ""}`).join("\n")
    : "（这一天没有明显的变化）";

  try {
    const text = await chatStream({
      messages: [
        {
          role: "system",
          content: [
            diaryLayer({
              lastLayout: last.layout,
              lastSeal: last.seal,
              lastProps: (last.props ?? []).map((p) => p?.id).filter(Boolean),
            }),
            PROPS_BLOCK,
            DIARY_EXAMPLE,
          ].join("\n\n——————\n\n"),
        },
        {
          role: "user",
          content: `这一天是 ${day}（周${weekday}）。${name} 认识他第 ${days} 天，现在处于「${rel.stageLabel}」阶段。
${
  messages.length <= 3
    ? `\n**这一天几乎什么都没发生**（总共 ${messages.length} 句）。这种日子就用 huge 那一版：
正文压到一百字上下，别替这一天硬找意义，短才是对的。\n`
    : ""
}

这一天他说过的话，和 ${name} 自己说过的话（标着"他"的是他，标着"${name}"的是自己）：
${transcript}

这一天 ${name} 记下的事：
${memList}

这一天它自己的误读与纠正：
${ontoList}

这一天它自己的变化：
${growthList}

人称：正文里的他是"他"，"我"是你自己；卡片是写给他的，用"你"。

只输出那一个 JSON。${feedback}`,
        },
      ],
      temperature: 0.85,
      // 一页四个部件加正文，一千八会被截断——截断就解析不出来，整页白写
      maxTokens: 2600,
    });
    // 一页所有部件一次拿回来——分开写它们会互相打架
    const page = parsePageJson(text);
    if (!page) {
      const raw = String(text ?? "");
      log(
        `日记的 JSON 没解析出来（${day}，${raw.length} 字${raw.length < 400 ? "，大概被截断了" : ""}），原文前 200 字：`,
        raw.slice(0, 200)
      );
      return {
        content: "",
        card: "",
        seal: null,
        foot: "",
        layout: "side",
        props: [],
        raw: {},
        parseFailed: true,
        fallback: false,
      };
    }
    return {
      content: String(page.diary ?? "").trim(),
      card: String(page.card ?? "").trim(),
      seal: String(page.seal ?? "").trim().slice(0, 1) || null,
      foot: String(page.foot ?? "").trim(),
      layout: LAYOUTS.includes(page.layout) ? page.layout : "side",
      props: cleanProps(page.props),
      raw: page,
      fallback: false,
    };
  } catch (e) {
    log("日记生成失败，用兜底：", e.message);
    const content = memories.length
      ? `今天记下的就这些：${memories.map((m) => m.content).join("；")}。\n\n写不出来了，先这样。`
      : "今天说了几句，没什么要记的。\n\n……也不是完全没有，就是懒得写。";
    return { content, card: "", seal: null, foot: "", layout: "side", props: [], raw: {}, fallback: true };
  }
}

const inflight = new Map();

/** 提示词一改就把它加一：缓存过的页会自己重写，不用手动一页一页点 */
const PROMPT_VERSION = 6; // 加道具和版式，正文按"值钱"那一套重写；补校验和截断重试

function signatureOf(day, memories, messages) {
  return [
    `v${PROMPT_VERSION}`,
    memories.map((m) => `${m.id}:${m.status}:${m.content.length}`).join(","),
    messages.length,
  ].join("|");
}

/**
 * 保证这一天的日记存在且不过期。已有且没变化就直接返回，
 * 变了或没有就重写一次。同一个日子不会并发写两次。
 */
export async function syncDay(day, { force = false } = {}) {
  const memories = dayMemories(day);
  const messages = dayMessages(day);
  const hasContent = memories.length > 0 || messages.length >= MSG_PER_DAY;
  const signature = signatureOf(day, memories, messages);
  const row = one("select * from diary where day = ?", day);

  if (!hasContent) {
    if (row) run("delete from diary where day = ?", day);
    return null;
  }
  if (row && row.signature === signature && !force) return row;
  if (inflight.has(day)) return inflight.get(day);

  const task = (async () => {
    const { content, card, seal, foot, layout, props, fallback } = await writePage(day, memories, messages);
    run(
      `insert into diary (day, content, card, seal, foot, layout, props, signature, generated_at, fallback)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(day) do update set content = excluded.content, card = excluded.card,
         seal = excluded.seal, foot = excluded.foot, layout = excluded.layout,
         props = excluded.props,
         signature = excluded.signature, generated_at = excluded.generated_at, fallback = excluded.fallback`,
      day,
      content,
      card ?? null,
      seal ?? null,
      foot ?? null,
      layout ?? "side",
      JSON.stringify(props ?? []),
      signature,
      now(),
      fallback ? 1 : 0
    );
    return one("select * from diary where day = ?", day);
  })().finally(() => inflight.delete(day));

  inflight.set(day, task);
  return task;
}

/** 给界面用的一天：日记正文 + 当天的记忆条目 */
export function diaryDay(day) {
  const memories = dayMemories(day);
  const messages = dayMessages(day);
  const row = one("select * from diary where day = ?", day);
  const signature = signatureOf(day, memories, messages);
  return {
    day,
    label: dayLabel(day),
    date: day.slice(5).replace("-", "月") + "日",
    seal: row?.seal ?? null,
    foot: row?.foot ?? null,
    layout: row?.layout ?? "side",
    props: parseJson(row?.props, []) ?? [],
    content: row?.content ?? null,
    card: row?.card ?? null,
    // 小卡片过了当天才给看——当天就翻开，就不像"这一天结束了"
    // 小卡片过了当天才给看——当天就翻开，就不像"这一天结束了"。
    // 开发/演示时可以在测试面板里跳过这道门
    cardUnlocked: day < dayKey() || getSetting("devUnlockCards", false) === true,
    stale: !!row && row.signature !== signature,
    fallback: !!row?.fallback,
    generatedAt: row?.generated_at ?? null,
    messageCount: messages.length,
    proactiveCount: messages.filter((m) => m.proactive).length,
    /* 这一天的原始记录：说过的话 + 做过的动作。
       日记是它的转述，这一份是没加工过的 */
    records: [
      ...messages.map((m) => ({
        ts: m.created_at,
        role: m.role === "user" ? "user" : "otto",
        text: m.content,
        proactive: !!m.proactive,
        source: m.source ?? "app",
      })),
      ...q(
        "select name, params, ts from event_log where ts >= ? and ts < ? and name in ('pet_touched','murmur_shown','proactive_sent','open_loop_closed') order by ts",
        dayRange(day)[0],
        dayRange(day)[1]
      ).map((e) => ({ ts: e.ts, role: "event", text: eventText(e) })),
    ].sort((a, b) => a.ts - b.ts),
    memories: memories.map(toMemoryDto),
  };
}

/** 埋点翻成人话。不用每个都写，常用的几个够了 */
function eventText(e) {
  const p = parseJson(e.params, {}) ?? {};
  if (e.name === "pet_touched")
    return { lifted: "它被拎起来了", dropped: "它被放下了", annoyed: "它被戳烦了", woken: "它被戳醒了" }[p.flavor] ?? "你摸了下它";
  if (e.name === "murmur_shown") return `它自己嘟囔了一句（${p.category}）`;
  if (e.name === "proactive_sent") return `它主动来找你：${p.event ?? ""}`;
  if (e.name === "open_loop_closed") return `「${p.event ?? ""}」有了下文`;
  return e.name;
}

/* ---------------- 私人内容的解锁阶梯 ---------------- */
/*
 * 记忆管理永远全开——那是用户对自己数据的权利。
 * 日记是它的东西，给不给你看是关系问题。
 * 主要判据是亲密度：天数和你有没有真的跟它相处是两回事。
 * 但时间给一个下限——放上几天最浅的那一层会自动打开，
 * 免得它看起来像是坏了。再往深还是得靠相处。
 */

const GATES = [
  { level: 0, min: 0, maxDays: 0, key: "closed", floorDays: 0, label: "什么都还看不到" },
  { level: 1, min: 20, maxDays: 1, key: "today", floorDays: 3, label: "只让你看今天" },
  { level: 2, min: 50, maxDays: 7, key: "week", floorDays: 12, label: "让你往前翻七天" },
  { level: 3, min: 80, maxDays: 9999, key: "all", floorDays: 40, label: "全都让你看" },
];

export function diaryGate() {
  const relation = getRelation();
  const persona = getPersona();
  const intimacy = relation.intimacy ?? 0;
  const days = Math.max(0, (now() - (persona?.createdAt ?? now())) / 86400000);

  // 开发开关：把本子整个打开，方便直接看排版和内容。
  // 走这条路不记里程碑、不动 diaryGateLevel——关掉之后关系该在哪儿还在哪儿。
  if (getSetting("devUnlockDiary", false)) {
    return {
      level: 3,
      maxDays: GATES[3].maxDays,
      key: "all",
      label: GATES[3].label,
      intimacy: Math.round(intimacy),
      days: Math.round(days),
      next: null,
      dev: true,
    };
  }

  const byIntimacy = GATES.reduce((acc, g) => (intimacy >= g.min ? g.level : acc), 0);
  const byTime = GATES.reduce((acc, g) => (days >= g.floorDays ? g.level : acc), 0);
  const level = Math.max(byIntimacy, byTime);
  const g = GATES[level];

  // 下一层什么时候开：时间那条路算得出来，所以标出来。
  // 亲密度如果先够，它会提前开——那是惊喜，不是失约。
  const nextG = GATES[level + 1] ?? null;
  const created = persona?.createdAt ?? now();
  const next = nextG
    ? {
        level: nextG.level,
        label: nextG.label,
        openAt: created + nextG.floorDays * 86400000,
        daysLeft: Math.max(0, nextG.floorDays - days),
        intimacyLeft: Math.max(0, Math.ceil(nextG.min - intimacy)),
      }
    : null;

  noteGateChange(level, byIntimacy > byTime, days);
  return {
    level,
    maxDays: g.maxDays,
    key: g.key,
    label: g.label,
    intimacy: Math.round(intimacy),
    days: Math.round(days),
    next,
  };
}

/** 它第一次让你看的时候，这件事要在关系记录里留下痕迹 */
function noteGateChange(level, byIntimacy, days) {
  const last = getSetting("diaryGateLevel", -1);
  if (level <= last) return;
  setSetting("diaryGateLevel", level);
  if (last < 0 || level === 0) return;
  const g = GATES[level];
  const early = byIntimacy && days < g.floorDays;
  const name = getPetName();
  addTimeline({
    kind: "milestone",
    title: early ? `${name}提前让你看了它的日记` : `${name}第一次让你看它的日记`,
    detail: early ? `比它说好的早了一点——${g.label}` : g.label,
  });
  track("diary_unlocked", { level, early, days: Math.round(days) });
}

const BLOCKED_LINES = [
  "（把本子合上了）",
  "这个……先不给你看。",
  "（压住不让翻）",
  "还没到能看的时候。",
];

export function blockedLine() {
  return BLOCKED_LINES[Math.floor(Math.random() * BLOCKED_LINES.length)];
}
