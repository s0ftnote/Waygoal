import { test } from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
const jiti = createJiti(import.meta.url, { alias: { "@": fileURLToPath(new URL("../../", import.meta.url)) } });
const map = await jiti.import("./map.ts");
const { mapSections, sourceLinks } = map;

const MAP = `# 给朋友办一场小型放映会

## Destination

找到一个让朋友愿意留下来聊几句的放映会方案。

## Decisions so far

- [这部短片适合怎样的开场？](issues/02-film.md) — 开场简短交代片名。
- 场地就用客厅，见 [客厅平面图](notes/客厅.md)。

## Not yet specified

吃的还没定。

## Out of scope

订场地、发邀请。
`;

test("地图按来源自己的小节和原话拆开，不另生成摘要", () => {
  const sections = mapSections(MAP);
  assert.deepEqual(sections.map(s => s.heading), ["Destination", "Decisions so far", "Not yet specified", "Out of scope"]);
  assert.equal(sections[0].body, "找到一个让朋友愿意留下来聊几句的放映会方案。");
  assert.equal(sections[2].body, "吃的还没定。", "未明确方向照抄来源，不改写");
  assert.ok(sections[1].body.includes("[这部短片适合怎样的开场？](issues/02-film.md)"), "小节正文保留原格式");
});

test("标题之前的话属于地图本身，不硬塞一个小节标题", () => {
  const sections = mapSections("# 放映会\n\n先记一句。\n\n## Destination\n\n定下方案。\n");
  assert.deepEqual(sections.map(s => s.heading), ["Destination"]);
  assert.equal(mapSections("# 放映会\n\n就一句话。\n").length, 0, "没有小节就没有小节，不造一个出来");
});

test("只有来源写明的链接算去处，正文里提到的名字不算", () => {
  const links = sourceLinks(MAP);
  assert.deepEqual(links.map(l => l.target), ["issues/02-film.md", "notes/客厅.md"]);
  assert.deepEqual(links.map(l => l.label), ["这部短片适合怎样的开场？", "客厅平面图"]);
  assert.deepEqual(sourceLinks("## Answer\n\n就用客厅，理由写在 issues/01-room.md 里。\n"), [],
    "正文里念到一个文件名不是来源给出的去处");
});

test("同一个去处只列一次，标签用第一次写的那个", () => {
  const links = sourceLinks("- [开场](issues/02-film.md)\n- [再说一次](issues/02-film.md)\n");
  assert.deepEqual(links.map(l => [l.label, l.target]), [["开场", "issues/02-film.md"]]);
});

test("外部地址照原样留着，不去取它", () => {
  const links = sourceLinks("- [片子的介绍](https://example.com/film) 和 [本地记录](notes/a.md)\n");
  assert.deepEqual(links.map(l => [l.target, l.external]), [["https://example.com/film", true], ["notes/a.md", false]]);
});

test("锚点和空目标不算去处", () => {
  assert.deepEqual(sourceLinks("[回到上面](#top) [空的]() [真的](a.md)\n").map(l => l.target), ["a.md"]);
});

test("`##` 之前的话是这份文件自己的开头，照样要显示，不硬塞进某个小节", () => {
  assert.equal(map.mapLead("# 放映会\n\n先把范围说清楚。\n\n## Destination\n\n定下方案。\n"), "# 放映会\n\n先把范围说清楚。");
  assert.equal(map.mapLead("## Destination\n\n定下方案。\n"), "", "一上来就是小节，就没有开头这回事");
  assert.equal(map.mapLead("只有一段话，没有小节。\n"), "只有一段话，没有小节。", "没有小节时，整份文件都是开头");
});
