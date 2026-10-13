import { ENV } from "./env.mjs";
import { extractJson, log } from "./util.mjs";

export class LLMError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code; // no_key | network | timeout | http | bad_json
  }
}

export function status() {
  return {
    mode: ENV.mock ? "mock" : ENV.hasKey() ? "live" : "no_key",
    model: ENV.mock ? "mock-model" : ENV.model,
    baseUrl: ENV.baseUrl,
    keyConfigured: ENV.hasKey(),
  };
}

async function post(body, { timeoutMs = 60000, signal } = {}) {
  if (ENV.mock) return null;
  if (!ENV.hasKey()) {
    throw new LLMError("还没配置 DeepSeek API Key（把 .env 里的 DEEPSEEK_API_KEY 填上）", "no_key");
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  if (signal) signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  try {
    const res = await fetch(`${ENV.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ENV.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new LLMError(`模型接口返回 ${res.status}：${text.slice(0, 300)}`, "http");
    }
    return res;
  } catch (e) {
    if (e instanceof LLMError) throw e;
    if (e.name === "AbortError") throw new LLMError("模型响应超时", "timeout");
    throw new LLMError(`连不上模型接口：${e.message}`, "network");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 流式对话。onDelta 每收到一段文本调用一次。
 * 返回完整文本。
 */
export async function chatStream({ messages, temperature = 0.85, maxTokens = 800, onDelta, signal }) {
  if (ENV.mock) return mockStream({ messages, onDelta });

  const res = await post(
    { model: ENV.model, messages, stream: true, temperature, max_tokens: maxTokens },
    { signal }
  );
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let full = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const j = JSON.parse(payload);
        const delta = j.choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          onDelta?.(delta);
        }
      } catch {
        /* 忽略半包 */
      }
    }
  }
  return full;
}

/** 非流式的严格 JSON 输出，用于记忆抽取这类结构化任务 */
export async function chatJson({ messages, temperature = 0.2, maxTokens = 900 }) {
  if (ENV.mock) return mockJson(messages);
  const res = await post({
    model: ENV.model,
    messages,
    stream: false,
    temperature,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
  });
  const j = await res.json();
  const text = j.choices?.[0]?.message?.content ?? "";
  const parsed = extractJson(text);
  if (!parsed) {
    log("抽取结果不是合法 JSON：", text.slice(0, 200));
    throw new LLMError("模型返回的内容不是合法 JSON", "bad_json");
  }
  return parsed;
}

/* ------------------------------------------------------------------ */
/* mock：不消耗额度，用来验证记忆写入 / open loop 回收 / 主动发起是否真的在跑 */
/* ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mockStream({ messages, onDelta }) {
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const sys = messages[0]?.content ?? "";
  let reply;
  if (sys.includes("主动开口")) {
    const m = lastUser.match(/「(.+?)」/);
    reply = `（抬头）${m ? m[1] : "那件事"}怎么样了？`;
  } else if (sys.includes("日记")) {
    const m = lastUser.match(/\[[^\]]+\]\s*([^\n（]+)/);
    reply = m
      ? `今天记下的就一件：${m[1].trim().slice(0, 26)}。\n\n别的想不起来了……反正就这么过完了。明天再说吧。`
      : "这天说了几句，没有特别要记的。\n\n……也不是完全没有，就是懒得写。";
  } else if (sys.includes("人格推断")) {
    reply = "好，我记下了。";
  } else {
    // 假模型的话要一眼看出是假的：它是测试用的，不能被真模型学去
    reply = "［假模型］这条回复是写死的，只用来验证链路通不通。";
  }
  for (const ch of reply) {
    onDelta?.(ch);
    await sleep(12);
  }
  return reply;
}

function mockJson(messages) {
  const sys = messages[0]?.content ?? "";
  const userText = messages.map((m) => m.content).join("\n");
  if (sys.includes("人格推断")) {
    return {
      activity: 0.42,
      sociability: 0.55,
      expressiveness: 0.38,
      amplitude: 0.35,
      curiosity: 0.6,
      description: "话不多，但会记住细节；不急着给建议，更愿意先听你把话说完。",
    };
  }
  if (sys.includes("抽取")) {
    const out = { memories: [], open_loops: [], interaction_type: "social", mood: "平稳" };
    const m = userText.match(/(答辩|面试|考试|汇报)/);
    if (m) {
      out.memories.push({
        category: "relationship",
        content: `用户提到要${m[1]}，当时有点紧张`,
        source_quote: userText.slice(-40),
        emotion: "焦虑",
        confidence: 0.9,
        inferred: false,
      });
      out.open_loops.push({
        event: m[1],
        due_at: new Date(Date.now() + 30 * 3600000).toISOString().slice(0, 19),
        emotion: "焦虑",
        memory_content: `用户要${m[1]}，当时有点紧张`,
      });
      out.interaction_type = "task";
    }
    const c = userText.match(/不喝咖啡|咖啡/);
    if (c) {
      out.memories.push({
        category: "user_info",
        content: "用户不喝咖啡",
        source_quote: userText.slice(-30),
        emotion: null,
        confidence: 0.85,
        inferred: false,
      });
    }
    return out;
  }
  return { text: "（mock）" };
}
