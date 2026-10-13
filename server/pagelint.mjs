/**
 * 手账一页的校验。
 *
 * 为什么单独拆一个文件：这些规则是**可以算的**，所以也就可以被测试。
 * scripts/smoke.mjs 里拿几个正例反例跑一遍，改了规则立刻知道有没有把好页
 * 误判成坏页——不然"提示词改坏了"这件事只能靠一页一页肉眼看出来。
 *
 * 规则来自用户一条一条点名骂过的地方：复述、短句堆叠、清点、先否定再纠正、
 * 正文明明是写给自己却用了"你"。没有一条需要"品味"。
 */
import { BANNED_IN_DIARY, SHORT_SENTENCE_LIMIT } from "./prompt.mjs";
import { LAYOUTS } from "./props.mjs";

/** 两个字符串最长的公共片段。卡片要是从正文里抠的，这一查就露 */
export function longestCommon(a, b) {
  const A = String(a ?? "").replace(/\s/g, "");
  const B = String(b ?? "").replace(/\s/g, "");
  if (!A || !B) return 0;
  let best = 0;
  const prev = new Array(B.length + 1).fill(0);
  for (let i = 1; i <= A.length; i++) {
    let last = 0;
    for (let j = 1; j <= B.length; j++) {
      const tmp = prev[j];
      prev[j] = A[i - 1] === B[j - 1] ? last + 1 : 0;
      if (prev[j] > best) best = prev[j];
      last = tmp;
    }
  }
  return best;
}

/**
 * 查一页。返回毛病清单，空数组就是过了。
 * 这些字会原样念回给模型，所以每条都要说清楚"哪里不对、该往哪儿改"。
 */
export function lintPage(page, { lastSeal = null, lastLayout = null, lastProps = [] } = {}) {
  const bad = [];
  const body = String(page?.diary ?? "").trim();
  if (!body) return ["正文是空的"];

  const plain = body.replace(/\s/g, "");
  const sentences = body
    .split(/[。！？；]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);

  // 短句堆叠：平均句长不够，就是一条一条在报
  const avg = sentences.length ? plain.length / sentences.length : 99;
  if (sentences.length >= 5 && avg < SHORT_SENTENCE_LIMIT)
    bad.push(`句子太碎，平均一句只有 ${Math.round(avg)} 个字，要一连串地说下来`);

  // 连着三句都不到十个字，读起来就是在交日报
  let run = 0;
  for (const s of sentences) {
    run = s.length <= 10 ? run + 1 : 0;
    if (run >= 3) {
      bad.push("连着三句都很短，像汇报");
      break;
    }
  }

  const hit = BANNED_IN_DIARY.filter((w) => w.re.test(body)).map((w) => w.label);
  if (hit.length) bad.push(`用了这几个词：${hit.join("、")}`);

  // 把心里的事写成清点，这是它最爱犯的毛病
  if (/我数(过|完|着|了)/.test(body)) bad.push("把心思写成了清点（我数过／我数完），那是账本");

  /* 复述：读者十分钟前刚经历过，等于什么都没给他。
     两个信号：一唱一和的"我问…他说"连着来，或者整篇都在转述谁说了什么。
     单个"他说"是正常的叙述，不复述。 */
  const pingpong = (body.match(/(问|说|讲|答|回)[^。！？]{0,12}?他(说|答|回|讲)/g) ?? []).length;
  const retell = (body.match(/(我(问|说|讲)|他(说|答|回|讲))/g) ?? []).length;
  if (pingpong >= 2 || retell >= 6)
    bad.push(`一问一答地转了 ${retell} 处对话（${pingpong} 处是连着的），这是在复述，不是写日记`);

  // 人称：引号里的不算，那是他自己的原话
  const noQuote = body.replace(/[“"][^”"]*[”"]/g, "");
  const yous = (noQuote.match(/你/g) ?? []).length;
  if (yous >= 2) bad.push(`正文里出现了 ${yous} 次"你"，日记不是写给他的信`);

  // 复述：三处以上八个字以上的原话照抄
  const quoted = [...body.matchAll(/[“"]([^”"]{8,})[”"]/g)];
  if (quoted.length >= 3) bad.push("抄了太多他的原话，这是在复述");

  const seal = String(page?.seal ?? "").trim();
  if ([...seal].length !== 1 || !/[\u4e00-\u9fff]/.test(seal)) bad.push("印章要一个字");
  else if (lastSeal && seal === lastSeal) bad.push(`印章又用了昨天的"${lastSeal}"，换一个`);

  const card = String(page?.card ?? "").trim();
  if (card.length < 12 || card.length > 42) bad.push(`卡片 ${card.length} 字，要二十到三十五个字`);
  else if (longestCommon(body, card) >= 8) bad.push("卡片是从正文里抠出来的，它得是另一句话");

  if (!LAYOUTS.includes(page?.layout)) bad.push("版式没挑，五个里选一个");
  else if (lastLayout && page.layout === lastLayout)
    bad.push(`版式又用了昨天的 ${lastLayout}，换一个——连着两天一样，翻本子的人会以为你没写`);

  // huge 是"一个字"那一版：正文必须短，不然那个大字就是贴上去的装饰
  if (page?.layout === "huge" && plain.length > 140)
    bad.push(`正文 ${plain.length} 字，huge 是"没什么可说"的那一版，一百四十字以内，或者换个版式`);
  if (plain.length > 420) bad.push(`正文 ${plain.length} 字，太长了`);

  // 一页手账没画面，就退回成干巴巴的日记了
  if (!Array.isArray(page?.props) || !page.props.length) bad.push("画面空着，至少挑一个道具");
  else {
    // 连着两天画同一批东西，本子就不像日子了
    const ids = page.props.map((p) => (typeof p === "string" ? p : p?.id)).filter(Boolean);
    const same = ids.filter((id) => lastProps.includes(id));
    if (lastProps.length && same.length >= 2)
      bad.push(`昨天画的也是这几个（${same.join("、")}），换掉至少一个`);
  }
  return bad;
}
