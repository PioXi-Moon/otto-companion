/**
 * 硬件语音回合的统一入口。
 *
 * 小智已经有自己的语音模型，这里不再生成一遍回答。它只做软件最该做的两件事：
 * 1. 让同一句话先经过 Otto 本体，决定硬件与桌面最终该演什么；
 * 2. 把语音里真实说过的话写进关系记录，并在后台抽取长期记忆。
 */
import { broadcast } from "./bus.mjs";
import { dayKey, syncDay } from "./diary.mjs";
import { track } from "./events.mjs";
import { extractAndWrite, memoryEnabled } from "./memory.mjs";
import {
  ensureSession,
  guessInteractionType,
  insertMessage,
} from "./messages.mjs";
import { observe, actionFitsDecision } from "./ontology.mjs";
import { getRelation, updateRelation } from "./persona.mjs";
import { log } from "./util.mjs";
import { scheduleCombo } from "./gesture-combo.mjs";

const SYSTEM_ACTIONS = new Set(["stop", "home", "quiet", "normal"]);

function clean(value, max = 1200) {
  return String(value ?? "").trim().slice(0, max);
}

/**
 * 语音模型会先给一个动作草稿。草稿可以表达它想干什么，但最终要过本体这一关：
 * 如果它想做一个和当前意图冲突的动作，软件把它换成意图池里的动作。
 * 用户明确下达的物理移动命令不参与这层替换，安全控制也原样放行。
 */
export function resolveVoiceAction(text, proposedAction) {
  const proposed = clean(proposedAction, 40).toLowerCase();
  const { decision } = observe(text);

  if (SYSTEM_ACTIONS.has(proposed)) {
    return {
      action: proposed,
      proposedAction: proposed,
      overridden: false,
      decision,
    };
  }

  if (!proposed || proposed === "none") {
    return {
      action: null,
      proposedAction: proposed || null,
      overridden: false,
      decision,
    };
  }

  if (actionFitsDecision(decision, proposed)) {
    return {
      action: proposed,
      proposedAction: proposed,
      overridden: false,
      decision,
    };
  }

  log(`语音本体接管：${proposed} → ${decision.action}（意图 ${decision.intent}）`);
  return {
    action: decision.action,
    proposedAction: proposed,
    overridden: true,
    decision,
  };
}

async function extractVoiceMemory({ sessionId, text, reply, assistantId }) {
  if (!memoryEnabled()) return;
  try {
    const out = await extractAndWrite({
      sessionId,
      turns: [
        { role: "user", content: text },
        { role: "assistant", content: reply },
      ],
      currentMessageId: assistantId,
      trigger: "voice_turn",
    });
    if (out?.error) return;

    const relation = updateRelation({
      intimacyDelta: (out.memories?.length ?? 0) * 1.5,
      mood: out.mood ?? undefined,
      sharedCount: getRelation().sharedCount,
    });
    if (out.memories?.length) {
      track("memory_write", {
        count: out.memories.length,
        source: "voice",
        categories: out.memories.map((m) => m.category),
      });
    }
    if (out.loops?.length) {
      track("open_loop_created", {
        count: out.loops.length,
        source: "voice",
        events: out.loops.map((l) => l.event),
      });
    }
    if (out.memories?.length || out.loops?.length) {
      const day = dayKey();
      void syncDay(day)
        .then(() => broadcast("state", { diaryUpdated: day }))
        .catch(() => {});
    }
    broadcast("state", {
      relation,
      memoryCount: out.memories?.length ?? 0,
      voiceRecorded: true,
    });
  } catch (error) {
    log("语音记忆后处理失败：", error.message);
  }
}

export function recordVoiceTurn({
  text,
  reply,
  proposedAction,
  move = "none",
  sessionId,
}) {
  const heard = clean(text, 2000);
  const spoken = clean(reply, 4000);
  if (!heard) throw new Error("语音回合缺少用户原话");

  const session = ensureSession(clean(sessionId, 120) || undefined, {
    source: "voice",
    mode: "voice",
  });
  const interactionType = guessInteractionType(heard);
  const resolved = resolveVoiceAction(heard, proposedAction);
  const finalMove = clean(move, 30).toLowerCase() || "none";

  const userMessage = insertMessage({
    sessionId: session.id,
    role: "user",
    content: heard,
    interactionType,
    source: "voice",
    meta: { input: "speech" },
  });
  const assistantMessage = insertMessage({
    sessionId: session.id,
    role: "assistant",
    content: spoken,
    interactionType,
    source: "voice",
    meta: {
      input: "speech",
      output: "speech",
      proposedAction: resolved.proposedAction,
      action: resolved.action,
      actionOverridden: resolved.overridden,
      move: finalMove === "none" ? null : finalMove,
      ontology: {
        speech: resolved.decision.speech,
        conflict: resolved.decision.conflict,
        intent: resolved.decision.intent,
        action: resolved.decision.action,
      },
    },
  });

  track("voice_turn", {
    sessionId: session.id,
    userMessageId: userMessage.id,
    action: resolved.action,
    proposedAction: resolved.proposedAction,
    overridden: resolved.overridden,
    move: finalMove,
    intent: resolved.decision.intent,
  });

  if (resolved.action) {
    broadcast("pet", { action: resolved.action, mood: "active", source: "voice" });
  }
  if (resolved.decision.combo) {
    scheduleCombo(
      resolved.decision.combo,
      (nextAction, step) =>
        broadcast("pet", {
          action: nextAction,
          mood: "combo",
          source: "voice",
          combo: resolved.decision.combo.label,
          step,
        }),
      { skipAction: resolved.action }
    );
  }
  broadcast("state", {
    voiceTurn: {
      sessionId: session.id,
      action: resolved.action,
      intent: resolved.decision.intent,
    },
  });

  void extractVoiceMemory({
    sessionId: session.id,
    text: heard,
    reply: spoken,
    assistantId: assistantMessage.id,
  });

  return {
    ok: true,
    sessionId: session.id,
    action: resolved.action ?? "none",
    move: finalMove,
    overridden: resolved.overridden,
    proposedAction: resolved.proposedAction,
    sequence: [
      ...(resolved.action ? [{ action: resolved.action, atMs: 0 }] : []),
      ...(resolved.decision.combo?.steps ?? []),
    ],
    ontology: {
      speech: resolved.decision.speech,
      conflict: resolved.decision.conflict,
      intent: resolved.decision.intent,
      action: resolved.decision.action,
      pool: resolved.decision.pool,
    },
  };
}
