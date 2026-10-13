import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, screen, shell } from "electron";
import path from "node:path";
import url from "node:url";
import { startServer } from "../server/index.mjs";
import { onEvent } from "../server/bus.mjs";
import { getSetting, setSetting } from "../server/db.mjs";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// 把 Electron 的缓存也放进工程目录，一是免得脏了用户目录，二是打包后自包含
app.setPath("userData", path.join(ROOT, "data", "electron"));

let baseUrl = "";
let petWin = null;
let panelWin = null;
let dragOrigin = null;
let quitting = false;
let toldAboutPanel = false;

/**
 * 关门之前先说一句。
 *
 * 这是它唯一一次"主动告别"的机会。程序被点掉的时候是静悄悄的，
 * 静悄悄最像程序；它应该说一句再走。
 * 顺带把"今天的记录都收好了"这件事讲明白——用户会想知道数据还在不在。
 */
const GOODBYES = [
  { line: "那我先睡啦。", detail: "今天的几页我都收好了，线头也记着，到点会想着。\n明天开机叫我一声。" },
  { line: "行，我趴着了。", detail: "该记的都记下了，桌上那个位置我给你留着。" },
  { line: "那我先歇一会儿。", detail: "你放心关，今天的事一样都没落下。" },
];

async function sayGoodbyeAndQuit() {
  if (quitting) return;
  const name = getSetting("petName", "小月汐");
  const g = GOODBYES[Math.floor(Math.random() * GOODBYES.length)];
  const opts = {
    type: "none",
    title: name,
    message: `${name}：${g.line}`,
    detail: g.detail,
    buttons: ["再坐会儿", "好，晚安"],
    defaultId: 1,
    cancelId: 0,
    noLink: true,
  };
  const parent = panelWin && !panelWin.isDestroyed() && panelWin.isVisible() ? panelWin : null;
  const { response } = parent
    ? await dialog.showMessageBox(parent, opts)
    : await dialog.showMessageBox(opts);
  if (response === 0) return; // 再坐会儿：什么也不做

  petWin?.webContents.executeJavaScript(
    `window.ottoPetLocal && (window.ottoPetLocal.setAction("wave", { ms: 2200 }), window.ottoPetLocal.say("晚安。", 1800))`
  );
  await new Promise((r) => setTimeout(r, 1400));
  quitting = true;
  app.quit();
}

const PET_BASE = { width: 260, height: 300 };
const clampScale = (s) => Math.min(2.2, Math.max(0.6, Number(s) || 1));

/** 启动时确认 preload 真的挂上了。它一旦静默失败，拖动和缩放会一起没反应。 */
async function probeBridge(win, name) {
  try {
    const kind = await win.webContents.executeJavaScript("typeof window.ottoPet");
    if (kind === "object") console.log(`[bridge] ${name} 就绪`);
    else console.log(`[bridge] ${name} 没有挂上（window.ottoPet = ${kind}），拖动和缩放会失效`);
  } catch (e) {
    console.log(`[bridge] ${name} 探测失败：${e.message}`);
  }
}

function petSizeFor(scale) {
  return {
    width: Math.round(PET_BASE.width * scale),
    height: Math.round(PET_BASE.height * scale),
  };
}

/** 缩放时以底部中心为锚点，并保证不跑出屏幕 */
function applyPetBounds(scale) {
  if (!petWin || petWin.isDestroyed()) return;
  const size = petSizeFor(scale);
  const [x, y] = petWin.getPosition();
  const [ow, oh] = petWin.getSize();
  const { workArea } = screen.getPrimaryDisplay();
  const nx = Math.round(x + (ow - size.width) / 2);
  const ny = Math.round(y + oh - size.height);
  petWin.setBounds({
    x: Math.min(Math.max(nx, workArea.x), workArea.x + workArea.width - size.width),
    y: Math.min(Math.max(ny, workArea.y), workArea.y + workArea.height - size.height),
    ...size,
  });
}

function setPetScale(scale) {
  const s = clampScale(scale);
  setSetting("petScale", s);
  petWin?.webContents.executeJavaScript(
    `window.ottoPetLocal && window.ottoPetLocal.setScale(${s}, { persist: false })`
  );
}

function createPetWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const size = petSizeFor(clampScale(getSetting("petScale", 1)));
  petWin = new BrowserWindow({
    ...size,
    x: workArea.x + workArea.width - size.width - 40,
    y: workArea.y + workArea.height - size.height - 40,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  petWin.setAlwaysOnTop(true, "floating");
  petWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // 默认整块穿透。渲染进程会在鼠标移到它身上时报一次，那时才接管
  petWin.setIgnoreMouseEvents(true, { forward: true });
  petWin.loadURL(`${baseUrl}/pet`);
  petWin.once("ready-to-show", () => {
    petWin.show();
    probeBridge(petWin, "桌宠窗口");
  });
  petWin.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      petWin.hide();
    }
  });
  return petWin;
}

function createPanelWindow() {
  panelWin = new BrowserWindow({
    width: 1020,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    title: "Otto",
    backgroundColor: "#f6f7f9",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  panelWin.loadURL(`${baseUrl}/`);
  panelWin.once("ready-to-show", () => probeBridge(panelWin, "面板窗口"));
  panelWin.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      panelWin.hide();
      /* 面板关掉不等于它走了——但用户不一定知道，所以让它自己说一句。
         一次就够，不然每次关都念一遍就烦人了 */
      if (!toldAboutPanel) {
        toldAboutPanel = true;
        petWin?.webContents.executeJavaScript(
          `window.ottoPetLocal && window.ottoPetLocal.say("面板关了我还在这儿，双击我就回来。", 7000)`
        );
      }
    }
  });
  panelWin.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith(baseUrl)) return { action: "allow" };
    shell.openExternal(target);
    return { action: "deny" };
  });
  return panelWin;
}

function openPanel() {
  if (!panelWin || panelWin.isDestroyed()) createPanelWindow();
  panelWin.show();
  panelWin.focus();
}

function petMenu() {
  const memoryOn = getSetting("memoryEnabled", true) !== false;
  const proactiveOn = process.env.OTTO_PROACTIVE !== "0";
  const menu = Menu.buildFromTemplate([
    { label: "打开面板", click: openPanel },
    { type: "separator" },
    {
      label: "开启长期记忆（A/B 开关）",
      type: "checkbox",
      checked: memoryOn,
      click: (item) => {
        setSetting("memoryEnabled", item.checked);
        panelWin?.webContents.send("state-changed");
        openPanel();
      },
    },
    {
      label: "允许主动发起",
      type: "checkbox",
      checked: proactiveOn,
      click: (item) => {
        process.env.OTTO_PROACTIVE = item.checked ? "1" : "0";
      },
    },
    { type: "separator" },
    { label: "大一点（滚轮也行）", click: () => setPetScale(getSetting("petScale", 1) + 0.1) },
    { label: "小一点", click: () => setPetScale(getSetting("petScale", 1) - 0.1) },
    { label: "恢复原始大小", click: () => setPetScale(1) },
    { type: "separator" },
    { label: "点一下摸摸它 · 双击打开面板", enabled: false },
    { label: "拖动换位置 · 滚轮改大小", enabled: false },
    { type: "separator" },
    { label: "让它先睡（退出 Otto）", click: () => sayGoodbyeAndQuit() },
  ]);
  menu.popup({ window: petWin });
}

app.whenReady().then(async () => {
  const server = await startServer({ port: Number(process.env.OTTO_PORT || 7788) });
  baseUrl = server.url;

  createPanelWindow();
  createPetWindow();
  openPanel();

  onEvent((ev) => {
    if (ev.type === "proactive") {
      const n = new Notification({
        title: "Otto 想起了你之前说过的事",
        body: ev.message.content,
      });
      n.on("click", openPanel);
      n.show();
      petWin?.webContents.executeJavaScript(
        `window.ottoPetLocal && window.ottoPetLocal.setAction("perk", { ms: 2600 })`
      );
    }
  });

  ipcMain.on("panel:open", openPanel);
  ipcMain.on("app:quit", () => sayGoodbyeAndQuit());
  ipcMain.on("pet:menu", petMenu);
  ipcMain.on("pet:action", (_e, name) => {
    petWin?.webContents.executeJavaScript(
      `window.ottoPetLocal && window.ottoPetLocal.setAction(${JSON.stringify(name)}, { ms: 2400 })`
    );
  });
  ipcMain.on("pet:ignore-mouse", (_e, v) => petWin?.setIgnoreMouseEvents(!!v, { forward: true }));
  ipcMain.on("pet:resize", (_e, scale) => applyPetBounds(clampScale(scale)));
  ipcMain.on("pet:drag-start", () => {
    dragOrigin = petWin?.getPosition() ?? null;
  });
  ipcMain.on("pet:drag-move", (_e, { dx, dy }) => {
    if (!dragOrigin || !petWin) return;
    petWin.setPosition(Math.round(dragOrigin[0] + dx), Math.round(dragOrigin[1] + dy));
  });
  ipcMain.on("pet:drag-end", () => {
    dragOrigin = null;
  });
});

app.on("window-all-closed", (e) => {
  // 桌宠常驻，不随窗口关闭退出
});

app.on("before-quit", () => {
  quitting = true;
});
