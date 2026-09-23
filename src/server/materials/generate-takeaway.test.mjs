import assert from 'node:assert/strict';
import test from 'node:test';
import { createAssistantMessageEventStream, getCurrentSystemPrompt, getCurrentTools } from '@earendil-works/pi-ai';
import { createJiti } from 'jiti';
const { generateTakeaway } = await createJiti(import.meta.url).import('./generate-takeaway.ts');

function sourceFixture(reply = '消息链路仍需验证') {
  const contexts = [];
  const source = {
    state: {
      systemPrompt: 'original private instructions', model: { provider: 'test', id: 'test-model' },
      thinkingLevel: 'high', tools: [{ name: 'write', execute: () => assert.fail('must not execute tools') }],
      messages: [{ role: 'user', content: 'unrelated history', timestamp: 1 }],
    },
    convertToLlm: messages => messages,
    transformContext: () => assert.fail('must not run the conversation context transform'),
    streamFunction: (_model, context) => {
      contexts.push(structuredClone(context));
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => stream.push({ type: 'done', reason: 'stop', message: {
        role: 'assistant', content: [{ type: 'text', text: reply }], api: 'test', provider: 'test', model: 'test-model',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: 'stop', timestamp: Date.now(),
      } }));
      return stream;
    },
  };
  return { source, contexts };
}

test('takeaway uses only the chosen turn with no tools and leaves the source agent untouched', async () => {
  const { source, contexts } = sourceFixture();
  const messages = structuredClone(source.state.messages);
  const tools = source.state.tools;
  assert.equal(await generateTakeaway(source, '设备为何离线？', '网关在线，消息链路仍需验证。'), '消息链路仍需验证');
  assert.equal(contexts.length, 1);
  assert.deepEqual(contexts[0].messages.map(message => message.role), ['system', 'user']);
  assert.match(getCurrentSystemPrompt(contexts[0].messages), /你为思考画布提炼一轮讨论/);
  assert.deepEqual(JSON.parse(contexts[0].messages[1].content[0].text), { question: '设备为何离线？', answer: '网关在线，消息链路仍需验证。' });
  assert.equal(getCurrentTools(contexts[0].messages).length, 0);
  assert.doesNotMatch(JSON.stringify(contexts), /unrelated history|original private instructions/);
  assert.deepEqual(source.state.messages, messages);
  assert.equal(source.state.tools, tools);
});

test('a cancelled request does not call the model', async () => {
  const { source, contexts } = sourceFixture();
  await assert.rejects(generateTakeaway(source, 'question', 'answer', AbortSignal.abort()), /取消/);
  assert.equal(contexts.length, 0);
});
