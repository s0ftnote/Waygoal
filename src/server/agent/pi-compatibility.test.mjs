import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createJiti } from "jiti";
import { startFakeModel, modelsJson } from "../../../tests/e2e/fake-model.mjs";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { AgentSessionWrapper, startRpcSession } = await jiti.import("./rpc-manager.ts");
const { createSubagentController } = await jiti.import("./subagent-runtime.ts");
const { createRecordedFork } = await jiti.import("../sessions/fork-service.ts");
const { buildSessionContext } = await jiti.import("../sessions/session-reader.ts");
const { projectTurns } = await jiti.import("../../features/sessions/turns.ts");
const { toClientAgentEvent } = await jiti.import("../../shared/agent-event-wire.ts");

test("Pi 0.87 preserves exact prompts, raw history and fork context through reload and reopen", { timeout: 30_000 }, async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "waygoal-pi-compat-"));
  const cwd = join(agentDir, "workspace");
  mkdirSync(cwd);
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const model = await startFakeModel();
  const wrappers = [];
  const wire = [];
  const open = async (id, file = "") => {
    const { session } = await startRpcSession(id, file, cwd, { toolNames: [], persistPreferences: false });
    wrappers.push(session);
    session.onEvent(event => { const projected = toClientAgentEvent(event); if (projected) wire.push(projected); });
    return session;
  };
  const prompt = async (session, text) => {
    await session.send({ type: "prompt", message: text });
    const deadline = Date.now() + 10_000;
    while (session.isRunning()) {
      assert.ok(Date.now() < deadline, "fake-model prompt must finish");
      await delay(10);
    }
    assert.match(session.inner.getLastAssistantText(), /E2E reply/);
  };
  const requestPrompt = () => model.requests.at(-1).body.messages.filter(m => m.role === "system").map(m => m.content).join("\n");
  try {
    writeFileSync(join(agentDir, "models.json"), modelsJson(model.baseUrl));
    writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "e2e", defaultModel: "e2e-model" }));
    writeFileSync(join(cwd, "AGENTS.md"), "EXACT_CONTEXT_ONE");
    const first = await open("fresh");
    await prompt(first, "first question");
    assert.match(requestPrompt(), /EXACT_CONTEXT_ONE/);
    assert.doesNotMatch(requestPrompt(), /expert coding assistant/i);
    assert.deepEqual(model.requests.at(-1).body.tools ?? [], []);
    const parentId = first.sessionId, parentFile = first.sessionFile;
    const manager = first.inner.sessionManager;
    const firstAnswer = manager.getEntries().find(e => e.type === "message" && e.message.role === "assistant");
    assert.ok(manager.getEntries().some(e => e.type === "message" && e.message.role === "system"));
    writeFileSync(join(cwd, "AGENTS.md"), "EXACT_CONTEXT_TWO");
    await first.send({ type: "reload" });
    await prompt(first, "second question");
    assert.match(requestPrompt(), /EXACT_CONTEXT_TWO/);
    assert.doesNotMatch(requestPrompt(), /EXACT_CONTEXT_ONE/);
    const entries = manager.getEntries();
    const context = buildSessionContext(entries);
    assert.deepEqual(context.messages.map(m => m.role), ["user", "assistant", "user", "assistant"]);
    const turns = projectTurns(parentId, entries, manager.getLeafId());
    assert.equal(turns.turns.length, 2, "system records must not create canvas cards");
    assert.ok(wire.every(e => e.message?.role !== "system"));
    const sourceLeaf = manager.getLeafId();
    const fork = createRecordedFork(manager, { selectedEntryId: firstAnswer.id, mode: "after", operationId: "pi-087-after-answer" }, agentDir);
    assert.equal(manager.getLeafId(), sourceLeaf);
    await first.shutdown();
    const child = await open(fork.newSessionId, fork.file);
    await prompt(child, "fork question");
    const childRequest = JSON.stringify(model.requests.at(-1).body.messages);
    assert.match(childRequest, /first question/);
    assert.doesNotMatch(childRequest, /second question/);
    assert.match(requestPrompt(), /EXACT_CONTEXT_TWO/);
    await child.shutdown();
    const reopened = await open(parentId, parentFile);
    await prompt(reopened, "third question");
    assert.match(JSON.stringify(model.requests.at(-1).body.messages), /second question/);
    assert.doesNotMatch(JSON.stringify(model.requests.at(-1).body.messages), /fork question/);
    // Context edits change future model input but leave the user's raw history intact.
    const oldAnswer = reopened.inner.sessionManager.getEntry(firstAnswer.id);
    reopened.inner.sessionManager.appendContextEdit(oldAnswer.id, null);
    reopened.inner.refreshContext();
    await prompt(reopened, "after context edit");
    const visible = buildSessionContext(reopened.inner.sessionManager.getEntries());
    assert.ok(visible.entryIds.includes(oldAnswer.id));
    assert.doesNotMatch(JSON.stringify(model.requests.at(-1).body.messages), /E2E reply: first question/);
    // Exercise the actual zero-tool child creation and its persisted resource snapshot.
    mkdirSync(join(agentDir, "agents"));
    writeFileSync(join(agentDir, "agents", "compat-child.md"), "---\ntools: none\n---\nEXACT_CHILD_PROMPT");
    const controller = createSubagentController({
      getSession: id => wrappers.find(w => w.sessionId === id && w.isAlive()),
      registerSession: (inner, options) => {
        const wrapper = new AgentSessionWrapper(inner, { ...options, exactSystemPrompt: () => options.exactSystemPrompt });
        wrappers.push(wrapper);
        wrapper.start();
      },
      reopenSession: async (id, file) => open(id, file),
      resolveSessionPath: async () => null,
      invalidateSessionList: () => {},
      isBuiltInSubagentsEnabled: () => true,
    });
    const execution = await controller.extensionRuntime.start({
      parentContext: { sessionManager: reopened.inner.sessionManager },
      parentToolCallId: "fake-child-call", profile: "compat-child", task: "child task", description: "compatibility test",
    });
    assert.equal((await execution.completion).status, "completed");
    assert.equal(requestPrompt(), "EXACT_CHILD_PROMPT");
    assert.deepEqual(model.requests.at(-1).body.tools ?? [], []);
    await wrappers.find(w => w.sessionId === execution.run.sessionId).shutdown();
    const resumedChild = await open(execution.run.sessionId, execution.run.sessionPath);
    await prompt(resumedChild, "resume child");
    assert.equal(requestPrompt(), "EXACT_CHILD_PROMPT");

  } finally {
    for (const wrapper of wrappers) await wrapper.shutdown();
    await model.close();
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(agentDir, { recursive: true, force: true });
  }
});
