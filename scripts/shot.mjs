/**
 * 用 Electron 自己渲染并截图，用于核对桌宠和面板的视觉。
 * 用法：pnpm shot   （需要服务已经在 7788 跑着）
 *      pnpm shot -- --only diary,props   只拍名字里带这些字的那几张
 */
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data", "shots");
const BASE = process.env.OTTO_BASE || "http://127.0.0.1:7788";

/** 一次只核对一个东西的时候，不用把 30 多张全拍一遍 */
const ONLY = (() => {
  const i = process.argv.indexOf("--only");
  if (i < 0) return null;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v.split(",").filter(Boolean) : null;
})();

const shots = [
  { name: "props-wall", path: "/props", width: 1040, height: 760, bg: "#fbf9f4" },
  // 24 个形象，一张一张拍，回头拼成图集
  ...[
    "idle", "happy", "lean_in", "surprise", "sleepy", "wronged", "angry", "proud",
    "wave", "welcome", "peek", "shy", "celebrate", "sit", "approach", "hide",
    "think", "listening", "speaking", "studying", "done", "confused", "confirm", "welcome_back",
  ].map((a, i) => ({
    name: `act-${String(i + 1).padStart(2, "0")}-${a}`,
    path: "/pet?shot=1",
    width: 300,
    height: 360,
    bg: "#eef3f6",
    action: a,
    scale: 1.65,
    // 一次性动作要抓在动作中间，等它播完就只剩一个静止的姿势了
    settle: 620,
  })),
  { name: "pet", path: "/pet", width: 300, height: 340, bg: "#dfe7ee" },
  { name: "pet-duang", path: "/pet", width: 300, height: 340, bg: "#dfe7ee", eval: `document.getElementById('otto').classList.add('duang')`, settle: 500 },
  { name: "pet-happy", path: "/pet", width: 300, height: 340, bg: "#dfe7ee", action: "perk" },
  { name: "pet-curious", path: "/pet", width: 300, height: 340, bg: "#dfe7ee", action: "lean_in" },
  { name: "pet-sulk", path: "/pet", width: 300, height: 340, bg: "#dfe7ee", action: "sulk" },
  { name: "pet-sad", path: "/pet", width: 300, height: 340, bg: "#dfe7ee", action: "droop" },
  { name: "pet-shock", path: "/pet", width: 300, height: 340, bg: "#dfe7ee", action: "alert" },
  { name: "pet-doze", path: "/pet", width: 300, height: 340, bg: "#dfe7ee", action: "doze" },
  { name: "panel-home", path: "/?shot=1", width: 1040, height: 760, bg: "#f6f7f9" },
  {
    name: "panel-tools",
    path: "/?shot=1",
    width: 1040,
    height: 820,
    bg: "#f6f7f9",
    eval: `[...document.querySelectorAll('.tab')].find(b => b.dataset.tab === 'tools').click()`,
    settle: 1200,
  },
  {
    name: "panel-timeline",
    path: "/?shot=1",
    width: 1040,
    height: 820,
    bg: "#f6f7f9",
    eval: `[...document.querySelectorAll('.tab')].find(b => b.dataset.tab === 'timeline').click()`,
    settle: 2200,
  },
  { name: "rig-editor", path: "/rig", width: 1160, height: 700, bg: "#f4f7f9" },
  {
    name: "rig-shapes",
    path: "/rig",
    width: 1160,
    height: 700,
    bg: "#f4f7f9",
    eval: `[...document.querySelectorAll('.tb')].find(b => b.dataset.tab === 'shape').click();
           document.querySelectorAll('#shapeList .shape')[6]?.click();`,
    settle: 1500,
  },
  {
    name: "panel-chat",
    path: "/?shot=1",
    width: 1040,
    height: 820,
    bg: "#f6f7f9",
    eval: `[...document.querySelectorAll('.tab')].find(b => b.dataset.tab === 'tools').click()`,
    settle: 1200,
  },
  {
    name: "panel-memory-modal",
    path: "/?shot=1",
    width: 1040,
    height: 820,
    bg: "#f6f7f9",
    eval: `document.getElementById('homeTop').dispatchEvent(new MouseEvent('contextmenu', { clientX: 300, clientY: 160, bubbles: true }));
           document.querySelectorAll('#ctxMenu button')[0].click();`,
    settle: 1200,
  },
  {
    name: "panel-diary",
    path: "/?shot=1",
    width: 1040,
    height: 820,
    bg: "#f6f7f9",
    eval: `[...document.querySelectorAll('.tab')].find(b => b.dataset.tab === 'memory').click()`,
    settle: 2500,
  },
  {
    // 第二页：把日记本往下推一屏，看下一个版式长什么样
    name: "panel-diary-2",
    path: "/?shot=1",
    width: 1040,
    height: 820,
    bg: "#f6f7f9",
    eval: `[...document.querySelectorAll('.tab')].find(b => b.dataset.tab === 'memory').click();
           setTimeout(() => { document.getElementById('pane-memory').scrollTop = 760; }, 2000);`,
    settle: 3200,
  },
  {
    // 再往下两屏：看 note（正文中间横着一张票）这一版的咬合
    name: "panel-diary-3",
    path: "/?shot=1",
    width: 1040,
    height: 820,
    bg: "#f6f7f9",
    eval: `[...document.querySelectorAll('.tab')].find(b => b.dataset.tab === 'memory').click();
           setTimeout(() => { document.getElementById('pane-memory').scrollTop = 1500; }, 2000);`,
    settle: 3200,
  },
  {
    // 测试面板底下那两张卡：动作调试台 + 硬件接口
    name: "panel-test",
    path: "/?shot=1",
    width: 1040,
    height: 900,
    bg: "#f6f7f9",
    eval: `[...document.querySelectorAll('.tab')].find(b => b.dataset.tab === 'test').click();
           setTimeout(() => {
             document.querySelectorAll('#actGrid .actbtn')[3]?.click();
             const pane = document.getElementById('pane-test');
             if (pane) pane.scrollTop = pane.scrollHeight;
           }, 1600);`,
    settle: 2600,
  },
];

app.disableHardwareAcceleration();
app.on("window-all-closed", () => {
  /* 关闭窗口不退出，否则第一张截完进程就结束了 */
});

async function capture(spec) {
  const win = new BrowserWindow({
    width: spec.width,
    height: spec.height,
    show: false,
    webPreferences: { offscreen: true, preload: path.join(ROOT, "electron", "preload.cjs") },
  });
  if (spec.bg) win.setBackgroundColor(spec.bg);
  /* 页面里的 JS 报错默认是静悄悄的：截图只会看到一张没有数据的空壳，
     得靠人盯着发呆。让它在控制台里响一声 */
  win.webContents.on("console-message", (e, level, message) => {
    const msg = message ?? e?.message ?? "";
    const lvl = String(level ?? e?.level ?? "");
    if (lvl === "error" || lvl === "2" || /Uncaught|SyntaxError|is not/.test(msg)) {
      console.log(`  [${spec.name}] 页面报错：${msg}`);
    }
  });
  await win.loadURL(`${BASE}${spec.path}`);
  if (spec.bg) {
    await win.webContents.executeJavaScript(
      `document.body.style.background = ${JSON.stringify(spec.bg)};`
    );
  }
  // 等页面自己的初始化跑完（它会读回存着的缩放），再去覆盖，否则会被它盖掉
  await new Promise((r) => setTimeout(r, 700));
  // 桌宠是按 --pet-scale 缩放的；截图要按 1:1 看，不然窗口一大就成了缩略图。
  // act-* 那批用的是 /pet?shot=1，也算桌宠窗口
  if (spec.path.startsWith("/pet")) {
    await win.webContents.executeJavaScript(
      `window.ottoPetLocal?.setScale(${spec.scale ?? 1}, { persist: false, quiet: true });`
    );
  }
  if (spec.action) {
    await win.webContents.executeJavaScript(
      `window.ottoPetLocal && window.ottoPetLocal.setAction(${JSON.stringify(spec.action)})`
    );
  }
  if (spec.eval) await win.webContents.executeJavaScript(spec.eval);
  await new Promise((r) => setTimeout(r, spec.settle ?? 1400));
  const img = await win.webContents.capturePage();
  const file = path.join(OUT, `${spec.name}.png`);
  fs.writeFileSync(file, img.toPNG());
  console.log("saved", file, `${img.getSize().width}x${img.getSize().height}`);
  win.destroy();
  await new Promise((r) => setTimeout(r, 400));
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const list = ONLY ? shots.filter((s) => ONLY.some((o) => s.name.includes(o))) : shots;
  if (!list.length) console.log("没有匹配的截图位：", ONLY.join(","));
  for (const spec of list) {
    try {
      await capture(spec);
    } catch (e) {
      console.log("失败", spec.name, e.message);
    }
  }
  app.quit();
});
