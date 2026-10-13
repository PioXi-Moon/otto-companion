/** 极简事件总线：SSE 客户端订阅 + 主进程（Electron 通知）订阅 */
const clients = new Set();
const listeners = new Set();

export function addClient(res) {
  clients.add(res);
  res.on("close", () => clients.delete(res));
}

export function onEvent(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function broadcast(type, data = {}) {
  const payload = { type, ...data };
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    try {
      res.write(line);
    } catch {
      clients.delete(res);
    }
  }
  for (const fn of listeners) {
    try {
      fn(payload);
    } catch {
      /* ignore */
    }
  }
}

export const clientCount = () => clients.size;
