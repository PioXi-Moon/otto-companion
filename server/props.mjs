/**
 * 道具库：手账页上的小画。
 *
 * 为什么不让它自由画：模型画 SVG 一定翻车（畸形路径、越界、风格漂移）。
 * 所以收窄成"挑道具 + 挑格子"——它负责判断这一天该出现什么东西，
 * 画成什么样由这里定死。
 *
 * 这份目录只管名字和格子；图形在 ui/props.js。
 * 两边靠 id 对齐，对不上就是静默失败，所以 scripts/smoke.mjs 里静态查一遍。
 */

/** 这些挑的都是「桌面上会有的东西」，不是装饰花边 */
export const PROPS = [
  { id: "lamp", name: "台灯" },
  { id: "window", name: "窗" },
  { id: "moon", name: "月亮" },
  { id: "sun", name: "太阳" },
  { id: "cloud", name: "云" },
  { id: "rain", name: "下雨" },
  { id: "umbrella", name: "伞" },
  { id: "cup", name: "水杯" },
  { id: "coffee", name: "咖啡" },
  { id: "noodle", name: "泡面" },
  { id: "bento", name: "饭盒" },
  { id: "snack", name: "零食" },
  { id: "paper", name: "一叠纸" },
  { id: "pen", name: "笔" },
  { id: "book", name: "摊开的书" },
  { id: "notebook", name: "本子" },
  { id: "alarm", name: "闹钟" },
  { id: "phone", name: "手机" },
  { id: "headphones", name: "耳机" },
  { id: "pillow", name: "枕头" },
  { id: "blanket", name: "毯子" },
  { id: "box", name: "纸箱" },
  { id: "plant", name: "盆栽" },
  { id: "tissue", name: "纸巾" },
  { id: "medicine", name: "药" },
  { id: "bandage", name: "创可贴" },
  { id: "star", name: "星星" },
  { id: "keyboard", name: "键盘" },
  { id: "speaker", name: "音箱" },
  { id: "postit", name: "便利贴" },
  { id: "biscuit", name: "饼干" },
  { id: "zzz", name: "睡着的记号" },
];

export const PROP_IDS = new Set(PROPS.map((p) => p.id));

/** 格子：四个角 + 页中。版式决定这些格子最终落在纸面的哪儿 */
export const SLOTS = ["tl", "tr", "mid", "bl", "br"];

export const LAYOUTS = ["side", "note", "full", "margin", "huge"];

export const PROPS_BLOCK = `【道具】挑 1 到 3 个，这一天的画面上要有它们。
优先级是这样的：
  1. 正文里真的写到过的那样东西（他喝的那个杯子、他今天放下的那本书）
  2. 正文里没写、但这一天确实在场的东西（窗外那场阴天、他打字用的手机、桌上亮着的灯）
  3. 实在没有，才空着
图和字对不上，这一页就是贴纸本；但一页手账上一件东西都没有，也退回了干巴巴的日记。
所以**至少挑一个**，空着是最后的选择。

**别连着两天画同一批东西。** 手机、台灯、水杯是最顺手的三个，顺手不等于对——
先在心里把那几个划掉，看看这一天还有没有别的：键盘、音箱、便利贴、饼干、耳机、
那本书、那个纸箱、窗外的月亮。同样的日子画两次，本子就不像日子了。
道具表：${PROPS.map((p) => `${p.id}=${p.name}`).join(" ")}
位置 at 只能填这五个之一：tl 左上 / tr 右上 / bl 左下 / br 右下 / mid 页中。
画面是配角，不许压住正文，主要放角落，mid 只留给"这一天就一个东西"的日子。`;

/**
 * 清洗模型给的道具。不认识的一律丢掉，不认识的格子退回角落，
 * 最多留三个——多了就不是手账，是贴纸本。
 */
export function cleanProps(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const p of raw) {
    const id = typeof p === "string" ? p : p?.id;
    if (!PROP_IDS.has(id) || seen.has(id)) continue;
    const at = SLOTS.includes(p?.at) ? p.at : "br";
    seen.add(id);
    out.push({ id, at });
    if (out.length >= 3) break;
  }
  return out;
}
