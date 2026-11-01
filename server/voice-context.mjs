import { baseLayer } from "./prompt.mjs";
import { getPersona, getRelation, getPetName } from "./persona.mjs";
import { recall, memoryEnabled } from "./memory.mjs";
import { dueLoops } from "./openloop.mjs";
import { snapshot as ontologySnapshot } from "./ontology.mjs";

function stateWords(snapshot) {
  return snapshot.dims
    .map((item) => `${item.label}${item.value >= item.base ? "偏高" : "偏低"}`)
    .join("、");
}

export function buildVoiceContext(query = "") {
  const memories = memoryEnabled()
    ? recall(String(query ?? ""), { limit: 4 }).memories
    : [];
  const loops = dueLoops();
  const persona = getPersona();
  const relation = getRelation();
  const ontology = ontologySnapshot();
  const last = ontology.lastDecision;

  const situation = last
    ? `上一轮你听到的是「${last.text}」。你当时读成「${last.speech?.act ?? "陈述"}」，` +
      `心里的拉扯是「${last.conflict?.label ?? "没有明显拉扯"}」，最后选择了「${last.intent}」，` +
      `身体动作是 ${last.action}${last.combo?.label ? `，随后还有一段「${last.combo.label}」` : ""}。`
    : "你们还没有形成上一轮的动作判断。";

  const context = `${baseLayer({ persona, relation, memories, dueLoops: loops })}

【你现在在实体身体里】
你就在桌面上，用户能听见你，也能看见你的点阵和身体。你不是在电脑聊天框里打字。
当前六维状态：${stateWords(ontology)}。
${situation}

说话仍按之前的口语规则来：一到三句，先回应他真正说的东西，可以有态度、反问和走神一下，
但不要把内部状态、意图、动作评分、记忆机制这些词说出来。记得的事只在自然相关时提，
不要为了证明记忆而硬背清单。`;

  return {
    context,
    petName: getPetName(),
    stage: relation.stage,
    mood: relation.mood,
    memoryCount: memories.length,
    loopCount: loops.length,
    updatedAt: Date.now(),
  };
}
