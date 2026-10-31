/**
 * 双击启动器。
 *
 * 之前双击那个 .bat 是起 node 服务 + 开浏览器标签页，桌宠是不出来的；
 * 从终端里 Start-Process 起 electron，终端一关进程还会被信号带走。
 * 这个脚本干三件事，就是为了"双击一下，它就坐在桌上"：
 *
 *   1. 先探一下 7788：已经在跑了就不重复开（重复开的那一个会绑不上端口，
 *      窗口是白的，看起来像坏了）
 *   2. 用 detached 的方式把 electron 递出去，跟启动它的窗口彻底脱钩
 *   3. 出问题的时候说人话，而不是让那个黑窗口一闪而过
 *
 * 用法：node scripts/launch.mjs      （或者双击「启动 Otto.bat」）
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { spawn } from "node:child_process";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.OTTO_PORT || 7788);
const URL_BASE = `http://127.0.0.1:${PORT}`;

const electronExe = path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");

function die(msg) {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}

/** 已经在跑了吗？只看它认不认 Otto 的接口，不认就当作别的程序占着 */
async function probe() {
  try {
    const res = await fetch(`${URL_BASE}/api/state`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return "other";
    const s = await res.json();
    return s && typeof s.petName === "string" ? "otto" : "other";
  } catch {
    return "none";
  }
}

const state = await probe();

if (state === "otto") {
  console.log(`\n  Otto 已经在桌面上了（${URL_BASE}）。\n  找不到它就看看屏幕右下角，双击它开面板。\n`);
  process.exit(0);
}
if (state === "other") {
  die(`端口 ${PORT} 被别的程序占着，Otto 起不来。\n  跑一下「关闭 Otto.bat」清干净，或者改 .env 里的 OTTO_PORT。`);
}

if (!fs.existsSync(electronExe)) {
  die("没找到 electron。先在工程目录里跑一次 pnpm install。");
}

console.log("\n  正在把它放到桌上……\n");

const child = spawn(electronExe, ["."], {
  cwd: ROOT,
  detached: true,      // 跟这个窗口脱钩：关掉启动器，它也还在
  stdio: "ignore",     // 不要把日志绑在这个终端上，否则终端一关它就跟着走
  windowsHide: false,
});
child.unref();

// 起来之后确认一次，别让用户对着一片安静的桌面发呆
await new Promise((r) => setTimeout(r, 3500));
const after = await probe();
if (after === "otto") console.log("  好了。它现在在你的屏幕右下角。\n");
else if (after === "none") console.log("  好像没起来。跑一下「关闭 Otto.bat」再试一次。\n");
else console.log("  端口被占了，看看是不是开了两份。\n");

process.exit(0);
