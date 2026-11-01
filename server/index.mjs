import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { ROOT, ENV } from "./env.mjs";
import { q, one, run, getSetting, setSetting, DATA_DIR } from "./db.mjs";

/* 调参窗口存下来的动作姿势。存成 JSON 而不是数据库，
   因为这个文件是要给人看、给人改、给人贴来贴去的 */
const POSES_FILE = path.join(DATA_DIR, "poses.json");
function readPoses() {
  try {
    const d = JSON.parse(fs.readFileSync(POSES_FILE, "utf8"));
    return { actions: d.actions ?? {} };
  } catch {
    return { actions: {} };
  }
}
function writePoses(data) {
  fs.writeFileSync(POSES_FILE, JSON.stringify(data, null, 2), "utf8");
}
import {
  loadClock,
  describeClock,
  setScale,
  jump,
  setVirtual,
  resetClock,
  now,
} from "./clock.mjs";
import { addClient, broadcast, clientCount } from "./bus.mjs";
import {
  handleChat,
  beginInit,
  initStatus,
  startProactiveLoop,
  llmStatus,
} from "./agent.mjs";
import { snapshot as ontologySnapshot, observe as ontologyObserve, resetState as ontologyReset } from "./ontology.mjs";
import {
  listMemories,
  listKeepsakes,
  updateMemory,
  deleteMemory,
  confirmMemory,
  memoryEnabled,
} from "./memory.mjs";
import { listLoops } from "./openloop.mjs";
import { listTimeline } from "./timeline.mjs";
import { listEvents, countEvents, track } from "./events.mjs";
import { daysWithContent, diaryDay, syncDay, dayKey, diaryGate, blockedLine } from "./diary.mjs";
import { murmurTick, murmurStats, markFocused } from "./murmur.mjs";
import { touchResponse } from "./touch.mjs";
import {
  immersionState,
  immersionEnabled,
  updateImmersion,
  tickImmersion,
} from "./immersion.mjs";
import {
  getPersona,
  getRelation,
  updateRelation,
  getPetName,
  getPetNamed,
  setPetName,
  DEFAULT_PET_NAME,
  DIMENSIONS,
  DEFAULT_DIMS,
} from "./persona.mjs";
import {
  adjustDimension,
  finishInit,
  inferPersona,
  initState,
  initQuestions,
  resetPersona,
} from "./initflow.mjs";
import { allMessages, ensureSession, recentMessages } from "./messages.mjs";
import {
  executeModuleTool,
  modulesSnapshot,
  wordCatalog,
} from "./modules.mjs";
import { recordVoiceTurn } from "./voice.mjs";
import { buildVoiceContext } from "./voice-context.mjs";
import { log, uid } from "./util.mjs";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function sendJson(res, data, code = 200) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

function serveStatic(res, rel) {
  const safe = path
    .normalize(rel)
    .replace(/^([/\\])+/, "")
    .replace(/^(\.\.([/\\]|$))+/, "");
  const file = path.join(ROOT, safe);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("404");
    return;
  }
  res.writeHead(200, {
    "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
    "cache-control": "no-store",
  });
  fs.createReadStream(file).pipe(res);
}

function overview() {
  const persona = getPersona();
  const relation = getRelation();
  return {
    currentSessionId: one("select id from session order by started_at desc limit 1")?.id ?? null,
    clock: describeClock(),
    llm: llmStatus(),
    petName: getPetName(),
    petNamed: getPetNamed(),
    persona,
    relation,
    dimensions: DIMENSIONS,
    init: initStatus(),
    memoryEnabled: memoryEnabled(),
    proactiveEnabled: ENV.proactive,
    memoryCount: one("select count(*) as c from memory")?.c ?? 0,
    pendingCount: one("select count(*) as c from memory where status='pending'")?.c ?? 0,
    keepsakeCount: listKeepsakes().length,
    openLoops: listLoops({ status: "open" }),
    diaryGate: diaryGate(),
    devUnlockDiary: !!getSetting("devUnlockDiary", false),
    murmur: murmurStats(),
    immersion: immersionState(),
    quietUntil: getSetting("quietUntil", null),
    devUnlockCards: getSetting("devUnlockCards", false) === true,
    petScale: getSetting("petScale", 1),
    clients: clientCount(),
    modules: modulesSnapshot(),
  };
}

const routes = {
  "GET /api/state": (req, res) => sendJson(res, overview()),

  /* 本体：状态驱动的交互。调试面板和语音层都从这里读/写 */
  "GET /api/ontology": (req, res) => sendJson(res, ontologySnapshot()),
  "POST /api/ontology/observe": async (req, res) => {
    const body = await readBody(req);
    sendJson(res, ontologyObserve(String(body.text ?? "")));
  },
  "POST /api/ontology/reset": (req, res) => sendJson(res, ontologyReset()),

  "GET /api/modules": (req, res) => sendJson(res, modulesSnapshot()),

  "GET /api/words": (req, res) => {
    const u = new URL(req.url, "http://x");
    sendJson(res, {
      items: wordCatalog({
        deck: u.searchParams.get("deck") || undefined,
        q: u.searchParams.get("q") || undefined,
        limit: Number(u.searchParams.get("limit") || 240),
      }),
    });
  },

  "GET /api/stream": (req, res) => {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify({ type: "hello", clock: describeClock() })}\n\n`);
    addClient(res);
  },

  "POST /api/chat": async (req, res) => {
    const body = await readBody(req);
    const text = String(body.text ?? "").trim();
    if (!text) return sendJson(res, { error: "空消息" }, 400);
    res.writeHead(200, {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache",
      "x-accel-buffering": "no",
    });
    const emit = (obj) => {
      try {
        res.write(`${JSON.stringify(obj)}\n`);
      } catch {
        /* 客户端断开 */
      }
    };
    try {
      await handleChat({
        sessionId: body.sessionId,
        text,
        mode: body.mode === "init" ? "init" : "chat",
        emit,
      });
    } catch (e) {
      log("对话处理失败：", e);
      emit({ type: "error", message: e.message });
    }
    res.end();
  },

  /* 小智语音回合：说由硬件负责，动作与记录由软件统一接管。 */
  "GET /api/voice/context": (req, res) => {
    const u = new URL(req.url, "http://x");
    sendJson(res, buildVoiceContext(u.searchParams.get("text") || ""));
  },

  "POST /api/voice/turn": async (req, res) => {
    const body = await readBody(req);
    try {
      sendJson(
        res,
        recordVoiceTurn({
          text: body.text,
          reply: body.reply,
          proposedAction: body.action ?? body.proposedAction,
          move: body.move,
          sessionId: body.sessionId,
        })
      );
    } catch (error) {
      sendJson(res, { ok: false, error: error.message }, 400);
    }
  },

  "POST /api/init/start": (req, res) => sendJson(res, beginInit()),

  // 第一次点开时先给它起个名字。名字是用户给的，跟稳定人格参数是两回事
  "GET /api/pet/name": (req, res) =>
    sendJson(res, { name: getPetName(), named: getPetNamed(), defaultName: DEFAULT_PET_NAME }),

  "POST /api/pet/name": async (req, res) => {
    const body = await readBody(req);
    const name = setPetName(body.name);
    broadcast("state", { petName: name });
    sendJson(res, { name, named: true });
  },

  "POST /api/init/adjust": async (req, res) => {
    const { key, value } = await readBody(req);
    sendJson(res, adjustDimension(key, Number(value)));
  },

  "POST /api/init/lock": (req, res) => {
    const p = finishInit();
    broadcast("state", { persona: p });
    sendJson(res, { persona: p });
  },

  "GET /api/memory": (req, res) =>
    sendJson(res, { items: listMemories({ status: new URL(req.url, "http://x").searchParams.get("status") || undefined }) }),

  "GET /api/timeline": (req, res) => sendJson(res, { items: listTimeline({}) }),

  "GET /api/diary": (req, res) => {
    const gate = diaryGate();
    const all = daysWithContent();
    const visibleCount = gate.maxDays >= all.length ? all.length : gate.maxDays;
    /* 日记按「了解程度」挡，**卡片不挡**。
       卡片是它写给你的，锁着就变成"你得先亲近我才能拿到我的关心"——
       正是要避开的那个味道。所以卡片只等一天，不等关系。 */
    const items = all.map((d, i) => {
      const item = diaryDay(d);
      if (i >= visibleCount) item.content = null;
      return item;
    });
    // 缺的、或者内容已经过期的，后台补写；写完通知界面重新拉
    for (const item of items.slice(0, Math.max(visibleCount, 1))) {
      if (!item.content || item.stale) {
        syncDay(item.day)
          .then(() => broadcast("state", { diaryUpdated: item.day }))
          .catch(() => {});
      }
    }
    sendJson(res, {
      items,
      gate: {
        level: gate.level,
        maxDays: gate.maxDays,
        key: gate.key,
        label: gate.label,
        days: gate.days,
        intimacy: gate.intimacy,
        next: gate.next,
        hiddenCount: Math.max(0, all.length - visibleCount),
        locked: gate.maxDays === 0,
        dev: gate.dev === true,
        line: gate.maxDays === 0 ? blockedLine() : null,
      },
    });
  },

  // 想往前翻的时候：有概率被挡下来。被挡不是惩罚，是它还没准备好
  "POST /api/diary/peek": (req, res) => {
    const gate = diaryGate();
    const all = daysWithContent();
    if (gate.maxDays === 0) {
      const line = blockedLine();
      broadcast("pet", { action: "turn_away", mood: "sulk" });
      return sendJson(res, { allowed: false, line, exhausted: false });
    }
    if (all.length <= gate.maxDays) return sendJson(res, { allowed: false, exhausted: true });
    const allowed = Math.random() < 0.25;
    track("diary_peek", { allowed, level: gate.level });
    if (!allowed) broadcast("pet", { action: "turn_away", mood: "sulk" });
    sendJson(
      res,
      allowed
        ? { allowed: true, day: diaryDay(all[gate.maxDays]), line: "……好吧，就看一眼。" }
        : { allowed: false, line: blockedLine(), exhausted: false }
    );
  },

  "GET /api/keepsakes": (req, res) => sendJson(res, { items: listKeepsakes() }),

  /* 前端报"我还在/我走了"。
     这一条同时干三件事：碎碎念的"你回来了"、桌上的它打招呼、以及离开久了它坐下等 */
  "POST /api/presence": async (req, res) => {
    const body = await readBody(req);
    const visible = body.visible !== false;
    if (!visible) {
      setSetting("panelHiddenSince", now());
      setSetting("sitDone", false);
      return sendJson(res, { ok: true, visible: false });
    }

    const lastSeen = getSetting("panelHiddenSince", null);
    setSetting("panelHiddenSince", null);
    setSetting("sitDone", false);
    markFocused();

    // 隔了多久回来 → 它反应不一样
    const awayMs = lastSeen ? now() - lastSeen : null;
    const coldStart = getSetting("serverStartedAt", null) === null;
    if (coldStart) setSetting("serverStartedAt", now());
    let action = null;
    if (coldStart) action = "welcome";
    else if (awayMs !== null && awayMs > 3 * 3600000) action = "welcome_back";
    else if (awayMs !== null && awayMs > 10 * 60000) action = "peek";
    if (action && !immersionEnabled()) broadcast("pet", { action });
    sendJson(res, { ok: true, visible: true, action, awayMs });
  },

  // 一比特互动：摸一下、拎起来、放下。不进对话流，只埋点
  "POST /api/pet/touch": async (req, res) => {
    const body = await readBody(req);
    const kind = ["tap", "drag", "drop"].includes(body.kind) ? body.kind : "tap";
    sendJson(res, touchResponse({ kind, sleeping: !!body.sleeping }));
  },

  // 调参台点「套用它」：让桌上的它立刻演一遍，不用等你去看
  "POST /api/pet/action": async (req, res) => {
    const body = await readBody(req);
    const name = String(body.name ?? "").trim();
    if (!name) return sendJson(res, { error: "缺动作名" }, 400);
    broadcast("pet", { action: name, ms: Number(body.ms) || undefined });
    sendJson(res, { ok: true, name });
  },

  "POST /api/immersion": async (req, res) => {
    const body = await readBody(req);
    let out;
    try {
      out = updateImmersion(body);
    } catch (e) {
      return sendJson(res, { error: e.message }, 400);
    }
    broadcast("immersion", out);
    if (out.event === "entered") broadcast("pet", { action: "immersed", ms: 2200 });
    if (out.event === "exited") broadcast("pet", { action: "happy", ms: 2200 });
    sendJson(res, out);
  },

  // 动作调试台专用：只广播给硬件桥，不写事件、不进记忆
  "POST /api/pet/hardware": async (req, res) => {
    const body = await readBody(req);
    const name = String(body.name ?? "").trim();
    if (!name) return sendJson(res, { error: "缺动作名" }, 400);
    broadcast("hw", { action: name });
    sendJson(res, { ok: true, name });
  },

  // 动作库：调参窗口写，桌宠读
  "GET /api/poses": (req, res) => sendJson(res, readPoses()),

  /* 形象本身。谁画的都行——只要按命名约定分好组，放进来就会动。
     改完这个文件桌宠会自己刷新，不用重启 */
  "GET /api/otto-svg": (req, res) => {
    const u = new URL(req.url, "http://x");
    const file = path.join(ROOT, "ui", "otto.svg");
    try {
      if (u.searchParams.get("meta") === "1") {
        return sendJson(res, { version: fs.statSync(file).mtimeMs });
      }
      res.writeHead(200, { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "no-store" });
      res.end(fs.readFileSync(file, "utf8"));
    } catch (e) {
      sendJson(res, { error: e.message }, 500);
    }
  },

  "POST /api/otto-svg": async (req, res) => {
    const body = await readBody(req);
    const svg = String(body.svg ?? "");
    if (!svg.includes("<svg")) return sendJson(res, { error: "这不像一段 SVG" }, 400);
    const file = path.join(ROOT, "ui", "otto.svg");
    fs.writeFileSync(file, svg, "utf8");
    broadcast("ottoArt", { version: fs.statSync(file).mtimeMs });
    track("otto_art_saved", { bytes: svg.length });
    sendJson(res, { ok: true, version: fs.statSync(file).mtimeMs });
  },

  "POST /api/poses": async (req, res) => {
    const body = await readBody(req);
    const name = String(body.name ?? "").trim();
    if (!name || !body.pose) return sendJson(res, { error: "缺少动作名或姿势" }, 400);
    const data = readPoses();
    data.actions[name] = body.pose;
    writePoses(data);
    track("pose_saved", { name });
    broadcast("state", { posesChanged: true });
    sendJson(res, { ok: true, ...data });
  },

  "POST /api/poses/delete": async (req, res) => {
    const body = await readBody(req);
    const data = readPoses();
    delete data.actions[String(body.name ?? "").trim()];
    writePoses(data);
    sendJson(res, { ok: true, ...data });
  },

  "POST /api/diary/refresh": async (req, res) => {
    const body = await readBody(req);
    const day = body.day || dayKey();
    await syncDay(day, { force: true });
    broadcast("state", { diaryUpdated: day });
    sendJson(res, { day: diaryDay(day) });
  },

  "GET /api/openloops": (req, res) => sendJson(res, { items: listLoops({}) }),

  "GET /api/messages": (req, res) => {
    const u = new URL(req.url, "http://x");
    const sid = u.searchParams.get("sessionId");
    sendJson(res, { items: sid ? allMessages(400).filter((m) => m.session_id === sid) : allMessages(400) });
  },

  "GET /api/events": (req, res) =>
    sendJson(res, { items: listEvents({}), summary: countEvents() }),

  "GET /api/export": (req, res) =>
    sendJson(res, {
      exportedAt: new Date().toISOString(),
      clock: describeClock(),
      persona: getPersona(),
      relation: getRelation(),
      memories: listMemories({}),
      openLoops: listLoops({}),
      timeline: listTimeline({}),
      messages: allMessages(2000),
      events: listEvents({ limit: 5000 }),
      diary: daysWithContent().map(diaryDay),
    }),

  "POST /api/settings": async (req, res) => {
    const body = await readBody(req);
    if (typeof body.memoryEnabled === "boolean") {
      setSetting("memoryEnabled", body.memoryEnabled);
      track("settings_changed", { memoryEnabled: body.memoryEnabled });
    }
    if (typeof body.mock === "boolean") {
      process.env.OTTO_MOCK_LLM = body.mock ? "1" : "0";
      setSetting("mockOverride", body.mock);
      track("settings_changed", { mock: body.mock });
    }
    if (typeof body.quietMinutes === "number") {
      setSetting("quietUntil", body.quietMinutes > 0 ? now() + body.quietMinutes * 60000 : null);
      track("quiet_set", { minutes: body.quietMinutes });
    }
    if (typeof body.petScale === "number") {
      setSetting("petScale", Math.min(2.2, Math.max(0.6, body.petScale)));
    }
    // 开发用：跳过卡片"等一天"的门，方便立刻看效果
    if (typeof body.devUnlockCards === "boolean") setSetting("devUnlockCards", body.devUnlockCards);
    if (typeof body.timeScale === "number") setScale(body.timeScale);
    if (typeof body.jumpMinutes === "number") jump(body.jumpMinutes * 60000);
    if (typeof body.devUnlockDiary === "boolean") {
      setSetting("devUnlockDiary", body.devUnlockDiary);
      track("settings_changed", { devUnlockDiary: body.devUnlockDiary });
    }
    if (body.resetClock) resetClock();
    if (body.resetPersona) resetPersona();
    broadcast("state", overview());
    sendJson(res, overview());
  },

  // 面板按钮、语音工具和外部自动化都走同一个执行器，避免三套状态各说各话
  "POST /api/tools/run": async (req, res) => {
    const body = await readBody(req);
    const out = executeModuleTool(body.action ?? body.tool, body.args ?? body, {
      source: body.source === "voice" ? "voice" : "api",
    });
    broadcast("state", { modulesChanged: true });
    sendJson(res, out, out.ok === false && out.error === "unknown_tool" ? 400 : 200);
  },

  "POST /api/words/mark": async (req, res) => {
    const body = await readBody(req);
    const out = executeModuleTool("word_mark", body, { source: "ui" });
    sendJson(res, out);
  },

  "POST /api/dev/reset": async (req, res) => {
    const body = await readBody(req);
    const keepPersona = !!body.keepPersona;
    for (const t of ["message", "session", "memory", "open_loop", "timeline", "event_log", "diary", "word_progress", "tool_run"]) {
      run(`delete from ${t}`);
    }
    run("update relation set stage='stranger', intimacy=0, shared_count=0, mood='平稳', updated_at=? where id=1", now());
    setSetting("pendingLoops", {});
    setSetting("murmur", null);
    setSetting("quietUntil", null);
    setSetting("lastFocusedAt", null);
    setSetting("diaryGateLevel", -1);
    setSetting("devUnlockDiary", false);
    setSetting("petNamed", false);
    setSetting("petName", DEFAULT_PET_NAME);
    setSetting("touchState", null);
    setSetting("immersion", null);
    setSetting("panelHiddenSince", null);
    setSetting("serverStartedAt", null);
    setSetting("sitDone", false);
    setSetting("musicState", null);
    setSetting("wordSession", null);
    resetClock();
    if (!keepPersona) {
      run("delete from persona");
      resetPersona();
    }
    broadcast("state", overview());
    sendJson(res, overview());
  },

  "POST /api/dev/tick": (req, res) => sendJson(res, { ok: true }),

  "POST /api/dev/proactive-check": async (req, res) => {
    const { proactiveTick } = await import("./agent.mjs");
    const out = await proactiveTick();
    sendJson(res, out ? { ok: true, message: out.message.content, loop: out.loop } : { ok: false });
  },

  // 调关系状态。演示要看"解锁之后的日记"时不用真聊三十轮
  "POST /api/dev/relation": async (req, res) => {
    const body = await readBody(req);
    const rel = getRelation();
    updateRelation({
      intimacyDelta: typeof body.intimacy === "number" ? body.intimacy - rel.intimacy : 0,
      sharedCount: typeof body.sharedCount === "number" ? body.sharedCount : rel.sharedCount,
      mood: body.mood,
    });
    broadcast("state", overview());
    sendJson(res, { relation: getRelation(), gate: diaryGate() });
  },

  "POST /api/dev/murmur-check": (req, res) => {
    const out = murmurTick(broadcast);
    sendJson(res, out ? { said: true, ...out } : { said: false, stats: murmurStats() });
  },

  "POST /api/dev/recall": async (req, res) => {
    const body = await readBody(req);
    const { recall } = await import("./memory.mjs");
    const out = recall(String(body.text ?? ""), { limit: Number(body.limit ?? 6) });
    sendJson(res, {
      memories: out.memories.map((m) => ({ id: m.id, category: m.category, content: m.content })),
      scored: out.scored ?? [],
      reason: out.reason ?? null,
    });
  },
};

// 带 :id 的路径单独处理
async function handleMemoryItem(req, res, id, method) {
  if (method === "PATCH") {
    const body = await readBody(req);
    const row = updateMemory(id, body);
    broadcast("state", overview());
    return sendJson(res, { memory: row });
  }
  if (method === "DELETE") {
    deleteMemory(id);
    track("memory_deleted", { id });
    broadcast("state", overview());
    return sendJson(res, { ok: true });
  }
  return sendJson(res, { error: "method not allowed" }, 405);
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const p = u.pathname;
  const method = req.method.toUpperCase();
  try {
    if (p === "/api/memory/confirm" && method === "POST") {
      const body = await readBody(req);
      const row = confirmMemory(body.id);
      track("memory_confirmed", { id: body.id, category: row?.category });
      broadcast("state", overview());
      return sendJson(res, { memory: row });
    }
    const memMatch = p.match(/^\/api\/memory\/([^/]+)$/);
    if (memMatch) return await handleMemoryItem(req, res, memMatch[1], method);

    const key = `${method} ${p}`;
    const handler = routes[key];
    if (handler) return await handler(req, res);

    if (method === "GET") {
      if (p === "/" || p === "/index.html") return serveStatic(res, "ui/index.html");
      if (p === "/pet" || p === "/pet.html") return serveStatic(res, "ui/pet.html");
      if (p === "/rig" || p === "/rig.html") return serveStatic(res, "ui/rig.html");
      if (p === "/props" || p === "/props.html") return serveStatic(res, "ui/props.html");
      if (p.startsWith("/api/")) return sendJson(res, { error: "not found" }, 404);
      return serveStatic(res, `ui${p}`);
    }
    sendJson(res, { error: "not found" }, 404);
  } catch (e) {
    log("请求出错：", p, e.message);
    if (!res.headersSent) sendJson(res, { error: e.message }, 500);
    else res.end();
  }
});

process.on("unhandledRejection", (e) => log("未处理的 Promise 异常：", e?.message ?? e));
process.on("uncaughtException", (e) => log("未捕获异常：", e?.message ?? e));

export function startServer({ port = ENV.port } = {}) {
  // 面板里切换过的模型模式要能跨重启保持，否则测试者每次都要改 .env
  const mockOverride = getSetting("mockOverride", null);
  if (typeof mockOverride === "boolean") process.env.OTTO_MOCK_LLM = mockOverride ? "1" : "0";
  loadClock();
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const url = `http://127.0.0.1:${port}`;
      log(`Otto 服务已启动： ${url}`);
      log(`模型： ${ENV.mock ? "mock（假模型）" : ENV.hasKey() ? ENV.model : "未配置 API Key"}`);
      const stop = startProactiveLoop(15000);
      const murmurTimer = setInterval(() => {
        try {
          murmurTick(broadcast);
          // 用户离开超过 5 分钟：它坐下等（只说一次）
          const hiddenSince = getSetting("panelHiddenSince", null);
          if (hiddenSince && !getSetting("sitDone", false) && now() - hiddenSince > 5 * 60000) {
            setSetting("sitDone", true);
            broadcast("pet", { action: "sit" });
          }
        } catch (e) {
          log("碎碎念失败：", e.message);
        }
      }, 45000);
      murmurTimer.unref?.();
      const immersionTimer = setInterval(() => {
        try {
          const out = tickImmersion();
          if (out) broadcast("immersion", out);
        } catch (e) {
          log("沉浸模式计时失败：", e.message);
        }
      }, 1000);
      immersionTimer.unref?.();
      resolve({
        port,
        url,
        stop: () => {
          stop();
          clearInterval(murmurTimer);
          clearInterval(immersionTimer);
          server.close();
        },
      });
    });
  });
}

const isMain = process.argv[1] && process.argv[1].endsWith("index.mjs");
if (isMain) {
  startServer().then(({ url }) => {
    console.log(`\n打开面板： ${url}\n桌宠窗口： ${url}/pet\n`);
  });
}
