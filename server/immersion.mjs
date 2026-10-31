import { getSetting, setSetting } from "./db.mjs";
import { now } from "./clock.mjs";
import { track } from "./events.mjs";

/**
 * 沉浸模式。
 *
 * 它不是“安静动作”，而是一级运行状态：
 * - 停掉碎碎念、主动发起和闲置彩蛋；
 * - 保留用户主动触发的对话、触摸和模块计时；
 * - 让桌宠维持一个低幅度姿势，不靠频繁动作证明自己还在。
 *
 * 脚位值目前是模块的交互元数据。经典舵机没有位置回报，
 * 所以不能把“手动扳脚到某个角度”误说成已经能被 Nano 读到。
 */
export const IMMERSION_MODULES = [
  {
    id: "quiet",
    label: "静默陪坐",
    hint: "不设结束时间，只把自由动作收起来",
    footAngle: 0,
    focusSeconds: 0,
    breakSeconds: 0,
    cycles: 0,
    enterLine: "我不催你。需要的时候再叫我。",
  },
  {
    id: "focus25",
    label: "番茄专注",
    hint: "25 分钟专注，5 分钟起身",
    footAngle: -18,
    focusSeconds: 25 * 60,
    breakSeconds: 5 * 60,
    cycles: 4,
    enterLine: "二十五分钟。我先安静待着。",
  },
  {
    id: "deep50",
    label: "深度工作",
    hint: "50 分钟一段，留 10 分钟缓一缓",
    footAngle: -9,
    focusSeconds: 50 * 60,
    breakSeconds: 10 * 60,
    cycles: 2,
    enterLine: "这一轮长一点。我不打断你。",
  },
  {
    id: "eyes20",
    label: "护眼节律",
    hint: "每 20 分钟，看远处 20 秒",
    footAngle: 9,
    focusSeconds: 20 * 60,
    breakSeconds: 20,
    cycles: 3,
    enterLine: "二十分钟后，抬头看远处一会儿。",
  },
  {
    id: "stand45",
    label: "久坐提醒",
    hint: "45 分钟后，起来走一走",
    footAngle: 18,
    focusSeconds: 45 * 60,
    breakSeconds: 5 * 60,
    cycles: 2,
    enterLine: "先坐稳。四十五分钟后我提醒你起来。",
  },
  {
    id: "wrap",
    label: "收尾五分钟",
    hint: "把手上这一件事做完，然后停",
    footAngle: 27,
    focusSeconds: 5 * 60,
    breakSeconds: 0,
    cycles: 1,
    enterLine: "最后五分钟。做完就停。",
  },
];

export const IMMERSION_MODULE_MAP = new Map(IMMERSION_MODULES.map((m) => [m.id, m]));

const QUIET_ACTIONS = new Set([
  "immersed",
  "idle",
  "sleepy",
  "doze",
  "sit",
  "lean_in",
  "listening",
  "think",
  "speaking",
  "confirm",
]);

function defaultState() {
  return {
    enabled: false,
    module: "quiet",
    running: false,
    phase: "focus",
    cycle: 1,
    phaseStartedAt: null,
    phaseEndsAt: null,
    pausedRemainingMs: null,
    completedSessions: 0,
    lastCompletedAt: null,
    lastNotice: null,
  };
}

function normalize(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== "object") return base;
  const module = IMMERSION_MODULE_MAP.has(raw.module) ? raw.module : base.module;
  const phase = ["focus", "break", "complete"].includes(raw.phase) ? raw.phase : "focus";
  const cycle = Math.max(1, Number(raw.cycle) || 1);
  return {
    ...base,
    ...raw,
    enabled: raw.enabled === true,
    module,
    phase,
    cycle,
    running: raw.running === true,
    completedSessions: Math.max(0, Number(raw.completedSessions) || 0),
  };
}

function save(state) {
  setSetting("immersion", state);
}

function phaseDurationMs(module, phase) {
  if (!module || phase === "complete") return 0;
  return (phase === "break" ? module.breakSeconds : module.focusSeconds) * 1000;
}

function phaseLine(module, phase) {
  if (phase === "break") {
    if (module.id === "eyes20") return "抬头，看看六米以外的地方。二十秒就好。";
    if (module.id === "stand45") return "站起来走一走。五分钟后再回来。";
    return "这一轮结束了，松一下。";
  }
  if (phase === "complete") return "这一段做完了。先停在这里。";
  return module.enterLine;
}

function publicState(raw) {
  const st = normalize(raw);
  const module = IMMERSION_MODULE_MAP.get(st.module);
  const durationMs = phaseDurationMs(module, st.phase);
  let remainingMs = null;
  if (st.running && st.phaseEndsAt != null) remainingMs = Math.max(0, st.phaseEndsAt - now());
  else if (!st.running && st.pausedRemainingMs != null) remainingMs = st.pausedRemainingMs;
  const progress = durationMs > 0 && remainingMs != null
    ? Math.max(0, Math.min(1, 1 - remainingMs / durationMs))
    : st.phase === "complete" ? 1 : 0;

  return {
    ...st,
    moduleInfo: module,
    modules: IMMERSION_MODULES,
    phaseLabel:
      st.phase === "break" ? "休息" : st.phase === "complete" ? "已完成" : "工作",
    remainingMs,
    durationMs,
    progress,
    footRule: "两只脚同向；任一只到达即算",
  };
}

export function immersionState() {
  return publicState(getSetting("immersion", null));
}

export function immersionEnabled() {
  return immersionState().enabled;
}

/** 沉浸模式下，所有由程序发出的身体动作都收成低幅度状态 */
export function immersionAction(action) {
  if (!immersionEnabled()) return action;
  return QUIET_ACTIONS.has(action) ? action : "immersed";
}

function startPhase(st, phase, at) {
  const module = IMMERSION_MODULE_MAP.get(st.module);
  const duration = phaseDurationMs(module, phase);
  st.phase = phase;
  st.phaseStartedAt = at;
  st.phaseEndsAt = duration > 0 ? at + duration : null;
  st.pausedRemainingMs = null;
  st.running = true;
}

function advancePhase(st, at) {
  const module = IMMERSION_MODULE_MAP.get(st.module);
  if (st.phase === "focus") {
    if (module.breakSeconds > 0) {
      startPhase(st, "break", at);
      return { event: "break", notice: phaseLine(module, "break") };
    }
    if (st.cycle < module.cycles) {
      st.cycle += 1;
      startPhase(st, "focus", at);
      return { event: "focus", notice: phaseLine(module, "focus") };
    }
  } else if (st.phase === "break" && st.cycle < module.cycles) {
    st.cycle += 1;
    startPhase(st, "focus", at);
    return { event: "focus", notice: phaseLine(module, "focus") };
  }

  st.running = false;
  st.phase = "complete";
  st.phaseEndsAt = null;
  st.pausedRemainingMs = 0;
  st.completedSessions += 1;
  st.lastCompletedAt = at;
  track("immersion_completed", { module: st.module });
  return { event: "complete", notice: phaseLine(module, "complete") };
}

/**
 * 更新沉浸模式。
 * body.command: start / pause / resume / next / reset / finish
 */
export function updateImmersion(body = {}) {
  let st = normalize(getSetting("immersion", null));
  let event = "updated";
  let notice = null;
  let membershipChanged = false;

  if (typeof body.enabled === "boolean") {
    membershipChanged = body.enabled !== st.enabled;
    st.enabled = body.enabled;
    if (!membershipChanged) {
      event = "unchanged";
    }
    if (st.enabled) {
      if (membershipChanged) {
        st.running = false;
        st.phase = "focus";
        st.cycle = 1;
        st.phaseStartedAt = null;
        st.phaseEndsAt = null;
        st.pausedRemainingMs = null;
        event = "entered";
        notice = "我安静下来了。你可以把我倒过来，去做你的事。";
        track("immersion_entered", { module: st.module });
      }
    } else {
      if (membershipChanged) {
        st.running = false;
        st.phase = "focus";
        st.cycle = 1;
        st.phaseStartedAt = null;
        st.phaseEndsAt = null;
        st.pausedRemainingMs = null;
        event = "exited";
        notice = "好了，我回来了。";
        track("immersion_exited", { module: st.module });
      }
    }
    st.lastNotice = notice;
  }

  let requestedModule = typeof body.module === "string" ? body.module : null;
  const footAngles = [
    ...(Array.isArray(body.footAngles) ? body.footAngles : []),
    body.footAngle,
  ]
    .map(Number)
    .filter(Number.isFinite);
  if (footAngles.length) {
    const hit = IMMERSION_MODULES.find((m) =>
      footAngles.some((angle) => Math.abs(m.footAngle - angle) <= 3.5)
    );
    if (!hit) throw new Error("脚位没有对应的沉浸模块");
    requestedModule = hit.id;
    track("immersion_foot_selected", { angles: footAngles, module: hit.id });
  }

  if (requestedModule && requestedModule !== st.module) {
    if (!IMMERSION_MODULE_MAP.has(requestedModule)) throw new Error("未知的沉浸模块");
    st.module = requestedModule;
    st.running = false;
    st.phase = "focus";
    st.cycle = 1;
    st.phaseStartedAt = null;
    st.phaseEndsAt = null;
    st.pausedRemainingMs = null;
    if (!membershipChanged) {
      event = "module";
      notice = IMMERSION_MODULE_MAP.get(st.module).enterLine;
    }
    track("immersion_module_changed", { module: st.module });
  }

  const command = String(body.command ?? "");
  const module = IMMERSION_MODULE_MAP.get(st.module);
  const at = now();
  if (command === "start") {
    startPhase(st, "focus", at);
    event = "started";
    notice = module.enterLine;
    track("immersion_started", { module: st.module });
  } else if (command === "pause" && st.running) {
    st.pausedRemainingMs = st.phaseEndsAt == null ? null : Math.max(0, st.phaseEndsAt - at);
    st.running = false;
    st.phaseEndsAt = null;
    event = "paused";
    notice = "计时先停着。";
    track("immersion_paused", { module: st.module, phase: st.phase });
  } else if (command === "resume" && !st.running && st.phase !== "complete") {
    const remaining = st.pausedRemainingMs;
    st.running = true;
    st.phaseEndsAt = remaining == null ? null : at + remaining;
    st.pausedRemainingMs = null;
    event = "resumed";
    notice = "接着来。";
  } else if (command === "reset") {
    st.running = false;
    st.phase = "focus";
    st.cycle = 1;
    st.phaseStartedAt = null;
    st.phaseEndsAt = null;
    st.pausedRemainingMs = null;
    event = "reset";
    notice = "这一轮从头开始。";
  } else if (command === "next" && st.phase !== "complete") {
    const advanced = advancePhase(st, at);
    event = advanced.event;
    notice = advanced.notice;
  } else if (command === "finish") {
    st.running = false;
    st.phase = "complete";
    st.phaseEndsAt = null;
    st.pausedRemainingMs = 0;
    event = "finished";
    notice = "好，先到这里。";
  }

  st.lastNotice = notice;
  save(st);
  return { state: publicState(st), event, notice };
}

/** 定时器每一秒调用；只在阶段真正切换时返回事件 */
export function tickImmersion() {
  const st = normalize(getSetting("immersion", null));
  if (!st.enabled || !st.running || st.phaseEndsAt == null) return null;
  const at = now();
  if (at < st.phaseEndsAt) return null;

  let guard = 0;
  let notice = null;
  let event = "phase";
  while (st.running && st.phaseEndsAt != null && at >= st.phaseEndsAt && guard++ < 24) {
    const advanced = advancePhase(st, st.phaseEndsAt);
    event = advanced.event;
    notice = advanced.notice;
  }
  st.lastNotice = notice;
  save(st);
  return { state: publicState(st), event, notice };
}
