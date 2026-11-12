/** AIAX ready (2026-10-12): the optional catalog field and its small, configurable ranking bonus. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rank } from '../src/rank/ranker';
import { AIAX_READY_WEIGHT, DEFAULT_WEIGHTS } from '../src/rank/weights';
import { validateToolRecord } from '../src/schema/validate';
import { canonical, sha256 } from '../src/hash';
import { RouterIndex, retrieve, type Retrieved } from '../src/retrieve/hybrid';
import { fixtureStore } from './fixture-catalog';
import type { PlanNode } from '../src/types/route';

const s = fixtureStore();
const ix = new RouterIndex(s);
const node: PlanNode = { node_id: 'n1', capability: 'weather.forecast', depends_on: [], risk_classes: [], args_known: ['query', 'location'], args_missing: [], needs_tool: true };
const cands = retrieve(ix, node, 'weather forecast in Paris');
const ready = (c: Retrieved, v: boolean | undefined): Retrieved => ({ ...c, item: { ...c.item, rec: { ...c.item.rec, aiax_ready: v } } });
const anyRec = () => cands[0].item.rec;

test('schema: aiax_ready is optional, boolean only', () => {
  const rec = anyRec();
  assert.ok(validateToolRecord(JSON.parse(JSON.stringify(rec))).ok);
  assert.ok(validateToolRecord({ ...rec, aiax_ready: true }).ok);
  assert.ok(validateToolRecord({ ...rec, aiax_ready: false }).ok);
  for (const bad of ['yes', 1, null, {}]) assert.equal(validateToolRecord({ ...rec, aiax_ready: bad }).ok, false, `accepted ${JSON.stringify(bad)}`);
});

test('absent field: record hash and ranking unchanged', () => {
  const rec = anyRec();
  const { aiax_ready: _drop, ...plain } = rec as any;
  assert.equal(sha256(canonical({ ...plain, aiax_ready: undefined })), sha256(canonical(plain)));
  const a = rank(cands).map((x) => [x.r.item.key, x.score]);
  const b = rank(cands.map((c) => ready(c, undefined))).map((x) => [x.r.item.key, x.score]);
  assert.deepEqual(a, b);
  assert.ok(rank(cands).every((x) => x.parts.aiax === 0));
});

test('a ready entry gets the bonus, with a reason; false gets nothing', () => {
  const base = rank(cands);
  const target = base[base.length - 1].r.item.key;
  const boosted = rank(cands.map((c) => ready(c, c.item.key === target ? true : false)));
  const before = base.find((x) => x.r.item.key === target)!;
  const after = boosted.find((x) => x.r.item.key === target)!;
  assert.ok(Math.abs(after.score - before.score - AIAX_READY_WEIGHT) < 1e-9);
  assert.equal(after.parts.aiax, AIAX_READY_WEIGHT);
  assert.ok(after.reasons.includes('provider publishes a valid AIAX manifest'));
  for (const x of boosted) if (x.r.item.key !== target) assert.equal(x.parts.aiax, 0);
});

test('weight 0 disables it; the weight is configurable', () => {
  const all = cands.map((c) => ready(c, true));
  const off = rank(all, { aiaxWeight: 0 }).map((x) => [x.r.item.key, x.score]);
  assert.deepEqual(off, rank(cands).map((x) => [x.r.item.key, x.score]));
  const big = rank(all, { aiaxWeight: 0.05 });
  for (const x of big) assert.equal(x.parts.aiax, 0.05);
});

test('the bonus never overturns a clearly more relevant tool', () => {
  // two copies of one candidate: the better one leads on fit by 0.1 (a clear gap), the other is AIAX ready
  const c = cands[0];
  const better: Retrieved = { ...c, item: { ...c.item, key: 'a-better' }, signals: { ...c.signals, capability: 1, vector: 0.8, lexical: 0.8 } };
  const worse: Retrieved = ready({ ...c, item: { ...c.item, key: 'b-ready' }, signals: { ...c.signals, capability: 1, vector: 0.6, lexical: 0.6 } }, true);
  const r = rank([worse, better]);
  assert.equal(r[0].r.item.key, 'a-better', JSON.stringify(r.map((x) => [x.r.item.key, x.fit, x.score, x.parts])));
  assert.ok(r[0].fit - r[1].fit >= 0.1);
  assert.ok(AIAX_READY_WEIGHT < DEFAULT_WEIGHTS.fit * 0.07, 'the bonus stays under a 0.07 fit gap');
});
