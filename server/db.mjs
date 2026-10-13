import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ROOT, ENV } from "./env.mjs";

export const DATA_DIR = process.env.OTTO_DATA_DIR
  ? path.resolve(process.env.OTTO_DATA_DIR)
  : path.join(ROOT, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

export const DB_FILE = path.join(DATA_DIR, "otto.db");
export const db = new DatabaseSync(DB_FILE);

const SCHEMA = `
create table if not exists settings (key text primary key, value text);

create table if not exists persona (
  id integer primary key check (id = 1),
  dims text,
  description text,
  influence text,
  locked integer default 0,
  created_at integer,
  locked_at integer
);

create table if not exists relation (
  id integer primary key check (id = 1),
  stage text,
  intimacy real default 0,
  shared_count integer default 0,
  mood text,
  updated_at integer
);

create table if not exists session (
  id text primary key,
  source text,
  mode text,
  started_at integer,
  ended_at integer
);

create table if not exists message (
  id text primary key,
  session_id text,
  role text,
  content text,
  created_at integer,
  proactive integer default 0,
  interaction_type text,
  meta text
);

create table if not exists memory (
  id text primary key,
  category text,
  content text,
  source_message_id text,
  source_quote text,
  inferred integer default 0,
  emotion text,
  confidence real default 0.6,
  status text default 'long_term',
  created_at integer,
  last_ref_at integer,
  ref_count integer default 0,
  user_visible integer default 1,
  keepsake integer default 0,
  keepsake_note text,
  keepsake_at integer
);

create table if not exists open_loop (
  id text primary key,
  memory_id text,
  event text,
  due_at integer,
  status text default 'open',
  created_at integer,
  closed_at integer,
  attempts integer default 0
);

create table if not exists timeline (
  id text primary key,
  ts integer,
  kind text,
  title text,
  detail text,
  ref_id text
);

create table if not exists diary (
  day text primary key,
  content text,
  signature text,
  generated_at integer,
  fallback integer default 0
);

create table if not exists event_log (
  id text primary key,
  name text,
  params text,
  ts integer
);

create index if not exists idx_message_session on message (session_id, created_at);
create index if not exists idx_memory_status on memory (status, created_at);
create index if not exists idx_open_loop_status on open_loop (status, due_at);
create index if not exists idx_timeline_ts on timeline (ts);
create index if not exists idx_event_ts on event_log (ts);
`;

db.exec(SCHEMA);

/** 加了字段的老库要能平滑升上来，不然拿到旧 otto.db 会直接报错 */
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`pragma table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`alter table ${table} add column ${ddl}`);
    console.log(`[db] 补字段 ${table}.${column}`);
  }
}

// 物件：被它标记为"留着"的记忆
ensureColumn("memory", "keepsake", "keepsake integer default 0");
ensureColumn("memory", "keepsake_note", "keepsake_note text");
ensureColumn("memory", "keepsake_at", "keepsake_at integer");
// 小卡片：同一天的材料，写给用户看的那份（日记是写给自己的）
ensureColumn("diary", "card", "card text");
/* 硬件离线记录：等第三阶段接上硬件才用得上，但现在必须埋——
   晚了要动全表，而且历史数据没法回溯标注 */
ensureColumn("message", "source", "source text default 'app'");
ensureColumn("message", "captured_offline", "captured_offline integer default 0");
ensureColumn("event_log", "source", "source text default 'app'");
ensureColumn("diary", "offline_days", "offline_days real default 0");
// 手账一页的其余部件：印章一个字、页脚一句、版式
ensureColumn("diary", "seal", "seal text");
ensureColumn("diary", "foot", "foot text");
ensureColumn("diary", "layout", "layout text");
ensureColumn("diary", "props", "props text");
db.exec(`create table if not exists sync (
  id text primary key,
  started_at integer,
  ended_at integer,
  hardware_boot_id text,
  note text
)`);

export const q = (sql, ...p) => db.prepare(sql).all(...p);
export const one = (sql, ...p) => db.prepare(sql).get(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);

export function getSetting(key, fallback = null) {
  const row = one("select value from settings where key = ?", key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

export function setSetting(key, value) {
  run(
    "insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value",
    key,
    JSON.stringify(value)
  );
}

/** 配置文件是否真的配置过模型 */
export function llmConfigured() {
  return ENV.mock || ENV.hasKey();
}
