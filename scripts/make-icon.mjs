/**
 * 生成 Otto 的图标：从 ui/otto.svg（骨架）+ ui/pet.css（上色）出一张自包含的
 * otto-icon.svg，再渲染成多尺寸的 otto.ico。
 *
 * 换配色、改形象之后跑一次 pnpm icon 就行。
 * 需要本机有 Edge 或 Chrome（只用来渲染矢量图，不上网）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const SIZES = [16, 24, 32, 40, 48, 64];

const CANDIDATES = [
  process.env.OTTO_BROWSER,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean);

const browser = CANDIDATES.find((p) => fs.existsSync(p));
if (!browser) {
  console.error("找不到 Edge 或 Chrome。装一个，或者用 OTTO_BROWSER=<路径> 指定。");
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "otto-icon-"));
const profile = path.join(tmp, "profile");
const fileUrl = (p) => "file:///" + p.replace(/\\/g, "/");

function run(args) {
  return spawnSync(browser, args, { encoding: "utf8", timeout: 60000 });
}

function shot(page, size, out) {
  run([
    "--headless=old", "--no-sandbox", "--disable-gpu", "--no-first-run",
    "--default-background-color=00000000",
    "--user-data-dir=" + profile,
    "--window-size=" + size + "," + size,
    "--virtual-time-budget=1500",
    "--screenshot=" + out,
    fileUrl(page),
  ]);
  return fs.existsSync(out);
}

const css = fs.readFileSync(path.join(ROOT, "ui", "pet.css"), "utf8");
const raw = fs.readFileSync(path.join(ROOT, "ui", "otto.svg"), "utf8");
const inner = raw.slice(raw.indexOf(">") + 1, raw.lastIndexOf("</svg>"));

// 先量一次骨架的真实包围盒，图标才摆得正
const measure =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 190">' +
  "<style><![CDATA[" + css + "]]></style>" +
  inner +
  "<script><![CDATA[" +
  "window.addEventListener('load', function () {" +
  "  var b = document.querySelector('g.rig').getBBox();" +
  "  document.documentElement.setAttribute('data-bbox', [b.x, b.y, b.width, b.height].join(','));" +
  "});" +
  "]]></script>" +
  "</svg>";
const measureFile = path.join(tmp, "measure.svg");
fs.writeFileSync(measureFile, measure);

const dumped = run([
  "--headless=old", "--no-sandbox", "--disable-gpu", "--no-first-run",
  "--user-data-dir=" + profile,
  "--virtual-time-budget=2500", "--dump-dom",
  fileUrl(measureFile),
]);
const hit = (dumped.stdout || "").match(/data-bbox="([^"]+)"/);
if (!hit) {
  console.error("量不到骨架的包围盒，图标生成中止。");
  process.exit(1);
}
const [bx, by, bw, bh] = hit[1].split(",").map(Number);
const scale = Math.min((160 * 0.84) / bw, (160 * 0.84) / bh);
const dx = -(bx + bw / 2);
const dy = -(by + bh / 2);

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">' +
  "<style><![CDATA[" + css + "]]></style>" +
  "<defs>" +
  '<linearGradient id="tileGrad" x1="0" y1="0" x2="0.7" y2="1">' +
  '<stop offset="0" stop-color="#2a5170"/><stop offset="1" stop-color="#12283b"/>' +
  "</linearGradient>" +
  "</defs>" +
  '<rect width="160" height="160" rx="36" fill="url(#tileGrad)"/>' +
  '<g transform="translate(80 80) scale(' + scale.toFixed(4) + ") translate(" + dx.toFixed(2) + " " + dy.toFixed(2) + ')">' +
  inner +
  "</g>" +
  "</svg>";

const svgFile = path.join(ROOT, "otto-icon.svg");
fs.writeFileSync(svgFile, svg);

const pngs = [];
for (const size of SIZES) {
  const out = path.join(tmp, size + ".png");
  if (!shot(svgFile, size, out)) {
    console.error("渲染失败：" + size);
    process.exit(1);
  }
  pngs.push({ size, buf: fs.readFileSync(out) });
}

const dir = Buffer.alloc(6);
dir.writeUInt16LE(0, 0);
dir.writeUInt16LE(1, 2);
dir.writeUInt16LE(pngs.length, 4);
let offset = 6 + 16 * pngs.length;
const entries = pngs.map((p) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(p.size, 0);
  e.writeUInt8(p.size, 1);
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(p.buf.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += p.buf.length;
  return e;
});
fs.writeFileSync(
  path.join(ROOT, "otto.ico"),
  Buffer.concat([dir, ...entries, ...pngs.map((p) => p.buf)])
);
fs.rmSync(tmp, { recursive: true, force: true });
console.log("写好 otto-icon.svg 和 otto.ico：" + SIZES.join("/") + "，用 " + path.basename(browser));