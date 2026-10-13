export const uid = (p = "id") =>
  `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function parseJson(s, fallback = null) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** 稳定的 JSON 抽取：模型偶尔会包裹 ```json 或加前后废话 */
export function extractJson(text) {
  if (!text) return null;
  let s = String(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = Math.min(
    ...[s.indexOf("{"), s.indexOf("[")].filter((i) => i >= 0)
  );
  if (!Number.isFinite(start)) return null;
  const open = s[start];
  const close = open === "{" ? "}" : "]";
  const end = s.lastIndexOf(close);
  if (end < 0) return null;
  return parseJson(s.slice(start, end + 1));
}

export function log(...args) {
  const t = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  console.log(`[${t}]`, ...args);
}
