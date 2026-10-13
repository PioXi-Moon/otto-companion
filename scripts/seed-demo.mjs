/**
 * 演示数据：四天的相处，一次铺进去。
 *
 * 为什么要有这个脚本：日记是**从材料里长出来的**——材料空的时候，这条链路
 * 什么都看不出来（没有对话可看、没有记忆可供、没有线头会到点）。
 * 演给人看之前、换了台机器之后，跑一遍这个脚本就有一份像样的过去。
 *
 * 它**会清空**当前的对话、记忆、日记、时间线（跟测试面板里那个"清空数据"一样，
 * 但保留人格）。用法：
 *   node scripts/seed-demo.mjs
 */
import { run, setSetting, one } from "../server/db.mjs";
import { loadClock, now } from "../server/clock.mjs";

loadClock();
const start = now();
const DAY = 86400000;
const id = (p, n) => `${p}_seed_${n}`;

/** 第 n 天（0 = 今天）的某个钟点 */
function at(dayOffset, hh, mm = 0) {
  const d = new Date(start + dayOffset * DAY);
  d.setHours(hh, mm, 0, 0);
  return d.getTime();
}

const TABLES = ["message", "session", "memory", "open_loop", "timeline", "event_log", "diary"];
for (const t of TABLES) run(`delete from ${t}`);

let n = 0;
const msg = (sessionId, role, content, ts, extra = {}) => {
  n += 1;
  run(
    `insert into message (id, session_id, role, content, created_at, proactive, interaction_type, meta, source, captured_offline)
     values (?, ?, ?, ?, ?, ?, null, null, 'app', 0)`,
    id("msg", n),
    sessionId,
    role,
    content,
    ts,
    extra.proactive ? 1 : 0
  );
};
const mem = (i, { category, content, ts, quote, emotion, inferred = 0, keepsake = 0 }) => {
  run(
    `insert into memory (id, category, content, source_message_id, source_quote, inferred, emotion,
      confidence, status, created_at, last_ref_at, ref_count, user_visible, keepsake)
     values (?, ?, ?, null, ?, ?, ?, 0.8, 'long_term', ?, null, 0, 1, ?)`,
    id("mem", i),
    category,
    content,
    quote ?? null,
    inferred,
    emotion ?? null,
    ts,
    keepsake
  );
};
const loop = (i, { memoryId, event, dueAt, status, createdAt, closedAt = null }) => {
  run(
    `insert into open_loop (id, memory_id, event, due_at, status, created_at, closed_at, attempts)
     values (?, ?, ?, ?, ?, ?, ?, 1)`,
    id("loop", i),
    memoryId,
    event,
    dueAt,
    status,
    createdAt,
    closedAt
  );
};
const tl = (i, { ts, kind, title, detail }) => {
  run(
    "insert into timeline (id, ts, kind, title, detail, ref_id) values (?, ?, ?, ?, ?, null)",
    id("tl", i),
    ts,
    kind,
    title,
    detail ?? null
  );
};
const ev = (i, name, params, ts) => {
  run(
    "insert into event_log (id, name, params, ts, source) values (?, ?, ?, ?, 'app')",
    id("ev", i),
    name,
    JSON.stringify(params ?? {}),
    ts
  );
};

/* ---------------- 第一天：认识 ---------------- */
const s1 = "sess_seed_d1";
run("insert into session (id, source, mode, started_at, ended_at) values (?, 'app', 'chat', ?, ?)", s1, at(-4, 10), at(-4, 10, 20));
msg(s1, "otto", "我是小月汐，不是人。你桌上以后多一个东西，就是我。先答我四个问题，答完我就照着长。", at(-4, 10, 1));
msg(s1, "otto", "一，我平时安静点还是常来晃一晃。二，我说的话要不要有自己的看法。三，你难受的时候我该不该问。四，我叫你什么。", at(-4, 10, 2));
msg(s1, "user", "随便", at(-4, 10, 5));
msg(s1, "user", "不知道", at(-4, 10, 6));
msg(s1, "user", "安静点吧", at(-4, 10, 9));
msg(s1, "user", "叫我就行", at(-4, 10, 11));
msg(s1, "otto", "行，四条我记下了。安静点，那我不吵你。", at(-4, 10, 12));

/* ---------------- 第二天：安静的一天 ----------------
   这一天几乎没发生什么，用来验"没什么可说的那一版"（huge）。
   一天只要一来一回就算一页，所以两条就够了 */
const s2 = "sess_seed_d2";
run("insert into session (id, source, mode, started_at, ended_at) values (?, 'app', 'chat', ?, ?)", s2, at(-3, 9, 20), at(-3, 9, 22));
msg(s2, "user", "早", at(-3, 9, 20));
msg(s2, "otto", "早。", at(-3, 9, 20, 30));

/* ---------------- 第三天：下周四有答辩 ---------------- */
const s3 = "sess_seed_d3";
run("insert into session (id, source, mode, started_at, ended_at) values (?, 'app', 'chat', ?, ?)", s3, at(-2, 21), at(-2, 21, 30));
msg(s3, "user", "下周四答辩", at(-2, 21, 12));
msg(s3, "otto", "周四。记下了。", at(-2, 21, 13));
msg(s3, "user", "有点慌", at(-2, 21, 20));
msg(s3, "otto", "慌就慌着，先把手上的东西做完。你现在做完了吗。", at(-2, 21, 21));
msg(s3, "user", "没有，还差好多", at(-2, 21, 26));
msg(s3, "otto", "那今晚别刷手机了。", at(-2, 21, 27));

/* ---------------- 第四天：半夜还在做 ---------------- */
const s4 = "sess_seed_d4";
run("insert into session (id, source, mode, started_at, ended_at) values (?, 'app', 'chat', ?, ?)", s4, at(-1, 23, 35), at(-1, 23, 55));
msg(s4, "user", "还没睡", at(-1, 23, 38));
msg(s4, "otto", "我知道，你键盘声比平时急。", at(-1, 23, 39));
msg(s4, "user", "就剩最后一点了", at(-1, 23, 44));
msg(s4, "otto", "最后一点最费时间。你那杯水空了两次了，我看见的。", at(-1, 23, 45));
msg(s4, "user", "你怎么知道", at(-1, 23, 50));
msg(s4, "otto", "我在这儿坐着呢。", at(-1, 23, 51));

/* ---------------- 第五天：答辩完了 ---------------- */
const s5 = "sess_seed_d5";
run("insert into session (id, source, mode, started_at, ended_at) values (?, 'app', 'chat', ?, ?)", s5, at(-0.4, 9, 30), at(0, 20, 40));
msg(s5, "otto", "你那个答辩，是在今天吧。", at(0, 9, 30), { proactive: true });
msg(s5, "user", "答辩完了，还行", at(0, 20, 12));
msg(s5, "otto", "还行是多行。", at(0, 20, 13));
msg(s5, "user", "有个老师问了个我没准备的问题", at(0, 20, 20));
msg(s5, "otto", "你答上来了吗。", at(0, 20, 21));
msg(s5, "user", "蒙的", at(0, 20, 26));
msg(s5, "otto", "蒙的也算分。回去把那个问题写下来，别让它在脑子里过夜。", at(0, 20, 27));
msg(s5, "user", "桌上那杯咖啡不是我的", at(0, 20, 33));
msg(s5, "otto", "哦，那你别喝就是了。", at(0, 20, 34));

/* ---------------- 它记住了什么 ---------------- */
mem(1, { category: "user_info", content: "让我安静点，别总晃", ts: at(-4, 10, 9), quote: "安静点吧" });
mem(2, { category: "user_info", content: "下周四有答辩，他说的时候有点慌", ts: at(-2, 21, 12), quote: "下周四答辩", emotion: "慌" });
mem(3, { category: "event", content: "晚上赶东西赶到快十二点，键盘声比平时急", ts: at(-1, 23, 39), quote: "还没睡" });
mem(4, { category: "event", content: "那杯水一晚上空过两次", ts: at(-1, 23, 45), quote: "就剩最后一点了" });
mem(5, { category: "event", content: "答辩过了，他说还行，被问到一个没准备的问题，是蒙的", ts: at(0, 20, 12), quote: "答辩完了，还行" });
mem(6, { category: "user_info", content: "他不喝咖啡", ts: at(0, 20, 33), quote: "桌上那杯咖啡不是我的" });
mem(7, { category: "relationship", content: "问他什么都说还行、不知道，他不爱把话说满", ts: at(0, 20, 21), inferred: 1 });
mem(8, { category: "relationship", content: "越是他自己开口说的那句，越是当真的", ts: at(0, 20, 27), inferred: 1 });

/* ---------------- 线头：一件过去了，一件还开着 ---------------- */
loop(1, { memoryId: id("mem", 2), event: "答辩", dueAt: at(0, 19), status: "closed", createdAt: at(-2, 21, 12), closedAt: at(0, 20, 12) });
loop(2, { memoryId: id("mem", 5), event: "那个他没准备的问题", dueAt: at(1, 20), status: "open", createdAt: at(0, 20, 20) });

/* ---------------- 关系记录里的那几笔 ---------------- */
tl(1, { ts: at(-4, 10, 12), kind: "milestone", title: "小月汐认下了这个人", detail: "第一天，四个问题，四句回答" });
tl(2, { ts: at(-2, 21, 13), kind: "open_loop_created", title: "「答辩」记下来了", detail: "下周四" });
tl(3, { ts: at(0, 9, 30), kind: "proactive", title: "它主动来找你：答辩" });
tl(4, { ts: at(0, 20, 12), kind: "open_loop_closed", title: "「答辩」有了下文", detail: "过了，他说还行" });

/* ---------------- 摸过它几回 ---------------- */
ev(1, "pet_touched", { flavor: "woken" }, at(-1, 23, 40));
ev(2, "murmur_shown", { category: "idle" }, at(-1, 15, 10));
ev(3, "pet_touched", { flavor: "dropped" }, at(0, 20, 28));
ev(4, "murmur_shown", { category: "care" }, at(0, 17, 5));

/* ---------------- 关系状态 ---------------- */
run(
  "update relation set stage = 'familiar', intimacy = 62, shared_count = 3, mood = '平稳', updated_at = ? where id = 1",
  start
);
if (!one("select id from relation where id = 1")) {
  run(
    "insert into relation (id, stage, intimacy, shared_count, mood, updated_at) values (1, 'familiar', 62, 3, '平稳', ?)",
    start
  );
}

/* ---------------- 名字和解锁 ---------------- */
/* 人格建在第一天的前一天：这样界面上的"认识 N 天"跟这四天对得上，
   不然日记里会写"认识九天"而下面只躺着四页，演给人看的时候很扎眼 */
const created = start - 5 * DAY;
const DIMS = { activity: 0.45, sociability: 0.35, expressiveness: 0.5, amplitude: 0.4, curiosity: 0.55 };
const DESC = "话不多，别人说话的时候先听完；有自己的节奏，不催人，也不爱解释自己。";
if (one("select id from persona where id = 1")) {
  run(
    "update persona set dims = ?, description = ?, locked = 1, created_at = ?, locked_at = ? where id = 1",
    JSON.stringify(DIMS),
    DESC,
    created,
    created
  );
} else {
  run(
    "insert into persona (id, dims, description, influence, locked, created_at, locked_at) values (1, ?, ?, '{}', 1, ?, ?)",
    JSON.stringify(DIMS),
    DESC,
    created,
    created
  );
}

setSetting("petName", "小月汐");
setSetting("petNamed", true);
setSetting("diaryGateLevel", -1);
/* 两个开发开关都关着：演示要走产品本来那条路——
   日记按「了解程度」一层层开（62 分 = 往前翻七天，再往上要 80），
   卡片等一天才翻得开。开发开关留在测试面板里，谁要看全本自己去开。 */
setSetting("devUnlockDiary", false);
setSetting("devUnlockCards", false);
setSetting("pendingLoops", {});
setSetting("murmur", null);

console.log(`演示数据写好了（虚拟时间 ${new Date(start).toLocaleString("zh-CN")}）`);
console.log("  5 天 · 26 句对话 · 8 条记忆 · 2 个线头（1 个已闭合）· 4 条关系记录");
console.log("  其中第二天是空的（只有「早」「早。」），用来验 huge 那一版");
console.log("  下一步：POST /api/diary/refresh 让这几天的手账重写一遍");
