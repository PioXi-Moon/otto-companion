/**
 * 道具库的图形。id 必须和 server/props.mjs 里的目录一一对应（smoke 里会查）。
 *
 * 画法统一成三件事：
 *   1. 48×48 的方格，物件贴边但不越界
 *   2. 一根细灰线勾形（--prop-line），配浅色填充
 *   3. 颜色全走 CSS 变量，换皮只改 styles.css 里那一行
 * 这样它们跟 Otto 摆在一起是一套，而不是贴上去的图标。
 */
const S = (body) => `<svg viewBox="0 0 48 48" class="prop" aria-hidden="true">${body}</svg>`;

export const PROPS = [
  {
    id: "lamp",
    name: "台灯",
    svg: S(`
      <path class="p-warm" d="M15 8 H29 L35 23 H9 Z"/>
      <circle class="p-glow" cx="22" cy="27" r="3.4"/>
      <path class="p-line" d="M22 30.5 V37"/>
      <ellipse class="p-fill" cx="22" cy="39" rx="12" ry="3.2"/>`),
  },
  {
    id: "window",
    name: "窗",
    svg: S(`
      <rect class="p-glass" x="7" y="12" width="34" height="24" rx="1.5"/>
      <circle class="p-warm" cx="33" cy="19.5" r="3.4"/>
      <rect class="p-line" x="4.5" y="10" width="39" height="28" rx="2.5"/>
      <path class="p-line" d="M24 11 V37 M5.5 24 H42.5 M3 42 H45"/>`),
  },
  {
    id: "moon",
    name: "月亮",
    svg: S(`
      <path class="p-warm" d="M26 11 A13 13 0 1 0 26 37 A16.5 16.5 0 0 1 26 11 Z"/>
      <path class="p-glow" d="M38 12 l1.4 3 3 1.4 -3 1.4 -1.4 3 -1.4 -3 -3 -1.4 3 -1.4 z"/>`),
  },
  {
    id: "sun",
    name: "太阳",
    svg: S(`
      <circle class="p-warm" cx="24" cy="24" r="8.5"/>
      <path class="p-line" d="M24 6 v5 M24 37 v5 M6 24 h5 M37 24 h5
        M11.3 11.3 l3.5 3.5 M33.2 33.2 l3.5 3.5
        M36.7 11.3 l-3.5 3.5 M14.8 33.2 l-3.5 3.5"/>`),
  },
  {
    id: "cloud",
    name: "云",
    svg: S(`
      <g class="p-solid">
        <circle cx="16.5" cy="28" r="6.5"/>
        <circle cx="25" cy="23" r="8.5"/>
        <circle cx="33.5" cy="28.5" r="5.5"/>
        <rect x="16" y="27" width="18" height="8" rx="4"/>
      </g>
      <path class="p-line" d="M15 36.5 H34"/>`),
  },
  {
    id: "rain",
    name: "下雨",
    svg: S(`
      <g class="p-solid">
        <circle cx="16.5" cy="22" r="6"/>
        <circle cx="25" cy="17.5" r="8"/>
        <circle cx="33.5" cy="22.5" r="5.2"/>
        <rect x="16" y="21" width="18" height="7.5" rx="3.7"/>
      </g>
      <path class="p-line" d="M15 30.5 H34 M18 35 l-2 5 M26 35 l-2 5 M34 35 l-2 5"/>`),
  },
  {
    id: "umbrella",
    name: "伞",
    svg: S(`
      <path class="p-soft" d="M8 26 A16 16 0 0 1 40 26 Z"/>
      <path class="p-line" d="M8 26 q4 3.2 8 0 q4 3.2 8 0 q4 3.2 8 0 q4 3.2 8 0"/>
      <path class="p-line" d="M24 26 V37 a4.5 4.5 0 0 0 9 0 M24 10 V6.5"/>`),
  },
  {
    id: "cup",
    name: "水杯",
    svg: S(`
      <path class="p-fill" d="M15 13 H33 L30.6 38.4 A3.2 3.2 0 0 1 27.4 41.4 H20.6 A3.2 3.2 0 0 1 17.4 38.4 Z"/>
      <path class="p-water" d="M17.3 23 H30.7 L28.9 38.2 A1.8 1.8 0 0 1 27.1 39.8 H20.9 A1.8 1.8 0 0 1 19.1 38.2 Z"/>
      <ellipse class="p-fill" cx="24" cy="13" rx="9" ry="2.6"/>`),
  },
  {
    id: "coffee",
    name: "咖啡",
    svg: S(`
      <path class="p-line" d="M18.5 10.5 c0 -2.5 2 -2.5 2 -5 M24.5 10.5 c0 -2.5 2 -2.5 2 -5"/>
      <path class="p-fill" d="M13 15 H29 L27.4 33.6 A3.4 3.4 0 0 1 24 36.8 H18 A3.4 3.4 0 0 1 14.6 33.6 Z"/>
      <path class="p-line" d="M29.5 19.5 H32.5 A4.2 4.2 0 0 1 32.5 28 H28.6"/>
      <ellipse class="p-soft" cx="21" cy="40" rx="12" ry="2.6"/>
      <ellipse class="p-fill" cx="21" cy="15" rx="8" ry="2.4"/>`),
  },
  {
    id: "noodle",
    name: "泡面",
    svg: S(`
      <path class="p-fill" d="M13 17 H35 L32.6 39.4 A3 3 0 0 1 29.6 42 H18.4 A3 3 0 0 1 15.4 39.4 Z"/>
      <ellipse class="p-fill" cx="24" cy="17" rx="11" ry="2.8"/>
      <path class="p-line" d="M17.5 24 c2 2.5 4 -2.5 6.5 0 s4 2.5 6.5 0"/>
      <path class="p-warm" d="M34 14.5 l6 3 l-6 3 z"/>`),
  },
  {
    id: "bento",
    name: "饭盒",
    svg: S(`
      <rect class="p-fill" x="10" y="15" width="28" height="21" rx="3"/>
      <path class="p-line" d="M24 16 V35"/>
      <rect class="p-soft" x="27" y="19" width="8" height="6" rx="1.5"/>
      <circle class="p-warm" cx="17" cy="22" r="3.2"/>
      <path class="p-line" d="M13 32 h8"/>`),
  },
  {
    id: "snack",
    name: "零食",
    svg: S(`
      <path class="p-soft" d="M13 16 H35 V11 H13 Z"/>
      <path class="p-fill" d="M15 16 H33 V37 A2.5 2.5 0 0 1 30.5 39.5 H17.5 A2.5 2.5 0 0 1 15 37 Z"/>
      <path class="p-spark" d="M24 20 l2 4.6 4.6 2 -4.6 2 -2 4.6 -2 -4.6 -4.6 -2 4.6 -2 z"/>`),
  },
  {
    id: "paper",
    name: "一叠纸",
    svg: S(`
      <rect class="p-fill" x="11" y="12" width="23" height="27" rx="1.5"/>
      <rect class="p-fill" x="15" y="8" width="23" height="29" rx="1.5"/>
      <path class="p-line" d="M20 16 H33 M20 22 H33 M20 28 H29"/>`),
  },
  {
    id: "pen",
    name: "笔",
    svg: S(`
      <g transform="rotate(-38 24 24)">
        <rect class="p-fill" x="20.5" y="7" width="7" height="25" rx="2.5"/>
        <path class="p-soft" d="M20.5 32 H27.5 L24 40 Z"/>
        <path class="p-line" d="M20.5 13 H27.5"/>
      </g>`),
  },
  {
    id: "book",
    name: "摊开的书",
    svg: S(`
      <path class="p-fill" d="M24 15 C20 12 15 11 10.5 11.5 V33 C15 32.5 20 33.5 24 36.5
        C28 33.5 33 32.5 37.5 33 V11.5 C33 11 28 12 24 15 Z"/>
      <path class="p-line" d="M24 15 V36.5 M14 17.5 H20 M14 22.5 H20 M28 17.5 H34 M28 22.5 H34"/>`),
  },
  {
    id: "notebook",
    name: "本子",
    svg: S(`
      <rect class="p-fill" x="14" y="9" width="21" height="31" rx="2.5"/>
      <path class="p-line" d="M10 14.5 h7 M10 20.5 h7 M10 26.5 h7 M10 32.5 h7 M10 38 h7"/>
      <path class="p-line" d="M19.5 17 H30 M19.5 23 H30"/>`),
  },
  {
    id: "alarm",
    name: "闹钟",
    svg: S(`
      <path class="p-line" d="M14 10 l6 5 M34 10 l-6 5 M17 36.5 l-3.5 5 M31 36.5 l3.5 5"/>
      <circle class="p-fill" cx="24" cy="26" r="12"/>
      <path class="p-line" d="M24 26 V19.5 M24 26 l5.5 3"/>`),
  },
  {
    id: "phone",
    name: "手机",
    svg: S(`
      <rect class="p-fill" x="16" y="7" width="16" height="34" rx="3.5"/>
      <rect class="p-soft" x="18.5" y="12" width="11" height="21" rx="1.5"/>
      <path class="p-line" d="M22 9.5 h4"/>
      <circle class="p-dot" cx="24" cy="37" r="1.3"/>`),
  },
  {
    id: "headphones",
    name: "耳机",
    svg: S(`
      <path class="p-line" d="M11 30 V24 A13 13 0 0 1 37 24 V30"/>
      <rect class="p-soft" x="8" y="27" width="7" height="13" rx="3.5"/>
      <rect class="p-soft" x="33" y="27" width="7" height="13" rx="3.5"/>`),
  },
  {
    id: "pillow",
    name: "枕头",
    svg: S(`
      <rect class="p-fill" x="8" y="13" width="32" height="22" rx="8"/>
      <path class="p-line" d="M14 29.5 H34"/>`),
  },
  {
    id: "blanket",
    name: "毯子",
    svg: S(`
      <path class="p-soft" d="M9 16 H39 V32 q-3.7 3.2 -7.5 0 q-3.8 -3.2 -7.5 0
        q-3.7 3.2 -7.5 0 q-3.7 -3.2 -7.5 0 Z"/>
      <path class="p-line" d="M9 22 H39"/>`),
  },
  {
    id: "box",
    name: "纸箱",
    svg: S(`
      <path class="p-soft" d="M10 18 L17 10 H31 L38 18 Z"/>
      <path class="p-fill" d="M10 18 H38 V37 A2 2 0 0 1 36 39 H12 A2 2 0 0 1 10 37 Z"/>
      <rect class="p-tape" x="21.5" y="11" width="5" height="28"/>
      <path class="p-line" d="M10 18 H38"/>`),
  },
  {
    id: "plant",
    name: "盆栽",
    svg: S(`
      <path class="p-line" d="M24 31 V20"/>
      <path class="p-green" d="M24 26 C17 25 15.5 19 15.5 19 C21.5 18 24 21.5 24 26 Z"/>
      <path class="p-green" d="M24 22 C31 21 32.5 15 32.5 15 C26.5 14 24 17.5 24 22 Z"/>
      <path class="p-fill" d="M16 31 H32 L30 40 A1.5 1.5 0 0 1 28.5 41.5 H19.5 A1.5 1.5 0 0 1 18 40 Z"/>`),
  },
  {
    id: "tissue",
    name: "纸巾",
    svg: S(`
      <rect class="p-fill" x="9" y="27" width="30" height="12" rx="2.5"/>
      <path class="p-soft" d="M18.5 30 C18.5 15.5 29.5 15.5 29.5 30 Z"/>
      <path class="p-line" d="M18.5 30 H29.5"/>`),
  },
  {
    id: "medicine",
    name: "药",
    svg: S(`
      <g transform="rotate(-30 18 28)">
        <rect class="p-warm" x="11" y="24" width="14" height="9" rx="4.5"/>
        <path class="p-line" d="M18 24 V33"/>
      </g>
      <g transform="rotate(30 32 21)">
        <rect class="p-fill" x="25" y="16.5" width="14" height="9" rx="4.5"/>
        <path class="p-line" d="M32 16.5 V25.5"/>
      </g>`),
  },
  {
    id: "bandage",
    name: "创可贴",
    svg: S(`
      <g transform="rotate(-25 24 24)">
        <rect class="p-warm" x="9" y="19" width="30" height="11" rx="5.5"/>
        <rect class="p-soft" x="18" y="21" width="12" height="7" rx="1.5"/>
      </g>`),
  },
  {
    id: "star",
    name: "星星",
    svg: S(`<path class="p-warm" d="M24 8 L27 21 L40 24 L27 27 L24 40 L21 27 L8 24 L21 21 Z"/>`),
  },
  {
    id: "keyboard",
    name: "键盘",
    svg: S(`
      <rect class="p-fill" x="6" y="15" width="36" height="19" rx="2.5"/>
      <path class="p-line" d="M11 20.5 h4 M18 20.5 h4 M25 20.5 h4 M32 20.5 h5
        M11 25.5 h5 M19 25.5 h4 M26 25.5 h4 M33 25.5 h4"/>
      <path class="p-line" d="M16 30.5 h16"/>`),
  },
  {
    id: "speaker",
    name: "音箱",
    svg: S(`
      <rect class="p-fill" x="12" y="9" width="24" height="30" rx="4"/>
      <circle class="p-soft" cx="24" cy="25" r="7.5"/>
      <circle class="p-dot" cx="24" cy="25" r="2"/>
      <circle class="p-dot" cx="18.5" cy="14" r="1.2"/>`),
  },
  {
    id: "postit",
    name: "便利贴",
    svg: S(`
      <path class="p-warm" d="M12 10 H34 V30 L26 38 H12 Z"/>
      <path class="p-line" d="M26 38 V30 H34 M17 18 H29 M17 24 H25"/>`),
  },
  {
    id: "biscuit",
    name: "饼干",
    svg: S(`
      <ellipse class="p-soft" cx="24" cy="33" rx="16" ry="5"/>
      <circle class="p-fill" cx="18" cy="26" r="7"/>
      <circle class="p-fill" cx="30" cy="28.5" r="5.5"/>
      <circle class="p-dot" cx="15.5" cy="24" r="0.9"/>
      <circle class="p-dot" cx="20" cy="28.5" r="0.9"/>
      <circle class="p-dot" cx="19.5" cy="22.5" r="0.9"/>
      <circle class="p-dot" cx="30" cy="27" r="0.9"/>`),
  },
  {
    id: "zzz",
    name: "睡着的记号",
    svg: S(`
      <path class="p-line" d="M13 14 H22 L13 24 H22"/>
      <path class="p-line" d="M25 26 H32 L25 34 H32"/>
      <path class="p-line" d="M33 9 H38 L33 15 H38"/>`),
  },
];

export const PROP_MAP = Object.fromEntries(PROPS.map((p) => [p.id, p]));

/** 拿不到就返回空串——少一个道具，比页面上出现一个红叉好 */
export function propSvg(id) {
  return PROP_MAP[id]?.svg ?? "";
}

export function propName(id) {
  return PROP_MAP[id]?.name ?? id;
}
