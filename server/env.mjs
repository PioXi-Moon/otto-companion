import fs from "node:fs";
import path from "node:path";
import url from "node:url";

export const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");

/**
 * 极简 .env 解析，不引依赖。
 * 这里刻意让 .env 覆盖进程里已有的同名环境变量：不然从别处继承来的 Key
 * 会悄悄盖掉工程里的配置，改 .env 像是没生效。
 */
function readEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (v !== "") process.env[k] = v;
  }
}

readEnvFile(path.join(ROOT, ".env"));
// 测试或临时跑一份不同的配置时用：OTTO_ENV_FILE=xxx.env，在 .env 之上再覆盖一层
if (process.env.OTTO_ENV_FILE) readEnvFile(path.resolve(ROOT, process.env.OTTO_ENV_FILE));

export const ENV = {
  apiKey: process.env.DEEPSEEK_API_KEY || "",
  baseUrl: (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, ""),
  model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
  port: Number(process.env.OTTO_PORT || 7788),
  get mock() {
    return process.env.OTTO_MOCK_LLM === "1";
  },
  get proactive() {
    return process.env.OTTO_PROACTIVE !== "0";
  },
  hasKey() {
    return this.apiKey.startsWith("sk-") && !this.apiKey.includes("xxxx");
  },
};
