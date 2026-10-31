/**
 * 一次回复是怎么被控制的（产品方案 8.2）
 * 用户输入 → 判断互动类型 → 读取关系状态 → 召回记忆（含到期线头）
 * → 装配人格约束 → LLM 流式生成 → 动作映射 → 对话结束后异步抽取记忆
 */
import { ENV } from "./env.mjs";
import { chatStream, LLMError, status as llmStatus } from "./llm.mjs";
import { getPersona, getRelation, updateRelation } from "./persona.mjs";
import { baseLayer, chatLayer, proactiveLayer, ACTION_ALIAS, SYSTEM_ACTION_WORDS } from "./prompt.mjs";
import { resolveEmotion, byKey as emotionByKey, fallbackAction } from "./emotion.mjs";
import {
  observe as observeOntology,
  actionFitsDecision,
  isCorrection,
  correct as correctOntology,
} from "./ontology.mjs";
import { recall, extractAndWrite, memoryEnabled } from "./memory.mjs";
import { dueLoops, markAttempted, closeLoop, downgradeStale, listLoops } from "./openloop.mjs";
import {
  ensureSession,
  insertMessage,
  sessionMessages,
  guessInteractionType,
} from "./messages.mjs";
import { track } from "./events.mjs";
import { broadcast } from "./bus.mjs";
import { now } from "./clock.mjs";
import { getSetting, setSetting, one } from "./db.mjs";
import { log } from "./util.mjs";
import { initState, pushAnswer, inferPersona, startInit } from "./initflow.mjs";
import { syncDay, dayKey } from "./diary.mjs";
import { immersionEnabled, immersionAction } from "./immersion.mjs";

const FALLBACK = {
  no_key: { text: "我还没接上大脑——API Key 没配置。这会儿我只能陪你待着。", action: "lie_down" },
  network: { text: "我这会儿连不上外面。先陪你待着，等通了再聊。", action: "lie_down" },
  timeout: { text: "我想得有点久。要不你先说，我在听。", action: "think" },
  http: { text: "我脑子卡住了。等一下再跟我说一次？", action: "shake" },
  bad_json: { text: "我有点走神。你再说一次？", action: "shake" },
};

/* ---------------- 动作标注（7.4：姿态是主要语言） ---------------- */
/*
 * 标注只负责"它说了做什么动作"，映射到哪个情感模块交给 emotion.mjs。
 * 这样一张情感表同时管身体、声音、颜文字和心理，不会各说各的。
 */

// 只有这些词才算动作标注。不加这层过滤，正文里随便一个开头的括号
// 都会被吃掉——模型写"（这是 mock 回复）正文"时，前半截就凭空消失了
const ACTION_WORDS =
  /(抬头|看你|望向|看向|转开|别过|移开|趴|躺|摊|伏|打瞌睡|睡着|眯|困|精神|挺|弹|站起|凑近|前倾|低头|缩|抖|晃|摆|颤|想|停顿|迟疑|琢磨|歪头|得意|蔫|没力气|抖腿|翻了个身|打了个哈欠|伸懒腰)/;

export function extractAnnotation(text) {
  const src = String(text || "");
  const at = (i) => {
    const m = src.slice(i).match(/^\s*[（(\[]\s*([^）)\]]{1,20})\s*[）)\]]/);
    if (!m) return null;
    const note = m[1].trim();
    if (ACTION_ALIAS[note]) return { note, m, at: i };
    if (SYSTEM_ACTION_WORDS.has(note)) return { note: null, m, at: i };
    if (ACTION_WORDS.test(note)) return { note, m, at: i };
    return null;
  };

  // 先在句首找。找不到就全文扫一遍——模型有时候会把标注塞在句子中间，
  // 那种情况既会显示在正文里，动作也不会生效
  let hit = at(0);
  if (!hit) {
    const re = /[（(\[]/g;
    let mm;
    while ((mm = re.exec(src))) {
      const found = at(mm.index);
      if (found) { hit = found; break; }
    }
  }
  if (!hit) return { note: null, clean: src };

  const clean = (src.slice(0, hit.at) + src.slice(hit.at + hit.m[0].length)).replace(/\s+/g, " ").trim();
  return { note: hit.note, clean };
}

/**
 * 解析流开头的 <act>动作</act>。
 *
 * 这是"先做动作，再说话"那条链路：标签一到就往下发（桌宠先动起来），
 * 正文跟在后头慢慢流。动作是它看完用户那句话之后的第一反应，
 * 所以它必须出现在最前面——先想好一句话再补一个表情，顺序就反了。
 *
 * 开头不是 <act> 就立刻放弃等待：模型偶尔会忘记写标签，
 * 那时候正文不能被卡在缓冲里出不来。
 */
export function createActSplitter(onAct) {
  let buf = "";
  let done = false;
  const OPEN = "<act>";
  return {
    push(chunk) {
      if (done) return chunk;
      buf += chunk;
      const m = buf.match(/<act>\s*([^<]*?)\s*<\/act>/);
      if (m) {
        onAct(m[1]);
        done = true;
        /* 尾巴要先去掉换行再交出去：后面的 <mind> 解析认的是"从头开始"，
           前面挂一个 \n 它就当成普通正文，<mind> 会原样漏进正文里 */
        return buf.slice(m.index + m[0].length).replace(/^\s+/, "");
      }
      // 还是 OPEN 的前缀就再等等；不是就认了
      const head = buf.replace(/^\s+/, "");
      const maybe = head.length < OPEN.length && OPEN.startsWith(head);
      if (!maybe && head.length >= 1 && !head.startsWith(OPEN)) {
        done = true;
        return buf;
      }
      if (buf.length > 60) {
        done = true;
        return buf;
      }
      return "";
    },
    flush() {
      if (done) return "";
      done = true;
      return buf;
    },
  };
}

/** 解析流里的 <mind> 段：它是自言自语，不是正文 */
export function createMindSplitter(emit) {
  const OPEN = "<mind>";
  const CLOSE = "</mind>";
  let mode = "probe"; // probe → 还没确定开头是不是 <mind>；text → 已经在正文了
  let buf = "";
  let trimNext = false; // 只在 <mind> 之后为 true：那一段的换行不该带进正文
  let body = ""; // 真正属于正文的部分，<mind> 不算
  const pushDelta = (text) => {
    if (!text) return;
    body += text;
    emit({ type: "delta", text });
  };
  const emitMindAndRest = (chunk) => {
    const [head, ...rest] = chunk.split(CLOSE);
    emit({ type: "mind", text: head.slice(OPEN.length).trim() });
    mode = "text";
    buf = "";
    const bodyPart = rest.join(CLOSE).replace(/^\s+/, "");
    trimNext = !bodyPart;
    pushDelta(bodyPart);
  };
  return {
    push(chunk) {
      if (mode === "text") {
        let out = chunk;
        if (trimNext) {
          out = out.replace(/^\s+/, "");
          if (out) trimNext = false;
          if (!out) return;
        }
        pushDelta(out);
        return;
      }
      buf += chunk;
      if (buf.startsWith(OPEN)) {
        if (buf.includes(CLOSE)) emitMindAndRest(buf);
        else if (buf.length > 600) {
          // 模型忘了收尾，兜底当正文，别把回复卡住
          pushDelta(buf.slice(OPEN.length));
          mode = "text";
          buf = "";
        }
        return;
      }
      // 还可能是 <mind> 的前缀就再等等
      if (buf.length < OPEN.length && OPEN.startsWith(buf)) return;
      mode = "text";
      pushDelta(buf);
      buf = "";
    },
    flush() {
      if (buf) pushDelta(buf.replace(OPEN, ""));
      buf = "";
    },
    get body() {
      return body;
    },
  };
}

/* ---------------- 初始化流程 ---------------- */

export function initStatus() {
  const st = initState();
  const persona = getPersona();
  return {
    started: !!st.started,
    answered: st.answered ?? 0,
    total: 4,
    done: !!st.done && !!persona?.locked,
    infered: !!st.infered,
  };
}

export function beginInit() {
  const { question } = startInit();
  return { question, ...initStatus() };
}

async function initTurn({ emit, sessionId, text }) {
  const session = ensureSession(sessionId, { source: "app", mode: "init" });
  if (text) {
    insertMessage({ sessionId: session.id, role: "user", content: text, interactionType: "social" });

  /* 初始化阶段的回答是固定流程，不走本体。 */
  }
  const { done, question, state } = text
    ? pushAnswer(text)
    : { done: false, question: null, state: initState() };

  if (!done) {
    const content = question;
    const msg = insertMessage({
      sessionId: session.id,
      role: "assistant",
      content,
      meta: { kind: "init" },
    });
    emit({ type: "delta", text: content });
  emit({ type: "done", messageId: msg.id, text: content, action: "lean_in", init: true });
    return { sessionId: session.id };
  }

  emit({ type: "info", text: "记住了。让我把这些整理一下。" });
  const persona = await inferPersona(state.answers ?? []);
  const content = "这就是我。你可以改一个维度，只能改一次——改完我就定下来了。";
  const msg = insertMessage({
    sessionId: session.id,
    role: "assistant",
    content,
    meta: { kind: "init_done" },
  });
  emit({ type: "delta", text: content });
  emit({ type: "done", messageId: msg.id, text: content, action: "happy", persona, init: true });
  return { sessionId: session.id };
}

/* ---------------- 正常对话 ---------------- */

export async function handleChat({ sessionId, text, mode = "chat", emit }) {
  if (mode === "init") return initTurn({ emit, sessionId, text });

  const session = ensureSession(sessionId, { source: "app", mode: "chat" });
  const interactionType = guessInteractionType(text);

  /* 每句话都先过一遍本体：更新内部状态，并记下这一轮的"冲突 → 意图 → 动作"。
     这一版开始，意图成为动作的硬约束——模型只能在意图给的候选里挑。 */
  let ontoDecision = null;
  let correctionHint = "";

  /* 纠正要排在 observe 之前：observe 会把"上一次决策"覆盖成这一句，先纠正才拿得到旧的那条 */
  if (isCorrection(text)) {
    const fix = correctOntology(text);
    if (fix) {
      log(`本体校准：${fix.from} → ${fix.to}${fix.why ? `（上次误读：${fix.why}）` : ""}`);
      correctionHint = `\n\n【刚刚被纠正】你上一条把他的话听成了「${fix.from}」，他真正的意思是「${fix.to}」。这一轮先承认（别夸张道歉），再用对的方式回应。`;
    }
  }

  try {
    const { decision } = observeOntology(text);
    ontoDecision = decision;
    log(`本体：${decision.reason}`);
  } catch (e) {
    log("本体更新失败：", e.message);
  }

  insertMessage({
    sessionId: session.id,
    role: "user",
    content: text,
    interactionType,
  });
  emit({ type: "user_saved", sessionId: session.id, interactionType });

  // 用户回应了之前主动提起的事 → 线头闭合，变成共同经历
  closePendingLoops(session.id);

  const personaLocked = getPersona()?.locked;
  const enabled = memoryEnabled();
  const { memories } = enabled ? recall(text) : { memories: [] };
  const due = enabled ? dueLoops() : [];

  if (memories.length) {
    emit({
      type: "recall",
      memories: memories.map((m) => ({
        id: m.id,
        content: m.content,
        category: m.category,
        createdAt: m.created_at,
      })),
    });
  }

  const growthHint = takeGrowthHint();
  const system = [
    baseLayer({ memories, dueLoops: due, relation: getRelation() }),
    chatLayer(),
    immersionEnabled()
      ? "【沉浸模式】用户正在工作。保持安静、简短、不催促；不要做庆祝、移动或大幅度动作，需要动作时只使用安静姿态。"
      : "",
  ].join("\n\n") + correctionHint + growthHint.text;
  const history = sessionMessages(session.id, 40)
    .slice(-12)
    .map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.content }));

  if (!personaLocked) {
    emit({ type: "info", text: "还没做人格初始化。先在测试面板里点「开始初始化」。" });
  }

  let full = "";
  let mindText = null;
  let firstToken = false;
  const stallTimer = setTimeout(() => {
    if (!firstToken) emit({ type: "stall", action: "think", text: "……我想想" });
  }, 2500);

  const splitter = createMindSplitter((obj) => {
    if (obj.type === "mind") mindText = obj.text;
    emit(obj);
  });

  /* 动作先落地：标签一解析出来就往下发，桌宠先动，正文后到 */
  let actName = null;
  const actSplit = createActSplitter((raw) => {
    const word = String(raw).trim();
    const key = ACTION_ALIAS[word] ?? word;
    actName = key;
    const quietKey = immersionAction(key);
    broadcast("pet", { action: quietKey, mood: "active" });
    emit({ type: "act", action: quietKey, label: word });
  });

  try {
    full = await chatStream({
      messages: [{ role: "system", content: system }, ...history],
      onDelta: (d) => {
        if (!firstToken) {
          firstToken = true;
          clearTimeout(stallTimer);
        }
        const rest = actSplit.push(d);
        if (rest) splitter.push(rest);
      },
    });
    const tail = actSplit.flush();
    if (tail) splitter.push(tail);
    splitter.flush();
  } catch (e) {
    clearTimeout(stallTimer);
    const code = e instanceof LLMError ? e.code : "network";
    const fb = FALLBACK[code] ?? FALLBACK.network;
    track("downgrade_triggered", { reason: code });
    const msg = insertMessage({
      sessionId: session.id,
      role: "assistant",
      content: fb.text,
      meta: { degraded: code },
    });
    // 出错的时候它自己也该知道：换成"困惑"，而不是继续演刚才那个表情
    broadcast("pet", { action: immersionAction("confused"), ms: 3000 });
    emit({ type: "delta", text: fb.text });
    emit({
      type: "done",
      messageId: msg.id,
      text: fb.text,
      action: immersionAction("confused"),
      degraded: code,
    });
    return { sessionId: session.id, degraded: code };
  }

  // 正文取 splitter 累积的那一份：它已经剔掉 <mind>，而 full 里还留着原始标记
  const { note, clean } = extractAnnotation(splitter.body || full);
  /* 模型偶尔把 <act> 写在句子中间——开头的 splitter 只管开头，
     剩下的必须在正文里清干净，否则会被当成话念出来。 */
  let cleanText = clean
    .replace(/<act>[\s\S]*?<\/act>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  /* 同样的坑：<mind> 也可能不在开头。取出来当心理流，正文里清掉 */
  const midMind = [...cleanText.matchAll(/<mind>([\s\S]*?)<\/mind>/g)]
    .map((m) => m[1].trim())
    .join(" ");
  if (midMind && !mindText) mindText = midMind;
  cleanText = cleanText.replace(/<mind>[\s\S]*?<\/mind>/g, "").replace(/\n{3,}/g, "\n\n").trim();

  /* 回访证据兜底：模型没自然带出来，就补一句短的。
     变化必须能被用户遇到，不能只存在于日志里。 */
  if (growthHint.growth && !/以前|早就不|换作我再/.test(cleanText)) {
    cleanText += "\n\n换以前我可能就不理了。";
  }
  // 模型标的中文名优先。只有它知道这一轮该是什么表情，外面猜不准
  const direct = note ? ACTION_ALIAS[note.trim()] : null;
  const emoKey = direct ? null : resolveEmotion({ actionHint: note, text: cleanText });
  // <act> 是它自己先定下来的那个（最优），圆括号那套只当兜底
  let action =
    actName ??
    direct ??
    (emoKey ? emotionByKey(emoKey)?.action ?? fallbackActionFor() : fallbackActionFor());

  /* 硬约束：模型选的动作必须落在本体这一轮给的意图里。
     不在就换成本体建议的那个，并记下来——这样"它有自己的意志"不是一句设定，
     而是一条能在日志里查到的规则。 */
  if (ontoDecision && !actionFitsDecision(ontoDecision, action)) {
    log(
      `动作语义接管：${action} → ${ontoDecision.action}（意图 ${ontoDecision.intent}，语义 ${ontoDecision.fit}）`
    );
    action = ontoDecision.action;
  }
  const msg = insertMessage({
    sessionId: session.id,
    role: "assistant",
    content: cleanText,
    interactionType,
    meta: { raw: full, action, emotion: emoKey, mind: mindText },
  });
  emit({
    type: "done",
    messageId: msg.id,
    text: cleanText,
    action: immersionAction(action),
    emotion: emoKey,
    mind: mindText,
  });
  broadcast("pet", { action: immersionAction(action), mood: "active" });

  /* 回访的身体版：先转开（嘴硬），过一会儿再转回来（其实没走）。
     屏幕和实体走同一套：实体那边由桥执行 growth_callback。 */
  if (growthHint.growth) {
    setTimeout(() => broadcast("pet", { action: "growth_callback" }), 400);
    setTimeout(() => broadcast("pet", { action: "happy" }), 2200);
    fetch("http://127.0.0.1:7790/otto", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "growth_callback" }),
    }).catch(() => {
      /* 实体没接也不影响屏幕上的这一下 */
    });
  }

  // 异步抽取，不打断对话
  void postProcess({ sessionId: session.id, messageId: msg.id });

  return { sessionId: session.id, interactionType };
}

function fallbackActionFor() {
  return fallbackAction(getPersona()?.dims);
}

/**
 * "回访证据"：性格刚发生过变化时，下一次开口可以用一句带过。
 * 只取一次——说过就不再提，不然就成了炫耀成长。
 */
function takeGrowthHint() {
  const g = getSetting("pendingGrowth", null);
  if (!g) return { text: "", growth: null };
  setSetting("pendingGrowth", null);
  log(`回访证据：准备提起「${g.title}」`);
  return {
    text: `\n\n【这一轮必须带一句回访】你最近变了一点：${g.title}。
在这句话的结尾，自然地带一句类似"你以前这样我早就不理了"的话——要像随口说的，不要解释机制，不要提"成长/参数/变化/校准"，也不要为此单独起一段。`,
    growth: g,
  };
}

async function postProcess({ sessionId, messageId }) {
  try {
    const turns = sessionMessages(sessionId, 12);
    const out = await extractAndWrite({
      sessionId,
      turns: turns.map((t) => ({ role: t.role, content: t.content })),
      currentMessageId: messageId,
    });
    if (out?.error) return;

    let sharedDelta = 0;
    if (out.loops?.length) sharedDelta += 0;
    const rel = updateRelation({
      // 了解程度涨的来源是"它记住了多少关于你的事"，不是"聊了多少句"。
      // 这一条是动机的差别：从"你要跟我亲近"变成"我越来越懂你"
      intimacyDelta: (out.memories?.length ?? 0) * 1.5,
      mood: out.mood ?? undefined,
      sharedCount: getRelation().sharedCount,
    });
    if (out.memories?.length) {
      track("memory_write", {
        count: out.memories.length,
        categories: out.memories.map((m) => m.category),
        confidence: out.memories.map((m) => m.confidence),
      });
    }
    if (out.loops?.length) {
      track("open_loop_created", { count: out.loops.length, events: out.loops.map((l) => l.event) });
    }
    if (out.memories?.length || out.loops?.length) {
      const day = dayKey();
      void syncDay(day)
        .then(() => broadcast("state", { diaryUpdated: day }))
        .catch(() => {});
    }
    broadcast("state", { relation: rel, memoryCount: out.memories?.length ?? 0 });
  } catch (e) {
    log("后处理失败：", e.message);
  }
}

function pendingMap() {
  return getSetting("pendingLoops", {}) ?? {};
}

function closePendingLoops(sessionId) {
  const map = pendingMap();
  const ids = map[sessionId];
  if (!ids?.length) return;
  delete map[sessionId];
  setSetting("pendingLoops", map);
  for (const id of ids) {
    const closed = closeLoop(id);
    if (closed) {
      const rel = getRelation();
      updateRelation({ sharedCount: rel.sharedCount + 1, intimacyDelta: 6 });
      track("open_loop_closed", { loopId: id, event: closed.event });
    }
  }
  broadcast("state", { closedLoops: ids.length });
}

/* ---------------- 主动发起 ---------------- */

function proactiveStats(sinceTs) {
  const row = one(
    "select count(*) as c, max(created_at) as last from message where proactive = 1 and created_at >= ?",
    sinceTs
  );
  return { count: row?.c ?? 0, last: row?.last ?? null };
}

export async function proactiveTick() {
  // 沉浸模式下主动发起不抢占工作注意力；到期的线头留着，退出后再处理。
  if (immersionEnabled()) return null;
  if (!ENV.proactive || !memoryEnabled()) return null;
  const quietUntil = getSetting("quietUntil", null);
  if (quietUntil && now() < quietUntil) return null;
  downgradeStale();
  const persona = getPersona();
  if (!persona?.locked) return null;

  const target = dueLoops()[0];
  if (!target) return null;

  const sociability = persona.dims.sociability ?? 0.5;
  const cap = Math.max(1, Math.round(1 + 3 * sociability));
  const { count, last } = proactiveStats(now() - 24 * 3600000);
  if (count >= cap) return null;
  const minGapMs = (24 / (cap + 1)) * 3600000;
  if (last && now() - last < minGapMs) return null;

  markAttempted(target.id);
  const relation = getRelation();

  let text;
  try {
    text = await chatStream({
      messages: [
        {
          role: "system",
          content: [
            baseLayer({ persona, relation, memories: [], dueLoops: [target] }),
            proactiveLayer(persona, relation),
          ].join("\n\n") + takeGrowthHint().text,
        },
        {
          role: "user",
          content: `你想起了一件还没下文的事：「${target.event}」，当时用户的情绪是${
            target.emotion || "不太好说"
          }。现在开口问一句。`,
        },
      ],
      maxTokens: 200,
      temperature: 0.9,
    });
  } catch (e) {
    text = `（抬头）你之前说过「${target.event}」，怎么样了？`;
    track("downgrade_triggered", { reason: "proactive_fallback" });
  }

  const { note, clean } = extractAnnotation(text);
  const emoKey = resolveEmotion({ actionHint: note, text: clean, context: { proactive: true } });
  const action = emoKey ? emotionByKey(emoKey)?.action ?? "alert" : "alert";
  const session = ensureSession(null, { source: "proactive", mode: "chat" });
  const msg = insertMessage({
    sessionId: session.id,
    role: "assistant",
    content: clean,
    proactive: true,
    meta: { loopId: target.id, action, emotion: emoKey },
  });

  const map = pendingMap();
  map[session.id] = [...(map[session.id] ?? []), target.id];
  setSetting("pendingLoops", map);
  track("proactive_sent", { loopId: target.id, event: target.event });

  const payload = {
    sessionId: session.id,
    message: { id: msg.id, content: clean, createdAt: msg.created_at, proactive: true },
    action,
    emotion: emoKey,
    loop: { id: target.id, event: target.event },
  };
  broadcast("proactive", payload);
  broadcast("pet", { action, mood: "perk" });
  log("主动发起：", clean);
  return payload;
}

export function startProactiveLoop(intervalMs = 15000) {
  const timer = setInterval(() => {
    proactiveTick().catch((e) => log("主动发起检查失败：", e.message));
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

export { llmStatus };
