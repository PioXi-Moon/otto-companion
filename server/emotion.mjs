/**
 * 情感模块。
 *
 * 一个模块触发时，四个输出同时发生：身体动作 + 声音 + 颜文字 + 心理。
 * 声音那一列第一阶段留空（Otto 会出声说话，但那是硬件侧能力），
 * 接口留着，第三阶段接上就行。
 *
 * 这张表同时也是设计交付物：7.4 说"四个舵机能表达的语义是有限的，
 * 需要做动作映射测试才知道"，所以它是给动作映射测试用的输入，
 * 测完认不出来的合并或砍掉。
 *
 * "身体"那一列写的必须是四个舵机真做得到的事：两条大腿管前后倾和站坐，
 * 两只脚管转角度和跺。Otto 没有手，头也转不了——那是和身子一体的。
 * 软件端照着这个做，第三阶段接硬件时这条链路才是通的。
 */

export const GROUPS = {
  self: "自发的（不需要你在场）",
  you: "对你的（对话或你的行为触发）",
  thing: "对事的（记忆和线头触发）",
};

export const EMOTIONS = [
  // 自发的
  {
    key: "doze",
    group: "self",
    label: "打盹",
    body: "坐下塌下去，两条腿往外摊，呼吸变慢",
    sound: null,
    kaomoji: "(￣ω￣)",
    action: "doze",
  },
  {
    key: "idle",
    group: "self",
    label: "发呆",
    body: "站着不动，偶尔轻轻晃一下",
    sound: null,
    kaomoji: "(・_・)",
    action: "idle",
  },
  {
    key: "stretch",
    group: "self",
    label: "伸懒腰",
    body: "踮脚站起来拉长，再落回去",
    sound: "一声长音",
    kaomoji: "(´-ω-`)",
    action: "stretch",
  },
  {
    key: "fidget",
    group: "self",
    label: "自己玩",
    body: "一条腿抖，另一条撑着",
    sound: "零碎短音",
    kaomoji: "( ˘ω˘ )",
    action: "fidget",
  },

  // 对你的
  {
    key: "perk",
    group: "you",
    label: "精神",
    body: "踮脚弹一下再落回来",
    sound: "上行短音",
    kaomoji: "(・∀・)",
    action: "happy",
  },
  {
    key: "lean_in",
    group: "you",
    label: "好奇",
    body: "整个人往前凑一点，脚掌跟着压下去",
    sound: "短促高音",
    kaomoji: "(・o・)",
    action: "lean_in",
  },
  {
    key: "proud",
    group: "you",
    label: "得意",
    body: "挺胸后仰，小幅度左右摆两下",
    sound: "连续高音",
    kaomoji: "(￣ω￣)v",
    action: "proud",
  },
  {
    key: "tsundere",
    group: "you",
    label: "傲娇",
    body: "先踮脚挺起来，再原地转过身去",
    sound: "上行音突然断掉",
    kaomoji: "(￣3￣)",
    action: "tsundere",
  },
  {
    key: "nuzzle",
    group: "you",
    label: "撒娇蹭",
    body: "小碎步往前挪，左右脚轮流抬",
    sound: "重复短音",
    kaomoji: "(๑•́ ₃ •̀๑)",
    action: "nuzzle",
  },
  {
    key: "guilty",
    group: "you",
    label: "心虚",
    body: "缩下去，两条腿往里弯",
    sound: "断续低音",
    kaomoji: "(´･_･`)",
    action: "guilty",
  },
  {
    key: "sulk",
    group: "you",
    label: "闹脾气",
    body: "跺脚，然后转开不理人",
    sound: "急促短音",
    kaomoji: "(￣ヘ￣)",
    action: "sulk",
  },

  // 对事的
  {
    key: "think",
    group: "thing",
    label: "迟疑",
    body: "停住，慢慢左右晃",
    sound: "停顿后一个低音",
    kaomoji: "(・_・?)",
    action: "think",
  },
  {
    key: "alert",
    group: "thing",
    label: "记挂",
    body: "从坐姿猛地站起来",
    sound: "一声短音",
    kaomoji: "(!)",
    action: "alert",
  },
  {
    key: "expect",
    group: "thing",
    label: "期待",
    body: "踮起脚，整个人往你这边探",
    sound: null,
    kaomoji: "(・∀・)",
    action: "expect",
  },
  {
    key: "droop",
    group: "thing",
    label: "失落",
    body: "腿软坐下去，两条腿往外摊开",
    sound: "长低音",
    kaomoji: "(￣︿￣)",
    action: "droop",
  },
];

export const byKey = (key) => EMOTIONS.find((e) => e.key === key) ?? null;

/** 硬件语音的接口位：现在恒为 null，第三阶段由硬件提供 */
export function soundFor(key) {
  return byKey(key)?.sound ?? null;
}

/** 从动作标注认情感 */
const ANNOTATION_MAP = [
  [/(抬头|看你|望向|看向|精神|挺|弹|站起)/, "happy"],
  [/(转开|别过|移开|扭开)/, "turn_away"],
  [/(趴|躺|摊|伏|蔫|没力气)/, "droop"],
  [/(打瞌睡|睡着|眯|困|困了)/, "doze"],
  [/(抖|晃|颤)/, "sulk"],
  [/(想|停顿|迟疑|琢磨|歪头)/, "think"],
  [/(凑近|前倾|探头)/, "lean_in"],
  [/(低头|缩|心虚)/, "guilty"],
];

/** 文字里的味道 */
const TEXT_MAP = [
  [/(记错|说错|我搞错|抱歉|对不起)/, "guilty"],
  [/(说对了|猜对|早就说|厉害吧|哼)/, "proud"],
  [/(才不是|也没想|谁要|随你|无所谓|不爱|不理你)/, "tsundere"],
  [/(有吃的|想吃|就一口|给点|蹭)/, "nuzzle"],
  [/(我记着|你上次说|不是有结果|我还记得|想起来)/, "alert"],
  [/(后来呢|怎么了|然后呢|为什么)/, "lean_in"],
  [/(算了|没意思|没什么|随便)/, "droop"],
];

/**
 * 决定这一刻用哪个情感模块。
 * 优先级：显式标注 > 文字的味道 > 情境 > 人格兜底
 */
export function resolveEmotion({ actionHint, text, context = {} } = {}) {
  if (actionHint) {
    if (actionHint === "turn_away") {
      // 转开在不同场合是两件事：闹脾气还是傲娇
      return context.recentPraise ? "tsundere" : "sulk";
    }
    const hit = ANNOTATION_MAP.find(([re]) => re.test(actionHint));
    if (hit) return hit[1];
  }
  const body = String(text ?? "");
  for (const [re, key] of TEXT_MAP) if (re.test(body)) return key;

  if (context.proactive) return "alert";
  if (context.loopClosed) return "celebrate";
  if (context.longSilence) return "droop";
  if (context.firstAttention) return "lean_in";
  return null; // 交给人格兜底
}

/** 没有明确情感时，按人格参数挑一个默认动作（9.6：情绪反馈模式影响动作强度） */
export function fallbackAction(dims) {
  const amplitude = dims?.amplitude ?? 0.4;
  const activity = dims?.activity ?? 0.45;
  if (amplitude > 0.6) return "proud";
  if (activity > 0.6) return "happy";
  return "happy";
}
