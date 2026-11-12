import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, FALLBACK_THRESHOLD } from '../src/classify/classifier';
import type { ClassifierPort } from '../src/types/ports';

const ON = { modelFallback: true, stopped: false };
const OFF = { modelFallback: false, stopped: false };

function fakePort(answer: any): ClassifierPort & { calls: string[] } {
  const calls: string[] = [];
  return { calls, async classify(text) { calls.push(text); return typeof answer === 'function' ? answer() : answer; } };
}

test('the port is called only under the threshold, with the flag on, and not for no_tool', async () => {
  const p = fakePort({ capabilities: ['weather.forecast'] });
  await classify("What's the weather in Paris?", {}, ON, p);
  assert.equal(p.calls.length, 0, 'confident rules: no call');
  await classify('What is the capital of Australia?', {}, ON, p);
  assert.equal(p.calls.length, 0, 'no_tool: no call');
  await classify('do it', {}, OFF, p);
  assert.equal(p.calls.length, 0, 'flag off: no call');
  await classify('do it', {}, { modelFallback: true, stopped: true }, p);
  assert.equal(p.calls.length, 0, 'stopped: no call');
  const r = await classify('do it', {}, ON, p);
  assert.equal(p.calls.length, 1);
  assert.equal(p.calls[0], 'do it', 'only the request text is sent');
  assert.equal(r.method, 'model');
  assert.deepEqual(r.capabilities, ['weather.forecast']);
  assert.equal(r.requirement, 'tool');
  assert.ok(FALLBACK_THRESHOLD === 0.5);
});

test('malformed or empty answers are ignored; a throwing port is ignored', async () => {
  for (const a of [null, {}, { capabilities: 'x' }, { capabilities: [] }, () => { throw new Error('down'); }]) {
    const r = await classify('do it', {}, ON, fakePort(a));
    assert.equal(r.method, 'rules');
    assert.equal(r.requirement, 'clarify');
  }
});

test('unknown labels are dropped; model capabilities can add risk, never remove it', async () => {
  const r = await classify('do it', {}, ON, fakePort({ capabilities: ['made.up', 'wallet.transfer'], requirement: 'whatever', task_complexity: 'HUGE', confidence: 7 }));
  assert.deepEqual(r.capabilities, ['wallet.transfer']);
  assert.ok(r.risk_classes.includes('payment'));
  assert.equal(r.task_complexity, 'SIMPLE');
  assert.ok(r.confidence <= 0.7);
});
