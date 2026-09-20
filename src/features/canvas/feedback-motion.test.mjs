import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coherentShifts, feedbackIntent, stopFeedback } from './feedback-motion.ts';

test('a connected cluster travels with its lines only when every endpoint moves together', () => {
  const shifts = new Map(['a', 'b', 'c'].map(key => [key, { x: 12, y: -3 }]));
  assert.deepEqual(coherentShifts(shifts, [['a', 'b'], ['b', 'c']]), shifts);
  assert.deepEqual(coherentShifts(shifts, [['a', 'b'], ['b', 'c'], ['c', 'fixed']]), new Map());
  assert.equal(shifts.size, 3, 'the layout input is never mutated');
});

test('different endpoint movements settle the entire cluster, including upstream links', () => {
  const shifts = new Map([['a', { x: 10, y: 0 }], ['b', { x: 10, y: 0 }], ['c', { x: 10, y: 4 }], ['isolated', { x: 8, y: 2 }]]);
  assert.deepEqual([...coherentShifts(shifts, [['a', 'b'], ['b', 'c']]).keys()], ['isolated']);
});

test('an intervening interaction invalidates feedback from an async response even after returning to pointer input', () => {
  const root = { dataset: { input: 'pointer' }, isConnected: true, contains: () => true };
  const element = { closest: () => root };
  const first = feedbackIntent(element);
  assert.equal(first(), true);
  stopFeedback(root);
  assert.equal(first(), false);
  assert.equal(feedbackIntent(element)(), true);
  root.dataset.input = 'keyboard';
  const keyboard = feedbackIntent(element);
  root.dataset.input = 'pointer';
  assert.equal(keyboard(), false);
  root.isConnected = false;
  assert.equal(feedbackIntent(element)(), false);
});
