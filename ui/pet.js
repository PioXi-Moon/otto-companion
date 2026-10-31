import { applyPose } from "./rig.js";
import { ACTIONS, NEUTRAL } from "./actions.js";

const stage = document.getElementById("stage");
const otto = document.getElementById("otto");
const bubble = document.getElementById("bubble");
const dots = document.getElementById("dots");
const zzz = document.getElementById("zzz");

/* 形象只有一份来源：otto.svg。桌宠和调参窗口都拉它 */
const art = document.getElementById("ottoArt");
let artVersion = -1;
async function loadArt(force = false) {
  try {
    const meta = await fetch("/api/otto-svg?meta=1").then((r) => r.json());
    if (!force && meta.version === artVersion) return;
    artVersion = meta.version;
    art.innerHTML = await fetch("/api/otto-svg").then((r) => r.text());
  } catch {
    /* 服务没起来就算了 */
  }
}
loadArt(true);
// 文件被改了（不管是谁改的）就自己换上，不用重启
setInterval(() => loadArt(), 3000);

/* 在调参窗口里存下来的动作。有存过的就用存的那套姿势，
   没存过的走代码里写死的那套 */
let poses = {};
function loadPoses() {
  return fetch("/api/poses")
    .then((r) => r.json())
    .then((d) => {
      poses = d.actions ?? {};
    })
    .catch(() => {});
}
loadPoses();


const BRIDGE = window.ottoPet ?? null;
let actionTimer = null;
let idleTimer = null;
let sleeping = false;
let bubbleTimer = null;
let currentAction = "idle";
let immersion = false;

const IMMERSION_ACTIONS = new Set([
  "immersed", "idle", "sleepy", "doze", "sit", "lean_in",
  "listening", "think", "speaking", "confirm",
]);

/* 动作层（关键帧）和附加符号，都要能被下一次动作清掉 */
const ANIM_CLASSES = [
  "m-jump", "m-hop", "m-wobble", "m-shiver", "m-bob", "m-talk", "m-scan",
  "m-stomp", "m-step", "m-jiggle",
];

/* 头顶那颗灯在"忙着"的时候变琥珀色并且会呼吸。
   这几个名字都是程序广播的功能状态，不是情绪动作 */
const LED_BUSY = new Set(["listening", "speaking", "think", "studying", "confirm"]);

const extras = document.getElementById("extra");

/* 漫画符号。样式统一走产品色盘，只有怒气符和问号用低饱和暖色 */
const MARK_CLASS = {
  "❤": "x-warm",
  "✦": "x-gold", "✦✦✦": "x-gold", "✓": "x-gold",
  "♪♪": "x-note",
  "💧": "x-sweat",
  "💢": "x-anger",
  "?": "x-ask",
  "!": "x-alert",
  "»": "x-line",
  "</>": "x-code",
};

function setExtra(kind, blush = false) {
  otto.classList.toggle("blush", !!blush);
  extras.className = "extra";
  extras.innerHTML = "";
  dots.classList.add("hidden");
  zzz.classList.add("hidden");
  if (!kind) return;

  if (kind === "z") return void zzz.classList.remove("hidden");
  if (kind === "……") return void dots.classList.remove("hidden");

  if (kind === "waves-in" || kind === "waves-out") {
    extras.className = "extra waves " + (kind === "waves-in" ? "into" : "outof");
    extras.innerHTML = "<i></i><i></i><i></i>";
    return;
  }
  if (kind === "◯") {
    extras.className = "extra x-bubble";
    return;
  }
  extras.className = "extra " + (MARK_CLASS[kind] ?? "");
  extras.innerHTML = `<span class="mk">${kind}</span>`;
}

const isState = (name) => (ACTIONS[name] ?? {}).kind === "state";

/**
 * 演一个动作。
 * 姿势从 actions.js 来（调参台存过的会盖掉它），动作层是 CSS 关键帧，
 * 两层分开所以能叠加：可以一边坐着（姿势）一边抖（动作）。
 */
export function setAction(name, { ms } = {}) {
  if (immersion && !IMMERSION_ACTIONS.has(name)) name = "immersed";
  const a = ACTIONS[name];
  if (!a) return;
  currentAction = name;
  clearTimeout(actionTimer);
  otto.classList.remove("blink", ...ANIM_CLASSES, "offline");
  void otto.offsetWidth; // 同一段动画要重新触发，得先把类摘掉再放回去

  applyPose(otto, poses[name] ?? a.pose);
  if (a.anim) otto.classList.add(a.anim);
  if (name === "offline") otto.classList.add("offline");
  otto.classList.toggle("busy", LED_BUSY.has(name));
  setExtra(a.extra, a.blush);

  if (a.kind !== "state") {
    actionTimer = setTimeout(() => {
      applyPose(otto, NEUTRAL);
      otto.classList.remove(...ANIM_CLASSES);
      setExtra(null);
      currentAction = "idle";
    }, ms ?? a.ms ?? 2400);
  }
  scheduleIdle();
}

/* 闲着的时候分两档：先犯困，再打盹。一上来就睡过去太突然 */
function scheduleIdle() {
  clearTimeout(idleTimer);
  if (immersion) {
    // 用户主动对话时的 listening / think / speaking 仍然允许；
    // 只把会自然扩散出去的 idle / sleepy / doze 收回到沉浸姿势。
    if (["idle", "sleepy", "doze"].includes(currentAction)) setAction("immersed");
    return;
  }
  idleTimer = setTimeout(() => {
    const a = ACTIONS[currentAction];
    if (!a || a.kind !== "state" || currentAction === "idle") setAction("sleepy");
    setTimeout(() => setAction("doze"), 7 * 60000);
  }, 90000);
}

/* 自然眨眼 */
const EYES_SHUT = new Set(["doze", "sleepy", "lie_down", "offline"]);
setInterval(() => {
  if (EYES_SHUT.has(currentAction)) return;
  otto.classList.add("blink");
  setTimeout(() => otto.classList.remove("blink"), 130);
}, 4200);

/* ---- 闲置彩蛋 ----
   有四条动作没有对应的事件（委屈、靠近、躲猫猫、完成任务）。
   丢在这里：它自己待着的时候偶尔做一下，不为什么。
   限量是刻意的——多了就从"活着"变成"表演" */
const EGG_POOL = ["wronged", "approach", "hide", "done"];
let eggsToday = 0;
let eggDay = "";
setInterval(() => {
  if (immersion) return;
  const day = new Date().toDateString();
  if (day !== eggDay) { eggDay = day; eggsToday = 0; }
  if (eggsToday >= 8) return;
  const a = ACTIONS[currentAction];
  if (!a || a.kind !== "state" || currentAction === "doze") return;
  if (Math.random() > 0.3) return;
  eggsToday += 1;
  setAction(EGG_POOL[Math.floor(Math.random() * EGG_POOL.length)]);
}, 3 * 60000);

scheduleIdle();

/* 气泡 */
function say(text, ms = 14000, kind = "") {
  bubble.className = "bubble" + (kind ? ` ${kind}` : "");
  bubble.textContent = text;
  bubble.classList.remove("hidden");
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubble.classList.add("hidden"), ms);
}

/* 服务端推送：主动发起 / 动作指令 */
const es = new EventSource("/api/stream");
es.onmessage = (e) => {
  let ev;
  try {
    ev = JSON.parse(e.data);
  } catch {
    return;
  }
  if (ev.type === "proactive") {
    if (immersion) return;
    setAction(ev.action ?? "perk", { ms: 2600 });
    blushPulse(2600);
    say(ev.message.content, 20000, "");
  } else if (ev.type === "murmur") {
    if (immersion) return;
    setAction(ev.action ?? "idle", { ms: 2200 });
    say(ev.kaomoji ? `${ev.text} ${ev.kaomoji}` : ev.text, 22000, "murmur");
  } else if (ev.type === "immersion") {
    immersion = ev.state?.enabled === true;
    if (immersion) setAction("immersed");
    else scheduleIdle();
    if (ev.notice) say(ev.notice, 7000, "murmur");
  } else if (ev.type === "pet") {
    setAction(ev.action ?? "idle", { ms: ev.ms });
  } else if (ev.type === "state" && ev.closedLoops) {
    setAction("alert", { ms: 2200 });
  }
};

/* ---------------- 大小 ---------------- */
/* 滚轮缩放，右键菜单里也能调。窗口跟着一起变，位置以底部中心为锚点，
   不然它会在缩放那一瞬间满桌乱跳。 */

let scale = 1;

/* 把"我在窗口里的哪儿"报给主进程：夹屏幕边界时用它，比主进程自己算准。
   窗口尺寸一变就再报一次——缩放、系统缩放取整、穿透状态切换都会挪动它。 */
function reportBox() {
  const r = otto.getBoundingClientRect();
  BRIDGE?.box?.({ left: r.left, top: r.top, width: r.width, height: r.height });
}
window.addEventListener("resize", reportBox);

async function applyScale(next, { persist = true, quiet = false } = {}) {
  scale = Math.min(2.2, Math.max(0.6, Math.round(next * 100) / 100));
  document.documentElement.style.setProperty("--pet-scale", String(scale));
  reportBox(); // 先报新的本体尺寸，主进程好按新尺寸摆窗口
  BRIDGE?.resize?.(scale);
  if (!quiet) say(`大小 ${Math.round(scale * 100)}%`, 1400, "murmur");
  if (persist) {
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ petScale: scale }),
      });
    } catch {
      /* 服务没起来也不影响缩放本身 */
    }
  }
  return scale;
}

stage.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    applyScale(scale + (e.deltaY < 0 ? 0.1 : -0.1));
  },
  { passive: false }
);

/* ---------------- 拖动 + 点击 ---------------- */
/* 用指针捕获：拖动时鼠标跑出窗口也不会丢事件，
   否则拖快一点它就停在半路上 */

/* ---------------- 一比特互动 ---------------- */
/*
 * 点一下 = 摸它。这是这个产品最便宜也最像活的交互：
 * 你不需要组织一句话，只要动一下手指，它就给你一段有内容的反应。
 * 双击才是打开面板——点它一下不该等于"打开一个 App"。
 */

async function touchPet(kind) {
  try {
    const res = await fetch("/api/pet/touch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, sleeping: otto.classList.contains("doze") }),
    });
    const r = await res.json();
    if (!r) return;

    /* 点一下的反应 = 左右晃。**不换姿势**——
       一换姿势它就会往一边斜，和晃动叠起来就不对称了 */
    if (kind === "tap") {
      if (immersion) blushPulse(900);
      else duang();
      if (r.text) say(r.kaomoji ? `${r.text} ${r.kaomoji}` : r.text, 5000, "murmur");
      return;
    }
    if (r.action) setAction(r.action, { ms: 2200 });
    if (r.text) say(r.kaomoji ? `${r.text} ${r.kaomoji}` : r.text, 5000, "murmur");
  } catch {
    /* 服务没起来就算了，别把桌宠搞死 */
  }
}

/* 身体左右晃两下，脚不动。被摸的第一反应就是晃，不是换姿势 */
function duang() {
  otto.classList.remove("duang");
  void otto.offsetWidth;
  otto.classList.add("duang");
  blushPulse(1900);
  setTimeout(() => otto.classList.remove("duang"), 2200);
}

/* 脸红一下就走。它是个机器人，脸红不能老挂着 */
let blushTimer = null;
function blushPulse(ms = 1800) {
  otto.classList.add("blush");
  clearTimeout(blushTimer);
  blushTimer = setTimeout(() => otto.classList.remove("blush"), ms);
}

let dragging = false;
let moved = false;
let sx = 0;
let sy = 0;
let clickThrough = true;

/* 透明区域也要放鼠标过去，否则它会挡住背后的软件。
   做法：鼠标在它身上时才接管，移开就交还给桌面。 */
function setClickThrough(next) {
  if (next === clickThrough) return;
  clickThrough = next;
  BRIDGE?.setIgnoreMouse?.(next);
}

window.addEventListener("mousemove", (e) => {
  gaze(e);
  if (dragging) {
    setClickThrough(false);
    return;
  }
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const onPet = !!(el && el.closest && el.closest(".otto, .bubble, .tip, .dots, .zzz"));
  setClickThrough(!onPet);
});

document.addEventListener("mouseleave", () => {
  setClickThrough(true);
  // 鼠标离开窗口，眼神收回来，别一直斜着
  otto.style.setProperty("--gazeX", "0");
  otto.style.setProperty("--gazeY", "0");
});

/* 眼神跟着鼠标：高光朝鼠标偏一点。
   归一化到 -1..1，140px 之外就到底——它得有个"最多看这么多"的限度 */
function gaze(e) {
  const r = otto.getBoundingClientRect();
  if (!r.width) return;
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height * 0.28; // 眼睛在头的上三分之一
  const dx = Math.max(-1, Math.min(1, (e.clientX - cx) / 140));
  const dy = Math.max(-1, Math.min(1, (e.clientY - cy) / 140));
  otto.style.setProperty("--gazeX", dx.toFixed(2));
  otto.style.setProperty("--gazeY", dy.toFixed(2));
}

stage.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  dragging = true;
  moved = false;
  sx = e.screenX;
  sy = e.screenY;
  try {
    stage.setPointerCapture(e.pointerId);
  } catch {
    /* 有些环境不支持，退化成普通拖动 */
  }
  document.body.classList.add("dragging");
  BRIDGE?.dragStart?.();
  setAction("look_up", { ms: 900 });
});

stage.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const dx = e.screenX - sx;
  const dy = e.screenY - sy;
  if (!moved && Math.abs(dx) + Math.abs(dy) > 4) {
    moved = true;
    // 被拎起来了：腿在半空乱蹬
    otto.classList.add("flailing");
    touchPet("drag");
  }
  BRIDGE?.dragMove?.(dx, dy);
});

function endDrag(e) {
  if (!dragging) return;
  dragging = false;
  try {
    stage.releasePointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
  document.body.classList.remove("dragging");
  otto.classList.remove("flailing");
  BRIDGE?.dragEnd?.();
  // 松手之后再报一次：拖动途中穿透状态变过一次，量一遍把差的那几像素收回来
  reportBox();
  if (moved) touchPet("drop");
  else if (e.detail < 2) touchPet("tap"); // 双击的第二下不算摸
}

stage.addEventListener("pointerup", endDrag);
stage.addEventListener("pointercancel", endDrag);

stage.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  BRIDGE?.menu?.();
});

function openPanel() {
  if (BRIDGE?.openPanel) BRIDGE.openPanel();
  else window.open("/", "_blank");
}

/* 双击打开面板 */
stage.addEventListener("dblclick", () => {
  bubble.classList.add("hidden");
  openPanel();
});

window.ottoPetLocal = { setAction, say, setScale: applyScale, getScale: () => scale };

/* 启动时把上次的大小读回来，顺便把本体在窗口里的位置报一次 */
fetch("/api/state")
  .then((r) => r.json())
  .then((s) => {
    if (s.petName) document.title = s.petName;
    if (typeof s.petScale === "number") applyScale(s.petScale, { persist: false, quiet: true });
    immersion = s.immersion?.enabled === true;
    if (immersion) setAction("immersed");
  })
  .catch(() => {})
  .finally(reportBox);
