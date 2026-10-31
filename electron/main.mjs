import "./quiet-stdio.mjs"; // 管子被掐断时别让 EPIPE 变成弹窗，见 quiet-stdio.mjs 顶部注释
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  Notification,
  screen,
  shell,
} from "electron";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { startServer } from "../server/index.mjs";
import { onEvent } from "../server/bus.mjs";
import { getSetting, setSetting } from "../server/db.mjs";
import { decryptString, encryptString, secureStorageAvailable } from "./secure-key.mjs";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// 语音点歌时面板可能处于隐藏状态，没有用户点击可以解锁音频。
// 这个策略只对 Otto 自己的本地窗口生效，音乐仍由面板里的 Web Audio 合成。
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

// 把 Electron 的缓存也放进工程目录，一是免得脏了用户目录，二是打包后自包含
app.setPath("userData", path.join(ROOT, "data", "electron"));
const API_KEY_FILE = path.join(app.getPath("userData"), "deepseek-api-key.bin");

/**
 * 第二次双击不要再起一只。
 * 桌面快捷方式 + 开机自启的场合很容易点在已经跑着的 Otto 上，
 * 两个实例会抢同一个端口（7788），第二个起不来还弹一堆报错。
 * 抢不到锁的直接退出，抢到锁的那个负责把窗口叫到前面。
 */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

// 开机自启用：只把它放出来，不把面板窗口弹到人脸上
const PET_ONLY = process.argv.includes("--pet-only");

let baseUrl = "";
let petWin = null;
let panelWin = null;
let keySetupWin = null;
let dragOrigin = null;
let quitting = false;
let toldAboutPanel = false;
let apiKeyIpcReady = false;
let runtimeIpcReady = false;
let runtimeStarted = false;
let runtimeStarting = null;

function isUsableApiKey(value) {
  const key = String(value ?? "").trim();
  return key.startsWith("sk-") && key.length >= 20 && !/x{8,}/i.test(key);
}

/**
 * Key 只在主进程里解密并交给本地服务。
 * 渲染页面只能知道“有没有配置”，拿不回明文。
 */
function readStoredApiKey() {
  try {
    if (!fs.existsSync(API_KEY_FILE)) return "";
    const value = decryptString(fs.readFileSync(API_KEY_FILE));
    return isUsableApiKey(value) ? value.trim() : "";
  } catch (e) {
    console.warn(`[api-key] 读取本机安全存储失败：${e.message}`);
    return "";
  }
}

function writeStoredApiKey(key) {
  if (!secureStorageAvailable()) {
    throw new Error("当前系统的安全存储不可用，不能安全保存 API Key");
  }
  fs.mkdirSync(path.dirname(API_KEY_FILE), { recursive: true });
  fs.writeFileSync(API_KEY_FILE, encryptString(key), { mode: 0o600 });
}

function setRuntimeApiKey(key) {
  if (key) process.env.DEEPSEEK_API_KEY = key;
  else delete process.env.DEEPSEEK_API_KEY;
}

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
/* 窗口里真正的"它"比窗口小一圈：pet.css 里 .otto 是 162×192，水平居中，
   底下那 14px 的 padding 被 overflow 裁掉了（.stage 是 height:100% + content-box），
   所以实测本体的底边就贴着窗口底边。这组数字只是兜底：窗口的实际可视区
   会随穿透状态变几个像素，真值以渲染进程量出来报上来的为准（petBoard）。 */
const PET_ART = { width: 162, height: 192, bottom: 0 };
/* 贴边时留的余量。屏幕缩放不是 100% 的时候，窗口坐标最后一次落到物理像素上
   还会再取整一次，留 4px 免得那一下把它蹭出屏幕（几个像素看不出来）。 */
const PET_EDGE_GAP = 4;
const clampScale = (s) => Math.min(2.2, Math.max(0.6, Number(s) || 1));

/** 渲染进程量出来的"本体在窗口里的哪个位置"（视口坐标）。没有就用 PET_ART 估。 */
let petBoard = null;
function setPetBoard(box) {
  if (!box) return;
  const nums = [box.left, box.top, box.width, box.height];
  if (!nums.every((n) => Number.isFinite(n))) return;
  if (box.width < 20 || box.height < 20 || box.width > 2000 || box.height > 2000) return;
  petBoard = { left: box.left, top: box.top, width: box.width, height: box.height };
}

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

/** 兜底：按 CSS 参数估本体在桌面坐标系里占的那一块 */
function petArtRect(x, y, size) {
  const scale = size.width / PET_BASE.width;
  const width = PET_ART.width * scale;
  const height = PET_ART.height * scale;
  return {
    x: x + (size.width - width) / 2,
    y: y + size.height - PET_ART.bottom - height,
    width,
    height,
  };
}

/** 本体在桌面坐标系里占的那一块。渲染进程量到了就用它量的，那是最准的。 */
function petArtScreen(x, y, size) {
  if (!petBoard) return petArtRect(x, y, size);
  return {
    x: x + petBoard.left,
    y: y + petBoard.top,
    width: petBoard.width,
    height: petBoard.height,
  };
}

/**
 * 把位置夹回屏幕里。
 *
 * 夹的是"本体"，不是整块窗口：透明窗口比它大一整圈，拿窗口去夹，
 * 它会在离屏幕边还有五十多像素的地方停住；反过来，只有窗口在屏幕内的时候
 * 才不管，本体照样能露到屏幕外面去。所以按本体算，允许透明边伸出屏幕，
 * 本体贴边停住。
 *
 * 显示器跟着本体走：两块屏并排的时候，拖到哪一块就按哪一块的工作区夹，
 * 不会突然跳回主屏。
 */
function clampPetPos(x, y, size) {
  const art = petArtScreen(x, y, size);
  const { workArea } = screen.getDisplayMatching({
    x: Math.round(art.x),
    y: Math.round(art.y),
    width: Math.round(art.width),
    height: Math.round(art.height),
  });
  const nx = Math.min(
    Math.max(art.x, workArea.x + PET_EDGE_GAP),
    workArea.x + workArea.width - art.width - PET_EDGE_GAP
  );
  const ny = Math.min(
    Math.max(art.y, workArea.y + PET_EDGE_GAP),
    workArea.y + workArea.height - art.height - PET_EDGE_GAP
  );
  return { x: Math.round(x + (nx - art.x)), y: Math.round(y + (ny - art.y)) };
}

/** 缩放时以底部中心为锚点，并保证不跑出屏幕 */
function applyPetBounds(scale) {
  if (!petWin || petWin.isDestroyed()) return;
  const size = petSizeFor(scale);
  const [x, y] = petWin.getPosition();
  const [ow, oh] = petWin.getSize();
  const nx = Math.round(x + (ow - size.width) / 2);
  const ny = Math.round(y + oh - size.height);
  petWin.setBounds({ ...clampPetPos(nx, ny, size), ...size });
  rememberPetPos();
}

function setPetScale(scale) {
  const s = clampScale(scale);
  setSetting("petScale", s);
  petWin?.webContents.executeJavaScript(
    `window.ottoPetLocal && window.ottoPetLocal.setScale(${s}, { persist: false })`
  );
}

/** 它落在哪儿：记住上次的位置，重启回原地。屏幕换了就把位置夹回可见范围。 */
function savedPetPos(size) {
  const { workArea } = screen.getPrimaryDisplay();
  const p = getSetting("petPos", null);
  const x = typeof p?.x === "number" ? p.x : workArea.x + workArea.width - size.width - 40;
  const y = typeof p?.y === "number" ? p.y : workArea.y + workArea.height - size.height - 40;
  return clampPetPos(x, y, size);
}

function rememberPetPos() {
  if (!petWin || petWin.isDestroyed()) return;
  const [x, y] = petWin.getPosition();
  setSetting("petPos", { x, y });
}

function createPetWindow() {
  const size = petSizeFor(clampScale(getSetting("petScale", 1)));
  petWin = new BrowserWindow({
    ...size,
    ...savedPetPos(size),
    icon: path.join(ROOT, "otto.ico"),
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
    icon: path.join(ROOT, "otto.ico"),
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
    { label: "设置 DeepSeek API Key…", click: () => openKeySetup(false) },
    { type: "separator" },
    { label: "点一下摸摸它 · 双击打开面板", enabled: false },
    { label: "拖动换位置 · 滚轮改大小", enabled: false },
    { type: "separator" },
    { label: "让它先睡（退出 Otto）", click: () => sayGoodbyeAndQuit() },
  ]);
  menu.popup({ window: petWin });
}

function wireRuntimeIpc() {
  if (runtimeIpcReady) return;
  runtimeIpcReady = true;
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
  /**
   * 桌宠页面把它自己的位置量好了报上来。
   *
   * 为什么不由主进程算：窗口的可视区不是一个定值。Electron 改穿透状态、
   * 缩放、系统缩放取整，都会让"本体离窗口左边多少"差上几个像素，
   * 主进程按公式估出来的框可能是歪的——歪几像素，夹出来就是脚踩进任务栏。
   * 所以谁能量得准就让谁量。拖动结束后它还会再报一次，用来纠正拖动途中
   * 因为穿透状态变化跑掉的那几像素。
   */
  ipcMain.on("pet:box", (_e, box) => {
    setPetBoard(box);
    if (!petWin || petWin.isDestroyed() || dragOrigin) return;
    const [x, y] = petWin.getPosition();
    const [width, height] = petWin.getSize();
    const pos = clampPetPos(x, y, { width, height });
    if (pos.x !== x || pos.y !== y) petWin.setPosition(pos.x, pos.y);
    rememberPetPos();
  });
  ipcMain.on("pet:drag-start", (_e, box) => {
    if (!petWin || petWin.isDestroyed()) return;
    setPetBoard(box);
    const [x, y] = petWin.getPosition();
    const [width, height] = petWin.getSize();
    dragOrigin = { x, y, width, height };
  });
  ipcMain.on("pet:drag-move", (_e, { dx, dy }) => {
    if (!dragOrigin || !petWin || petWin.isDestroyed()) return;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    // 每一帧都夹一次：拖动过程中就贴住边界，而不是松手时才弹回来
    const { x, y, width, height } = dragOrigin;
    const pos = clampPetPos(x + dx, y + dy, { width, height });
    // 这里必须用 setBounds 而不是 setPosition：在缩放不是 100% 的屏幕上，
    // 只挪位置会让窗口每次胖一圈（实测每帧约 1px），一次拖动能胖出几十像素，
    // 它自己也会跟着"越拖越偏"，最后被推到屏幕外。把尺寸一起写死就不会。
    petWin.setBounds({ ...pos, width, height });
  });
  ipcMain.on("pet:drag-end", () => {
    dragOrigin = null;
    rememberPetPos();
  });
}

async function startOtto() {
  if (runtimeStarted) return;
  if (runtimeStarting) return runtimeStarting;

  runtimeStarting = (async () => {
    const server = await startServer({ port: Number(process.env.OTTO_PORT || 7788) });
    baseUrl = server.url;
    wireRuntimeIpc();

    createPanelWindow();
    createPetWindow();
    if (!PET_ONLY) openPanel();

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
    runtimeStarted = true;
  })();

  try {
    await runtimeStarting;
  } finally {
    runtimeStarting = null;
  }
}

function openKeySetup(firstRun = false) {
  if (keySetupWin && !keySetupWin.isDestroyed()) {
    keySetupWin.show();
    keySetupWin.focus();
    return keySetupWin;
  }

  keySetupWin = new BrowserWindow({
    width: 560,
    height: 590,
    minWidth: 520,
    minHeight: 540,
    resizable: true,
    maximizable: false,
    title: "设置 Otto 的 API Key",
    backgroundColor: "#f6f7f9",
    icon: path.join(ROOT, "otto.ico"),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  keySetupWin.loadFile(path.join(__dirname, "key-setup.html"), {
    query: { firstRun: firstRun ? "1" : "0" },
  });
  keySetupWin.once("ready-to-show", () => {
    keySetupWin.show();
    keySetupWin.focus();
  });
  keySetupWin.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//i.test(target)) shell.openExternal(target);
    return { action: "deny" };
  });
  keySetupWin.on("closed", () => {
    keySetupWin = null;
    // 首次设置时点右上角关闭，程序不能在后台留着一个看不见的进程。
    if (!runtimeStarted && !quitting) app.quit();
  });
  return keySetupWin;
}

function wireApiKeyIpc() {
  if (apiKeyIpcReady) return;
  apiKeyIpcReady = true;

  ipcMain.handle("api-key:status", () => ({
    configured: isUsableApiKey(process.env.DEEPSEEK_API_KEY),
    encryptedStorage: secureStorageAvailable(),
    running: runtimeStarted,
  }));

  ipcMain.handle("api-key:save", async (_event, rawKey) => {
    const key = String(rawKey ?? "").trim();
    if (!isUsableApiKey(key)) {
      return { ok: false, error: "请输入完整的 DeepSeek API Key（通常以 sk- 开头）。" };
    }
    try {
      writeStoredApiKey(key);
      setRuntimeApiKey(key);
    } catch (e) {
      return { ok: false, error: `API Key 保存失败：${e.message}` };
    }

    try {
      await startOtto();
    } catch (e) {
      return { ok: false, error: `API Key 已安全保存，但 Otto 启动失败：${e.message}` };
    }

    if (keySetupWin && !keySetupWin.isDestroyed()) keySetupWin.close();
    panelWin?.webContents.reloadIgnoringCache();
    petWin?.webContents.executeJavaScript(
      `window.ottoPetLocal && window.ottoPetLocal.say("新的钥匙收好了。", 2600)`
    );
    return { ok: true };
  });

  ipcMain.handle("api-key:skip", async () => {
    try {
      await startOtto();
    } catch (e) {
      return { ok: false, error: `Otto 启动失败：${e.message}` };
    }
    if (keySetupWin && !keySetupWin.isDestroyed()) keySetupWin.close();
    return { ok: true };
  });

  ipcMain.on("api-key:close", () => {
    if (keySetupWin && !keySetupWin.isDestroyed()) keySetupWin.close();
  });
}

app.whenReady().then(async () => {
  if (!gotLock) return; // 另一个 Otto 已经在跑了
  wireApiKeyIpc();

  const storedKey = readStoredApiKey();
  if (storedKey) {
    setRuntimeApiKey(storedKey);
  } else if (app.isPackaged) {
    // 分享版首次打开一定走设置窗口，不捡系统里可能属于别处程序的环境变量。
    setRuntimeApiKey("");
  }

  if (!isUsableApiKey(process.env.DEEPSEEK_API_KEY)) {
    openKeySetup(true);
    return;
  }

  try {
    await startOtto();
  } catch (e) {
    dialog.showErrorBox("Otto 启动失败", e?.message || String(e));
    app.quit();
  }
});

app.on("window-all-closed", (e) => {
  // 桌宠常驻，不随窗口关闭退出
});

app.on("second-instance", () => {
  // 有人又点了一下图标：把已经在跑的那只叫出来，别沉默
  if (!runtimeStarted) {
    openKeySetup(true);
    return;
  }
  if (petWin && !petWin.isDestroyed()) petWin.show();
  if (panelWin && !panelWin.isDestroyed()) openPanel();
});

app.on("before-quit", () => {
  quitting = true;
});
