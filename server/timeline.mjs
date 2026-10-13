import { q, run } from "./db.mjs";
import { uid } from "./util.mjs";
import { now } from "./clock.mjs";

export function addTimeline({ kind, title, detail = "", refId = null }) {
  const id = uid("tl");
  run(
    "insert into timeline (id, ts, kind, title, detail, ref_id) values (?, ?, ?, ?, ?, ?)",
    id,
    now(),
    kind,
    title,
    detail,
    refId
  );
  return id;
}

export function listTimeline({ limit = 200 } = {}) {
  return q("select * from timeline order by ts desc limit ?", limit).map((r) => ({
    id: r.id,
    ts: r.ts,
    kind: r.kind,
    title: r.title,
    detail: r.detail,
    refId: r.ref_id,
  }));
}
