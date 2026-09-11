// THROWAWAY PROTOTYPE: isolated Pi session handback experiment, not a Wayfinder run.
// All people, prices and venue facts below are fictional fixtures. No tools or bookings.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, getAgentDir } from '@earendil-works/pi-coding-agent';

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(here, 'evidence.json');
const runtime = await ModelRuntime.create();
const model = runtime.getModel('openai-codex', 'gpt-5.6-luna');
if (!model) throw new Error('Required Luna model unavailable');
const settings = SettingsManager.inMemory({});
const loader = new DefaultResourceLoader({ cwd: here, agentDir: getAgentDir(), settingsManager: settings, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
  systemPrompt: '这是一个虚构放映会的会话交接实验。所有用户条件和场地资料都是测试夹具，不代表真实用户意愿或真实场地。用中文简洁回复，最多180字。只根据给定事实推理；未知就说未知。不能声称用户已接受建议或已执行预约。' });
await loader.reload();
const sessions = [];
async function make(entries) {
  const manager = SessionManager.inMemory(here, undefined, entries ? structuredClone(entries) : undefined);
  const { session } = await createAgentSession({ cwd: here, modelRuntime: runtime, model, thinkingLevel: 'low', tools: [], resourceLoader: loader, settingsManager: settings, sessionManager: manager });
  sessions.push(session);
  return { session, manager };
}
async function ask(target, prompt) {
  await target.session.prompt(prompt);
  const msg = target.session.state.messages.filter(m => m.role === 'assistant').at(-1);
  if (!msg || msg.stopReason === 'error' || msg.stopReason === 'aborted') throw new Error(msg?.errorMessage || 'Model run did not finish');
  const text = msg.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
  const result = { prompt, text, model: msg.model, provider: msg.provider, sessionId: target.manager.getSessionId(), entryId: target.manager.getLeafId() };
  console.log(JSON.stringify(result));
  return result;
}
const evidence = { at: new Date().toISOString(), fixture: true, model: 'openai-codex/gpt-5.6-luna', scope: 'Real Pi SDK model calls with in-memory sessions; no Wayfinder, tracker, external research or human acceptance is tested.', runs: {} };
try {
  const parent = await make();
  evidence.runs.parent = await ask(parent, '测试夹具：8人放映会，总预算不超过1000元，饮料固定300元。候选：小画室场租400元，没有投影仪；咖啡馆场租550元，有投影仪。放映需要投影、幕布、音箱和遮光。我们正在比较两个场地，但设备条件和额外费用尚未核对。请说清现在卡在哪里，留下一句设备核对后回来接着解决的问题，不要现在替我决定。');
  const startingEntries = structuredClone(parent.manager.getEntries());
  const baseline = await make(startingEntries);
  const changed = await make(startingEntries);
  const child = await make();
  evidence.anchor = { parentSessionId: parent.manager.getSessionId(), sourceEntryId: parent.manager.getLeafId(), childSessionId: child.manager.getSessionId(), returnQuestion: '设备核对后，哪个场地满足放映条件且总价不超过预算？', constraints: { people: 8, budget: 1000, drinks: 300 } };
  evidence.runs.child = await ask(child, '测试夹具：你是独立的设备核对子会话，返回主讨论的问题是选场地。只报告设备、遮光、费用的事实和限制，不替主讨论做选择。资料：小画室可完全遮光；租用设备套装200元，含投影仪、幕布、音箱。咖啡馆的投影仪、幕布、音箱免费，但活动时段无法遮光。此次放映需要遮光。请给出能带回主讨论的简短核对结论。');
  evidence.runs.baseline = await ask(baseline, '设备分支已经聊完了。回到刚才的问题，继续比较两个场地。');
  const handback = { ...evidence.anchor, sourceResultEntryId: child.manager.getLeafId(), facts: evidence.runs.child.text };
  evidence.handback = handback;
  evidence.runs.returned = await ask(parent, `系统交接资料（子会话报告，不是用户的选择）：\n${JSON.stringify(handback)}\n请接着此前的场地比较，结合主会话已有约束说明可行性与理由。不要重新询问已知人数或预算，不要声称用户已选择。`);
  evidence.runs.changed = await ask(changed, `测试夹具更新：我把总预算改成800元，饮料仍为300元。\n系统收到此前设备分支的交接资料：${JSON.stringify(handback)}\n请按本会话最新约束继续场地比较。报告建议，不替用户接受。`);
  evidence.sessionContinuity = { parentBefore: evidence.runs.parent.sessionId, parentAfter: evidence.runs.returned.sessionId, same: evidence.runs.parent.sessionId === evidence.runs.returned.sessionId };
  evidence.entries = { parent: parent.manager.getEntries(), child: child.manager.getEntries(), baseline: baseline.manager.getEntries(), changed: changed.manager.getEntries() };
  mkdirSync(here, { recursive: true });
  writeFileSync(output, JSON.stringify(evidence, null, 2));
  const pagePath = resolve(here, 'index.html');
  const { entries: _entries, ...replay } = evidence;
  const payload = JSON.stringify(replay).replaceAll('<', '\\u003c');
  writeFileSync(pagePath, readFileSync(pagePath, 'utf8').replace(/(<script id="evidence" type="application\/json">)[\s\S]*?(<\/script>)/, (_, start, end) => start + payload + end));
  console.log(`Saved ${output}`);
} finally {
  for (const session of sessions) session.dispose();
}
