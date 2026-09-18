import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { createJiti } from "jiti";

// Node has no stylesheet loader; the browser owns this side-effect import.
const require = createRequire(import.meta.url);
require.extensions[".css"] = () => {};
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { WaygoalMaterialTray } = jiti("./MaterialTray.tsx");
const source = await readFile(new URL("./MaterialTray.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("./MaterialTray.css", import.meta.url), "utf8");
const material = {
  sessionId: "s", turnId: "t", scope: "excerpt", targetLeafId: null,
  capturedAt: "2026-09-17T09:00:00Z",
  parts: [{ entryId: "e", role: "assistant", text: "原文 <不可执行> 😀" }],
};
const render = (props = {}) => renderToStaticMarkup(React.createElement(WaygoalMaterialTray, {
  materials: [material], arrival: null, onRemove: () => {}, ...props,
}));

test("renders the boundary, counts, readable source and snapshot in native details/pre", () => {
  const html = render({ sourceLabels: { "s:t": { title: "验证方案", turnLabel: "第 3 轮 · 如何验证？" } }, onLocate: () => {} });
  assert.match(html, /aria-label="下一轮引用材料"/);
  for (const text of ["本次额外带入", "不代表完整 Pi 上下文", "字符量不是 token 数", "1 份", "11 个文本字符", "验证方案", "第 3 轮 · 如何验证？", "回答摘录", "展开原文", "查看来源", "取得时间："]) assert.ok(html.includes(text), text);
  assert.match(html, /<details><summary>/);
  assert.match(html, /回答摘录 · 11 字 · 1 条文字/);
  assert.match(html, /<pre>原文 &lt;不可执行&gt; 😀<\/pre>/);
  assert.match(html, /<time dateTime="2026-09-17T09:00:00Z">/);
  assert.match(html, /aria-label="移除材料 1"/);
  assert.doesNotMatch(html, /<summary>[\s\S]*?<button[\s\S]*?<\/summary>/);
});

test("missing labels and locator do not pretend to have a source title or active navigation", () => {
  const html = render();
  assert.match(html, /会话名称未知 · 来源 ID：s/);
  assert.match(html, /轮次 \/ 问题未知 · 来源 ID：t/);
  assert.match(html, /class="waygoal-material-locate" disabled=""/);
  assert.match(html, /暂无法定位来源；仍可展开已保存的原文/);
  assert.doesNotMatch(render({ materials: [] }), /下一轮引用材料/);
});

test("locating is a separate read-only callback; exits remain inert and feedback stays event-scoped", () => {
  assert.match(source, /onLocate=\{\(\) => onLocate\?\.\(material\)\}/);
  assert.match(source, /className="waygoal-material-row waygoal-material-exit"[^>]*inert aria-hidden="true"/);
  assert.match(source, /revealedArrivals\.has\(arrival\)/);
  assert.match(source, /if \(!arrival\?\.allowed\(\)/);
  assert.match(source, /row\.contains\(document\.activeElement\)/);
  assert.match(source, /focus\(\{ preventScroll: true \}\)/);
});

test("tray owns bounded scrolling, wrapping, touch targets and keyboard focus styles", () => {
  assert.match(source, /import "\.\/MaterialTray\.css"/);
  for (const rule of [/max-height: min\(/, /overflow: auto/, /min-height: 44px/, /min-width: 44px/, /overflow-wrap: anywhere/, /:focus-visible/, /outline: 2px solid var\(--wg-ink\)/]) assert.match(css, rule);
});
