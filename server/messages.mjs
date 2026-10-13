import { q, one, run } from "./db.mjs";
import { uid } from "./util.mjs";
import { now } from "./clock.mjs";
import { track } from "./events.mjs";

export function ensureSession(sessionId, { source = "app", mode = "chat" } = {}) {
  const id = sessionId || uid("sess");
  const existing = one("select * from session where id = ?", id);
  if (!existing) {
    run(
      "insert into session (id, source, mode, started_at) values (?, ?, ?, ?)",
      id,
      source,
      mode,
      now()
    );
    track("session_start", { source, mode });
  }
  return one("select * from session where id = ?", id);
}

export function insertMessage({
  sessionId,
  role,
  content,
  proactive = false,
  interactionType = null,
  meta = null,
  source = "app",
  capturedOffline = false,
}) {
  const id = uid("msg");
  run(
    `insert into message (id, session_id, role, content, created_at, proactive, interaction_type, meta, source, captured_offline)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    sessionId,
    role,
    content,
    now(),
    proactive ? 1 : 0,
    interactionType,
    meta ? JSON.stringify(meta) : null,
    source,
    capturedOffline ? 1 : 0
  );
  return one("select * from message where id = ?", id);
}

export function sessionMessages(sessionId, limit = 40) {
  return q(
    "select * from message where session_id = ? order by created_at asc limit ?",
    sessionId,
    limit
  );
}

export function recentMessages(limit = 20) {
  return q("select * from message order by created_at desc limit ?", limit).reverse();
}

export function allMessages(limit = 400) {
  return q("select * from message order by created_at asc limit ?", limit);
}

export function endSession(sessionId) {
  run("update session set ended_at = ? where id = ?", now(), sessionId);
}

export function messageCount() {
  return one("select count(*) as c from message")?.c ?? 0;
}

/** 任务型 / 非任务型：这是主要指标的核心分型，先做粗判，抽取结果会覆盖它 */
export function guessInteractionType(text) {
  const t = String(text || "");
  const taskish =
    /(帮我|查一下|怎么|为什么|是什么|能不能告诉|几点|天气|提醒我|翻译|写一?[个份段])/.test(t) ||
    /[?？]$/.test(t.trim());
  return taskish ? "task" : "social";
}
