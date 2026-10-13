/**
 * 动作调参台。
 *
 * 拖动圆点 → 改关节角度 → 存下来 → 桌宠立刻用上。
 * 存的是 data/poses.json，不是代码。
 */
import { RIG_PARAMS, DEFAULT_POSE, applyPose, poseToCss, describeParam } from "./rig.js";
import { ACTIONS } from "./actions.js";

const preview = document.getElementById("preview");
const otto = document.getElementById("otto");
const handlesBox = document.getElementById("handles");

let pose = { ...DEFAULT_POSE };
let poses = {};

const post = (url, body) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  }).then((r) => r.json());

/* ---------------- 画出来 ---------------- */

fetch("/otto.svg")
  .then((r) => r.text())
  .then((svg) => {
    document.getElementById("ottoArt").innerHTML = svg;
    layoutHandles();
  });

function paint() {
  applyPose(otto, pose);
  document.getElementById("css").textContent = poseToCss(pose);
  for (const p of RIG_PARAMS) {
    const out = document.querySelector(`[data-out="${p.key}"]`);
    if (out) out.textContent = describeParam(p, pose[p.key]);
    const range = document.querySelector(`[data-in="${p.key}"]`);
    if (range && Number(range.value) !== pose[p.key]) range.value = pose[p.key];
  }
  layoutHandles();
}

/* ---------------- 滑块 ---------------- */

const sliderBox = document.getElementById("sliders");
for (const p of RIG_PARAMS) {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = `
    <label>${p.label}<b data-out="${p.key}"></b></label>
    <input type="range" data-in="${p.key}" min="${p.min}" max="${p.max}" step="${p.step}" value="${p.def}">
    ${p.hint ? `<div class="hintline">${p.hint}</div>` : ""}`;
  sliderBox.appendChild(row);
  row.querySelector("input").addEventListener("input", (e) => {
    pose[p.key] = Number(e.target.value);
    paint();
  });
}

/* ---------------- 拖动圆点 ---------------- */

/* 圆点挂在哪个 SVG 元素上、拖多远算一度 */
const HANDLES = [
  { param: "lean", sel: ".torso", ax: 0.5, ay: 0.5, k: 0.32, label: "整体" },
  { param: "head", sel: ".head", ax: 0.5, ay: 0.12, k: 0.4, label: "头" },
  { param: "mouthY", sel: ".mouths", ax: 0.5, ay: 0.5, k: 0.5, label: "嘴" },
  { param: "hipL", sel: ".leg.left .thigh", ax: 0.5, ay: 0.08, k: 0.5, label: "左髋" },
  { param: "ankleL", sel: ".leg.left .foot", ax: 0.5, ay: 0.5, k: 0.6, label: "左脚" },
  { param: "hipR", sel: ".leg.right .thigh", ax: 0.5, ay: 0.08, k: -0.5, label: "右髋" },
  { param: "ankleR", sel: ".leg.right .foot", ax: 0.5, ay: 0.5, k: -0.6, label: "右脚" },
];

for (const h of HANDLES) {
  const node = document.createElement("div");
  node.className = "h";
  node.innerHTML = `<span>${h.label}</span>`;
  handlesBox.appendChild(node);
  h.node = node;

  let startX = 0;
  let startVal = 0;
  node.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    node.setPointerCapture(e.pointerId);
    startX = e.clientX;
    startVal = pose[h.param];
  });
  node.addEventListener("pointermove", (e) => {
    if (!node.hasPointerCapture?.(e.pointerId)) return;
    pose[h.param] = round(startVal + (e.clientX - startX) * h.k, RIG_PARAMS.find((p) => p.key === h.param));
    paint();
  });
  node.addEventListener("pointerup", (e) => {
    try { node.releasePointerCapture(e.pointerId); } catch {}
  });
}

function round(v, def) {
  const step = def?.step ?? 0.5;
  const n = Math.round(v / step) * step;
  return Math.min(def?.max ?? v, Math.max(def?.min ?? v, Number(n.toFixed(2))));
}

/* 圆点跟着关节跑。关节有过渡，所以这里一直循环着算 */
function layoutHandles() {
  const box = preview.getBoundingClientRect();
  for (const h of HANDLES) {
    const el = document.querySelector(h.sel);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    const x = r.left - box.left + h.ax * r.width;
    const y = r.top - box.top + h.ay * r.height;
    h.node.style.transform = `translate(${x}px, ${y}px)`;
  }
}
(function loop() {
  layoutHandles();
  requestAnimationFrame(loop);
})();

/* ---------------- 动作槽位 ---------------- */

/* 桌宠会念到这些动作名。存哪个，哪个就换成你调的姿势。
   列表直接来自 actions.js，所以那边加了新动作这里自动就有 */
const SLOTS = Object.entries(ACTIONS).map(([k, a]) => [k, a.label]);

const slotSel = document.getElementById("slot");
for (const [key, label] of SLOTS) {
  const o = document.createElement("option");
  o.value = key;
  o.textContent = `${label}　(${key})`;
  slotSel.appendChild(o);
}

/* ---------------- 存取 ---------------- */

function refreshList() {
  const box = document.getElementById("list");
  const keys = Object.keys(poses);
  if (!keys.length) {
    box.innerHTML = `<div class="hint">还没有存过任何动作。</div>`;
    return;
  }
  box.innerHTML = "";
  for (const k of keys) {
    const label = SLOTS.find((s) => s[0] === k)?.[1] ?? k;
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `<span>${label}　<span style="color:#9aa6b2">${k}</span></span>`;
    const btns = document.createElement("span");
    const b1 = document.createElement("button");
    b1.textContent = "载入";
    b1.onclick = () => { pose = { ...DEFAULT_POSE, ...poses[k] }; paint(); slotSel.value = k; };
    const b0 = document.createElement("button");
    b0.textContent = "套用它";
    b0.title = "让桌宠现在演这个动作";
    b0.onclick = () => post("/api/pet/action", { name: k });
    const b2 = document.createElement("button");
    b2.className = "danger";
    b2.textContent = "删";
    b2.onclick = async () => {
      const d = await fetch("/api/poses/delete", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: k }),
      }).then((r) => r.json());
      poses = d.actions ?? {};
      refreshList();
    };
    btns.append(b0, b1, b2);
    el.appendChild(btns);
    box.appendChild(el);
  }
}

fetch("/api/poses")
  .then((r) => r.json())
  .then((d) => {
    poses = d.actions ?? {};
    refreshList();
  });

document.getElementById("save").addEventListener("click", async () => {
  const name = slotSel.value;
  const d = await fetch("/api/poses", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, pose }),
  }).then((r) => r.json());
  poses = d.actions ?? {};
  refreshList();
  flash(`已存：${name}`);
});

document.getElementById("reset").addEventListener("click", () => {
  pose = { ...DEFAULT_POSE };
  paint();
});

document.getElementById("mirror").addEventListener("click", () => {
  const t = pose.hipL; pose.hipL = -pose.hipR; pose.hipR = -t;
  const a = pose.ankleL; pose.ankleL = -pose.ankleR; pose.ankleR = -a;
  paint();
});

document.getElementById("copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText(poseToCss(pose));
  flash("CSS 已复制");
});

function flash(text) {
  const el = document.createElement("div");
  el.textContent = text;
  el.style.cssText =
    "position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:#16324f;color:#fff;" +
    "padding:8px 16px;border-radius:20px;font-size:13px;z-index:99";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1600);
}

paint();

/* ============================================================
   形状编辑

   只做"改"：选中、挪位置、改尺寸、增删。
   "从零画一个"交给 Figma/Illustrator——那种工具做了三十年，
   自己写一个一定更差。
   ============================================================ */

const panePose = document.getElementById("pane-pose");
const paneShape = document.getElementById("pane-shape");
const shapeList = document.getElementById("shapeList");
const shapeProps = document.getElementById("shapeProps");
let selShape = null;
let selBox = null;
let dirty = false;
let mode = "pose";

document.querySelectorAll(".tb").forEach((b) =>
  b.addEventListener("click", () => {
    mode = b.dataset.tab;
    document.querySelectorAll(".tb").forEach((x) => x.classList.toggle("active", x === b));
    panePose.classList.toggle("hidden", mode !== "pose");
    paneShape.classList.toggle("hidden", mode !== "shape");
    handlesBox.style.display = mode === "pose" ? "" : "none";
    if (mode === "shape") renderShapeList();
    else layoutHandles();
  })
);

const SHAPE_TAGS = new Set(["rect", "circle", "ellipse", "path", "line", "polygon", "polyline"]);
const findSvg = () => document.querySelector("#ottoArt svg");

/* 想让它动，组名得是这几个之一。桌宠按这些名字找关节 */
const JOINT_NAMES = ["rig", "leg-left", "leg-right", "foot-left", "foot-right", "headgroup", "torso", "mouths", "eyes"];

function labelOf(el) {
  if (el.id) return `#${el.id}`;
  const cls = (el.getAttribute("class") || "").split(/\s+/).filter(Boolean);
  return cls.length ? `.${cls[0]}` : el.tagName;
}

function renderShapeList() {
  const svg = findSvg();
  if (!svg) return;
  shapeList.innerHTML = "";
  const walk = (parent, depth) => {
    for (const c of parent.children) {
      if (c.tagName === "defs" || c.tagName === "clipPath") continue;
      const isGroup = c.tagName === "g";
      if (!isGroup && !SHAPE_TAGS.has(c.tagName)) continue;
      const row = document.createElement("div");
      row.className = "shape" + (c === selShape ? " sel" : "");
      row.style.paddingLeft = `${6 + depth * 12}px`;
      row.innerHTML = `<span>${isGroup ? "▸ " : ""}${labelOf(c)}</span><span class="tag">${c.tagName}</span>`;
      row.onclick = () => selectShape(c);
      shapeList.appendChild(row);
      if (isGroup) walk(c, depth + 1);
    }
  };
  walk(svg, 0);
}

function selectShape(el) {
  selShape = el;
  renderShapeList();
  renderProps();
  drawSelBox();
}

function drawSelBox() {
  if (selBox) { selBox.remove(); selBox = null; }
  if (!selShape) return;
  const a = selShape.getBoundingClientRect();
  const p = preview.getBoundingClientRect();
  selBox = document.createElement("div");
  selBox.className = "selbox";
  selBox.style.left = `${a.left - p.left - 3}px`;
  selBox.style.top = `${a.top - p.top - 3}px`;
  selBox.style.width = `${a.width + 6}px`;
  selBox.style.height = `${a.height + 6}px`;
  preview.appendChild(selBox);
}

/* 哪些属性值得给个输入框 */
const ATTRS = {
  rect: [["x", "X"], ["y", "Y"], ["width", "宽"], ["height", "高"], ["rx", "圆角"]],
  circle: [["cx", "圆心 X"], ["cy", "圆心 Y"], ["r", "半径"]],
  ellipse: [["cx", "圆心 X"], ["cy", "圆心 Y"], ["rx", "横向半径"], ["ry", "纵向半径"]],
  line: [["x1", "起点 X"], ["y1", "起点 Y"], ["x2", "终点 X"], ["y2", "终点 Y"]],
  path: [],
  polygon: [],
  polyline: [],
};

function renderProps() {
  shapeProps.innerHTML = "";
  if (!selShape) {
    shapeProps.innerHTML = `<p class="hint">左边点一个形状。</p>`;
    return;
  }
  const title = document.createElement("p");
  title.className = "hint";
  title.innerHTML = `选中：<b>${labelOf(selShape)}</b>（${selShape.tagName}）`;
  shapeProps.appendChild(title);

  /* 名字：从 Figma 导进来最容易出问题的就是这一步。
     想让它动，组名必须是 rig / leg-left / foot-right / headgroup / torso / mouths 这些 */
  const idRow = document.createElement("div");
  idRow.className = "prop";
  idRow.innerHTML = `<label>名字</label>
    <input type="text" list="knownNames" value="${selShape.getAttribute("class")?.split(/\s+/)[0] || selShape.id || ""}" placeholder="leg-left">
    <datalist id="knownNames">${JOINT_NAMES.map((k) => `<option value="${k}">`).join("")}</datalist>`;
  idRow.querySelector("input").oninput = (e) => {
    const v = e.target.value.trim();
    // 统一写进 class：Figma 导出的 SVG 用的就是 class
    const rest = (selShape.getAttribute("class") || "").split(/\s+/).filter(Boolean).slice(1);
    selShape.setAttribute("class", [v, ...rest].filter(Boolean).join(" "));
    dirty = true;
    renderShapeList();
  };
  shapeProps.appendChild(idRow);

  for (const [name, label] of ATTRS[selShape.tagName] ?? []) {
    const v = selShape.getAttribute(name);
    if (v === null && name !== "rx") continue;
    shapeProps.appendChild(numRow(label, Number(v ?? 0), 0.1, (n) => {
      selShape.setAttribute(name, String(round2(n)));
      afterEdit();
    }));
  }
  // 颜色：只在是纯色的时候给
  for (const name of ["fill", "stroke"]) {
    const v = selShape.getAttribute(name) || "";
    if (/^#[0-9a-f]{3,8}$/i.test(v)) {
      const row = document.createElement("div");
      row.className = "prop";
      row.innerHTML = `<label>${name === "fill" ? "填充" : "描边"}</label><input type="color" value="${v.slice(0, 7)}">`;
      row.querySelector("input").oninput = (e) => {
        selShape.setAttribute(name, e.target.value);
        afterEdit();
      };
      shapeProps.appendChild(row);
    }
  }
}

function numRow(label, value, step, onChange) {
  const row = document.createElement("div");
  row.className = "prop";
  row.innerHTML = `<label>${label}</label><input type="number" step="${step}" value="${Math.round(value * 100) / 100}">`;
  row.querySelector("input").oninput = (e) => onChange(Number(e.target.value));
  return row;
}

const round2 = (n) => Math.round(n * 100) / 100;

function afterEdit() {
  dirty = true;
  requestAnimationFrame(() => {
    drawSelBox();
    renderProps();
  });
}

/* 在画布上点形状 = 选中，拖着走 = 挪位置 */
const MOVE = {
  rect: (el, dx, dy) => { el.setAttribute("x", el.getAttribute("x") * 1 + dx); el.setAttribute("y", el.getAttribute("y") * 1 + dy); },
  circle: (el, dx, dy) => { el.setAttribute("cx", el.getAttribute("cx") * 1 + dx); el.setAttribute("cy", el.getAttribute("cy") * 1 + dy); },
  ellipse: (el, dx, dy) => { el.setAttribute("cx", el.getAttribute("cx") * 1 + dx); el.setAttribute("cy", el.getAttribute("cy") * 1 + dy); },
};

function dragBy(el, dx, dy) {
  const tag = el.tagName;
  if (MOVE[tag]) return MOVE[tag](el, dx, dy);
  if (tag === "line") {
    for (const k of ["x1", "x2"]) el.setAttribute(k, el.getAttribute(k) * 1 + dx);
    for (const k of ["y1", "y2"]) el.setAttribute(k, el.getAttribute(k) * 1 + dy);
    return;
  }
  // path / polygon / polyline：用 transform 挪
  const tx = Number(el.dataset.tx || 0) + dx;
  const ty = Number(el.dataset.ty || 0) + dy;
  el.dataset.tx = round2(tx);
  el.dataset.ty = round2(ty);
  el.setAttribute("transform", `translate(${round2(tx)} ${round2(ty)})`);
}

let drag = null;
preview.addEventListener("pointerdown", (e) => {
  if (mode !== "shape") return;
  const hit = document.elementFromPoint(e.clientX, e.clientY);
  const el = hit?.closest?.("rect,circle,ellipse,path,line,polygon,polyline");
  if (!el || !findSvg()?.contains(el)) return;
  selectShape(el);
  drag = { el, x: e.clientX, y: e.clientY };
  preview.setPointerCapture(e.pointerId);
});
preview.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const svg = findSvg();
  const scale = svg.viewBox.baseVal.width / svg.getBoundingClientRect().width;
  dragBy(drag.el, (e.clientX - drag.x) * scale, (e.clientY - drag.y) * scale);
  drag.x = e.clientX;
  drag.y = e.clientY;
  dirty = true;
  drawSelBox();
});
preview.addEventListener("pointerup", (e) => {
  if (!drag) return;
  drag = null;
  try { preview.releasePointerCapture(e.pointerId); } catch {}
  renderProps();
});

/* 增删 */
function addShape(tag) {
  const svg = findSvg();
  if (!svg) return;
  const parent = selShape?.parentElement && selShape.parentElement.tagName === "g"
    ? selShape.parentElement
    : svg.querySelector(".rig") ?? svg;
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  if (tag === "rect") {
    el.setAttribute("x", 70); el.setAttribute("y", 70);
    el.setAttribute("width", 20); el.setAttribute("height", 20); el.setAttribute("rx", 3);
  } else {
    el.setAttribute("cx", 80); el.setAttribute("cy", 80); el.setAttribute("r", 10);
  }
  el.setAttribute("fill", "#8fb8a0");
  parent.appendChild(el);
  dirty = true;
  selectShape(el);
}

document.getElementById("addRect").onclick = () => addShape("rect");
document.getElementById("addCircle").onclick = () => addShape("circle");
document.getElementById("dupShape").onclick = () => {
  if (!selShape) return;
  const copy = selShape.cloneNode(true);
  dragBy(copy, 6, 6);
  selShape.parentElement.appendChild(copy);
  dirty = true;
  selectShape(copy);
};
document.getElementById("delShape").onclick = () => {
  if (!selShape) return;
  selShape.remove();
  dirty = true;
  selShape = null;
  renderShapeList();
  renderProps();
  drawSelBox();
};

document.getElementById("saveSvg").onclick = async () => {
  const svg = findSvg();
  if (!svg) return;
  const d = await fetch("/api/otto-svg", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ svg: svg.outerHTML }),
  }).then((r) => r.json());
  dirty = false;
  flash(d.ok ? "形象已保存，桌宠三秒内换上" : `没存上：${d.error}`);
};

document.getElementById("revertSvg").onclick = async () => {
  if (dirty && !confirm("撤掉这次没保存的改动？")) return;
  const svg = findSvg();
  if (svg) svg.outerHTML = await fetch("/api/otto-svg").then((r) => r.text());
  selShape = null;
  dirty = false;
  renderShapeList();
  renderProps();
  drawSelBox();
};

setInterval(() => { if (mode === "shape") drawSelBox(); }, 400);
