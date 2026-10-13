/**
 * 记忆系统（对应产品方案第 10 节）
 * 三类记忆：用户信息 / 事件 / 关系。写入异步，召回按优先级打分。
 */
import { q, one, run, getSetting } from "./db.mjs";
import { uid, clamp, log } from "./util.mjs";
import { now } from "./clock.mjs";
import { chatJson } from "./llm.mjs";
import { addTimeline } from "./timeline.mjs";
import { createLoop, openLoopCount } from "./openloop.mjs";

export const CATEGORIES = {
  user_info: "用户信息记忆",
  event: "事件记忆",
  relationship: "关系记忆",
};

const CATEGORY_WEIGHT = { relationship: 3.0, event: 2.0, user_info: 1.5 };
const MAX_LOOPS = 3;

export function memoryEnabled() {
  return getSetting("memoryEnabled", true) !== false;
}

export function toMemoryDto(r) {
  return {
    id: r.id,
    category: r.category,
    categoryLabel: CATEGORIES[r.category] ?? r.category,
    content: r.content,
    sourceQuote: r.source_quote,
    sourceMessageId: r.source_message_id,
    inferred: !!r.inferred,
    emotion: r.emotion,
    confidence: r.confidence,
    status: r.status,
    createdAt: r.created_at,
    lastRefAt: r.last_ref_at,
    refCount: r.ref_count,
    keepsake: !!r.keepsake,
    keepsakeNote: r.keepsake_note ?? null,
    keepsakeAt: r.keepsake_at ?? null,
  };
}

export function listMemories({ status, includeHidden } = {}) {
  const rows = status
    ? q("select * from memory where status = ? order by created_at desc", status)
    : q("select * from memory order by created_at desc");
  return rows.filter((r) => includeHidden || r.user_visible).map(toMemoryDto);
}

export function insertMemory({
  category,
  content,
  sourceMessageId = null,
  sourceQuote = null,
  inferred = false,
  emotion = null,
  confidence = 0.6,
  status,
}) {
  const id = uid("mem");
  const st = status ?? (confidence >= 0.7 ? "long_term" : "pending");
  run(
    `insert into memory (id, category, content, source_message_id, source_quote, inferred, emotion,
       confidence, status, created_at, ref_count, user_visible)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1)`,
    id,
    category,
    content,
    sourceMessageId,
    sourceQuote,
    inferred ? 1 : 0,
    emotion,
    confidence,
    st,
    now()
  );
  addTimeline({
    kind: "memory",
    title: `记住了一件事`,
    detail: content,
    refId: id,
  });
  return one("select * from memory where id = ?", id);
}

export function updateMemory(id, patch) {
  const cur = one("select * from memory where id = ?", id);
  if (!cur) return null;
  run(
    "update memory set content = ?, category = ?, status = ? where id = ?",
    patch.content ?? cur.content,
    patch.category ?? cur.category,
    patch.status ?? cur.status,
    id
  );
  return one("select * from memory where id = ?", id);
}

export function deleteMemory(id) {
  run("delete from open_loop where memory_id = ?", id);
  run("delete from memory where id = ?", id);
  return true;
}

export function confirmMemory(id) {
  run("update memory set status = 'long_term', confidence = 0.9 where id = ?", id);
  return one("select * from memory where id = ?", id);
}

/* ------------------------------------------------------------------ */
/* 召回：规则优先 + 打分取 top-k。记忆规模只有几十到两百条，不值得上向量库 */
/* ------------------------------------------------------------------ */

function bigrams(s) {
  const t = String(s || "").replace(/[\s\p{P}]/gu, "");
  const out = new Set();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  if (t.length === 1) out.add(t);
  return out;
}

function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let hit = 0;
  for (const g of a) if (b.has(g)) hit++;
  return hit / Math.min(a.size, b.size);
}

export function recall(text, { limit = 6 } = {}) {
  if (!memoryEnabled()) return { memories: [], reason: "memory_off" };
  const rows = q("select * from memory where status = 'long_term' and user_visible = 1");
  const input = bigrams(text);
  const t = now();
  const scored = rows.map((m) => {
    const cat = CATEGORY_WEIGHT[m.category] ?? 1;
    const ageDays = Math.max(0, (t - m.created_at) / 86400000);
    const recency = Math.exp(-ageDays / 30);
    const rel = overlap(input, bigrams(m.content));
    const refBonus = Math.min(m.ref_count, 5) * 0.15;
    const lastRef = m.last_ref_at ? Math.exp(-(t - m.last_ref_at) / 86400000 / 14) : 0;
    const score = cat * (0.6 + recency) + rel * 3.2 + refBonus + lastRef * 0.4;
    return { m, score, rel };
  });
  scored.sort((a, b) => b.score - a.score);
  const picked = scored.slice(0, limit);
  if (picked.length) {
    const ids = picked.map((p) => p.m.id);
    for (const id of ids) {
      run("update memory set ref_count = ref_count + 1, last_ref_at = ? where id = ?", t, id);
    }
  }
  return {
    memories: picked.map((p) => p.m),
    scored: scored.map((p) => ({ id: p.m.id, content: p.m.content, score: +p.score.toFixed(2) })),
  };
}

/* ------------------------------------------------------------------ */
/* 写入：对话结束后异步抽取，不打断对话                                 */
/* ------------------------------------------------------------------ */

const EXTRACT_SYSTEM = `你是一个记忆抽取器。你的任务是从一段对话里抽取值得长期记住的条目，输出 JSON。

规则：
1. 只抽用户明确说过的事。不要推断，不要补全，不要把 Otto 说的话当成用户的事。
2. 一段对话最多抽 2 条记忆。没有值得记的就返回空数组。宁可少记，不要记错。
3. 分类：
   - user_info：稳定的个人信息（姓名、偏好、作息、习惯）
   - event：发生过或将要发生的具体事件
   - relationship：共同经历和情绪节点，写法要像"你上次说……"那种口吻能引用的句子
4. 每条记忆都要写成能被自然引用的一句话：不用"用户"这个词，不用"他/她"。
   主语省略，或者用"你"。它是拿来在对话里念出来的，不是数据库字段。
   好例子：下周四有答辩，有点慌；不喝咖啡；说过想养一只猫
   坏例子：用户提到要答辩，当时有点紧张；用户表示自己不喝咖啡
5. 同一个对象如果已经在"已有记忆"里出现，不要重复抽取。
6. 如果用户提到一件以后才会发生的事（有明确或大致的时间），放进 open_loops。
   时间一律用绝对时间：先根据"当前时间"把"下周四""明天晚上"这类说法换算成具体日期，再输出 due_at。
   只说到日期、没说时间的，默认当天 20:00。完全没提时间的，不要放进 open_loops。
7. confidence：你对这条抽取的把握，0 到 1。低于 0.7 会被标成"我猜的"。
8. interaction_type：用户这次是"task"（有明确任务目的，比如查信息、要建议）还是"social"（没有目的，只是想说话）。
9. keepsake：它自己会不会把这件事留下来。大多数时候是 false，偶尔才有一个。
   留的标准不是"这件事重要"，是"以后还想拿出来看看"。一次对话最多留一个，经常一个都不留。

只输出 JSON，格式：
{
  "memories": [
    {"category": "user_info|event|relationship", "content": "一句话", "source_quote": "用户的原话片段", "emotion": "情绪词或 null", "confidence": 0.0, "inferred": false}
  ],
  "open_loops": [
    {"event": "简短事件名", "due_at": "2026-10-15T20:00:00", "emotion": "情绪词或 null", "memory_content": "对应的记忆句子"}
  ],
  "keepsake": {"keep": false, "note": "为什么留着，一句话"},
  "interaction_type": "task|social",
  "mood": "最近情绪基调，两到四个字"
}`;

const MAX_KEEPSAKES = 6;

export function listKeepsakes() {
  return q("select * from memory where keepsake = 1 order by keepsake_at desc").map(toMemoryDto);
}

export async function extractAndWrite({ sessionId, turns, currentMessageId, trigger = "chat_end" }) {
  if (!memoryEnabled()) return { skipped: "memory_off" };
  const existing = q("select content from memory order by created_at desc limit 40");
  const transcript = turns
    .map((m) => `${m.role === "user" ? "用户" : "Otto"}：${m.content}`)
    .join("\n");
  const nowTs = new Date(now()).toISOString();

  let result;
  try {
    result = await chatJson({
      messages: [
        { role: "system", content: EXTRACT_SYSTEM },
        {
          role: "user",
          content: `当前时间：${nowTs}\n\n已有记忆：\n${
            existing.map((e) => `- ${e.content}`).join("\n") || "（还没有）"
          }\n\n待抽取的对话：\n${transcript}`,
        },
      ],
    });
  } catch (e) {
    log("记忆抽取失败：", e.message);
    return { error: e.message };
  }

  const written = [];
  const memories = Array.isArray(result.memories) ? result.memories.slice(0, 2) : [];
  for (const m of memories) {
    const content = String(m.content || "").trim();
    if (!content) continue;
    const dup = existing.find((e) => overlap(bigrams(e.content), bigrams(content)) > 0.72);
    if (dup) continue;
    if (m.category === "user_info" || m.category === "event" || m.category === "relationship") {
      const row = insertMemory({
        category: m.category,
        content,
        sourceMessageId: currentMessageId,
        sourceQuote: m.source_quote ?? null,
        inferred: !!m.inferred,
        emotion: m.emotion ?? null,
        confidence: clamp(Number(m.confidence ?? 0.7), 0, 1),
      });
      written.push(row);
    }
  }

  let loops = [];
  const rawLoops = Array.isArray(result.open_loops) ? result.open_loops : [];
  const existingLoops = q("select event from open_loop where status = 'open'");
  for (const l of rawLoops) {
    const event = String(l.event || "").trim();
    if (!event) continue;
    // 同一件事别记成两个线头，不然到点它会问你两遍
    const dup = existingLoops.find((e) => overlap(bigrams(e.event), bigrams(event)) > 0.5);
    if (dup) {
      log("这个线头已经在等着了，跳过：", event);
      continue;
    }
    if (openLoopCount() >= MAX_LOOPS) {
      log("未闭合线头已达上限，跳过：", event);
      break;
    }
    // 模型给绝对时间更靠谱；due_in_hours 作为兜底
    const t = now();
    const parsed = l.due_at ? Date.parse(l.due_at) : NaN;
    const dueAt = Number.isFinite(parsed)
      ? clamp(parsed, t + 60000, t + 90 * 86400000)
      : t + clamp(Number(l.due_in_hours ?? 24), 0.05, 24 * 30) * 3600000;
    const linked =
      written.find((w) => overlap(bigrams(w.content), bigrams(l.memory_content || "")) > 0.4) ??
      written[0] ??
      null;
    const loop = createLoop({
      memoryId: linked?.id ?? null,
      event,
      dueAt,
      emotion: l.emotion ?? null,
    });
    if (loop) loops.push(loop);
    if (loop) existingLoops.push({ event });
  }

  // 物件：从这次写的记忆里挑一条留下来。数量少是刻意的——
  // 10.3 给 open loop 定的上限理由是"多了就变回待办清单了"，物件同理
  let keepsake = null;
  const keep = result.keepsake;
  if (keep?.keep && written.length && listKeepsakes().length < MAX_KEEPSAKES) {
    const target = written[0];
    run(
      "update memory set keepsake = 1, keepsake_note = ?, keepsake_at = ? where id = ?",
      String(keep.note ?? "").slice(0, 60) || null,
      now(),
      target.id
    );
    keepsake = one("select * from memory where id = ?", target.id);
  }

  return {
    trigger,
    memories: written,
    loops,
    keepsake,
    interactionType: result.interaction_type === "task" ? "task" : "social",
    mood: result.mood || null,
  };
}
