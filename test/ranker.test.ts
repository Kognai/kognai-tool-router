import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rank } from '../src/rank/ranker';
import { DEFAULT_WEIGHTS, DEFAULT_FIT, checkWeights, fitOf, EXPLORATION_MAX } from '../src/rank/weights';
import { RouterIndex, retrieve } from '../src/retrieve/hybrid';
import { fixtureStore, RAWS } from './fixture-catalog';
import type { PlanNode } from '../src/types/route';

const s = fixtureStore();
const ix = new RouterIndex(s);
const node: PlanNode = { node_id: 'n1', capability: 'weather.forecast', depends_on: [], risk_classes: [], args_known: ['query', 'location'], args_missing: [], needs_tool: true };
const cands = retrieve(ix, node, 'weather forecast in Paris');

test('weights sum to 1; bad weights are refused', () => {
  checkWeights(DEFAULT_WEIGHTS, DEFAULT_FIT);
  assert.throws(() => checkWeights({ ...DEFAULT_WEIGHTS, fit: 0.5 }));
  assert.throws(() => checkWeights(DEFAULT_WEIGHTS, { capability: 0.5, vector: 0.5, lexical: 0.5 }));
  assert.equal(fitOf({ capability: 1, vector: 0, lexical: 1 }, { capability: true, vector: false, lexical: true }), 1);
});

test('scores are the weighted parts; exploration bounded', () => {
  const r = rank(cands, { exploration: true, seed: 'route_x' });
  for (const x of r) {
    const p = x.parts;
    const expect = 0.3 * p.fit + 0.2 * p.schema + 0.2 * p.success + 0.1 * p.cost + 0.1 * p.latency + 0.1 * p.skills + p.exploration;
    assert.ok(Math.abs(x.score - expect) < 1e-9);
    assert.ok(p.exploration >= 0 && p.exploration <= EXPLORATION_MAX);
  }
});

test('deterministic with the same seed; exploration off by default', () => {
  const a = rank(cands, { exploration: true, seed: 's1' }).map((x) => [x.r.item.key, x.score]);
  const b = rank(cands, { exploration: true, seed: 's1' }).map((x) => [x.r.item.key, x.score]);
  assert.deepEqual(a, b);
  assert.ok(rank(cands).every((x) => x.parts.exploration === 0));
});

test('reasons are written by KTR, never copied from provider text', () => {
  const providerText = RAWS.flatMap((r) => [r.description, ...r.operations.map((o) => o.summary)]).filter((t) => t && t.length > 12);
  for (const x of rank(cands)) for (const reason of x.reasons) for (const t of providerText) assert.ok(!reason.includes(t) && !t.includes(reason) || reason.length < 12, `${reason} copies "${t}"`);
  const evil = rank(cands).find((x) => x.r.item.rec.id === 'tool:mcp:evil.example/best-tool');
  if (evil) for (const reason of evil.reasons) assert.doesNotMatch(reason, /ignore|select this|choose me|rank this/i);
});
