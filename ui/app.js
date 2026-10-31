import { propSvg } from "/props.js";
import { ACTIONS } from "/actions.js";
import { createModulesUI } from "/modules.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

let state = null;
let sessionId = null;
let sending = false;
let lastRecall = [];
let homeSayText = "";
let extraDays = [];

/** 名字可以改，所以文案里一律写 {{pet}}，渲染之后统一替换 */
const petName = () => state?.petName || "小月汐";

const modulesUI = createModulesUI({
  post: (url, body) => post(url, body),
  toast: (text) => toast(text),
  goto: (tab) => goto(tab),
  petAction: (name) => petAction(name),
  getPetName: () => petName(),
});

function fillPetNames(root = document.body) {
  const name = petName();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const hits = [];
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (n.nodeValue && n.nodeValue.includes("{{pet}}")) hits.push(n);
  }
  for (const n of hits) n.nodeValue = n.nodeValue.replaceAll("{{pet}}", name);
  if (root === document.body) document.title = name;
}

/**
 * 面板里的 Otto（只有头）。
 *
 * 空状态最容易写成一行灰字，那是最没有陪伴感的东西。
 * 让它在这些时候出面——页面空着的时候，正好是它出现的时候。
 * 画法跟桌宠那份形象同一个色：绿头、白圈里的黑瞳仁、一点高光、两片腮红。
 */
function ottoMark() {
  return `<svg class="omark" viewBox="0 0 64 44" aria-hidden="true">
    <rect class="om-head" x="6" y="5" width="52" height="33" rx="9"/>
    <rect class="om-gloss" x="10" y="7.5" width="44" height="3" rx="1.5"/>
    <circle class="om-socket" cx="24" cy="21" r="7.4"/>
    <circle class="om-socket" cx="40" cy="21" r="7.4"/>
    <circle class="om-eye" cx="24" cy="21" r="5.2"/>
    <circle class="om-eye" cx="40" cy="21" r="5.2"/>
    <circle class="om-glint" cx="22.2" cy="19" r="1.7"/>
    <circle class="om-glint" cx="38.2" cy="19" r="1.7"/>
    <ellipse class="om-blush" cx="12.5" cy="30" rx="3.2" ry="1.9"/>
    <ellipse class="om-blush" cx="51.5" cy="30" rx="3.2" ry="1.9"/>
  </svg>`;
}

/** 空状态：它出面 + 一句话 */
function emptyState(text) {
  return `<div class="empty"><span class="em-mark">${ottoMark()}</span><p>${text}</p></div>`;
}

/**
 * 首页那只 Otto（整只，会呼吸、会眨眼）。
 *
 * 形象的本体是 ui/otto.svg，那份是给桌宠用的参数化骨架（姿势、动作、表情全由变量驱动）。
 * 面板里不需要一整套驱动，只需要一只站在纸上的它——所以这里画的是同一只的静态版：
 * 同一套色、同一副比例，呼吸和眨眼用 CSS 做。
 * 两边的形状要对得上，改形象的时候两边都得看一眼。
 */
function deskOtto() {
  return `<svg class="dko" viewBox="0 0 160 190" aria-hidden="true">
    <defs>
      <linearGradient id="dkoHeadG" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#6fd77c"/><stop offset="100%" stop-color="#3ead51"/>
      </linearGradient>
      <linearGradient id="dkoBodyG" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#fbfdfe"/><stop offset="100%" stop-color="#e0e8ef"/>
      </linearGradient>
    </defs>
    <ellipse class="dko-shadow" cx="80" cy="183" rx="50" ry="6.5"/>
    <rect class="dko-leg" x="52" y="108" width="20" height="48" rx="6" fill="url(#dkoBodyG)"/>
    <rect class="dko-leg" x="88" y="108" width="20" height="48" rx="6" fill="url(#dkoBodyG)"/>
    <rect class="dko-leg" x="40" y="156" width="38" height="22" rx="7" fill="url(#dkoBodyG)"/>
    <rect class="dko-leg" x="82" y="156" width="38" height="22" rx="7" fill="url(#dkoBodyG)"/>
    <rect class="dko-body" x="37" y="60" width="86" height="50" rx="6" fill="url(#dkoBodyG)"/>
    <line class="dko-seam" x1="43" y1="67" x2="117" y2="67"/>
    <circle class="dko-led" cx="112" cy="76" r="3"/>
    <rect class="dko-head" x="32" y="2" width="96" height="60" rx="7" fill="url(#dkoHeadG)"/>
    <rect class="dko-gloss" x="38" y="5.5" width="84" height="4.5" rx="2.2"/>
    <ellipse class="dko-blush" cx="44" cy="46.5" rx="8.5" ry="5"/>
    <ellipse class="dko-blush" cx="116" cy="46.5" rx="8.5" ry="5"/>
    <circle cx="58" cy="32" r="15.5" fill="#f2f6f8"/>
    <circle cx="102" cy="32" r="15.5" fill="#f2f6f8"/>
    <g class="dko-pupils">
      <circle cx="58" cy="32" r="9.9" fill="#212932"/>
      <circle cx="102" cy="32" r="9.9" fill="#212932"/>
      <circle cx="54.1" cy="28.1" r="3.2" fill="#ffffff" opacity=".92"/>
      <circle cx="98.1" cy="28.1" r="3.2" fill="#ffffff" opacity=".92"/>
    </g>
    <path class="dko-mouth" d="M70 51.5 Q80 56.5 90 51.5"/>
  </svg>`;
}

/* ---------------- 启动 ---------------- */

init();

async function init() {
  bindTabs();
  bindComposer();
  bindTestPanel();
  bindHome();
  bindImmersion();
  bindContextMenu();
  bindNaming();
  bindQuit();
  bindHints();
  bindRecbar();
  bindOntology();
  renderActGrid();
  renderOntology();
  await refresh();
  // 硬件帧要等模块走完（SERVOS 在上面那段 const 里，提前碰会撞上暂时性死区）
  showFrame("idle");
  await loadMessages();
  connectStream();
  setInterval(tickClockChip, 5000);
  setInterval(tickImmersionUI, 1000);
  fillPetNames();
  maybeAskName();
  post("/api/presence", {});
  document.addEventListener("visibilitychange", () => {
    post("/api/presence", { visible: document.visibilityState === "visible" });
  });
}

function renderTools() {
  /* 工具：都是通道，不是陪伴本身。入口和语音工具共用同一份状态 */
  const TOOLS = [
    {
      title: "听点声音",
      desc: "六首离线环境音乐。点卡片，或者对小智说「放一首雨天的歌」。",
      tag: "已接通",
      run: () => goto("music"),
    },
    {
      title: "背几个词",
      desc: "主题词卡、英文发音、学习进度和一分钟小测。",
      tag: "已接通",
      run: () => goto("words"),
    },
    {
      title: "专注计时",
      desc: "番茄钟、深度工作、护眼和久坐提醒都收在首页工作牌里。",
      tag: "已接通",
      run: () => {
        goto("home");
        setTimeout(() => $("#immersionPanel")?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
      },
    },
    {
      title: "暂停音乐",
      desc: "让小智把正在播放的环境音乐停下来。",
      tag: "语音",
      run: () => modulesUI.run("music_pause"),
    },
    {
      title: "继续上一个词",
      desc: "直接回到当前词卡，不用从第一页重新翻。",
      tag: "语音",
      run: () => goto("words"),
    },
    {
      title: "问问它现在在做什么",
      desc: "汇总音乐、词卡和专注状态。也可以直接问小智。",
      tag: "状态",
      run: async () => {
        const out = await modulesUI.run("status");
        setHomeSay(out.spoken);
      },
    },
  ];
  const box = $("#toolGrid");
  box.innerHTML = "";
  for (const item of TOOLS) {
    const el = document.createElement("button");
    el.className = "tool";
    el.innerHTML = `<div class="t"></div><div class="d"></div><span class="tag"></span>`;
    el.querySelector(".t").textContent = item.title;
    el.querySelector(".d").textContent = item.desc;
    el.querySelector(".tag").textContent = item.tag;
    el.onclick = item.run;
    box.appendChild(el);
  }
}

/* ---------------- 数据 ---------------- */

async function refresh() {
  state = await fetch("/api/state").then((r) => r.json());
  if (!sessionId) sessionId = state.currentSessionId ?? null;
  renderHeader();
  renderHome();
  renderTools();
  renderDims();
  renderLoops();
  renderTestToggles();
  tickClockChip();
  const mem = await fetch("/api/memory").then((r) => r.json());
  renderMemory(mem.items ?? []);
  const diary = await fetch("/api/diary").then((r) => r.json());
  renderDiary(diary.items ?? [], diary.gate);
  renderGate(diary.gate);
  renderHomeObjects(diary.items ?? []);
  const ks = await fetch("/api/keepsakes").then((r) => r.json());
  renderKeepsakes(ks.items ?? []);
  const tl = await fetch("/api/timeline").then((r) => r.json());
  renderTimeline(tl.items ?? [], diary.items ?? []);
  renderHomeRecent(tl.items?.[0]);
  const ev = await fetch("/api/events").then((r) => r.json());
  renderEvents(ev);
  await modulesUI.refresh();
  fillPetNames();
}

/* ---------------- 起名 ---------------- */

function bindNaming() {
  $("#nameOk").addEventListener("click", submitName);
  $("#nameInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitName();
  });
}

/* "让它睡"：整个退出去。
   注意它和右上角那个关闭按钮不是一回事——关掉面板它还在桌面上待着，
   要真的送走它得走这条路，走之前它会先说一句 */
function bindQuit() {
  const btn = $("#quitOtto");
  if (!btn) return;
  btn.addEventListener("click", () => {
    if (window.ottoPet?.quit) window.ottoPet.quit();
    else toast("这是浏览器里打开的，关掉标签页就行");
  });
}

/* ---------------- 硬件条 ---------------- */
/*
 * 这一条是"软件反补硬件"最直白的地方：软件把姿势算出来，往下发给硬件。
 *
 * 起点是桌宠身上正在播的那个动作——跟桌宠共用 ui/actions.js 里同一份姿势数据，
 * 所以面板上显示的角度和它真正摆出来的姿势是一个来源，不会各说各话。
 * 四颗舵机按硬件方案来：头（俯仰）、左腿、右腿、身体前倾；另有一颗蜂鸣器当嘴。
 * 角度以中位 90° 为基准，夹在 20°~160° 之间——真舵机转不到那么远。
 */
const SERVOS = [
  { key: "head", label: "头", pose: "head", gain: 1.1 },
  { key: "hipL", label: "左腿", pose: "hipL", gain: 1 },
  { key: "hipR", label: "右腿", pose: "hipR", gain: 1 },
  { key: "lean", label: "前倾", pose: "lean", gain: 1.2 },
];

/* 出声的场合：蜂鸣器响。它没有喇叭，"说话"在硬件上就是这一颗在响 */
const BUZZ_ACTIONS = new Set(["speaking", "alert", "celebrate", "welcome", "done", "confetti"]);
/* 想着事的时候灯是琥珀色，跟桌宠头顶那颗一致 */
const LED_BUSY = new Set(["listening", "speaking", "think", "studying", "confirm"]);

const clampAngle = (v) => Math.max(20, Math.min(160, Math.round(v)));

function frameFor(actionName) {
  const a = ACTIONS[actionName] ?? ACTIONS.idle ?? {};
  const pose = a.pose ?? {};
  const servos = SERVOS.map((s) => ({
    key: s.key,
    label: s.label,
    deg: clampAngle(90 + (Number(pose[s.pose]) || 0) * s.gain),
  }));
  const led = actionName === "offline" ? "灰" : LED_BUSY.has(actionName) ? "琥珀" : "绿";
  return {
    action: actionName,
    label: a.label ?? actionName,
    servos,
    led,
    buzzer: BUZZ_ACTIONS.has(actionName) ? "响" : "—",
  };
}

let frameTimer = null;

/**
 * 硬件帧。桌宠每动一下，这里跟着报一次。
 * 它在测试面板里（不是给用户看的那条），所以每一块都允许缺席：
 * 拿不到的就跳过，别让整块挂掉。
 */
function showFrame(actionName) {
  if (!actionName) return;
  const f = frameFor(actionName);
  /* 有些动作只有表情——屏幕上看得出来，硬件上一点都看不出来。
     这种事不能藏着：它决定了硬件的表达力边界，也决定了灯和蜂鸣器要承担什么 */
  const spread = Math.max(...f.servos.map((s) => Math.abs(s.deg - 90)));
  const onlyFace = spread < 3 ? "　（这一轮只有表情，硬件上得靠灯和蜂鸣器）" : "";
  const last = $("#hwLast");
  if (last) last.textContent = `刚才下发：${f.label}${onlyFace}`;

  const box = $("#hwServos");
  if (box) {
    box.innerHTML = f.servos
      .map(
        (s) =>
          `<span class="hw-s"><b>${s.label}</b><i><u style="width:${Math.round(
            ((s.deg - 20) / 140) * 100
          )}%"></u></i><em>${s.deg}°</em></span>`
      )
      .join("");
  }
  const aux = $("#hwAux");
  if (aux) {
    aux.innerHTML =
      `<span class="hw-a">灯 <b class="hw-led ${f.led === "琥珀" ? "busy" : f.led === "灰" ? "off" : ""}"></b>${f.led}</span>` +
      `<span class="hw-a">蜂鸣器 <b>${f.buzzer}</b></span>`;
  }
  // 给固件的那一帧，原样放在测试面板里
  const dump = $("#hwFrame");
  if (dump) {
    dump.textContent = JSON.stringify(
      {
        seq: Date.now(),
        action: f.action,
        servos: Object.fromEntries(f.servos.map((s) => [s.key, s.deg])),
        led: f.led,
        buzzer: f.buzzer === "响" ? { tone: 880, ms: 220 } : null,
      },
      null,
      2
    );
  }
  // 一次性动作播完就回中位，硬件也一样
  clearTimeout(frameTimer);
  const a = ACTIONS[actionName] ?? {};
  frameTimer = setTimeout(() => {
    if (a.kind !== "state") showFrame("idle");
  }, a.ms ?? 2400);
}

/**
 * 动作调试台：把动作库整个摊开。
 *
 * 这一栏的意义是"检查"——24 个动作一个个过一遍，看姿势对不对、
 * 翻成硬件之后哪几颗舵机在动、哪些动作其实只有表情。
 * 它走的是 IPC 直接让桌宠演一下，**不经过服务端**，所以不会写事件、
 * 不会进记忆、不动关系：看姿势和"真的发生了"必须是两件事。
 */
function renderActGrid() {
  const box = $("#actGrid");
  if (!box) return;
  box.innerHTML = "";
  for (const [key, a] of Object.entries(ACTIONS)) {
    if (!a || typeof a !== "object" || !a.pose) continue;
    const b = document.createElement("button");
    b.className = "actbtn";
    b.innerHTML = `<span class="ab-label"></span><span class="ab-key"></span>`;
    b.querySelector(".ab-label").textContent = a.label ?? key;
    b.querySelector(".ab-key").textContent = key;
    b.onclick = () => {
      window.ottoPet?.action?.(key);
      showFrame(key);
      post("/api/pet/hardware", { name: key }).catch(() => {});
      toast(window.ottoPet?.action ? `演一遍：${a.label ?? key}` : "桌宠窗口没开着，先看下面的硬件帧");
    };
    box.appendChild(b);
  }
  const moves = [["前进", "walk"], ["后退", "back"], ["左转", "left"],
                 ["右转", "right"], ["弹跳", "bounce"], ["扭动", "wiggle"]];
  for (const [label, key] of moves) {
    const b = document.createElement("button");
    b.className = "actbtn";
    b.innerHTML = `<span class="ab-label"></span><span class="ab-key"></span>`;
    b.querySelector(".ab-label").textContent = "机器人" + label;
    b.querySelector(".ab-key").textContent = "hw:" + key;
    b.onclick = () => {
      post("/api/pet/hardware", { name: key }).catch(() => {});
      toast("机器人：" + label);
    };
    box.appendChild(b);
  }
}

/**
 * 本体调试：六个状态条 + 上一次的"冲突 → 意图 → 动作"。
 * 这个面板的意义是让状态可见——看不见的状态，最后都会变成自嗨。
 */
async function renderOntology() {
  const box = $("#ontoDims");
  if (!box) return;
  let o = null;
  try {
    o = await fetch("/api/ontology").then((r) => r.json());
  } catch {
    return;
  }
  if (!o?.dims) return;
  box.innerHTML = o.dims
    .map(
      (d) => `<div class="onto-d">
        <span class="onto-l">${d.label}</span>
        <i><u style="width:${Math.round(d.value * 100)}%"></u><em style="left:${Math.round(d.base * 100)}%"></em></i>
        <b>${d.value.toFixed(2)}</b>
      </div>`
    )
    .join("");
  const el = $("#ontoDecision");
  const last = o.lastDecision;
  if (!last) {
    el.textContent = "还没有观察过。";
    return;
  }
  el.innerHTML = `<div class="onto-line">
      <b>${last.speech.act}</b>（${last.speech.confidence}） ·
      冲突：${last.conflict.label} ${last.conflict.tension} ·
      意图：<b>${last.intent}</b> · 动作：<b>${last.action}</b>
    </div><div class="onto-reason"></div>
    ${
      last.misread
        ? `<div class="onto-mis">上次误读：${last.misread.from} → ${last.misread.to}（${last.misread.why}）</div>`
        : ""
    }
    ${last.calibrated ? `<div class="onto-mis">这条用的是校准后的读法。</div>` : ""}`;
  el.querySelector(".onto-reason").textContent = `「${last.text}」 → ${last.reason}`;
  el.querySelector(".onto-reason").textContent += ` · 已校准 ${o.calibrations ?? 0} 条`;
}

async function runOntology() {
  const input = $("#ontoInput");
  const text = (input?.value ?? "").trim();
  if (!text) return toast("先说一句");
  await post("/api/ontology/observe", { text });
  input.value = "";
  await renderOntology();
  toast("观察了一次");
}

function bindOntology() {
  $("#ontoRun")?.addEventListener("click", runOntology);
  $("#ontoInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runOntology();
  });
  $("#ontoReset")?.addEventListener("click", async () => {
    await post("/api/ontology/reset", {});
    await renderOntology();
    toast("本体归零");
  });
}

/* 第一次用它的人需要知道能干什么 */
function bindHints() {
  const box = $("#hints");
  if (!box) return;
  if (localStorage.getItem("ottoHints") === "1") return;
  box.classList.remove("hidden");
  $("#hintsClose").addEventListener("click", () => {
    localStorage.setItem("ottoHints", "1");
    box.classList.add("hidden");
  });
}

/* 顶部那条"记录"提示：点一下就去看看现在记了什么 */
function bindRecbar() {
  const btn = $("#recGo");
  if (btn) btn.addEventListener("click", () => goto("timeline"));
}

function maybeAskName(force = false) {
  if (!force && state?.petNamed) return;
  $("#nameInput").value = state?.petName || "小月汐";
  $("#nameModal").classList.remove("hidden");
  setTimeout(() => {
    $("#nameInput").focus();
    $("#nameInput").select();
  }, 60);
}

async function submitName() {
  const name = ($("#nameInput").value || "").trim() || "小月汐";
  const r = await post("/api/pet/name", { name });
  $("#nameModal").classList.add("hidden");
  state.petName = r.name;
  state.petNamed = true;
  document.title = r.name;
  location.reload();
}

function renderHeader() {
  const { relation, llm, init: initState_, memoryEnabled } = state;
  // 不叫"亲密度"了。亲密是有上限的，了解没有——而且"了解"不会把人推开
  $("#relationLine").textContent = `${relation.stageLabel} · 共同经历 ${relation.sharedCount} 条 · 它了解你 ${Math.round(relation.intimacy)} 分`;
  $("#llmChip").textContent =
    llm.mode === "live" ? `模型 ${llm.model}` : llm.mode === "mock" ? "模型 mock" : "模型 未配置";
  $("#statusDot").className = "dot" + (llm.mode === "no_key" ? " off" : "");

  const banner = $("#banner");
  if (llm.mode === "no_key") {
    banner.className = "banner err";
    banner.textContent = "还没配置 DeepSeek API Key：把 .env 里的 DEEPSEEK_API_KEY 填上，然后重启。现在可以先用 mock 模式跑通链路（OTTO_MOCK_LLM=1）。";
  } else if (llm.mode === "mock" && state.llm.keyConfigured) {
    banner.className = "banner";
    banner.textContent = "当前是假模型（mock），回复内容是写死的，只用来验证记忆和 open loop 在不在跑。要用真实模型，去测试面板把「用假模型跑」关掉。";
  } else if (!memoryEnabled) {
    banner.className = "banner";
    banner.textContent = "当前是 A/B 对照组的「无长期记忆」版本：{{pet}}不会记住任何事，也不会主动提起。";
  } else {
    banner.className = "banner hidden";
  }

  $("#initHint").classList.toggle("hidden", initState_.done);
  $("#startInit").textContent = initState_.started ? "继续初始化" : "开始初始化";
}

function tickClockChip() {
  if (!state?.clock) return;
  const drift = state.clock.driftMs ?? 0;
  const virtual = new Date(state.clock.now);
  const y = virtual.getFullYear(), m = `${virtual.getMonth() + 1}`.padStart(2, "0");
  const d = `${virtual.getDate()}`.padStart(2, "0"), hh = `${virtual.getHours()}`.padStart(2, "0");
  const mm = `${virtual.getMinutes()}`.padStart(2, "0");
  $("#clockChip").textContent = `${y}-${m}-${d} ${hh}:${mm} · ${state.clock.scale}×`;
  $("#clockDetail").textContent =
    `虚拟时间：${y}-${m}-${d} ${hh}:${mm}　倍速：${state.clock.scale}×　` +
    `相对真实时间偏移：${drift >= 0 ? "+" : ""}${(drift / 3600000).toFixed(1)} 小时`;
}

/* ---------------- 标签页 ---------------- */

function bindTabs() {
  $$(".tab").forEach((btn) =>
    btn.addEventListener("click", () => {
      $$(".tab").forEach((b) => b.classList.toggle("active", b === btn));
      $$(".pane").forEach((p) => p.classList.toggle("active", p.id === `pane-${btn.dataset.tab}`));
    })
  );
}

function switchTab(name) {
  $(`.tab[data-tab="${name}"]`)?.click();
}

/* ---------------- 首页 ---------------- */
/* 12.1：用户不点任何东西，也应该已经得到了一次陪伴。按钮是备选项，不是这一页的目的。 */

function bindHome() {
  $("#goChat").addEventListener("click", () => switchTab("chat"));
  $("#goTimeline").addEventListener("click", () => switchTab("timeline"));
  $("#homeTop").addEventListener("contextmenu", (e) => {
    e.preventDefault();
    showCtx(e.clientX, e.clientY, [
      { label: "{{pet}}记得的事", action: openMemModal },
      { label: "让{{pet}}安静两个小时", action: () => quietFor(120) },
      { label: "给{{pet}}改个名字", action: () => maybeAskName(true) },
    ]);
  });
}

function homeStateText() {
  const im = state.immersion;
  if (im?.enabled) {
    if (im.phase === "complete") return "{{pet}}陪你做完了这一段，正在安静等你。";
    if (im.running && im.phase === "break") return "{{pet}}提醒你离开屏幕一会儿。";
    if (im.running) return "{{pet}}倒过来坐着，不催你，也不表演。";
    return "{{pet}}已经安静下来，等你选一段工作节奏。";
  }
  const loops = state.openLoops ?? [];
  const since = (state.clock.now - (state.relation.updatedAt ?? state.clock.now)) / 60000;
  if (loops.some((l) => l.due_at <= state.clock.now)) return "{{pet}}好像一直记着一件事，还没找到机会问你。";
  if (since < 10) return "刚聊完，{{pet}}还挺精神。";
  if (since < 120) return "{{pet}}趴在桌角，偶尔动一下。";
  if (since < 1440) return "{{pet}}趴着，看起来有点无聊。";
  return "{{pet}}趴着，好像睡了一会儿。";
}

function homeFallbackSay() {
  if (state.immersion?.enabled) return "它把想说的话先收起来了。需要的时候，你还在这里找得到它。";
  const loops = state.openLoops ?? [];
  if (loops.length) return `{{pet}}记着「${loops[0].event}」。`;
  if (state.memoryCount > 0) return `{{pet}}记着 ${state.memoryCount} 件事。`;
  return "{{pet}}还没记住什么。跟它说点什么吧。";
}

function renderHome() {
  const r = state.relation;
  const created = state.persona?.createdAt;
  const days = created ? Math.max(0, Math.floor((state.clock.now - created) / 86400000)) : 0;
  // 首页那只它：整只站在纸上，跟桌宠是同一个形象
  const ottoBox = $("#homeOtto");
  if (ottoBox && !ottoBox.firstChild) ottoBox.innerHTML = deskOtto();
  $("#homeSub").textContent =
    r.stageLabel + (created ? ` · 认识 ${days} 天` : "") + ` · 共同经历 ${r.sharedCount} 条`;
  $("#homeState").textContent = homeStateText();
  if (!homeSayText) $("#homeSay").textContent = homeFallbackSay();
  renderImmersion();
}

/* ---------------- 沉浸模式 ---------------- */

function immTime(ms) {
  if (ms == null || !Number.isFinite(ms)) return "∞";
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function renderImmersion() {
  const im = state?.immersion;
  const panel = $("#immersionPanel");
  if (!im || !panel) return;
  const active = !!im.enabled;
  panel.classList.toggle("on", active);
  panel.classList.toggle("off", !active);
  $("#immersionToggle").checked = active;
  $("#immersionToggleText").textContent = active ? "开启" : "关闭";
  $("#immersionLead").textContent = active
    ? "自由动作已经停下。它只保留工作计时、阶段提醒和你主动发起的互动。"
    : "打开后，它不再自己碎碎念、做彩蛋或主动找你，只留必要的提醒。";

  const moduleBox = $("#immersionModules");
  moduleBox.innerHTML = "";
  for (const mod of im.modules ?? []) {
    const b = document.createElement("button");
    b.className = "imm-module" + (mod.id === im.module ? " active" : "");
    b.innerHTML = "<b></b><span></span><em></em>";
    b.querySelector("b").textContent = mod.label;
    b.querySelector("span").textContent = mod.hint;
    b.querySelector("em").textContent = `脚位 ${mod.footAngle > 0 ? "+" : ""}${mod.footAngle}°`;
    b.onclick = async () => {
      if (im.running && !confirm("换模块会结束当前计时，继续吗？")) return;
      await changeImmersion({ module: mod.id });
    };
    moduleBox.appendChild(b);
  }

  const mod = im.moduleInfo;
  $("#immersionModuleHint").textContent = mod?.hint ?? "";
  $("#immersionFootRule").textContent = im.footRule ?? "";
  const isQuiet = im.module === "quiet";
  const pause = $("#immersionPause");
  pause.classList.toggle("hidden", isQuiet || im.phase === "complete");
  pause.textContent = im.running ? "暂停计时" : "继续计时";
  $("#immersionNext").classList.toggle("hidden", isQuiet);
  $("#immersionStart").textContent =
    im.phase === "complete" ? "再来一段" : isQuiet && im.running ? "重新开始陪坐" : "开始这一段";
  tickImmersionUI();
}

function tickImmersionUI() {
  const im = state?.immersion;
  if (!im) return;
  const quiet = im.module === "quiet";
  $("#immersionPhase").textContent = quiet
    ? im.running ? "陪坐中" : "静默陪坐"
    : im.phaseLabel;
  $("#immersionClock").textContent =
    im.phase === "complete" ? "00:00" : immTime(im.remainingMs);
  $("#immersionProgress").style.width = `${Math.round((im.progress ?? 0) * 100)}%`;
}

async function changeImmersion(body) {
  const out = await post("/api/immersion", body);
  if (out?.error) {
    toast(out.error);
    return out;
  }
  if (out?.state) {
    state.immersion = out.state;
    renderHome();
  }
  if (out?.notice) {
    setHomeSay(out.notice);
    toast(out.notice);
  }
  return out;
}

function bindImmersion() {
  $("#immersionToggle").addEventListener("change", async (e) => {
    await changeImmersion({ enabled: e.target.checked });
  });
  $("#immersionStart").addEventListener("click", async () => {
    if (!state?.immersion?.enabled) await changeImmersion({ enabled: true });
    await changeImmersion({ command: "start" });
  });
  $("#immersionPause").addEventListener("click", async () => {
    await changeImmersion({ command: state?.immersion?.running ? "pause" : "resume" });
  });
  $("#immersionNext").addEventListener("click", () => changeImmersion({ command: "next" }));
  $("#immersionReset").addEventListener("click", () => changeImmersion({ command: "reset" }));
}

/**
 * 桌上那三样东西：一张便签、今天那一页、一个还没到点的信封。
 *
 * 首页回答的是"它和我之间今天发生了什么"，不是"这个 App 有什么功能"。
 * 所以这三样都是**已经发生的事**，点一下都能走到那个东西所在的那一页。
 */
function renderHomeObjects(days) {
  const note = $("#homeToday");
  const page = $("#homePage");
  const letter = $("#homeLetter");
  const today = (days ?? []).find((d) => d.cardUnlocked === false) ?? (days ?? [])[0] ?? null;

  if (!today) {
    note.innerHTML = `<b>今天</b>还没什么。跟它说句话，或者晚点回来看。`;
    page.innerHTML = `<span class="d-empty">今天这一页还空着</span>`;
    letter.innerHTML = `<span class="d-empty">信封也还空着</span>`;
    return;
  }

  const bits = [`聊了 ${today.messageCount} 句`];
  if (today.memories?.length) bits.push(`记住 ${today.memories.length} 件`);
  if (today.proactiveCount) bits.push(`它主动找过你 ${today.proactiveCount} 次`);
  note.innerHTML = `<b>今天</b>　${bits.join(" · ")}`;
  note.onclick = () => goto("memory");

  // 一张纸：今天那一页的缩略。想看全的就去它的本子
  if (today.content) {
    const head = today.content.replace(/\s+/g, "").slice(0, 24);
    page.innerHTML = `<span class="d-seal">${escapeHtml(today.seal ?? "页")}</span>
      <span class="d-text">${escapeHtml(head)}…</span>
      <span class="d-go">翻开这一页 →</span>`;
  } else {
    page.innerHTML = `<span class="d-empty">今天这一页它还在写</span>`;
  }
  page.onclick = () => goto("memory");

  // 信封：锁着的时候连口都不开，这就是"等一天"的分量
  if (today.card) {
    letter.innerHTML = today.cardUnlocked
      ? `<span class="d-seal">✦</span><span class="d-text">它给你留了一张卡片，点开看看</span>`
      : `<span class="d-seal">✉</span><span class="d-text">它给你留了一张卡片，<b>明天可以翻开</b></span>`;
  } else {
    letter.innerHTML = `<span class="d-empty">今天它还没写卡片</span>`;
  }
  letter.onclick = () => goto("timeline");
}

/** 跳到某一页（跟点那个页签是一回事） */
function goto(tab) {
  const btn = [...document.querySelectorAll(".tab")].find((b) => b.dataset.tab === tab);
  if (btn) btn.click();
}

function setHomeSay(text) {
  homeSayText = text;
  $("#homeSay").textContent = text;
}

/** 第三层：最近的关系变化，只给一条，不是列表 */
function renderHomeRecent(item) {
  const el = $("#homeRecent");
  if (!item) {
    el.textContent = "";
    return;
  }
  const when = new Date(item.ts).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  el.textContent = `${when}　${item.title}${item.detail ? `：${item.detail}` : ""}`;
}

function renderKeepsakes(items) {
  const box = $("#homeKeepsakes");
  if (!items.length) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML = `<div class="k-title">{{pet}}自己留着的东西</div>`;
  const row = document.createElement("div");
  row.className = "k-row";
  for (const m of items) {
    const el = document.createElement("div");
    el.className = "k-item";
    el.title = m.content;
    el.innerHTML = `<div class="k-note"></div><div class="k-content"></div>`;
    el.querySelector(".k-note").textContent = m.keepsakeNote || "留着";
    el.querySelector(".k-content").textContent = m.content;
    el.addEventListener("click", () => toast(m.content));
    row.appendChild(el);
  }
  box.appendChild(row);
}

async function quietFor(minutes) {
  await post("/api/settings", { quietMinutes: minutes });
  toast(`行，我安静 ${minutes} 分钟。别想我。`);
  refresh();
}

/* ---------------- 对话 ---------------- */

function bindComposer() {
  const input = $("#input");
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  });
  /* 你开始打字 = 它在听。这是最便宜的一条"在场感"：
     不用你说什么，它先转过来看着你 */
  input.addEventListener("focus", () => petAction("listening"));
  input.addEventListener("blur", () => petAction("idle"));
  input.addEventListener("keydown", () => petAction("listening"));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  $("#send").addEventListener("click", send);
  $("#startInit").addEventListener("click", startInit);
  $("#openPet").addEventListener("click", () => window.open("/pet", "ottoPet", "width=260,height=300"));
}

/* 面板和桌宠是两个窗口。走服务端广播，浏览器里打开也能用 */
let lastPetAction = null;
function petAction(name) {
  if (name === lastPetAction) return;
  lastPetAction = name;
  post("/api/pet/action", { name }).catch(() => {});
}

async function loadMessages() {
  const { items } = await fetch("/api/messages").then((r) => r.json());
  const box = $("#messages");
  box.innerHTML = "";
  for (const m of items.slice(-40)) {
    const meta = m.meta ? safeParse(m.meta) : null;
    if (meta?.mind) appendMind(meta.mind);
    appendMessage({
      role: m.role,
      content: m.content,
      proactive: !!m.proactive,
      ts: m.created_at,
    });
  }
  // ?shot=1 时保持滚动条在顶部，便于截图核对（离屏渲染下滚动内容会漏栅格化）
  if (!location.search.includes("shot=1")) box.scrollTop = box.scrollHeight;
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** 心理流：它没说出口的那一层。默认收起来，不折叠就会变成噪音 */
function appendMind(text) {
  const el = document.createElement("div");
  el.className = "mind collapsed";
  el.innerHTML = `<span class="mind-tag">没说出口的</span><span class="mind-text"></span>`;
  el.querySelector(".mind-text").textContent = text;
  el.title = "点一下展开或收起";
  el.addEventListener("click", () => el.classList.toggle("collapsed"));
  $("#messages").appendChild(el);
  $("#messages").scrollTop = $("#messages").scrollHeight;
  return el;
}

/** 召回提示：不是播报"我想起了"，是它心里浮上来的那一条。
    只给一条、字号压到最小；点开能看它记得的所有事。 */
function appendRecallNote(m) {
  if (!m) return null;
  const el = document.createElement("div");
  el.className = "recall-note";
  el.textContent = `记着：${m.content}`;
  el.title = "点开看它记得的所有事";
  el.addEventListener("click", openMemModal);
  $("#messages").appendChild(el);
  $("#messages").scrollTop = $("#messages").scrollHeight;
  return el;
}

function appendMessage({ role, content, proactive, ts, kind }) {
  const div = document.createElement("div");
  div.className = `msg ${role === "user" ? "user" : "otto"}${proactive ? " proactive" : ""}${kind ? ` ${kind}` : ""}`;
  if (proactive) {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = "{{pet}}主动找你的";
    div.appendChild(tag);
  }
  div.appendChild(document.createTextNode(content));
  if (ts) div.title = new Date(ts).toLocaleString("zh-CN");
  $("#messages").appendChild(div);
  $("#messages").scrollTop = $("#messages").scrollHeight;
  fillPetNames(div);
  return div;
}

function appendMeta(text, kind = "meta") {
  return appendMessage({ role: "otto", content: text, kind });
}

async function startInit() {
  const r = await fetch("/api/init/start", { method: "POST" }).then((x) => x.json());
  appendMessage({ role: "otto", content: r.question });
  $("#initHint").classList.add("hidden");
  $("#input").focus();
  await refresh();
}

async function send() {
  const input = $("#input");
  const text = input.value.trim();
  if (!text || sending) return;
  input.value = "";
  input.style.height = "auto";
  sending = true;
  $("#send").disabled = true;

  const mode = state?.init?.done ? "chat" : "init";
  appendMessage({ role: "user", content: text, ts: Date.now() });

  let bubble = null;
  let buffer = "";
  let meta = null;
  let thinkNode = null;

  const ensureBubble = () => {
    if (!bubble) {
      bubble = appendMessage({ role: "otto", content: "" });
    }
    return bubble;
  };

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, sessionId, mode }),
    });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (ev.type === "user_saved" && ev.sessionId) sessionId = ev.sessionId;
        if (ev.type === "info") appendMeta(ev.text);
        if (ev.type === "mind") appendMind(ev.text);
        if (ev.type === "recall") {
          lastRecall = ev.memories;
          renderRecall();
          appendRecallNote(ev.memories[0]);
        }
        if (ev.type === "stall") {
          thinkNode = appendMeta(ev.text ?? "……我想想", "thinking");
          window.ottoPet?.action?.(ev.action ?? "think");
        }
        if (ev.type === "delta") {
          if (thinkNode) {
            thinkNode.remove();
            thinkNode = null;
          }
          if (!buffer) petAction("speaking");
          buffer += ev.text;
          const node = ensureBubble();
          node.textContent = buffer;
          $("#messages").scrollTop = $("#messages").scrollHeight;
        }
        if (ev.type === "done") {
          meta = ev;
          if (thinkNode) {
            thinkNode.remove();
            thinkNode = null;
          }
          const node = ensureBubble();
          node.textContent = ev.text ?? buffer;
          window.ottoPet?.action?.(ev.action ?? "look_up");
          if (ev.degraded) appendMeta(`（降级：${ev.degraded}，这次没有正常生成）`);
        }
        if (ev.type === "error") appendMeta(`出错了：${ev.message}`);
      }
    }
  } catch (e) {
    appendMeta(`连接断了：${e.message}`);
  } finally {
    if (thinkNode) thinkNode.remove();
    sending = false;
    $("#send").disabled = false;
    $("#input").focus();
    if (meta?.init) await refresh();
    if (meta?.persona) {
      renderDims(meta.persona.dims);
  appendMeta("把{{pet}}拖到你想的位置，然后点「定下来」。每个维度只有一次机会。");
    }
  }
}

/* ---------------- 记忆页 ---------------- */

const CAT_LABEL = { user_info: "用户信息记忆", event: "事件记忆", relationship: "关系记忆" };

/* ---------------- 日记本 ---------------- */
/* 合上的时候它是一本合着的本子，腰封上印着倒计时；翻开之后是跨页，
   还没到手的那几天变成一叠封着的页。 */

const DAY_MS = 86400000;
const UNIT_LABEL = { d: "天", h: "时", m: "分", s: "秒" };
const REL_DAYS = ["今天", "昨天", "前天"];
let diaryTick = null;
let diaryCounts = [];

/** state.clock 只是一次快照，要按倍速往前推，倒计时才和虚拟时钟一致 */
function virtualNow() {
  const c = state?.clock;
  if (!c) return Date.now();
  return c.now + (Date.now() - (c.realNow ?? Date.now())) * (c.scale ?? 1);
}

const leftMs = (openAt) => Math.max(0, openAt - virtualNow());

/** 倒计时的精度随临近收紧：还有几天只看天/时，最后一小时才走到分/秒 */
function countUnits(left) {
  if (left < 3600000) return "ms";
  if (left < DAY_MS) return "hm";
  return "dh";
}

function splitTime(ms) {
  const t = Math.max(0, ms);
  return {
    d: Math.floor(t / DAY_MS),
    h: Math.floor(t / 3600000) % 24,
    m: Math.floor(t / 60000) % 60,
    s: Math.floor(t / 1000) % 60,
  };
}

function stamp(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`;
}

/** 一行数字牌。建好之后每一秒只改数字，不重建 DOM */
function countdown(openAt, size = "") {
  const units = countUnits(leftMs(openAt));
  const box = document.createElement("div");
  box.className = "bk-count" + (size ? ` ${size}` : units === "ms" ? " lg" : "");
  box.dataset.until = String(openAt);
  box.dataset.units = units;
  const tiles = document.createElement("div");
  tiles.className = "bk-tiles";
  for (const u of units) {
    const tile = document.createElement("span");
    tile.className = "bk-tile";
    tile.innerHTML = '<span class="n"></span><span class="u"></span>';
    tile.querySelector(".u").textContent = UNIT_LABEL[u];
    tiles.appendChild(tile);
  }
  box.appendChild(tiles);
  return box;
}

function paintCountdowns() {
  for (const c of diaryCounts) {
    if (!c.el.isConnected) continue;
    const p = splitTime(c.until - virtualNow());
    c.nums.forEach((n, i) => {
      const u = c.units[i];
      const v = u === "d" ? String(p.d) : String(p[u]).padStart(2, "0");
      if (n.textContent !== v) n.textContent = v;
    });
  }
}

/** 每次重画日记都重新收一遍，顺手重置心跳 */
function mountCountdowns() {
  if (diaryTick) clearInterval(diaryTick);
  diaryCounts = [...document.querySelectorAll("#pane-memory .bk-count")].map((el) => ({
    el,
    until: Number(el.dataset.until),
    units: el.dataset.units,
    nums: [...el.querySelectorAll(".bk-tile .n")],
  }));
  paintCountdowns();
  if (diaryCounts.length) diaryTick = setInterval(paintCountdowns, 1000);
}

/** 合上的本子：腰封上印着下次什么时候开 */
function lockedBook(gate) {
  const next = gate.next;
  const wrap = document.createElement("div");
  wrap.className = "bk" + (next && leftMs(next.openAt) < 3600000 ? " ajar" : "");
  wrap.innerHTML = `
    <p class="bk-say"></p>
    <div class="bk-book">
      <div class="bk-block"><span class="bk-fore"></span><span class="bk-bot"></span></div>
      <div class="bk-top"></div>
      <div class="bk-glow"></div>
      <div class="bk-cover">
        <span class="bk-frame"></span>
        <span class="bk-title">{{pet}}</span>
        <span class="bk-chop"></span>
      </div>
      <div class="bk-band">
        <div class="bk-band-label">还有</div>
        <div class="bk-slots"></div>
        <div class="bk-band-date"></div>
        <div class="bk-peek">趁{{pet}}不注意看一眼 (¬‿¬)</div>
        <span class="bk-seal"><span class="bk-lock"></span></span>
      </div>
    </div>
    <p class="bk-foot">现在的{{pet}}还不想你看它的日记，不要偷看哦</p>`;
  wrap.querySelector(".bk-say").textContent =
    next && leftMs(next.openAt) < 3600000 ? "就快了，过一个小时左右吧。" : "{{pet}}将日记本锁起来了";
  if (next) {
    wrap.querySelector(".bk-band-date").textContent = `${stamp(next.openAt)} 之后`;
    wrap.querySelector(".bk-slots").replaceWith(countdown(next.openAt));
  }
  fillPetNames(wrap);
  return wrap;
}

/** 翻开之后，还没到手的那几天：一叠封着的页 */
function sealedStrip(gate) {
  const wrap = document.createElement("div");
  wrap.className = "bk-sealed";
  wrap.innerHTML = `
    <span class="bk-edges"></span>
    <div class="bk-sbody">
      <div class="bk-srow">
        <span id="sealLine">往前还有 ${gate.hiddenCount} 页，趁{{pet}}不注意也只能看一眼。</span>
        <button id="peekBtn" class="bk-pbtn">试试往前翻</button>
      </div>
      <div class="bk-srow2"></div>
    </div>`;
  if (gate.next) {
    const row = wrap.querySelector(".bk-srow2");
    row.appendChild(countdown(gate.next.openAt, "sm"));
    const when = document.createElement("span");
    when.textContent = `${stamp(gate.next.openAt)} 之后 · ${gate.next.label}`;
    row.appendChild(when);
  }
  wrap.querySelector("#peekBtn").addEventListener("click", peek);
  fillPetNames(wrap);
  return wrap;
}

function renderDiary(items, gate) {
  const box = $("#diaryList");
  box.innerHTML = "";
  if (gate?.locked) {
    box.classList.add("hidden");
    return;
  }
  box.classList.remove("hidden");
  if (!items.length && !extraDays.length) {
    box.innerHTML = emptyState("你们还没开始。<br>第一页会在你们第一次聊完之后出现。");
    return;
  }
  for (const d of items) box.appendChild(dayPage(d));
  for (const d of extraDays) box.appendChild(dayPage(d, true));
}

/**
 * 一页手账。五个部件长在一张纸上：印章、道具、正文、页脚、纸面上的痕迹。
 *
 * 版式不是"换个摆法"，而是**图文关系**：
 *   side   左边一张贴着的纸，正文从它右边起头
 *   note   正文中间横着一张票——读到一半会撞上它
 *   full   顶上一长条画面，正文压在它下面（有一点重叠，不是两块）
 *   margin 道具靠在页边，正文居中，安静
 *   huge   印章放大成水印，压在正文底下
 * 所以道具不是"配图"，它占的是正文旁边那块位置。
 */
function dayPage(d, peeked = false) {
  const el = document.createElement("article");
  const layout = ["side", "note", "full", "margin", "huge"].includes(d.layout) ? d.layout : "side";
  el.className = `hp L-${layout}` + (peeked ? " peeked" : "");

  const props = Array.isArray(d.props) ? d.props.slice(0, 3) : [];
  const main = props[0]?.id ? propSvg(props[0].id) : "";
  const doodles = props.slice(1).filter((p) => p?.id);

  const meta = [`聊了 ${d.messageCount} 句`];
  if (d.memories?.length) meta.push(`记住 ${d.memories.length} 件`);
  if (d.proactiveCount) meta.push(`它主动找过你 ${d.proactiveCount} 次`);

  el.innerHTML = `
    <span class="hp-bind"></span>
    <span class="hp-tab"></span>
    <header class="hp-head">
      <span class="hp-day"></span>
      <span class="hp-date"></span>
      ${d.seal ? '<span class="hp-seal"></span>' : ""}
      ${peeked ? '<i class="hp-mark">偷偷多看的一眼</i>' : ""}
      <span class="hp-meta"></span>
    </header>
    <div class="hp-body">
      ${main ? `<figure class="hp-fig"><span class="hp-tape"></span>${main}</figure>` : ""}
      <div class="hp-text"></div>
      ${doodles
        .map((p) => `<figure class="hp-doodle at-${p.at ?? "br"}">${propSvg(p.id)}</figure>`)
        .join("")}
    </div>
    <footer class="hp-foot">
      <span class="hp-line"></span>
      <span class="hp-tools"></span>
    </footer>`;

  el.querySelector(".hp-day").textContent = d.label;
  // "10月19日 · 周一"这种标签自己就带日期了，再补一个就成了两个
  el.querySelector(".hp-date").textContent = REL_DAYS.includes(d.label) ? `· ${d.date}` : "";
  el.querySelector(".hp-meta").textContent = meta.join(" · ");
  el.querySelector(".hp-tab").textContent = String(Number(d.day.slice(-2)));
  const seal = el.querySelector(".hp-seal");
  if (seal) seal.textContent = d.seal;

  // 它自己分段，按空行切开，一段一个段落，别糊成一坨
  const paras = d.content ? d.content.split(/\n+/).map((s) => s.trim()).filter(Boolean) : [];
  const textBox = el.querySelector(".hp-text");
  const fig = el.querySelector(".hp-fig");
  const put = (t) => {
    const p = document.createElement("p");
    p.className = "hp-p";
    p.textContent = t;
    textBox.appendChild(p);
  };
  if (!paras.length) {
    put("这一页还没写完。");
    textBox.querySelector(".hp-p").classList.add("hp-idle");
  } else if (layout === "note" && fig && paras.length > 1) {
    // 票夹在段落中间，这一版式的意思就在这里
    put(paras[0]);
    textBox.appendChild(fig);
    for (const t of paras.slice(1)) put(t);
  } else {
    for (const t of paras) put(t);
  }

  // full 和 note 这两版里，小画是长在图里头的；其它版式它们散在页边
  if (fig && (layout === "full" || layout === "note")) {
    for (const d2 of [...el.querySelectorAll(".hp-doodle")]) fig.appendChild(d2);
  }

  const foot = el.querySelector(".hp-line");
  if (d.foot) foot.textContent = `—— ${d.foot}`;
  else foot.remove();

  // 这一天的记忆：它是证据，所以收成一个可以合上的小抽屉，别抢正文
  if (d.memories?.length) {
    const keep = document.createElement("details");
    keep.className = "hp-keep";
    keep.innerHTML = `<summary>这天它记住的 ${d.memories.length} 件</summary><ul></ul>`;
    const ul = keep.querySelector("ul");
    for (const m of d.memories) ul.appendChild(memoryCard(m, { compact: true }));
    el.insertBefore(keep, el.querySelector(".hp-foot"));
  }

  el.querySelector(".hp-tools").appendChild(
    button(
      "重写这一页",
      async () => {
        toast("重写这一页……");
        await post("/api/diary/refresh", { day: d.day });
        refresh();
      },
      "hp-pbtn"
    )
  );
  fillPetNames(el);
  return el;
}

function renderGate(gate) {
  const el = $("#diaryGate");
  const title = $("#diaryTitle");
  const lead = $("#diaryLead");
  el.innerHTML = "";
  if (!gate) {
    el.className = "dg hidden";
    return;
  }

  if (gate.locked) {
    title.textContent = "{{pet}}的本子";
    lead.textContent = "它自己的本子。什么时候给你看，它说了算。";
    el.className = "dg";
    el.appendChild(lockedBook(gate));
    fillPetNames($("#pane-memory"));
    mountCountdowns();
    return;
  }

  title.textContent = "{{pet}}记下的日子";
  lead.textContent =
    "一天一页手账：印章、画面、正文、页脚写在同一张纸上，是{{pet}}写给自己看的。" +
    "这天它记住的事收在每页底下。" +
    (gate.dev ? "（开发模式：日记全开）" : "");
  el.className = "dg";
  if (gate.hiddenCount > 0) {
    el.appendChild(sealedStrip(gate));
  } else {
    const quiet = document.createElement("p");
    quiet.className = "bk-quiet";
    quiet.textContent = gate.dev
      ? "开发模式：本子整个开着，不走解锁阶梯。"
      : gate.next
        ? `再往后，${stamp(gate.next.openAt)} 之后${gate.next.label}。`
        : "它把整个本子推给你了。";
    el.appendChild(quiet);
  }
  fillPetNames($("#pane-memory"));
  mountCountdowns();
}

async function peek() {
  const r = await post("/api/diary/peek", {});
  if (r.allowed) {
    setHomeSay(r.line ?? "");
    extraDays.push(r.day);
    $("#diaryList").appendChild(daySpread(r.day, true));
    const line = $("#sealLine");
    if (line) line.textContent = "……{{pet}}让你多看了一眼，往前还是封着的。";
    fillPetNames($("#diaryGate"));
    window.ottoPet?.action?.("perk");
    return;
  }
  if (r.exhausted) {
    toast("就这些了。");
    return;
  }
  toast(r.line ?? "（{{pet}}把本子合上了）");
  window.ottoPet?.action?.("turn_away");
}

/* ---------------- 它记得的事（记忆管理） ---------------- */
/* 入口藏在右键后面——一个显式的记忆面板在暗示"这些都是数据"，
   但每条记忆的编辑和删除必须两步内可达（16 节的伦理要求）。 */

function openMemModal() {
  $("#memModal").classList.remove("hidden");
}

function bindContextMenu() {
  document.addEventListener("click", hideCtx);
  $("#closeMem").addEventListener("click", () => $("#memModal").classList.add("hidden"));
  $("#memModal").addEventListener("click", (e) => {
    if (e.target.id === "memModal") $("#memModal").classList.add("hidden");
  });
}

function showCtx(x, y, items) {
  const el = $("#ctxMenu");
  el.innerHTML = "";
  for (const it of items) {
    const b = document.createElement("button");
    b.textContent = it.label;
    b.addEventListener("click", () => {
      hideCtx();
      it.action();
    });
    el.appendChild(b);
  }
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.classList.remove("hidden");
  fillPetNames(el);
}

function hideCtx() {
  $("#ctxMenu").classList.add("hidden");
}

function renderMemory(items) {
  const box = $("#memAll");
  if (!items.length) {
    box.innerHTML = emptyState(
      "{{pet}}还没记住任何事。<br>记忆是对话结束后异步抽取的，最早的一条通常出现在第一次聊完之后。"
    );
    return;
  }
  const groups = { relationship: [], event: [], user_info: [] };
  for (const m of items) (groups[m.category] ??= []).push(m);
  box.innerHTML = "";
  for (const [cat, list] of Object.entries(groups)) {
    if (!list.length) continue;
    const h = document.createElement("div");
    h.className = "group-title";
    h.textContent = CAT_LABEL[cat] ?? cat;
    box.appendChild(h);
    for (const m of list) box.appendChild(memoryCard(m));
  }
}

function memoryCard(m, { showCategory = false, compact = false } = {}) {
  const el = document.createElement("div");
  el.className = `mem${m.status === "pending" ? " pending" : ""}${compact ? " compact" : ""}`;
  el.title = "右键可以改或者删";
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    showCtx(e.clientX, e.clientY, [
      { label: "改", action: () => editMemory(m) },
      { label: "删掉", action: () => removeMemory(m) },
    ]);
  });
  const when = new Date(m.createdAt).toLocaleString("zh-CN");
  const catShort = (CAT_LABEL[m.category] ?? m.category).replace("记忆", "");
  // 日记页里只留它记下的那句话和来源，时间和引用次数不进本子
  el.innerHTML = compact
    ? `
    <div class="content"></div>
    <div class="meta">
      ${m.inferred ? '<span class="tag guess">我猜的</span>' : '<span class="tag">你说过的</span>'}
      ${m.status === "pending" ? '<span class="tag pending">待确认</span>' : ""}
      ${m.keepsake ? '<span class="tag keep">{{pet}}留着的</span>' : ""}
    </div>
    <div class="row"></div>`
    : `
    <div class="content"></div>
    <div class="meta">
      ${showCategory ? `<span class="tag cat">${catShort}</span>` : ""}
      <span>${when}</span>
      ${m.inferred ? '<span class="tag guess">我猜的</span>' : '<span class="tag">你说过的</span>'}
      ${m.status === "pending" ? '<span class="tag pending">待确认</span>' : ""}
      ${m.keepsake ? '<span class="tag keep">{{pet}}留着的</span>' : ""}
      ${m.emotion ? `<span>当时情绪：${m.emotion}</span>` : ""}
      <span>引用 ${m.refCount ?? 0} 次</span>
    </div>
    ${m.sourceQuote ? `<div class="meta quote">原话：${escapeHtml(m.sourceQuote)}</div>` : ""}
    <div class="row"></div>`;
  el.querySelector(".content").textContent = m.content;
  const row = el.querySelector(".row");

  if (m.status === "pending") {
    row.appendChild(
      button("是我说的，记住了", async () => {
        await fetch("/api/memory/confirm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: m.id }),
        });
      toast("记住了。");
        refresh();
      })
    );
  }
  if (!row.childElementCount) row.remove();
  return el;
}

async function editMemory(m) {
  const next = prompt("改一下这条记忆：", m.content);
  if (next == null || !next.trim()) return;
  await fetch(`/api/memory/${m.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: next.trim() }),
  });
  refresh();
}

async function removeMemory(m) {
  if (!confirm(`删掉这条记忆？删掉之后不会恢复。\n\n${m.content}`)) return;
  await fetch(`/api/memory/${m.id}`, { method: "DELETE" });
      toast("删了。");
  refresh();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function button(label, onClick, cls = "") {
  const b = document.createElement("button");
  b.textContent = label;
  b.className = cls;
  b.addEventListener("click", onClick);
  return b;
}

/* ---------------- 关系记录 ---------------- */

/* 关系记录：按天，每天它自己的日记 + 给你的一张卡片。
   卡片过了当天才能翻开——当天就拆开，就不像"这一天过完了" */
function renderTimeline(items, days) {
  const box = $("#timeline");
  if (!days?.length && !items.length) {
    box.innerHTML = emptyState("你们还没开始。<br>第一条记录会在你们第一次聊天之后出现。");
    return;
  }
  const KIND = {
    memory: "",
    open_loop_created: "",
    open_loop_closed: "closed",
    proactive: "proactive",
    milestone: "milestone",
  };
  box.innerHTML = "";

  /* 每天一块 = 原始记录 + 它给你留的那张卡片。
     它的转述（日记）在"日记"那一页，这一页不放——
     同一件事在这儿再读一遍，那页就不值钱了 */
  for (const d of days ?? []) {
    const el = document.createElement("div");
    el.className = "dayblock";
    const meta = [`聊了 ${d.messageCount} 句`];
    if (d.memories.length) meta.push(`记住 ${d.memories.length} 件`);
    if (d.proactiveCount) meta.push(`它主动找过你 ${d.proactiveCount} 次`);
    el.innerHTML = `
      <div class="head"><span class="d"></span><span class="m"></span><span class="meta"></span></div>
      <div class="rawlist"></div>
      <div class="cardwrap"></div>`;
    el.querySelector(".head .d").textContent = d.label;
    el.querySelector(".head .m").textContent = d.date;
    el.querySelector(".head .meta").textContent = meta.join(" · ");

    // 这一天真正发生过什么：说过的话 + 做过的动作，没加工过的那一份
    const list = el.querySelector(".rawlist");
    if (!(d.records ?? []).length) {
      list.innerHTML = `<div class="muted">这一天没有留下记录。</div>`;
    } else {
      for (const r of d.records) {
        const line = document.createElement("div");
        line.className = "rl" + (r.role === "user" ? " me" : r.role === "event" ? " ev" : "");
        line.textContent = (r.role === "user" ? "你：" : r.role === "event" ? "" : "它：") + r.text;
        list.appendChild(line);
      }
    }
    el.querySelector(".cardwrap").appendChild(cardFor(d));
    box.appendChild(el);
  }

  // 底下接着系统事件的时间线
  if (items.length) {
    const h = document.createElement("div");
    h.className = "group-title";
    h.textContent = "另外，这些也发生过";
    box.appendChild(h);
  }
  for (const t of items) {
    const el = document.createElement("div");
    el.className = `tl ${KIND[t.kind] ?? ""}`;
    const when = new Date(t.ts).toLocaleString("zh-CN");
    el.innerHTML = `<div class="when">${when}</div><div class="title"></div><div class="detail"></div>`;
    el.querySelector(".title").textContent = t.title;
    el.querySelector(".detail").textContent = t.detail ?? "";
    box.appendChild(el);
  }
}

function cardFor(d) {
  const el = document.createElement("div");
  el.className = "card";
  if (!d.card) {
    el.classList.add("locked");
    el.innerHTML = `<span class="seal">✉</span><span class="hint">还没写好，等这一天的东西都落下来。</span>`;
    return el;
  }
  if (!d.cardUnlocked) {
    el.classList.add("locked");
    el.innerHTML = `<span class="seal">✉</span><span class="hint">它给你留了一张卡片。<b>明天可以翻开。</b></span>`;
  el.onclick = () => toast("……明天吧。");
    return el;
  }
  // 没翻开时只露一个封口
  el.innerHTML = `<span class="seal">✉</span><span class="hint">它给你留了一张卡片。<b>点开看看</b></span>`;
  el.onclick = () => {
    el.classList.add("open");
    el.onclick = null;
    el.innerHTML = `<span class="seal">✦</span><span class="text"></span>`;
    el.querySelector(".text").textContent = d.card;
  };
  return el;
}

/* ---------------- 测试面板 ---------------- */

function renderTestToggles() {
  $("#memoryToggle").checked = !!state.memoryEnabled;
  $("#mockToggle").checked = state.llm.mode === "mock";
  $("#unlockCardsToggle").checked = !!state.devUnlockCards;
  $("#devUnlock").checked = !!state.devUnlockDiary;
}

function bindTestPanel() {
  $("#memoryToggle").addEventListener("change", async (e) => {
    await post("/api/settings", { memoryEnabled: e.target.checked });
    toast(e.target.checked ? "已开启长期记忆" : "已切到无记忆对照组");
    refresh();
  });
  $("#mockToggle").addEventListener("change", async (e) => {
    await post("/api/settings", { mock: e.target.checked });
    toast(e.target.checked ? "已切到假模型" : "已切到真实模型");
    refresh();
  });
  $("#unlockCardsToggle").addEventListener("change", async (e) => {
    await post("/api/settings", { devUnlockCards: e.target.checked });
    toast(e.target.checked ? "卡片现在随时能翻开" : "卡片恢复等一天");
    refresh();
  });
  $("#devUnlock").addEventListener("change", async (e) => {
    await post("/api/settings", { devUnlockDiary: e.target.checked });
    toast(e.target.checked ? "日记全开：跳过解锁阶梯" : "日记回到按关系算的那一层");
    refresh();
  });
  $$("[data-scale]").forEach((b) =>
    b.addEventListener("click", async () => {
      await post("/api/settings", { timeScale: Number(b.dataset.scale) });
      toast(`时间倍速 ${b.dataset.scale}×`);
      refresh();
    })
  );
  $$("[data-jump]").forEach((b) =>
    b.addEventListener("click", async () => {
      await post("/api/settings", { jumpMinutes: Number(b.dataset.jump) });
      toast(`把时间往前推了 ${b.dataset.jump} 分钟`);
      refresh();
    })
  );
  $("#resetClock").addEventListener("click", async () => {
    await post("/api/settings", { resetClock: true });
    toast("虚拟时间归零");
    refresh();
  });
  $("#tickNow").addEventListener("click", async () => {
    const r = await post("/api/dev/proactive-check", {});
    toast(r?.message ? "{{pet}}主动开口了，去看对话页" : "暂时没有到期的线头");
    refresh();
  });
  $("#exportData").addEventListener("click", () => {
    window.open("/api/export", "_blank");
  });
  $("#resetData").addEventListener("click", async () => {
    if (!confirm("清空全部对话、记忆、埋点，回到 Day 0？这个操作不可恢复。")) return;
    await post("/api/dev/reset", {});
    sessionId = null;
    $("#messages").innerHTML = "";
    toast("已回到 Day 0");
    await refresh();
    await loadMessages();
  });
}

async function post(url, body) {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  }).then((r) => r.json());
}

function renderDims(dims) {
  const d = dims ?? state?.persona?.dims;
  const defs = state?.dimensions ?? [];
  const box = $("#dims");
  box.innerHTML = "";
  for (const def of defs) {
    const v = d?.[def.key] ?? 0.5;
    const row = document.createElement("div");
    row.className = "dimrow";
    row.innerHTML = `<span>${def.label}</span>
      <span class="track"><em style="left:0">${def.low}</em><em style="right:0">${def.high}</em><i style="left:${v * 100}%"></i></span>`;
    box.appendChild(row);
  }
  drawPersonaMap(d);
}

function drawPersonaMap(d) {
  const svg = $("#personaMap");
  if (!svg) return;
  const act = d?.activity ?? 0.5;
  const soc = d?.sociability ?? 0.5;
  const pad = 24;
  const span = 200 - pad * 2;
  const x = pad + act * span;
  const y = 200 - pad - soc * span;
  const drift = 0.16 * span;
  svg.innerHTML = `
    <rect x="${pad}" y="${pad}" width="${span}" height="${span}" fill="#fbfcfd" stroke="#e3e8ee"/>
    <line x1="${pad}" y1="${100}" x2="${200 - pad}" y2="100" stroke="#eef2f6"/>
    <line x1="100" y1="${pad}" x2="100" y2="${200 - pad}" stroke="#eef2f6"/>
    <rect x="${Math.max(pad, x - drift)}" y="${Math.max(pad, Math.min(200 - pad, y - drift))}"
      width="${drift * 2}" height="${drift * 2}" fill="none" stroke="#9fb6c9"
      stroke-dasharray="4 3" rx="3"/>
    <circle cx="${x}" cy="${y}" r="5.5" fill="#2f6f8f"/>
    <circle cx="${x}" cy="${y}" r="10" fill="#2f6f8f" opacity="0.12"/>
    <text x="${pad}" y="16" font-size="9" fill="#7b8794">安静</text>
    <text x="${200 - pad}" y="16" font-size="9" fill="#7b8794" text-anchor="end">好动</text>
    <text x="4" y="${pad + 3}" font-size="9" fill="#7b8794">粘人</text>
    <text x="4" y="${200 - pad}" font-size="9" fill="#7b8794">独立</text>`;
}

function renderLoops() {
  const box = $("#loops");
  const loops = state?.openLoops ?? [];
  if (!loops.length) {
    box.innerHTML = `<div class="muted">暂时没有未闭合的线头。用户提到以后才会发生的事时，这里会出现一条。</div>`;
    return;
  }
  box.innerHTML = "";
  for (const l of loops) {
    const due = new Date(l.due_at);
    const late = l.due_at <= (state?.clock?.now ?? Date.now());
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `<div></div><div class="muted small"></div>`;
    el.firstChild.textContent = l.event;
    el.lastChild.textContent = `到期时间 ${due.toLocaleString("zh-CN")} · 已尝试 ${l.attempts} 次${late ? " · 已经到时间了" : ""}`;
    box.appendChild(el);
  }
}

function renderRecall() {
  const box = $("#recall");
  if (!lastRecall.length) {
    box.textContent = "这次没有召回到记忆。";
    return;
  }
  box.className = "list";
  box.innerHTML = lastRecall
    .map(
      (m) =>
        `<div class="item"><b>${CAT_LABEL[m.category] ?? m.category}</b>　${escapeHtml(m.content)}</div>`
    )
    .join("");
}

function renderEvents(data) {
  const box = $("#events");
  const items = (data.items ?? []).slice(0, 40);
  if (!items.length) {
    box.innerHTML = `<div class="muted">还没有事件。</div>`;
    return;
  }
  box.innerHTML = items
    .map((e) => {
      const t = new Date(e.ts).toLocaleString("zh-CN");
      return `<div class="item"><b>${e.name}</b>　<span class="muted">${t}</span><br><span class="muted">${escapeHtml(
        e.params ?? "{}"
      )}</span></div>`;
    })
    .join("");
}

/* ---------------- 实时推送 ---------------- */

function connectStream() {
  const es = new EventSource("/api/stream");
  es.onmessage = (e) => {
    let ev;
    try {
      ev = JSON.parse(e.data);
    } catch {
      return;
    }
    if (ev.type === "hello") return;
    if (ev.type === "music" || ev.type === "module" || ev.type === "navigate") {
      modulesUI.handleEvent(ev).catch(() => {});
      if (ev.type === "navigate") return;
    }
    if (ev.type === "proactive") {
      sessionId = ev.sessionId;
      appendMessage({
        role: "otto",
        content: ev.message.content,
        proactive: true,
        ts: ev.message.createdAt,
      });
      window.ottoPet?.action?.(ev.action ?? "perk");
      showFrame(ev.action ?? "perk");
      setHomeSay(ev.message.content);
      notify(`${petName()}想起了你之前说过的事`, ev.message.content);
      toast(`${petName()}想起件事，戳你一下`);
      refresh();
      return;
    }
    if (ev.type === "murmur") {
      setHomeSay(ev.kaomoji ? `${ev.text} ${ev.kaomoji}` : ev.text);
      window.ottoPet?.action?.(ev.action ?? "idle");
      showFrame(ev.action ?? "idle");
      toast(ev.text);
      return;
    }
    if (ev.type === "immersion") {
      if (ev.state) state.immersion = ev.state;
      renderHome();
      if (ev.notice) {
        setHomeSay(ev.notice);
        toast(ev.notice);
      }
      return;
    }
    if (ev.type === "pet") {
      window.ottoPet?.action?.(ev.action);
        showFrame(ev.action);
      return;
    }
    if (ev.type === "state") {
      if (ev.closedLoops) toast(`一件事有了下文，成了你们的共同经历`);
      refresh();
      return;
    }
  };
  es.onerror = () => {
    /* EventSource 会自动重连 */
  };
}

function notify(title, body) {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") new Notification(title, { body });
  else if (Notification.permission !== "denied") Notification.requestPermission();
}

/* ---------------- 小工具 ---------------- */

let toastTimer = null;
function toast(text) {
  const el = $("#toast");
  el.textContent = text;
  fillPetNames(el);
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 2200);
}
