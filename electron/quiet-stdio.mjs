/**
 * stdout / stderr 上的 EPIPE，按住它，别让它变成弹窗。
 *
 * 症状就是 Windows 上那个红叉框：
 *   A JavaScript error occurred in the main process
 *   Uncaught Exception: Error: EPIPE: broken pipe, write
 *       at Socket._write (node:internal/net:75:18)
 *       ...
 *       at console.log (node:internal/console/constructor:414:26)
 *
 * 来龙去脉：主进程的话都往 stdout 写，而 stdout 常常是根管子——
 * 终端里 `electron scripts/xxx.mjs`、脚本里 spawn(electron, …, { stdio: "pipe" })、
 * 自动化里的一次命令，都是这样。管子另一头一没（终端关了、父进程退了、命令跑完了），
 * 下一次 console.log 就会拿到 EPIPE。它不是"代码错了"，是一个未捕获异常，
 * Electron 的默认处理器只好把它渲染成上面那个框。程序本身还好好的，只是没人听它说话了。
 *
 * 这里做两件事，把这条路堵死：
 *   1. 给 stdout / stderr 挂 error 监听 —— 兜住异步冒出来的那份
 *   2. 包一层 console.* 和这两个流的 write —— 兜住同步扔出来的那份
 * 只有"管子没了"会被吞掉，别的错误照旧往上抛，不掩盖真问题；
 * 管子断了之后就索性不再往里写，省得每一句都去撞同一堵墙。
 *
 * 要赶在任何人写日志之前生效，请放在文件最前面 import（ESM 从上往下求值）：
 *   import "./quiet-stdio.mjs";
 */

const PIPE_GONE = new Set(["EPIPE", "ERR_STREAM_DESTROYED"]);

/** 是"管子另一头没了"吗？只有这一种情况值得吞 */
function pipeGone(e) {
  return (
    !!e &&
    (PIPE_GONE.has(e.code) || e.errno === -4047 || /broken pipe/i.test(String(e.message || "")))
  );
}

function guardStream(stream) {
  if (!stream || typeof stream.write !== "function") return;
  let dead = false;
  const write = stream.write.bind(stream);
  stream.write = (...args) => {
    if (dead) return false;
    try {
      return write(...args);
    } catch (e) {
      if (!pipeGone(e)) throw e;
      dead = true;
      return false;
    }
  };
  stream.on("error", (e) => {
    if (pipeGone(e)) {
      dead = true;
      return;
    }
    throw e; // 跟管道无关的错误：还是原来那套，交给 Electron / Node 的默认处理
  });
}

guardStream(process.stdout);
guardStream(process.stderr);

/* console.* 内部是直接调 write 的，上面那层包不到它同步抛出来的那一份，所以再包一层 */
for (const name of ["log", "info", "warn", "error", "debug", "trace"]) {
  const original = typeof console[name] === "function" ? console[name].bind(console) : null;
  if (!original) continue;
  console[name] = (...args) => {
    try {
      original(...args);
    } catch (e) {
      if (!pipeGone(e)) throw e;
    }
  };
}
