import test from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
const { zoomTier, validTakeaway, takeawayChanged, cleanTakeaway } = await jiti.import('./takeaways.ts');

test('zoom boundaries retain the current reading level without flickering', () => {
  assert.equal(zoomTier(.7, 'detail'), 'map');
  assert.equal(zoomTier(.78, 'map'), 'map');
  assert.equal(zoomTier(.78, 'detail'), 'detail');
  assert.equal(zoomTier(.3, 'map'), 'overview');
  assert.equal(zoomTier(.36, 'overview'), 'overview');
  assert.equal(zoomTier(.36, 'map'), 'map');
  assert.equal(zoomTier(1, 'overview'), 'detail');
});
test('generated annotation remains a draft and changed sources invalidate its confirmation', () => {
  const draft = { text: '需要再验证消息链路', status: 'draft', fingerprint: 'original' };
  assert.equal(validTakeaway(draft), true);
  assert.equal(validTakeaway({ ...draft, status: 'decided' }), false);
  assert.equal(validTakeaway({ ...draft, text: '长'.repeat(81) }), false);
  assert.equal(takeawayChanged({ ...draft, status: 'confirmed' }, 'updated'), true);
  assert.equal(takeawayChanged(draft, 'original'), false);
  assert.equal(takeawayChanged(draft), true);
});
test('takeaway cleanup preserves uncertainty and rejects unusable replies', () => {
  assert.equal(cleanTakeaway('所得：“尚不能排除设备故障”'), '尚不能排除设备故障');
  assert.equal(cleanTakeaway('```text\n需要补充证据\n```'), '需要补充证据');
  assert.throws(() => cleanTakeaway('---'), /可用/);
});
