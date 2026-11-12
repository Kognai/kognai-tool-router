import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wilsonLower, successScore, priorOf, evidenceConfidence } from '../src/rank/confidence';
import { EMPTY_SUCCESS } from '../src/types/tool';

const near = (a: number, b: number, e = 1e-3) => Math.abs(a - b) < e;

test('Wilson lower bound values (z 1.64)', () => {
  assert.equal(wilsonLower(0, 0), 0);
  assert.ok(near(wilsonLower(10, 10), 0.788, 0.01));
  assert.ok(near(wilsonLower(50, 100), 0.418, 0.01));
  assert.ok(wilsonLower(5, 5) < wilsonLower(50, 50), 'more evidence, higher bound');
});

test('priors by origin and trust', () => {
  assert.deepEqual(priorOf({ origin: 'kognai', trust_state: 'verified' }), [4, 1]);
  assert.deepEqual(priorOf({ origin: 'mcp', trust_state: 'reviewed' }), [2, 2]);
  assert.deepEqual(priorOf({ origin: 'mcp', trust_state: 'quarantined' }), [1, 1]);
  const k = successScore({ origin: 'kognai', trust_state: 'verified' }, EMPTY_SUCCESS);
  const q = successScore({ origin: 'mcp', trust_state: 'quarantined' }, EMPTY_SUCCESS);
  assert.ok(k > q, 'the prior favours verified Kognai tools with no history');
});

test('T10 simulation: 500 self reports from one principal do not outrank an honest verified tool', () => {
  const rec = { origin: 'mcp' as const, trust_state: 'reviewed' as const };
  const honest = successScore(rec, { exec_ok: 50, exec_n: 50, verified_ok: 40, verified_n: 50, distinct_principals: 20, window_days: 30 });
  const gamed = successScore(rec, { exec_ok: 500, exec_n: 500, verified_ok: 0, verified_n: 0, distinct_principals: 1, window_days: 30 });
  assert.ok(honest > gamed, `${honest} vs ${gamed}`);
  const sybilVerified = successScore(rec, { exec_ok: 0, exec_n: 0, verified_ok: 30, verified_n: 30, distinct_principals: 1, window_days: 30 });
  assert.ok(honest > sybilVerified, `one principal's verified runs are shrunk: ${honest} vs ${sybilVerified}`);
});

test('execution success alone counts at half weight', () => {
  const rec = { origin: 'mcp' as const, trust_state: 'reviewed' as const };
  const exec = successScore(rec, { exec_ok: 100, exec_n: 100, verified_ok: 0, verified_n: 0, distinct_principals: 50, window_days: 30 });
  assert.ok(exec <= 0.5);
});

test('evidence confidence grows with trust and verified runs', () => {
  assert.ok(evidenceConfidence({ origin: 'mcp', trust_state: 'quarantined' }, EMPTY_SUCCESS) < evidenceConfidence({ origin: 'kognai', trust_state: 'verified' }, EMPTY_SUCCESS));
  assert.ok(evidenceConfidence({ origin: 'kognai', trust_state: 'verified' }, { ...EMPTY_SUCCESS, verified_n: 100 }) > 0.9);
});
