import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

// Run after the first live-model smoke test has populated the playground.
const base = process.env.BEACON_TEST_URL || "http://127.0.0.1:30142";
const output = resolve("../../docs/research/prototype-evidence");
mkdirSync(output, { recursive: true });
const snapshot = await (await fetch(`${base}/api/beacon`)).json();
const map = snapshot.maps[0];
const ticket = map.tickets.find(t => t.number === "01");
const research = map.tickets.find(t => t.number === "02");
assert(ticket.binding, "first run needs a real Pi conversation");
assert.equal(research.status, "resolved");
assert(map.tickets.some(t => t.number === "04"), "new ticket created by the agent");
assert.equal(map.warnings.length, 0);
const countUsers = path => readFileSync(path, "utf8").trim().split("\n").map(JSON.parse).filter(e => e.message?.role === "user").length;
const before = countUsers(ticket.binding.path);
const request = t => fetch(`${base}/api/beacon`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "open", cwd: snapshot.cwd, mapId: map.id, ticketId: t.id }) });
const opened = await Promise.all([request(ticket), request(ticket)]).then(rs => Promise.all(rs.map(r => r.json())));
assert(opened.every(r => r.session.id === ticket.binding.id && r.reused));
assert.equal(countUsers(ticket.binding.path), before, "no duplicate startup prompt");
assert.equal((await request(map.tickets.find(t => t.number === "03"))).status, 400);

const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = []; page.on("pageerror", error => errors.push(error.message));
try {
  await page.goto(`${base}/beacon`);
  await page.locator('[data-ticket="04"]').waitFor();
  assert.equal(await page.locator('[data-ticket]').count(), 4);
  await page.screenshot({ path: resolve(output, "map.png") });
  const card = page.locator('[data-ticket="01"]');
  const box = await card.boundingBox();
  await page.mouse.move(box.x + 30, box.y + 30); await page.mouse.down();
  await page.mouse.move(box.x + 75, box.y + 50, { steps: 8 }); await page.mouse.up();
  const stored = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("beacon:positions:")).map(k => localStorage.getItem(k)));
  assert(stored.some(p => p.includes("01-feeling")));
  await page.reload(); await card.waitFor();
  const moved = await card.boundingBox(); assert(moved.x > box.x + 25);
  await card.click();
  await page.getByText("离开时的感受", { exact: false }).last().waitFor();
  await page.locator('.beacon-conversation').getByText(/gpt[- ]5\.6[- ]luna/i).last().waitFor();
  await page.screenshot({ path: resolve(output, "conversation.png") });
  await page.getByRole("button", { name: "关闭对话" }).click();
  await page.locator('[data-ticket="03"]').click();
  await page.getByRole("heading", { name: "先找到这些答案" }).waitFor();
  await page.getByRole("button", { name: "阅读原始票据" }).click();
  await page.getByRole("button", { name: "关闭对话" }).waitFor();
  assert.equal(errors.length, 0, errors.join("\n"));
  const report = { passed: true, at: new Date().toISOString(), sessionId: ticket.binding.id, researchSessionId: research.binding.id, userMessagesBefore: before, userMessagesAfter: countUsers(ticket.binding.path), checks: ["four tracker nodes visible", "real Luna conversation rendered", "concurrent clicks reuse session", "no repeated skill prompt", "blocked node rejects new session", "drag position survives reload", "ticket file viewer opens", "no browser page errors"] };
  writeFileSync(resolve(output, "browser-checks.json"), JSON.stringify(report, null, 2));
  console.log(report);
} finally { await browser.close(); }
