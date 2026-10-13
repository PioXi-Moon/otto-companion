import { q, run } from "./db.mjs";
import { uid } from "./util.mjs";
import { now } from "./clock.mjs";

/** 埋点。没有这些记录，"非任务型互动"就无从分辨（产品方案 13.2） */
export function track(name, params = {}, source = "app") {
  run(
    "insert into event_log (id, name, params, ts, source) values (?, ?, ?, ?, ?)",
    uid("ev"),
    name,
    JSON.stringify(params ?? {}),
    now(),
    source
  );
}

export function listEvents({ limit = 500 } = {}) {
  return q("select * from event_log order by ts desc limit ?", limit).map((r) => ({
    id: r.id,
    name: r.name,
    params: r.params,
    ts: r.ts,
  }));
}

export function countEvents() {
  return q("select name, count(*) as c from event_log group by name order by c desc");
}
