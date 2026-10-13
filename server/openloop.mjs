/**
 * open loop：一个已经开启、还没有关闭的线头（对应产品方案 10.3 / 11.2）
 */
import { q, one, run } from "./db.mjs";
import { uid } from "./util.mjs";
import { now } from "./clock.mjs";
import { addTimeline } from "./timeline.mjs";

export function openLoopCount() {
  return one("select count(*) as c from open_loop where status = 'open'")?.c ?? 0;
}

export function createLoop({ memoryId, event, dueAt, emotion = null }) {
  const id = uid("loop");
  run(
    "insert into open_loop (id, memory_id, event, due_at, status, created_at, attempts) values (?, ?, ?, ?, 'open', ?, 0)",
    id,
    memoryId,
    event,
    dueAt,
    now()
  );
  addTimeline({
    kind: "open_loop_created",
    title: "记下了一件还没发生的事",
    detail: `${event}${emotion ? `（当时是${emotion}）` : ""}`,
    refId: id,
  });
  return one("select * from open_loop where id = ?", id);
}

export function listLoops({ status } = {}) {
  return status
    ? q("select * from open_loop where status = ? order by due_at asc", status)
    : q("select * from open_loop order by due_at asc");
}

/** 到时间点、还没有主动问过的线头 */
export function dueLoops(t = now()) {
  return q(
    "select * from open_loop where status = 'open' and attempts = 0 and due_at <= ? order by due_at asc",
    t
  );
}

/** 生成主动消息前调用，避免同一个线头被反复提起 */
export function markAttempted(id) {
  run("update open_loop set attempts = attempts + 1 where id = ?", id);
}

export function closeLoop(id, { shared = true } = {}) {
  const loop = one("select * from open_loop where id = ?", id);
  if (!loop) return null;
  run("update open_loop set status = 'closed', closed_at = ? where id = ?", now(), id);
  addTimeline({
    kind: "open_loop_closed",
    title: "一件说过的事有了下文",
    detail: loop.event,
    refId: id,
  });
  return { ...loop, shared };
}

/** 用户没回应就一直不重复提醒，超时后降级成普通记忆 */
export function downgradeStale(t = now(), maxAgeMs = 48 * 3600000) {
  const stale = q(
    "select * from open_loop where status = 'open' and attempts > 0 and due_at <= ?",
    t - maxAgeMs
  );
  for (const l of stale) {
    run("update open_loop set status = 'downgraded' where id = ?", l.id);
  }
  return stale.length;
}
