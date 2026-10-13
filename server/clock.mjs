/**
 * 虚拟时钟。
 * 所有和"时间"有关的判断都必须走 now()，否则时间加速会失效，
 * 而 open loop 的验证离不开时间加速（否则一个"周四答辩"要等四天）。
 */
import { getSetting, setSetting } from "./db.mjs";

let state = { baseReal: Date.now(), baseVirtual: Date.now(), scale: 1 };

export function loadClock() {
  const saved = getSetting("clock", null);
  if (saved && typeof saved === "object") {
    state = {
      baseReal: Date.now(),
      baseVirtual: saved.baseVirtual ?? Date.now(),
      scale: saved.scale ?? 1,
    };
  }
  return describeClock();
}

function persist() {
  setSetting("clock", state);
}

export const now = () => state.baseVirtual + (Date.now() - state.baseReal) * state.scale;

function rebase() {
  const v = now();
  state.baseVirtual = v;
  state.baseReal = Date.now();
}

export function setScale(scale) {
  rebase();
  state.scale = Math.max(0, Number(scale) || 0);
  persist();
  return describeClock();
}

/** 把虚拟时间往前推 ms 毫秒 */
export function jump(ms) {
  rebase();
  state.baseVirtual += Number(ms) || 0;
  persist();
  return describeClock();
}

/** 直接把虚拟时间设到某个时间戳 */
export function setVirtual(ts) {
  state.baseReal = Date.now();
  state.baseVirtual = Number(ts) || Date.now();
  persist();
  return describeClock();
}

export function resetClock() {
  state = { baseReal: Date.now(), baseVirtual: Date.now(), scale: 1 };
  persist();
  return describeClock();
}

export function describeClock() {
  return {
    now: now(),
    scale: state.scale,
    driftMs: now() - Date.now(),
    realNow: Date.now(),
  };
}

/** "3 天后" / "昨天" 这类相对说法 */
export function humanizeDelta(ts, from = now()) {
  const d = ts - from;
  const abs = Math.abs(d);
  const day = 86400000;
  const rtf = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });
  if (abs < 3600000) return rtf.format(Math.round(d / 60000), "minute");
  if (abs < day) return rtf.format(Math.round(d / 3600000), "hour");
  return rtf.format(Math.round(d / day), "day");
}
