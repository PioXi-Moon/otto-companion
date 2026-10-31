import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ROOT } from "../server/env.mjs";

/**
 * 从 MIT 许可的 ECDICT 中抽取一组适合桌面陪伴场景的常用词。
 * 运行：pnpm vocab:build
 */
const DECKS = [
  {
    id: "daily",
    label: "日常高频",
    description: "每天都会遇见，先把最常用的词装进口袋",
    words: "about after again always answer around because before bring call change choose during enough every feel find follow friend help idea keep learn maybe need open people place right start still take talk think time together try walk want way".split(" "),
  },
  {
    id: "campus",
    label: "校园学习",
    description: "课堂、作业、考试和那些需要慢慢弄懂的事",
    words: "assignment attention campus chapter classroom course degree discuss essay exam explain grade homework improve knowledge language lecture lesson library major note practice project question reading research review science student study subject teacher test university vocabulary writing".split(" "),
  },
  {
    id: "emotion",
    label: "情绪关系",
    description: "说出感受，也听懂别人没有直接说出口的部分",
    words: "afraid angry anxious calm care comfortable concerned confident confused curious excited grateful happy hopeful lonely nervous patient proud relaxed sad shy sorry surprised tired trust upset worried wonderful".split(" "),
  },
  {
    id: "time",
    label: "时间计划",
    description: "约会、截止日期和把一天慢慢排好",
    words: "appointment arrive calendar clock daily deadline early evening finish future habit later minute month morning plan prepare remind repeat schedule soon usually weekly yesterday".split(" "),
  },
  {
    id: "work",
    label: "工作科技",
    description: "屏幕、网络与每天都会碰到的数字工具",
    words: "account app battery browser button camera computer connect device download email file internet keyboard laptop message network online password phone screen search software update upload video website wireless".split(" "),
  },
  {
    id: "travel",
    label: "出行自然",
    description: "从街角到远山，路上会看到和问到的词",
    words: "airport beach bridge bus city country direction forest garden hill hotel journey lake map mountain ocean park path plane river road station ticket train travel weather wind world".split(" "),
  },
  {
    id: "life",
    label: "生活健康",
    description: "吃饭、睡觉、运动，照顾好自己用的词",
    words: "breakfast dinner doctor drink exercise food fruit health hospital hungry kitchen lunch meal medicine rest run shower sleep snack sport tea tired vegetable water".split(" "),
  },
  {
    id: "expression",
    label: "表达交流",
    description: "把想法说明白，也让对话继续往前走",
    words: "agree ask believe describe decide disagree example explain express guess hear introduce listen mean mention opinion promise reply say speak story suggest understand".split(" "),
  },
];

/**
 * ECDICT 里少数词条把较旧的专业释义排在常用义前面。
 * 这些只改面向学习者展示的首选释义，不改变词库来源与其余字段。
 */
const MEANING_OVERRIDES = {
  account: "n. 账户；解释；v. 说明；占比",
  app: "n. 应用；应用程序",
  appointment: "n. 预约；约会；任命",
  assignment: "n. 作业；任务；分配",
  attention: "n. 注意；注意力",
  battery: "n. 电池",
  bridge: "n. 桥；桥梁；v. 架桥；连接",
  browser: "n. 浏览器",
  button: "n. 按钮；纽扣",
  camera: "n. 相机；摄像头",
  computer: "n. 电脑；计算机",
  connect: "v. 连接；联络",
  device: "n. 设备；装置",
  download: "v. 下载",
  email: "n. 电子邮件；v. 发电子邮件",
  file: "n. 文件；档案",
  internet: "n. 互联网",
  keyboard: "n. 键盘",
  laptop: "n. 笔记本电脑",
  message: "n. 消息；信息",
  network: "n. 网络；关系网",
  online: "adj./adv. 在线的；联网地",
  password: "n. 密码",
  phone: "n. 电话；手机",
  screen: "n. 屏幕；帘；v. 筛选",
  search: "v./n. 搜索；寻找",
  software: "n. 软件",
  update: "v./n. 更新",
  upload: "v. 上传",
  video: "n. 视频",
  website: "n. 网站",
  wireless: "adj. 无线的",
  calendar: "n. 日历；日程表",
  schedule: "n. 日程；v. 安排",
  deadline: "n. 截止日期；最后期限",
  doctor: "n. 医生；博士",
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function cleanMeaning(translation) {
  const lines = String(translation ?? "")
    .replaceAll("\\n", "\n")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("[网络]"))
    .map((line) => line.replace(/\[(计|经|机|化|医|法)\][^；。]*[；。]?/g, "").trim())
    .filter(Boolean);
  const concise = lines.slice(0, 2).map((line) => {
    const match = line.match(/^([a-z.]{1,6})\s+(.+)$/i);
    const pos = match ? match[1] : "";
    const body = match ? match[2] : line;
    const senses = body.split(/[,，;；]/).map((item) => item.trim()).filter(Boolean).slice(0, 4);
    return `${pos ? `${pos} ` : ""}${senses.join("；")}`;
  });
  return concise.join("；").slice(0, 110);
}

function cleanPos(pos) {
  return String(pos ?? "")
    .split("/")
    .filter(Boolean)
    .slice(0, 3)
    .join("/");
}

const sourceFile = process.argv[2] || path.join(ROOT, "tmp", "ecdict.csv");
if (!fs.existsSync(sourceFile)) {
  const sourceUrl =
    process.env.ECDICT_URL ||
    "https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv";
  console.log(`本地没有 ECDICT，正在下载：${sourceUrl}`);
  fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
  const response = await fetch(sourceUrl, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`ECDICT 下载失败：HTTP ${response.status}`);
  }
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(sourceFile));
}

const rows = parseCsv(fs.readFileSync(sourceFile, "utf8"));
const header = rows.shift();
const index = Object.fromEntries(header.map((name, i) => [name, i]));
const dictionary = new Map();
for (const row of rows) {
  const word = String(row[index.word] ?? "").trim();
  if (!word) continue;
  dictionary.set(word.toLowerCase(), row);
}

const missing = [];
const usedWords = new Set();
const decks = DECKS.map((deck) => {
  const words = deck.words.map((headword) => {
    const normalized = headword.toLowerCase();
    if (usedWords.has(normalized)) return null;
    const row = dictionary.get(headword.toLowerCase());
    if (!row) {
      missing.push(headword);
      return null;
    }
    const meaning = MEANING_OVERRIDES[headword.toLowerCase()] || cleanMeaning(row[index.translation]);
    if (!meaning) {
      missing.push(headword);
      return null;
    }
    usedWords.add(normalized);
    return {
      word: headword.toLowerCase(),
      phonetic: `/${String(row[index.phonetic] ?? "").trim()}/`,
      pos: cleanPos(row[index.pos]),
      meaning,
      definition: String(row[index.definition] ?? "").replaceAll("\\n", "\n").split(/\r?\n/)[0].trim().slice(0, 180),
      level: Number(row[index.oxford]) === 1 ? "Oxford 3000" : Number(row[index.bnc] || 999999) <= 5000 ? "高频" : "常用",
      rank: Number(row[index.bnc] || 0) || null,
    };
  }).filter(Boolean);
  return { ...deck, words };
});

const data = {
  source: {
    name: "ECDICT",
    url: "https://github.com/skywind3000/ECDICT",
    license: "MIT",
    note: "音标与中文释义来自 ECDICT；主题分组和应用内学习流程由 Otto 整理。",
  },
  builtAt: new Date().toISOString(),
  decks,
};

const outfile = path.join(ROOT, "server", "wordbook.json");
fs.writeFileSync(outfile, `${JSON.stringify(data, null, 2)}\n`, "utf8");
console.log(`已生成 ${outfile}`);
console.log(`主题 ${decks.length} 个，单词 ${decks.reduce((sum, deck) => sum + deck.words.length, 0)} 个`);
if (missing.length) console.log(`未找到：${missing.join(", ")}`);
