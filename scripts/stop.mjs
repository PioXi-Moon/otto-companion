/**
 * 把 Otto 关掉。
 *
 * 正常关门走的是它自己那句"那我先睡啦"（右键 → 退出，或者面板右上角那个键）。
 * 这个脚本是备用阀门：万一它卡住了、或者有人重复开了两份把端口占了，
 * 用它清干净。它只动这个工程里的进程，别的一概不碰。
 *
 * 用法：node scripts/stop.mjs      （或者双击「关闭 Otto.bat」）
 */
import path from "node:path";
import url from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.OTTO_PORT || 7788);

/** netstat 比 tasklist 可靠：我们要的是"谁占着那个端口" */
function pidOnPort(port) {
  try {
    const out = execFileSync("netstat", ["-ano"], { encoding: "utf8" });
    const line = out
      .split(/\r?\n/)
      .find((l) => l.includes(`:${port} `) && l.includes("LISTENING"));
    if (!line) return null;
    return Number(line.trim().split(/\s+/).pop());
  } catch {
    return null;
  }
}

const srvPid = pidOnPort(PORT);
let killed = 0;

if (srvPid) {
  try {
    process.kill(srvPid);
    killed += 1;
    console.log(`  关掉了服务（pid ${srvPid}）`);
  } catch (e) {
    console.log(`  没能关掉 pid ${srvPid}：${e.message}`);
  }
} else {
  console.log(`  端口 ${PORT} 上没人`);
}

/* 桌宠窗口是独立的进程树，可能有几层（主进程 + 渲染进程 + GPU），
   一起收掉。只杀这个工程目录下起来的那些，别误伤别的 Electron 应用。 */
try {
  const out = execFileSync(
    "wmic",
    ["process", "where", "name='electron.exe'", "get", "ProcessId,ExecutablePath"],
    { encoding: "utf8" }
  );
  for (const line of out.split(/\r?\n/)) {
    if (!line.includes(ROOT)) continue;
    const pid = Number(line.trim().split(/\s+/).pop());
    if (!pid) continue;
    try {
      process.kill(pid);
      killed += 1;
    } catch {
      /* 已经退出了 */
    }
  }
} catch {
  /* wmic 在新系统上可能没有；那就只关服务，剩下的手机关掉窗口即可 */
}

console.log(killed ? `\n  关了 ${killed} 个进程。\n` : "\n  没找到在跑的东西。\n");
