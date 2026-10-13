/** 把所有提示词打成一个文件，方便通读和改 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { baseLayer, chatLayer, proactiveLayer, diaryLayer, DIARY_EXAMPLE } from "../server/prompt.mjs";
import { PROPS_BLOCK } from "../server/props.mjs";
import { initQuestions } from "../server/initflow.mjs";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const grab = (f, name) => {
  const m = src(f).match(new RegExp(String.raw`const ${name} = \`([\s\S]*?)\`;`));
  return m ? m[1] : "(没找到)";
};

const persona = {
  dims: { activity: .45, sociability: .5, expressiveness: .4, amplitude: .4, curiosity: .55 },
  description: "话不多，先听你把话说完",
  createdAt: Date.now() - 3 * 86400000,
};
const relation = { stageLabel: "熟悉", mood: "平稳" };

const parts = [
  ["1. 基础层（所有「说话」的场合共用）", baseLayer({ persona, relation, memories: [], dueLoops: [] })],
  ["2. 对话场景层", chatLayer()],
  ["3. 主动发起层", proactiveLayer(persona, relation)],
  ["4. 日记层（手账一页）", diaryLayer({ lastLayout: "side" }) + "\n\n" + PROPS_BLOCK + "\n\n" + DIARY_EXAMPLE],
  ["5. 人格推断（工程任务，不套基础层）", grab("server/initflow.mjs", "INFER_SYSTEM")],
  ["6. 记忆抽取（工程任务，不套基础层）", grab("server/memory.mjs", "EXTRACT_SYSTEM")],
  ["7. 人格初始化问句", initQuestions().map((q, i) => `${i + 1}. ${q}`).join("\n\n")],
];

const text = `# Otto 提示词全文\n\n生成时间 ${new Date().toLocaleString("zh-CN")}\n` +
  parts.map(([t, b]) => `\n\n---\n\n## ${t}\n\n${b}`).join("") + "\n";
fs.writeFileSync(path.join(ROOT, "提示词全文.md"), text, "utf8");
console.log("已写入 提示词全文.md，共", text.length, "字");
for (const [t, b] of parts) console.log(" ", t.padEnd(30), b.length, "字");
