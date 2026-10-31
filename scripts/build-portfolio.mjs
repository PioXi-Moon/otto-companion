/**
 * 作品集的构建脚本。
 *
 *   node scripts/build-portfolio.mjs             出形象 + 打印 PDF
 *   node scripts/build-portfolio.mjs --svg-only  只出形象
 *   node scripts/build-portfolio.mjs --pdf-only  只打印 PDF
 *
 * 作品集里的形象不是截图：ui/otto.svg 是骨架，ui/pet.css 上色，
 * ui/actions.js 里的姿势是十几个数字。所以每一张形象都是从产品本身的
 * 同一份数据烘出来的，改了配色或动作之后重跑一次就行，也不会糊。
 *
 * 打印用本机的 Edge/Chrome（和 scripts/make-icon.mjs 同一套找法），不出网。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { spawnSync } from "node:child_process";
import { ACTIONS } from "../ui/actions.js";
import { RIG_PARAMS } from "../ui/rig.js";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const DOCS = path.join(ROOT, "docs");
const ASSETS = path.join(DOCS, "portfolio");
const HTML = path.join(DOCS, "作品集-Otto.html");
const PDF = path.join(DOCS, "作品集-Otto.pdf");

const argv = process.argv.slice(2);
const svgOnly = argv.includes("--svg-only");
const pdfOnly = argv.includes("--pdf-only");

/* 画布的裁切：把 2..178 的可视范围留足上下余量，
   这样 lift -22 的"跳跃庆祝"和 lift 18 的"打盹"都不会被切掉，也落在同一条地平线上。
   整页一张（hero）单给一个更紧的框，免得四周空太多。 */
const HERO = { action: "idle", viewBox: "26 -10 108 198", file: "otto-hero.svg" };
const SHEET_VIEWBOX = "22 -26 116 230";
const SHEET = [
  ["happy", "开心"],
  ["lean_in", "好奇"],
  ["sleepy", "困倦"],
  ["proud", "得意"],
  ["peek", "探头观察"],
  ["shy", "害羞"],
  ["celebrate", "跳跃庆祝"],
  ["wronged", "委屈"],
];

const css = fs.readFileSync(path.join(ROOT, "ui", "pet.css"), "utf8");
const svgRaw = fs.readFileSync(path.join(ROOT, "ui", "otto.svg"), "utf8");
const inner = svgRaw.slice(svgRaw.indexOf(">") + 1, svgRaw.lastIndexOf("</svg>"));

/* 静态帧：动画和过渡全关掉，否则烘出来的样子取决于抓拍到的那一帧 */
const STATIC_CSS = `
.breathe, .rig, .leg, .foot, .headgroup, .glint, .led-dot, .led-halo { animation: none !important; transition: none !important; }
`;

/** 把 actions.js 里的姿势翻成 CSS 变量 + class，和 ui/rig.js 的 applyPose 同一套规则 */
function poseOf(name) {
  const a = ACTIONS[name];
  if (!a) throw new Error("actions.js 里没有这个动作：" + name);
  const vars = [];
  const cls = [];
  for (const p of RIG_PARAMS) {
    const v = a.pose[p.key];
    const n = typeof v === "number" ? v : p.def;
    if (p.discrete) {
      cls.push(p.discrete[Math.max(0, Math.min(p.discrete.length - 1, Math.round(n)))]);
    } else {
      vars.push(`--${p.key}:${n}`);
    }
  }
  return { style: vars.join(";"), cls: cls.join(" "), blush: !!a.blush };
}

function bake(action, viewBox) {
  const { style, cls, blush } = poseOf(action);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">
<style><![CDATA[${css}${STATIC_CSS}]]></style>
<ellipse cx="80" cy="180.5" rx="33" ry="5.5" fill="rgba(30,54,74,.15)"/>
<g class="otto ${cls}${blush ? " blush" : ""}" style="${style}">
<g class="breathe">${inner}</g>
</g>
</svg>
`;
}

function writeAssets() {
  fs.mkdirSync(ASSETS, { recursive: true });
  const made = [];
  const hero = path.join(ASSETS, HERO.file);
  fs.writeFileSync(hero, bake(HERO.action, HERO.viewBox));
  made.push(HERO.file);
  for (const [action] of SHEET) {
    const file = `pose-${action.replace(/_/g, "-")}.svg`;
    fs.writeFileSync(path.join(ASSETS, file), bake(action, SHEET_VIEWBOX));
    made.push(file);
  }
  console.log("形象：" + made.join(" "));
}

const CANDIDATES = [
  process.env.OTTO_BROWSER,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean);

function printPdf() {
  const browser = CANDIDATES.find((p) => fs.existsSync(p));
  if (!browser) {
    console.error("找不到 Edge 或 Chrome，打不了 PDF。用 OTTO_BROWSER=<路径> 指定。");
    process.exit(1);
  }
  if (!fs.existsSync(HTML)) {
    console.error("找不到 " + HTML);
    process.exit(1);
  }

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "otto-portfolio-"));
  const base = [
    "--no-sandbox", "--disable-gpu", "--no-first-run", "--disable-extensions",
    "--user-data-dir=" + profile,
    "--virtual-time-budget=8000",
    "--no-pdf-header-footer",
    "--print-to-pdf=" + PDF,
    "file:///" + HTML.replace(/\\/g, "/"),
  ];

  /* 新版 Chromium 去掉了 old headless，两种都试一遍 */
  for (const mode of ["--headless=old", "--headless=new"]) {
    spawnSync(browser, [mode, ...base], { encoding: "utf8", timeout: 180000 });
    if (fs.existsSync(PDF) && fs.statSync(PDF).size > 20000) break;
  }

  if (!fs.existsSync(PDF) || fs.statSync(PDF).size < 20000) {
    console.error("PDF 没打出来。手动确认一下 Edge 能不能打开 " + HTML);
    process.exit(1);
  }
  console.log("PDF：" + PDF + "  " + fs.statSync(PDF).size + " 字节");
}

if (!pdfOnly) writeAssets();
if (!svgOnly) printPdf();
