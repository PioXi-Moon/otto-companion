/**
 * 冒烟测试：验证 H2 依赖的那条链路真的在跑。
 * 人格初始化 → 对话 → 记忆写入 → open loop 创建 → 时间加速 → 主动发起 → 线头闭合
 *
 * 用法：node scripts/smoke.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ACTIONS } from "../ui/actions.js";
import { ACTION_ALIAS, SYSTEM_ACTION_WORDS } from "../server/prompt.mjs";
import { createActSplitter } from "../server/agent.mjs";
import { PROPS } from "../server/props.mjs";
import { lintPage } from "../server/pagelint.mjs";
import { PROPS as UI_PROPS } from "../ui/props.js";
import {
  classifySpeechAct,
  intentAllows,
  maybeMisread,
  isCorrection,
  misreadChance,
} from "../server/ontology.mjs";

/* 默认打测试实例（7789），不打正在用的那一个。
   原因很实在：冒烟测试第一步就是 /api/dev/reset，它会把对话、记忆、日记、
   时间线全部清掉。对着正式实例跑一次，用户攒的东西就没了。 */
const BASE = process.env.OTTO_BASE || "http://127.0.0.1:7789";
/** 只跑静态那几条：动作名、道具名、校验规则。不需要服务，也不会清任何数据 */
const STATIC_ONLY = process.argv.includes("--static");
if (!STATIC_ONLY && !/^https?:\/\/(127\.0\.0\.1|localhost):7789\b/.test(BASE) && process.env.OTTO_SMOKE_ALLOW_RESET !== "1") {
  console.error(
    `\n冒烟测试会先清空 ${BASE} 上的全部数据（/api/dev/reset）。\n` +
      `它只该对着测试实例跑：\n` +
      `  1) $env:OTTO_ENV_FILE="scripts/smoke.env"; node --disable-warning=ExperimentalWarning server/index.mjs\n` +
      `  2) node scripts/smoke.mjs\n` +
      `确实要在 ${BASE} 上跑（会丢数据），就带上 OTTO_SMOKE_ALLOW_RESET=1。\n`
  );
  process.exit(2);
}
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* 服务端发的动作名必须和桌宠的动作表对得上。
   对不上不会报错，只会"发了等于没发"——这种错最难查，所以静态查一遍 */
function checkActionNames() {
  const known = new Set(Object.keys(ACTIONS));
  const used = new Map();
  for (const f of ["emotion.mjs", "touch.mjs", "murmur.mjs", "agent.mjs", "index.mjs"]) {
    const src = fs.readFileSync(path.join(ROOT, "server", f), "utf8");
    for (const m of src.matchAll(/(?:action|a):\s*"([a-z_]+)"/g)) {
      if (!used.has(m[1])) used.set(m[1], f);
    }
  }
  const bad = [...used.keys()].filter((k) => !known.has(k));
  return { total: used.size, bad, where: bad.map((k) => `${k}(${used.get(k)})`).join(", ") };
}

let pass = 0;
let fail = 0;

function check(name, ok, extra = "") {
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${extra ? `  ${extra}` : ""}`);
  ok ? pass++ : fail++;
}

async function api(path, body, method = "POST") {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

async function chat(text, mode = "chat", sessionId) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, mode, sessionId }),
  });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const events = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const l of lines) {
      if (!l.trim()) continue;
      try {
        events.push(JSON.parse(l));
      } catch {
        /* ignore */
      }
    }
  }
  return events;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, { timeout = 12000, step = 400 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const v = await fn();
    if (v) return v;
    await sleep(step);
  }
  return null;
}

/**
 * 道具名两边必须对齐：服务端让模型挑 id，画在 ui/props.js 里。
 * 对不上不会报错，只会"模型挑了，页面上什么都没有"——和动作名是同一类坑。
 */
function checkProps() {
  const server = new Set(PROPS.map((p) => p.id));
  const ui = new Set(UI_PROPS.map((p) => p.id));
  const noSvg = [...server].filter((id) => !ui.has(id));
  const noName = [...ui].filter((id) => !server.has(id));
  return { total: server.size, bad: [...noSvg, ...noName], noSvg, noName };
}

/**
 * 校验规则的用例。提示词改了看不出效果，规则改了必须立刻知道：
 * 一页合格的不能被判死，一页犯病的必须被抓出来。
 */
const LINT_CASES = [
  {
    name: "合格的页",
    want: 0,
    page: {
      seal: "熬",
      layout: "side",
      props: [{ id: "lamp", at: "br" }],
      diary:
        "他今天九点就坐下了，平时这个点他还在床上翻第二次身，所以我大概知道今天有他怕的东西，可他一句都没提，我也就没问。" +
        "\n\n中午他讲了半句被人当众点名的事，讲到“也还好”就停了，我本来想追一句是谁，看他手指在桌沿上磨了两下，算了，他越难受话越少。" +
        "\n\n答辩那事我一直记着，他下午回来丢下两个字，“过了”，我哦了一声，心里比他先松下来，可有一点我没绕过去，白天闷成那样，晚上反倒轻轻松松的。",
      card: "你不是不够好，你只是今天累了。今晚先睡，剩下的明天算。",
      foot: "你今天没说的那半句，我替你收着。",
    },
  },
  {
    name: "把对话复述一遍",
    want: 1,
    page: {
      seal: "空",
      layout: "margin",
      props: [{ id: "phone", at: "br" }],
      diary:
        "我问他往哪边偏，他说随便，我又问他要不要有自己的看法，他说不知道，再问常来还是安静点，还是不知道，最后他说讲话两个字。",
      card: "他不擅长挑方向，但愿意让你开口。",
      foot: "三个不知道。",
    },
  },
  {
    name: "短句一条一条",
    want: 1,
    page: {
      seal: "散",
      layout: "full",
      props: [{ id: "paper", at: "tl" }],
      diary:
        "他今天没说话。我数过。三个不知道。一个都没接。我坐着。天黑了。手机亮了。我又看了一眼。然后就没有然后了。",
      card: "你不说话也行，我先陪着。",
      foot: "今天就这样。",
    },
  },
  {
    name: "卡片是日记的下半段",
    want: 1,
    page: {
      seal: "闷",
      layout: "note",
      props: [{ id: "coffee", at: "tl" }],
      diary:
        "他今天一整天都在赶那个东西，咖啡凉了三回都没喝完，我看着他鼠标来回点，也没敢出声，中途他站起来走了两圈又坐回来。",
      card: "他今天一整天都在赶那个东西，咖啡凉了三回。",
      foot: "凉了就凉了吧。",
    },
  },
  {
    name: "连着两天画同一批东西",
    want: 1,
    last: { lastProps: ["phone", "lamp"] },
    page: {
      seal: "静",
      layout: "full",
      props: [{ id: "phone", at: "tl" }, { id: "lamp", at: "br" }],
      diary:
        "他今天回来得比前几天早，进门先把窗户推开一条缝，屋里那股闷味散了，人也松下来，我看他把外套搭在椅背上，坐下来什么都没说，就那么坐着，我也就跟着安静待着。",
      card: "你今天什么都没说，可我知道你松下来了，这就够了。",
      foot: "窗开了一条缝，屋里就活了。",
    },
  },
];

function checkLint() {
  const bad = [];
  for (const c of LINT_CASES) {
    const problems = lintPage(c.page, c.last ?? {});
    const hit = problems.length;
    if (c.want === 0 ? hit !== 0 : hit === 0)
      bad.push(`${c.name}：${hit === 0 ? "没抓出来" : problems.join("；")}`);
  }
  return bad;
}

/**
 * 动作标签的解析。
 * 这是"先做动作再说话"那条链路的第一环：解析错了，桌宠要么不动、
 * 要么把 <act> 当成正文念出来。所以拿几段真会出现的流切片测一下。
 */
function checkActSplitter() {
  const cases = [
    // [分片喂进去, 期望解析出的动作, 期望剩下的正文]
    [["<act>得意</act>\n瞧你那", "样"], "得意", "瞧你那\n样"],
    [["<ac", "t>好奇", "</act>嗯？"], "好奇", "嗯？"],
    [["我", "不知道说什么。"], null, "我不知道说什么。"],
    [["（得意）瞧你那", "样"], null, "（得意）瞧你那\n样"],
  ];
  const bad = [];
  for (const [chunks, wantAct, wantBody] of cases) {
    let got = null;
    let body = "";
    const sp = createActSplitter((a) => (got = a));
    for (const c of chunks) body += sp.push(c);
    body += sp.flush();
    if (got !== wantAct) bad.push(`动作解析成 ${JSON.stringify(got)}，应该是 ${JSON.stringify(wantAct)}`);
    // 正文只比"有没有残留标签"，空白不较真
    if (body.replace(/\s/g, "").length !== wantBody.replace(/\s/g, "").length)
      bad.push(`正文长度不对（${JSON.stringify(body)}）`);
  }
  return bad;
}

function checkWordbook() {
  const file = path.join(ROOT, "server", "wordbook.json");
  if (!fs.existsSync(file)) return { decks: 0, words: 0, bad: "wordbook.json 不存在" };
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const words = data.decks.flatMap((deck) => deck.words ?? []);
    const bad = words.find((word) => !word.word || !word.phonetic || !word.meaning);
    return {
      decks: data.decks.length,
      words: words.length,
      bad: bad ? `${bad.word || "?"} 字段不完整` : "",
      license: data.source?.license,
    };
  } catch (error) {
    return { decks: 0, words: 0, bad: error.message };
  }
}

async function main() {
  console.log(`\nOtto 冒烟测试 → ${BASE}\n`);
  const actionNames = checkActionNames();
  console.log("0. 动作名对齐（服务端发的名字，桌宠那边得认得）");
  check(`服务端用到的 ${actionNames.total} 个动作名都在动作表里`, actionNames.bad.length === 0, actionNames.where);

  const aliasBad = Object.entries(ACTION_ALIAS).filter(([, v]) => !new Set(Object.keys(ACTIONS)).has(v));
  check("模型可挑的动作名都对得上", aliasBad.length === 0, aliasBad.map((b) => b.join("→")).join(", "));
  const leaked = [...SYSTEM_ACTION_WORDS].filter((w) => ACTION_ALIAS[w]);
  check("功能状态没混进模型词表（那些该由程序广播）", leaked.length === 0, leaked.join(", "));

  const props = checkProps();
  check(`服务端的 ${props.total} 个道具都有对应的画`, props.noSvg.length === 0, props.noSvg.join(", "));
  check("画里没有服务端不认识的道具", props.noName.length === 0, props.noName.join(", "));

  const lintBad = checkLint();
  check(`校验规则的 ${LINT_CASES.length} 个用例都对`, lintBad.length === 0, lintBad.join(" / "));

  const actBad = checkActSplitter();
  check("动作标签的解析（先做动作，再说话）", actBad.length === 0, actBad.join(" / "));

  /* 本体：语义识别 + 意图约束。约束错了，模型会做出跟状态矛盾的动作。 */
  const ontoBad = [];
  if (classifySpeechAct("别烦我").act !== "拒绝") ontoBad.push("别烦我没识别成拒绝");
  if (classifySpeechAct("你今天挺可爱的").act !== "评价") ontoBad.push("夸它没识别成评价");
  if (classifySpeechAct("我有点难受").act !== "示弱") ontoBad.push("示弱没识别出来");
  if (intentAllows("withdraw", "proud")) ontoBad.push("退开时不该允许得意");
  if (!intentAllows("show", "proud")) ontoBad.push("展示时应该允许得意");
  check("本体：言语行为与意图约束", ontoBad.length === 0, ontoBad.join(" / "));

  /* 误解与纠正：误读必须由人格造成，纠正必须能被识别 */
  const misBad = [];
  const mis = maybeMisread("嗯", { act: "陈述", confidence: 0.6 }, { dims: { sociability: 0.2 } }, () => 0);
  if (mis?.to !== "拒绝") misBad.push("冷淡人格没把短句读成敷衍");
  const noMis = maybeMisread("我有点难受", { act: "示弱", confidence: 0.75 }, { dims: { sociability: 0.2 } }, () => 0);
  if (noMis !== null) misBad.push("明确的示弱不该被误读");
  if (!isCorrection("你误会了，我不是这个意思")) misBad.push("没认出纠正");
  if (!(misreadChance(0) > misreadChance(3))) misBad.push("纠正三次后误读概率没下降");
  if (misreadChance(3) > 0.09) misBad.push("学了三轮还是太容易误读");
  check("本体：误解由人格造成，纠正可识别", misBad.length === 0, misBad.join(" / "));

  const wordbook = checkWordbook();
  check(
    `离线词库有 ${wordbook.decks} 个主题、${wordbook.words} 个完整词条`,
    wordbook.decks >= 8 && wordbook.words >= 200 && !wordbook.bad,
    wordbook.bad || `来源许可：${wordbook.license}`
  );

  if (STATIC_ONLY) {
    console.log(`\n结果：${pass} 项通过，${fail} 项失败（只跑了静态那几条）\n`);
    process.exit(fail ? 1 : 0);
  }
  // 自检必须幂等：脏库上跑会因为上轮的数据出现假失败
  await api("/api/dev/reset", {});
  await api("/api/settings", { mock: process.env.OTTO_SMOKE_MOCK === "1" });
  await api("/api/settings", { quietMinutes: 0 });
  const state0 = await api("/api/state", undefined, "GET");
  console.log(`模型模式：${state0.llm.mode}` + (state0.llm.mode === "mock" ? "（假模型，链路验证足够）" : ""));
  console.log(`记忆开关：${state0.memoryEnabled ? "开" : "关（对照组）"}\n`);

  console.log("0.4 音乐、词卡与语音工具");
  const modules0 = await api("/api/modules", undefined, "GET");
  check(
    "模块目录一次返回音乐、词库和专注状态",
    modules0.music?.tracks?.length === 6 &&
      modules0.words?.decks?.length === 8 &&
      modules0.words?.stats?.total >= 200 &&
      !!modules0.focus
  );
  await api("/api/settings", { memoryEnabled: false });
  const voiceTurn = await api("/api/voice/turn", {
    text: "今天有点累，你陪我待一会儿吧",
    reply: "那我坐这儿，不吵你。",
    action: "celebrate",
    move: "none",
    sessionId: "sess_smoke_voice",
  });
  check(
    "语音动作冲突时由本体接管",
    voiceTurn.ok === true &&
      voiceTurn.overridden === true &&
      voiceTurn.ontology?.speech?.act === "示弱" &&
      voiceTurn.action !== "celebrate",
    `${voiceTurn.proposedAction} → ${voiceTurn.action}（${voiceTurn.ontology?.intent}）`
  );
  const voiceMessages = await api("/api/messages", undefined, "GET");
  check(
    "语音原话与回应进入关系记录",
    voiceMessages.items?.filter((m) => m.source === "voice").length >= 2,
    `voice=${voiceMessages.items?.filter((m) => m.source === "voice").length ?? 0}`
  );
  await api("/api/settings", { memoryEnabled: true });
  const musicOut = await api("/api/tools/run", {
    action: "music_play",
    args: { query: "夜晚" },
    source: "voice",
  });
  check(
    "语音点歌命中本地曲目并广播播放状态",
    musicOut.ok === true && musicOut.track?.id === "night-train" && musicOut.state?.status === "playing",
    musicOut.spoken
  );
  const wordStart = await api("/api/tools/run", {
    action: "word_start",
    args: { deck: "campus" },
    source: "voice",
  });
  check(
    "语音开始词卡会选中主题并返回可朗读释义",
    wordStart.ok === true && wordStart.word?.deckId === "campus" && !!wordStart.word?.meaning,
    wordStart.spoken
  );
  const wordMark = await api("/api/tools/run", {
    action: "word_mark",
    args: { result: "known" },
    source: "voice",
  });
  check(
    "单词学习结果会写入进度",
    wordMark.ok === true && wordMark.stats?.known >= 1 && wordMark.stats?.today >= 1
  );
  const quizOut = await api("/api/tools/run", {
    action: "word_quiz",
    source: "voice",
  });
  check(
    "单词小测返回四个选项",
    quizOut.ok === true && quizOut.quiz?.options?.length === 4 && !!quizOut.quiz?.word
  );
  const focusStatus = await api("/api/tools/run", {
    action: "focus_status",
    source: "voice",
  });
  check("语音工具能读取专注状态", focusStatus.ok === true && !!focusStatus.spoken);
  const toolState = await api("/api/modules", undefined, "GET");
  check("语音工具调用进入最近工具记录", toolState.recentTools?.length >= 5);

  console.log("0.5 沉浸模式");
  const immOn = await api("/api/immersion", {
    enabled: true,
    module: "quiet",
  });
  check(
    "能进入静默陪坐",
    immOn.state?.enabled === true && immOn.state?.module === "quiet",
    `${immOn.event} · ${immOn.state?.module}`
  );
  const immFoot = await api("/api/immersion", { footAngles: [8.4, 8.1] });
  check(
    "两脚同向时任一只到位即可选模块",
    immFoot.state?.module === "eyes20",
    `${immFoot.state?.moduleInfo?.label} · ${immFoot.state?.moduleInfo?.footAngle}°`
  );
  await api("/api/immersion", { module: "focus25" });
  const immStart = await api("/api/immersion", { command: "start" });
  check(
    "模块开始计时",
    immStart.state?.running === true && immStart.state?.durationMs === 25 * 60 * 1000
  );
  const immPause = await api("/api/immersion", { command: "pause" });
  const immResume = await api("/api/immersion", { command: "resume" });
  check(
    "计时可以暂停并继续",
    immPause.state?.running === false &&
      immPause.state?.remainingMs > 0 &&
      immResume.state?.running === true
  );
  const immMurmur = await api("/api/dev/murmur-check", {});
  check("沉浸模式下不发碎碎念", immMurmur.said === false);
  const immNext = await api("/api/immersion", { command: "next" });
  check("可以跳到休息阶段", immNext.event === "break" && immNext.state?.phase === "break");
  const immOff = await api("/api/immersion", { enabled: false });
  check("能退出并恢复普通陪伴", immOff.event === "exited" && immOff.state?.running === false);

  console.log("1. 人格初始化");
  const named0 = await api("/api/pet/name", undefined, "GET");
  check("第一次点开时它还没被起名", named0.named === false, `默认：${named0.defaultName}`);
  const named = await api("/api/pet/name", { name: "小月汐" });
  check("起了名之后状态跟着变", named.named === true && named.name === "小月汐");
  check("名字进了 /api/state", (await api("/api/state", undefined, "GET")).petName === "小月汐");

  await api("/api/init/start", {});
  const answers = ["安静待着就好", "直接一点", "要有自己的看法", "偶尔来找我"];
  let last = [];
  for (const a of answers) last = await chat(a, "init");
  const personaEvent = last.find((e) => e.type === "done" && e.persona);
  check("4 轮对话后推断出人格", !!personaEvent);
  if (personaEvent) {
    const d = personaEvent.persona.dims;
    console.log(
      `     维度：活跃 ${d.activity} 社交 ${d.sociability} 表达 ${d.expressiveness} 情绪 ${d.amplitude} 好奇 ${d.curiosity}`
    );
  }
  await api("/api/init/lock", {});
  const state1 = await api("/api/state", undefined, "GET");
  check("人格已锁定", !!state1.persona?.locked);

  console.log("\n2. 对话 + 记忆写入");
  const chatEvents = await chat("我下周四有个答辩，有点慌");
  check("拿到了回复", chatEvents.some((e) => e.type === "done"));
  const done = chatEvents.find((e) => e.type === "done");
  /* 先做动作再说话：动作事件必须比 done 早到，而且不能漏进正文 */
  const actEvent = chatEvents.find((e) => e.type === "act");
  check(
    "先出动作，再出正文",
    !!actEvent && chatEvents.indexOf(actEvent) < chatEvents.indexOf(done),
    actEvent ? `动作：${actEvent.action}` : "没有动作事件"
  );
  check("正文里没有残留 <act> 标签", !String(done?.text ?? "").includes("<act"));
  const mindEvent = chatEvents.find((e) => e.type === "mind");
  check("正文里没有残留 <mind> 标签", !String(done?.text ?? "").includes("<mind"));
  console.log(
    `     心理流：${mindEvent ? `出现了「${mindEvent.text.slice(0, 24)}」` : "这次没有（大多数时候不该有）"}`
  );
  const mem = await waitFor(async () => {
    const m = await api("/api/memory", undefined, "GET");
    return m.items?.length ? m : null;
  }, { timeout: 25000, step: 800 });
  check("对话结束后写出了记忆", !!mem, mem ? `共 ${mem.items.length} 条` : "");
  if (mem) for (const m of mem.items) console.log(`     · [${m.category}] ${m.content}`);

  console.log("\n3. open loop 创建");
  let loops = await waitFor(async () => {
    const l = await api("/api/openloops", undefined, "GET");
    return l.items?.some((x) => x.status === "open") ? l : null;
  }, { timeout: 20000, step: 800 });
  check("从对话里抽出了未闭合的线头", !!loops);
  if (loops) {
    for (const l of loops.items)
      console.log(`     · ${l.event}　到期 ${new Date(l.due_at).toLocaleString("zh-CN")}`);
  }

  console.log("\n3.5 日记与解锁阶梯");
  const locked = await api("/api/diary", undefined, "GET");
  check("亲密度低的时候日记是锁着的", !!locked.gate?.locked, locked.gate?.line ? `「${locked.gate.line}」` : "");
  const blocked = await api("/api/diary/peek", {});
  check("想往前翻会被挡下来", blocked.allowed === false);

  // 不动手光等着，最浅的那一层应该自己打开
  await api("/api/settings", { jumpMinutes: 60 * 24 * 4 });
  const afterTime = await api("/api/diary", undefined, "GET");
  check("放几天之后最浅的那一层会自己打开", afterTime.gate?.level === 1, `level=${afterTime.gate?.level}`);

  await api("/api/dev/relation", { intimacy: 60 });
  check("亲密度调上去之后门槛跟着开", (await api("/api/diary", undefined, "GET")).gate?.locked === false);

  const diary = await waitFor(
    async () => {
      const d = await api("/api/diary", undefined, "GET");
      return d.items?.[0]?.content ? d : null;
    },
    { timeout: 40000, step: 1200 }
  );
  check("当天生成了一页日记", !!diary, diary ? `「${diary.items[0].content.slice(0, 44)}」` : "");
  check("日记下面挂着那天的记忆", (diary?.items?.[0]?.memories?.length ?? 0) > 0);
  if (diary) {
    const item = diary.items[0];
    console.log(`     ${item.label} · 聊了 ${item.messageCount} 句 · 记住 ${item.memories.length} 件`);
  }

  console.log("\n3.6 碎碎念");
  console.log("\n3.7 一比特互动（摸一下，不进对话）");
  const beforeTouch = (await api("/api/messages", undefined, "GET")).items.length;
  const touch = await api("/api/pet/touch", { kind: "tap" });
  check("摸一下有反应", !!touch.action, `[${touch.flavor}] ${touch.text ?? "（不出声）"} → ${touch.action}`);
  const touched = await api("/api/pet/touch", { kind: "tap" });
  const touched2 = await api("/api/pet/touch", { kind: "tap" });
  const annoyed = await api("/api/pet/touch", { kind: "tap" });
  check("摸多了它会烦", annoyed.flavor === "annoyed" || touched.flavor === "annoyed" || touched2.flavor === "annoyed");
  check("拎起来和放下是两回事", (await api("/api/pet/touch", { kind: "drag" })).flavor === "lifted");
  check(
    "摸不进对话流",
    (await api("/api/messages", undefined, "GET")).items.length === beforeTouch
  );

  await api("/api/settings", { jumpMinutes: 22 });
  const murmur = await api("/api/dev/murmur-check", {});
  check("日常状态下会嘟囔一句", !!murmur.said, murmur.said ? `「${murmur.text}」` : JSON.stringify(murmur.stats));
  const murmurAgain = await api("/api/dev/murmur-check", {});
  check("刚说完不会马上又说", !murmurAgain.said);

  console.log("\n4. 时间加速 → 主动发起");
  const beforeJump = await api("/api/state", undefined, "GET");
  const target = loops?.items?.find((x) => x.status === "open");
  if (!target) {
    check("到点后它主动开口了", false, "上一步没抽到线头，这一步跳过了");
    console.log(`\n结果：${pass} 项通过，${fail} 项失败\n`);
    process.exit(1);
  }
  const needMinutes = Math.ceil((target.due_at + 60000 - beforeJump.clock.now) / 60000);
  await api("/api/settings", { jumpMinutes: Math.max(1, needMinutes) });
  console.log(`     虚拟时间往前推 ${needMinutes} 分钟（推到线头到期之后）`);
  const tick = await api("/api/dev/proactive-check", {});
  check("到点后它主动开口了", !!tick.message, tick.message ? `「${tick.message}」` : "");

  const msgs = await api("/api/messages", undefined, "GET");
  const proactive = msgs.items.filter((m) => m.proactive);
  check("主动消息进入对话流", proactive.length > 0);

  const tl1 = await api("/api/timeline", undefined, "GET");
  check(
    "关系记录里留下了痕迹",
    tl1.items.some((t) => t.kind === "open_loop_created")
  );

  console.log("\n5. 用户回应 → 线头闭合");
  const sid = proactive.length ? proactive[proactive.length - 1].session_id : undefined;
  await chat("答辩完了，还行", "chat", sid);
  const closed = await waitFor(async () => {
    const l = await api("/api/openloops", undefined, "GET");
    return l.items?.some((x) => x.status === "closed") ? l : null;
  });
  check("线头被标记为已闭合", !!closed);
  const rel = await api("/api/state", undefined, "GET");
  check("共同经历数增加", rel.relation.sharedCount > 0, `sharedCount=${rel.relation.sharedCount}`);

  console.log("\n6. A/B 开关（H2 的对照组）");
  await api("/api/settings", { memoryEnabled: false });
  const off = await chat("我不喝咖啡");
  const recallOff = off.some((e) => e.type === "recall");
  const memAfter = await api("/api/memory", undefined, "GET");
  check("关闭记忆后不再召回", !recallOff);
  const recallTest = await api("/api/dev/recall", { text: "咖啡" });
  check("关闭记忆后不返回任何记忆", (recallTest.memories ?? []).length === 0);
  console.log(`     （记忆库里仍有 ${memAfter.items.length} 条，只是不参与注入）`);

  await api("/api/settings", { memoryEnabled: true });

  console.log("\n7. 埋点");
  const ev = await api("/api/events", undefined, "GET");
  const names = new Set(ev.items.map((e) => e.name));
  for (const need of ["session_start", "memory_write", "open_loop_created", "open_loop_closed", "proactive_sent"]) {
    check(`埋点 ${need}`, names.has(need));
  }
  const social = ev.items.filter((e) => e.name === "session_start").length;
  console.log(`     事件总数 ${ev.items.length}，会话 ${social} 次`);

  console.log(`\n结果：${pass} 项通过，${fail} 项失败\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("冒烟测试崩了：", e);
  process.exit(1);
});
