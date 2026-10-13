/**
 * 骨架参数。
 *
 * 这个文件同时被桌宠和调参台用。
 * 每个参数都是 CSS 变量，SVG 的 transform 全部由它们算出来——
 * 所以"形象长什么样"是数据，不是写死的坐标。
 *
 * 顺序就是从上到下、从整体到局部，调参台按这个顺序排。
 */

export const RIG_PARAMS = [
  { key: "lean", label: "整体倾斜", min: -30, max: 30, step: 0.5, def: 0, unit: "°", hint: "绕脚底转，左右倒" },
  { key: "slide", label: "横向平移", min: -46, max: 46, step: 1, def: 0, unit: "", hint: "负数往左。躲猫猫要用它挪出半个身子" },
  { key: "lift", label: "上下", min: -24, max: 24, step: 0.5, def: 0, unit: "", hint: "正数往下坐" },
  { key: "squash", label: "压扁拉长", min: 0.76, max: 1.2, step: 0.01, def: 1, unit: "×", hint: "小于 1 是蹲，大于 1 是站高" },
  { key: "hipL", label: "左腿开合", min: -42, max: 42, step: 1, def: 0, unit: "°", hint: "往外是摊开" },
  { key: "hipR", label: "右腿开合", min: -42, max: 42, step: 1, def: 0, unit: "°" },
  { key: "ankleL", label: "左脚踝", min: -36, max: 36, step: 1, def: 0, unit: "°" },
  { key: "ankleR", label: "右脚踝", min: -36, max: 36, step: 1, def: 0, unit: "°" },
  { key: "head", label: "头角度", min: -16, max: 16, step: 0.5, def: 0, unit: "°", hint: "硬件上未必有，先当软件通道" },
  { key: "mouthY", label: "嘴的高低", min: -20, max: 30, step: 1, def: 0, unit: "", hint: "负数往上（绿头），正数往下（白身）" },

  /* ---- 眼睛：这五个是软件独有的通道，24 个表情大部分靠它们区分 ---- */
  { key: "lidL", label: "左眼睑", min: 0, max: 1, step: 0.01, def: 0, unit: "", hint: "0 全开，1 全闭" },
  { key: "lidR", label: "右眼睑", min: 0, max: 1, step: 0.01, def: 0, unit: "" },
  { key: "lidTilt", label: "眼皮倾斜", min: -1, max: 1, step: 0.05, def: 0, unit: "", hint: "正数 = 外眼角下垂（委屈）" },
  { key: "pupilX", label: "瞳孔左右", min: -1, max: 1, step: 0.05, def: 0, unit: "" },
  { key: "pupilY", label: "瞳孔上下", min: -1, max: 1, step: 0.05, def: 0, unit: "" },

  /* ---- 两个离散的：写法是数字，渲染时映射成 class ---- */
  { key: "eyeShape", label: "眼形", min: 0, max: 2, step: 1, def: 0, unit: "", hint: "0 圆瞳 · 1 弯眼（笑）· 2 闭眼", discrete: ["eye-round", "eye-arc", "eye-shut"] },
  { key: "mouthShape", label: "嘴形", min: 0, max: 4, step: 1, def: 0, unit: "", hint: "0 平 · 1 上弧 · 2 下弧 · 3 圆 · 4 大圆", discrete: ["mouth-s-flat", "mouth-s-happy", "mouth-s-sad", "mouth-s-o", "mouth-s-o-big"] },
];

export const DEFAULT_POSE = Object.fromEntries(RIG_PARAMS.map((p) => [p.key, p.def]));

export function applyPose(el, pose = {}) {
  for (const p of RIG_PARAMS) {
    const v = pose[p.key];
    const n = typeof v === "number" ? v : p.def;
    if (p.discrete) {
      // 离散参数：先把这一类 class 全摘掉，再挂上当前那个
      el.classList.remove(...p.discrete);
      const idx = Math.max(0, Math.min(p.discrete.length - 1, Math.round(n)));
      el.classList.add(p.discrete[idx]);
    } else {
      el.style.setProperty(`--${p.key}`, String(n));
    }
  }
}

/** 把姿势写成 CSS 自定义属性，方便贴给别人 */
export function poseToCss(pose) {
  return RIG_PARAMS.map((p) =>
    p.discrete
      ? `/* ${p.label}: ${p.discrete[Math.round(pose[p.key] ?? p.def)]} */`
      : `--${p.key}: ${pose[p.key] ?? p.def};`
  ).join("\n");
}

/** 给调参台用：把离散值翻成文字 */
export function describeParam(p, v) {
  if (!p.discrete) return `${v}${p.unit}`;
  return p.discrete[Math.round(v)].replace(/^(eye|mouth-s)-/, "");
}
