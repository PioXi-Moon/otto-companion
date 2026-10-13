/**
 * 桌宠页面的体检工具：把 /pet 打开，设一个动作，把该看的都打出来。
 * 截图是给眼睛看的，这个是给控制台看的——排查"看不见它"这种问题时，
 * 光看一张空图猜不出来是没加载、还是被挪到窗口外边去了。
 *
 * 用法：electron scripts/peek-pet.mjs happy "speaking"
 */
import { app, BrowserWindow } from "electron";
import path from "node:path";
import url from "node:url";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const BASE = process.env.OTTO_BASE || "http://127.0.0.1:7788";
const actions = process.argv.slice(2).filter((a) => !a.startsWith("--"));

app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 303,
    height: 362,
    show: false,
    webPreferences: { offscreen: true, preload: path.join(ROOT, "electron", "preload.cjs") },
  });
  win.webContents.on("console-message", (_e, _lvl, msg) => console.log("  [page]", msg));
  await win.loadURL(`${BASE}/pet?shot=1`);
  await new Promise((r) => setTimeout(r, 1200));

  for (const a of actions.length ? actions : ["idle"]) {
    const info = await win.webContents.executeJavaScript(`(async () => {
      window.ottoPetLocal?.setAction(${JSON.stringify(a)});
      await new Promise((r) => setTimeout(r, 700));
      const art = document.getElementById('ottoArt');
      const otto = document.getElementById('otto');
      const svg = otto.querySelector('svg');
      const box = (el) => el ? { x: Math.round(el.getBoundingClientRect().x), y: Math.round(el.getBoundingClientRect().y), w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) } : null;
      return {
        action: ${JSON.stringify(a)},
        artHtml: art.innerHTML.length,
        cls: otto.className || '(空)',
        otto: box(otto),
        svg: box(svg),
        stage: box(document.getElementById('stage')),
        lift: getComputedStyle(otto).getPropertyValue('--lift'),
        lean: getComputedStyle(otto).getPropertyValue('--lean'),
        cs: (() => { const s = getComputedStyle(otto); return {
          w: s.width, h: s.height, display: s.display, transform: s.transform, position: s.position,
        }; })(),
        petScale: getComputedStyle(document.documentElement).getPropertyValue('--pet-scale'),
        inline: otto.getAttribute('style') || '(无)',
      };
    })()`);
    console.log(JSON.stringify(info));
  }
  app.quit();
});
