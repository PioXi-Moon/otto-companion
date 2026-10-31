import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./env.mjs";
import { getSetting, one, q, run, setSetting } from "./db.mjs";
import { now } from "./clock.mjs";
import { broadcast } from "./bus.mjs";
import { track } from "./events.mjs";
import { immersionState, IMMERSION_MODULES, updateImmersion } from "./immersion.mjs";
import { uid } from "./util.mjs";

const WORDBOOK_FILE = path.join(ROOT, "server", "wordbook.json");

/**
 * 内置音乐使用 Web Audio 实时合成，不依赖线上曲库。
 *
 * 这样打包后离线也能播，也不会把来源不明的音频塞进安装包。
 * 每一首只描述音阶、速度、和声与质感，具体声音由 ui/modules.js 生成。
 */
export const MUSIC_TRACKS = [
  {
    id: "rain-desk",
    title: "雨后书桌",
    subtitle: "钢琴颗粒与很轻的雨",
    mood: "专注",
    symbol: "雨",
    duration: 180,
    bpm: 61,
    root: 220,
    scale: [0, 3, 5, 7, 10],
    progression: [[0, 2, 4], [3, 5, 7], [5, 7, 9], [1, 3, 5]],
    timbre: "soft",
    noise: 0.018,
    accent: "#708c91",
    accent2: "#cbd8d5",
    keywords: ["雨", "下雨", "书桌", "专注", "安静", "学习"],
  },
  {
    id: "night-train",
    title: "夜航慢车",
    subtitle: "低音、回声与缓慢的灯",
    mood: "夜晚",
    symbol: "夜",
    duration: 210,
    bpm: 53,
    root: 146.83,
    scale: [0, 2, 3, 7, 8, 10],
    progression: [[0, 2, 4], [2, 4, 6], [5, 7, 9], [3, 5, 7]],
    timbre: "deep",
    noise: 0.006,
    accent: "#5c6688",
    accent2: "#c2c7dc",
    keywords: ["夜", "晚上", "睡前", "夜晚", "慢", "安静"],
  },
  {
    id: "morning-window",
    title: "窗边晨光",
    subtitle: "清亮和弦，像刚拉开窗帘",
    mood: "清晨",
    symbol: "晨",
    duration: 165,
    bpm: 74,
    root: 261.63,
    scale: [0, 2, 4, 7, 9],
    progression: [[0, 2, 4], [3, 5, 7], [4, 6, 8], [0, 4, 7]],
    timbre: "bright",
    noise: 0.004,
    accent: "#b58b52",
    accent2: "#f0d9ae",
    keywords: ["晨", "早上", "清晨", "明亮", "起床", "开始"],
  },
  {
    id: "paper-moon",
    title: "纸月亮",
    subtitle: "很慢的留白，适合发呆",
    mood: "安静",
    symbol: "月",
    duration: 195,
    bpm: 48,
    root: 196,
    scale: [0, 3, 7, 10, 12],
    progression: [[0, 2, 3], [2, 4, 6], [0, 2, 4], [1, 3, 5]],
    timbre: "glass",
    noise: 0.002,
    accent: "#8e7b96",
    accent2: "#ded2e2",
    keywords: ["月", "安静", "发呆", "轻", "空白", "晚上"],
  },
  {
    id: "tiny-planet",
    title: "小小星球",
    subtitle: "轻快但不吵闹的循环",
    mood: "轻快",
    symbol: "星",
    duration: 150,
    bpm: 86,
    root: 293.66,
    scale: [0, 2, 4, 7, 9, 11],
    progression: [[0, 2, 4], [4, 6, 8], [5, 7, 9], [3, 5, 7]],
    timbre: "pluck",
    noise: 0.003,
    accent: "#a66955",
    accent2: "#efc9b6",
    keywords: ["星", "轻快", "开心", "玩", "活泼", "有精神"],
  },
  {
    id: "far-away",
    title: "远山来信",
    subtitle: "宽一点的和声，慢慢展开",
    mood: "思考",
    symbol: "山",
    duration: 190,
    bpm: 57,
    root: 174.61,
    scale: [0, 2, 5, 7, 9],
    progression: [[0, 2, 4], [1, 3, 5], [3, 5, 7], [0, 2, 5]],
    timbre: "warm",
    noise: 0.009,
    accent: "#617b64",
    accent2: "#c9d6c6",
    keywords: ["山", "远", "思考", "写作", "工作", "平和"],
  },
];

const TRACK_MAP = new Map(MUSIC_TRACKS.map((item) => [item.id, item]));
const DECK_FALLBACK = [{ id: "daily", label: "日常高频", description: "先把每天都会遇到的词装进口袋", words: [] }];

function readWordbook() {
  try {
    const data = JSON.parse(fs.readFileSync(WORDBOOK_FILE, "utf8"));
    return {
      source: data.source ?? null,
      decks: Array.isArray(data.decks) ? data.decks : DECK_FALLBACK,
    };
  } catch {
    return { source: null, decks: DECK_FALLBACK };
  }
}

const WORDBOOK = readWordbook();
const WORD_MAP = new Map();
for (const deck of WORDBOOK.decks) {
  for (const word of deck.words ?? []) {
    WORD_MAP.set(String(word.word).toLowerCase(), { ...word, deck, deckId: deck.id });
  }
}

function musicDefaults() {
  return {
    trackId: null,
    status: "stopped",
    volume: 0.72,
    startedAt: null,
    updatedAt: null,
  };
}

function musicState() {
  const raw = getSetting("musicState", null);
  const base = musicDefaults();
  if (!raw || typeof raw !== "object") return base;
  return {
    ...base,
    ...raw,
    trackId: TRACK_MAP.has(raw.trackId) ? raw.trackId : null,
    status: ["playing", "paused", "stopped"].includes(raw.status) ? raw.status : "stopped",
    volume: Math.max(0, Math.min(1, Number(raw.volume) || base.volume)),
  };
}

function publicMusicState(state = musicState()) {
  return {
    ...state,
    currentTrack: state.trackId ? TRACK_MAP.get(state.trackId) ?? null : null,
    tracks: MUSIC_TRACKS,
  };
}

function wordSessionDefaults() {
  return { deck: WORDBOOK.decks[0]?.id ?? "daily", index: 0, currentWord: null, quiz: null };
}

function wordSession() {
  const raw = getSetting("wordSession", null);
  const base = wordSessionDefaults();
  if (!raw || typeof raw !== "object") return base;
  const deck = WORDBOOK.decks.some((d) => d.id === raw.deck) ? raw.deck : base.deck;
  return {
    ...base,
    ...raw,
    deck,
    index: Math.max(0, Number(raw.index) || 0),
    currentWord: WORD_MAP.has(String(raw.currentWord ?? "").toLowerCase())
      ? String(raw.currentWord).toLowerCase()
      : null,
    quiz: raw.quiz && typeof raw.quiz === "object" ? raw.quiz : null,
  };
}

function saveWordSession(session) {
  setSetting("wordSession", session);
}

function ensureWordTables() {
  run(`create table if not exists word_progress (
    word text primary key,
    deck text,
    seen_count integer default 0,
    known_count integer default 0,
    again_count integer default 0,
    status text default 'new',
    last_seen_at integer,
    last_result text
  )`);
  run(`create table if not exists tool_run (
    id text primary key,
    tool text,
    args text,
    result text,
    source text,
    ts integer
  )`);
}
ensureWordTables();

function localDayStart(ts = now()) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function wordStats() {
  const total = WORD_MAP.size;
  const row = one(
    `select
       count(*) as seen,
       sum(case when status = 'known' then 1 else 0 end) as known,
       sum(case when status = 'learning' then 1 else 0 end) as learning,
       sum(case when last_seen_at >= ? then 1 else 0 end) as today
     from word_progress`,
    localDayStart()
  ) ?? {};
  const seen = Number(row.seen) || 0;
  const known = Number(row.known) || 0;
  return {
    total,
    seen,
    known,
    learning: Number(row.learning) || 0,
    today: Number(row.today) || 0,
    remaining: Math.max(0, total - known),
    mastery: total ? Math.round((known / total) * 100) : 0,
    dailyGoal: 10,
  };
}

function progressFor(word) {
  return one(
    "select seen_count, known_count, again_count, status, last_seen_at, last_result from word_progress where word = ?",
    String(word).toLowerCase()
  ) ?? {
    seen_count: 0,
    known_count: 0,
    again_count: 0,
    status: "new",
    last_seen_at: null,
    last_result: null,
  };
}

function publicWord(word) {
  const { deck, ...fields } = word;
  return {
    ...fields,
    deckId: word.deckId ?? deck?.id ?? null,
    deckLabel: deck?.label ?? null,
    progress: progressFor(word.word),
  };
}

function attachProgress(word) {
  return publicWord(word);
}

function publicDeck(deck) {
  return {
    id: deck.id,
    label: deck.label,
    description: deck.description,
    count: deck.words?.length ?? 0,
  };
}

function deckById(id) {
  return WORDBOOK.decks.find((d) => d.id === id) ?? WORDBOOK.decks[0] ?? DECK_FALLBACK[0];
}

function currentWord(session = wordSession()) {
  if (session.currentWord && WORD_MAP.has(session.currentWord)) {
    return WORD_MAP.get(session.currentWord);
  }
  const deck = deckById(session.deck);
  const first = deck.words?.[0] ?? null;
  return first ? WORD_MAP.get(String(first.word).toLowerCase()) ?? first : null;
}

function markSeen(word) {
  const key = String(word.word).toLowerCase();
  run(
    `insert into word_progress (word, deck, seen_count, status, last_seen_at)
     values (?, ?, 1, 'learning', ?)
     on conflict(word) do update set
       deck = excluded.deck,
       seen_count = word_progress.seen_count + 1,
       last_seen_at = excluded.last_seen_at,
       status = case when word_progress.status = 'new' then 'learning' else word_progress.status end`,
    key,
    word.deckId ?? word.deck?.id ?? null,
    now()
  );
}

function markWord(word, result) {
  const key = String(word.word).toLowerCase();
  const known = result === "known";
  markSeen(word);
  run(
    `update word_progress set
       known_count = known_count + ?,
       again_count = again_count + ?,
       status = ?,
       last_result = ?
     where word = ?`,
    known ? 1 : 0,
    known ? 0 : 1,
    known ? "known" : "learning",
    result,
    key
  );
  track("word_marked", { word: key, result, deck: word.deckId ?? word.deck?.id ?? null });
}

export function wordCatalog({ deck, q: query, limit = 240 } = {}) {
  const needle = String(query ?? "").trim().toLowerCase();
  let words = [];
  if (needle) {
    for (const item of WORD_MAP.values()) {
      const hay = `${item.word} ${item.meaning} ${item.definition ?? ""}`.toLowerCase();
      if (hay.includes(needle)) words.push(item);
    }
  } else {
    const selected = deckById(deck);
    words = (selected.words ?? [])
      .map((item) => WORD_MAP.get(String(item.word).toLowerCase()) ?? { ...item, deck: selected, deckId: selected.id });
  }
  return words.slice(0, Math.max(1, Math.min(500, Number(limit) || 240))).map(attachProgress);
}

function recentTools(limit = 12) {
  return q(
    "select id, tool, args, result, source, ts from tool_run order by ts desc limit ?",
    Math.max(1, Math.min(50, Number(limit) || 12))
  ).map((row) => ({
    id: row.id,
    tool: row.tool,
    args: safeJson(row.args, {}),
    result: safeJson(row.result, {}),
    source: row.source,
    ts: row.ts,
  }));
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function modulesSnapshot() {
  const session = wordSession();
  const word = currentWord(session);
  return {
    music: publicMusicState(),
    words: {
      source: WORDBOOK.source,
      decks: WORDBOOK.decks.map((d) => ({
        id: d.id,
        label: d.label,
        description: d.description,
        count: d.words?.length ?? 0,
      })),
      session: {
        deck: session.deck,
        index: session.index,
        currentWord: word ? attachProgress(word) : null,
        quiz: session.quiz,
      },
      stats: wordStats(),
    },
    focus: immersionState(),
    recentTools: recentTools(),
  };
}

function setMusic(next, event) {
  next.updatedAt = now();
  setSetting("musicState", next);
  const pub = publicMusicState(next);
  broadcast("music", { command: event, state: pub });
  broadcast("module", { module: "music", event, state: pub, tab: event === "play" ? "music" : null });
  return pub;
}

function chooseTrack(raw) {
  const needle = String(raw ?? "").trim().toLowerCase();
  if (!needle || /随机|随便|任意|random/.test(needle)) {
    return MUSIC_TRACKS[Math.floor(Math.random() * MUSIC_TRACKS.length)];
  }
  if (TRACK_MAP.has(needle)) return TRACK_MAP.get(needle);
  let best = null;
  let score = 0;
  for (const track of MUSIC_TRACKS) {
    const hay = `${track.id} ${track.title} ${track.mood} ${track.subtitle} ${track.keywords.join(" ")}`.toLowerCase();
    let s = hay.includes(needle) ? 4 : 0;
    for (const ch of needle) if (hay.includes(ch)) s += 0.05;
    if (s > score) {
      score = s;
      best = track;
    }
  }
  return best;
}

function normalizeDetail(value) {
  return String(value ?? "")
    .replace(/\\n/g, "；")
    .replace(/\s+/g, " ")
    .replace(/；+/g, "；")
    .replace(/^[；\s]+|[；\s]+$/g, "");
}

function wordSpoken(word) {
  const phonetic = word.phonetic ? `，${word.phonetic}` : "";
  const meaning = normalizeDetail(word.meaning);
  return `${word.word}${phonetic}。${word.pos ? `${word.pos}，` : ""}${meaning}。`;
}

function logTool(toolName, args, result, source) {
  run(
    "insert into tool_run (id, tool, args, result, source, ts) values (?, ?, ?, ?, ?, ?)",
    uid("tool"),
    toolName,
    JSON.stringify(args ?? {}),
    JSON.stringify(result ?? {}),
    source,
    now()
  );
}

function emitModule(module, event, payload = {}, tab = null) {
  broadcast("module", { module, event, ...payload, tab });
}

function focusModule(requested) {
  const aliases = {
    focus: "focus25",
    pomodoro: "focus25",
    focus25: "focus25",
    deep: "deep50",
    deep50: "deep50",
    eyes: "eyes20",
    eyes20: "eyes20",
    stand: "stand45",
    stand45: "stand45",
    wrap: "wrap",
    quiet: "quiet",
  };
  const id = aliases[String(requested ?? "").trim().toLowerCase()] ?? "focus25";
  return IMMERSION_MODULES.find((item) => item.id === id) ?? IMMERSION_MODULES[1];
}

function statusSpoken(snapshot) {
  const music = snapshot.music;
  const word = snapshot.words.session.currentWord;
  const stats = snapshot.words.stats;
  const focus = snapshot.focus;
  const musicLine =
    music.currentTrack && music.status === "playing"
      ? `正在放《${music.currentTrack.title}》`
      : music.currentTrack && music.status === "paused"
        ? `《${music.currentTrack.title}》暂停着`
        : "音乐没在放";
  const wordLine = word ? `当前单词是 ${word.word}，意思是${normalizeDetail(word.meaning)}` : "词卡还没开始";
  const focusLine = focus.enabled
    ? `工作模式开着，当前是${focus.moduleInfo?.label ?? "专注"}`
    : "专注模式没开";
  return `${musicLine}；${wordLine}；已经认识 ${stats.known} 个词；${focusLine}。`;
}

/**
 * 面板和语音入口共用的工具执行器。
 * 语音侧只负责把自然语言变成 action，所有业务状态仍由这里统一落盘和广播。
 */
export function executeModuleTool(rawAction, args = {}, meta = {}) {
  const action = String(rawAction ?? "")
    .trim()
    .toLowerCase()
    .replace(/[.-]/g, "_");
  const source = ["voice", "ui", "api"].includes(meta.source) ? meta.source : "api";
  let out;

  try {
    if (action === "music_play") {
      const selected = chooseTrack(args.track ?? args.query ?? args.song_name ?? args.mood);
      if (!selected) {
        const names = MUSIC_TRACKS.map((t) => t.title).join("、");
        out = { ok: false, spoken: `我没找到这首。现在有：${names}。`, error: "track_not_found" };
      } else {
        const prev = musicState();
        const next = {
          ...prev,
          trackId: selected.id,
          status: "playing",
          startedAt: prev.trackId === selected.id && prev.status === "playing" ? prev.startedAt : now(),
        };
        const state = setMusic(next, "play");
        out = {
          ok: true,
          spoken: `给你放《${selected.title}》。${selected.subtitle}。`,
          track: selected,
          state,
        };
        broadcast("pet", { action: selected.mood === "轻快" ? "happy" : "content", ms: 1800 });
      }
    } else if (action === "music_pause") {
      const prev = musicState();
      const state = setMusic({ ...prev, status: prev.trackId ? "paused" : "stopped" }, "pause");
      out = { ok: true, spoken: state.currentTrack ? "音乐先停在这里。" : "现在本来就没在放。", state };
    } else if (action === "music_resume") {
      const prev = musicState();
      let state = prev;
      if (prev.trackId) {
        state = setMusic({ ...prev, status: "playing" }, "resume");
        out = { ok: true, spoken: `接着听《${state.currentTrack.title}》。`, state };
      } else {
        const selected = MUSIC_TRACKS[0];
        state = setMusic({ ...prev, trackId: selected.id, status: "playing", startedAt: now() }, "play");
        out = { ok: true, spoken: `那从《${selected.title}》开始。`, track: selected, state };
      }
    } else if (action === "music_stop") {
      const prev = musicState();
      const state = setMusic({ ...prev, status: "stopped" }, "stop");
      out = { ok: true, spoken: "音乐关了。", state };
    } else if (action === "music_next") {
      const prev = musicState();
      const index = Math.max(0, MUSIC_TRACKS.findIndex((t) => t.id === prev.trackId));
      const selected = MUSIC_TRACKS[(index + 1) % MUSIC_TRACKS.length];
      const state = setMusic({ ...prev, trackId: selected.id, status: "playing", startedAt: now() }, "play");
      out = { ok: true, spoken: `下一首，《${selected.title}》。`, track: selected, state };
    } else if (action === "music_volume") {
      const prev = musicState();
      const raw = args.volume ?? args.level;
      let volume = Number(raw);
      if (!Number.isFinite(volume)) {
        volume = /高|大/.test(String(raw)) ? 0.75 : /低|小/.test(String(raw)) ? 0.2 : 0.46;
      }
      volume = Math.max(0, Math.min(1, volume));
      const state = setMusic({ ...prev, volume }, "volume");
      out = { ok: true, spoken: `音量调到 ${Math.round(volume * 100)}%。`, state };
    } else if (action === "word_start") {
      const requested = String(args.deck ?? "").trim().toLowerCase();
      const deck = WORDBOOK.decks.find((d) => d.id === requested || d.label.includes(String(args.deck ?? ""))) ?? deckById(requested);
      const first = deck.words?.[0] ? WORD_MAP.get(String(deck.words[0].word).toLowerCase()) : null;
      if (!first) {
        out = { ok: false, spoken: "这本词库还没准备好。", error: "empty_deck" };
      } else {
        const session = { ...wordSession(), deck: deck.id, index: 0, currentWord: first.word.toLowerCase(), quiz: null };
        saveWordSession(session);
        markSeen(first);
        emitModule("words", "start", { word: attachProgress(first), deck: deck.id }, "words");
        out = {
          ok: true,
          spoken: `从「${deck.label}」开始。第一个词，${wordSpoken(first)}`,
          word: attachProgress(first),
          deck: publicDeck(deck),
          stats: wordStats(),
        };
      }
    } else if (action === "word_show") {
      const requested = String(args.word ?? "").trim().toLowerCase();
      const base = WORD_MAP.get(requested);
      if (!base) {
        out = { ok: false, spoken: "词库里没有找到这个单词。", error: "word_not_found" };
      } else {
        const deck = deckById(base.deckId ?? base.deck?.id);
        const index = Math.max(0, (deck.words ?? []).findIndex((item) => String(item.word).toLowerCase() === base.word.toLowerCase()));
        const session = { ...wordSession(), deck: deck.id, index, currentWord: base.word.toLowerCase(), quiz: null };
        saveWordSession(session);
        markSeen(base);
        emitModule("words", "show", { word: attachProgress(base), deck: deck.id }, "words");
        out = { ok: true, spoken: wordSpoken(base), word: attachProgress(base), deck: publicDeck(deck), stats: wordStats() };
      }
    } else if (action === "word_next" || action === "word_repeat") {
      const session = wordSession();
      const deck = deckById(session.deck);
      const list = deck.words ?? [];
      if (!list.length) {
        out = { ok: false, spoken: "这本词库还没准备好。", error: "empty_deck" };
      } else {
        if (action === "word_next") {
          session.index = (Math.max(0, session.index) + 1) % list.length;
          session.quiz = null;
        }
        const base = WORD_MAP.get(String(list[session.index]?.word ?? list[0].word).toLowerCase());
        session.currentWord = base.word.toLowerCase();
        saveWordSession(session);
        markSeen(base);
        emitModule("words", "show", { word: attachProgress(base), deck: deck.id }, "words");
        out = {
          ok: true,
          spoken:
            action === "word_repeat"
              ? `再听一遍。${wordSpoken(base)}`
              : `下一个，${wordSpoken(base)}`,
          word: attachProgress(base),
          deck: publicDeck(deck),
          stats: wordStats(),
        };
      }
    } else if (action === "word_mark") {
      const session = wordSession();
      const requested = String(args.word ?? "").trim().toLowerCase();
      const base = requested ? WORD_MAP.get(requested) : currentWord(session);
      const result = args.result === "again" ? "again" : "known";
      if (!base) {
        out = { ok: false, spoken: "现在没有正在看的词。", error: "no_current_word" };
      } else {
        markWord(base, result);
        emitModule("words", "progress", { word: attachProgress(base), result, stats: wordStats() }, "words");
        out = {
          ok: true,
          spoken: result === "known" ? `好，${base.word} 先记下了。` : `没关系，${base.word} 稍后再看一遍。`,
          word: attachProgress(base),
          result,
          stats: wordStats(),
        };
      }
    } else if (action === "word_quiz") {
      const session = wordSession();
      const deck = deckById(session.deck);
      const list = deck.words ?? [];
      const target = currentWord(session) ?? (list[0] ? WORD_MAP.get(String(list[0].word).toLowerCase()) : null);
      if (!target) {
        out = { ok: false, spoken: "这本词库还没准备好。", error: "empty_deck" };
      } else {
        const pool = list
          .map((item) => WORD_MAP.get(String(item.word).toLowerCase()))
          .filter((item) => item && item.word !== target.word);
        const distractors = pool.sort(() => Math.random() - 0.5).slice(0, 3);
        const options = [target, ...distractors].sort(() => Math.random() - 0.5).map((item) => ({
          word: item.word,
          meaning: normalizeDetail(item.meaning),
        }));
        session.quiz = { word: target.word, options };
        saveWordSession(session);
        markSeen(target);
        emitModule("words", "quiz", { quiz: session.quiz }, "words");
        out = {
          ok: true,
          spoken: `小考一下。${target.word} 的中文意思，是下面哪一个？${options.map((o, i) => `${i + 1}，${o.meaning}`).join("；")}`,
          quiz: session.quiz,
        };
      }
    } else if (action === "word_answer") {
      const session = wordSession();
      const quiz = session.quiz;
      const answer = String(args.answer ?? "").trim();
      if (!quiz) {
        out = { ok: false, spoken: "现在还没有正在进行的单词小测。", error: "no_quiz" };
      } else {
        const target = quiz.options.find((o) => o.word === quiz.word);
        const normalizedAnswer = answer.toLowerCase();
        const hit =
          normalizedAnswer === target?.word?.toLowerCase() ||
          (target?.meaning && target.meaning.includes(answer)) ||
          String(quiz.options[Number(answer) - 1]?.word ?? "") === quiz.word;
        session.quiz = null;
        saveWordSession(session);
        out = {
          ok: true,
          correct: !!hit,
          spoken: hit
            ? `答对了。${quiz.word}，${target.meaning}。`
            : `答案是，${quiz.word}，${target?.meaning ?? ""}。`,
          quiz,
          answer: target,
        };
        emitModule("words", "answer", out, "words");
      }
    } else if (action === "word_stats") {
      const stats = wordStats();
      out = {
        ok: true,
        spoken: `这本词库一共 ${stats.total} 个词，已经看过 ${stats.seen} 个，认识 ${stats.known} 个，今天过了 ${stats.today} 个。`,
        stats,
      };
    } else if (action.startsWith("focus_")) {
      if (action === "focus_status") {
        const state = immersionState();
        out = {
          ok: true,
          spoken: state.enabled
            ? `专注模式开着。当前是${state.moduleInfo?.label ?? "专注"}，${state.running ? "正在计时" : state.phase === "complete" ? "这一轮已经完成" : "还没开始"}。`
            : "专注模式现在没开。",
          state,
        };
      } else {
        const command = action.slice("focus_".length);
        const mod = focusModule(args.module ?? args.preset);
        let body;
        if (command === "start") body = { enabled: true, module: mod.id, command: "start" };
        else if (command === "pause") body = { command: "pause" };
        else if (command === "resume") {
          const current = immersionState();
          body =
            !current.enabled || current.phase === "complete" || current.pausedRemainingMs == null
              ? { enabled: true, module: focusModule(args.module ?? current.module).id, command: "start" }
              : { command: "resume" };
        }
        else if (command === "finish") body = { command: "finish" };
        else throw new Error(`不支持的专注命令：${command}`);
        const updated = updateImmersion(body);
        broadcast("immersion", updated);
        emitModule("focus", command, { state: updated.state }, "home");
        out = {
          ok: true,
          spoken: updated.notice ?? `专注模式已${command === "start" ? "开始" : "更新"}。`,
          state: updated.state,
        };
      }
    } else if (action === "status") {
      const snapshot = modulesSnapshot();
      out = { ok: true, spoken: statusSpoken(snapshot), snapshot };
    } else if (action === "open") {
      const allowed = new Set(["home", "tools", "music", "words", "memory", "timeline"]);
      const tab = allowed.has(String(args.tab ?? "")) ? String(args.tab) : "tools";
      broadcast("navigate", { tab });
      emitModule("app", "open", { tab }, tab);
      out = { ok: true, spoken: "好，已经打开了。", tab };
    } else {
      out = { ok: false, spoken: "这个工具我还不认识。", error: "unknown_tool" };
    }
  } catch (error) {
    out = { ok: false, spoken: `刚才没做成：${error.message}`, error: String(error.message) };
  }

  if (!out) out = { ok: false, spoken: "这个工具没有返回结果。", error: "empty_result" };
  logTool(action || "unknown", args, out, source);
  track("module_tool", { tool: action, source, ok: out.ok === true });
  return out;
}

export { wordStats };
