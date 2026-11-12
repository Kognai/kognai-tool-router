import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, MAX_CANDIDATES } from '../src/shortlist/generate';
import type { Ranked } from '../src/rank/ranker';
import type { ToolRecord } from '../src/types/tool';
import { EMPTY_SUCCESS } from '../src/types/tool';
import { fixtureStore, CITIZEN, SWARM } from './fixture-catalog';
import type { PlanNode } from '../src/types/route';

const s = fixtureStore();
const node: PlanNode = { node_id: 'n1', capability: 'video.generate', depends_on: [], risk_classes: [], args_known: ['query'], args_missing: [], needs_tool: true };

function fake(rec: ToolRecord, score: number, fit = 0.8, cap = 1): Ranked {
  const op = rec.operations[0];
  return { r: { index: 0, item: { key: `${rec.id}#${op.op}`, rec, op }, signals: { lexical: 0.5, vector: 0.5, capability: cap, schema: 0.8, health: 0.5, cosine: null } },
    fit, score, parts: { fit, schema: 0.8, success: 0.5, cost: 0.5, latency: 0.5, skills: 0, exploration: 0, aiax: 0 }, reasons: ['capability matches the step'], confidence: 0.6, skills: [], stats: EMPTY_SUCCESS, cold: true };
}

test('cap 10, fewer when fewer are relevant (floor)', () => {
  const base = s.get('tool:x402:video.example/text-to-video')!;
  const many = Array.from({ length: 25 }, (_, i) => fake({ ...base, id: `tool:x402:video.example/v${i}`, same_as: [] }, 1 - i / 100));
  assert.equal(generate(many, node, SWARM, { mode: 'discover' }).candidates.length, MAX_CANDIDATES);
  assert.equal(generate(many, node, SWARM, { mode: 'discover', max: 3 }).candidates.length, 3);
  const weak = many.map((x, i) => ({ ...x, fit: i < 2 ? 0.8 : 0.2 }));
  assert.equal(generate(weak, node, SWARM, { mode: 'discover' }).candidates.length, 2);
});

test('Kognai first (hard): outside tools become fallbacks of the first Kognai candidate', () => {
  const kv = s.get('tool:kognai:products/create-video')!;
  const ext = s.get('tool:x402:video.example/text-to-video')!;
  const r = generate([fake(ext, 0.9), fake(kv, 0.6)], node, CITIZEN, { mode: 'execute_plan' });
  assert.equal(r.kognaiFirst, true);
  assert.deepEqual(r.candidates.map((c) => c.tool_id), ['tool:kognai:products/create-video#order']);
  assert.deepEqual(r.candidates[0].fallbacks, ['tool:x402:video.example/text-to-video#call']);
  assert.match(r.candidates[0].reasons[0], /ADR-008/);
  const prior = generate([fake(ext, 0.62), fake(kv, 0.6)], node, SWARM, { mode: 'discover' });
  assert.equal(prior.candidates[0].tool_id, 'tool:kognai:products/create-video#order', 'prior bonus');
  const off = generate([fake(ext, 0.62), fake(kv, 0.6)], node, { ...SWARM, kognai_first: 'off' }, { mode: 'discover' });
  assert.equal(off.candidates[0].tool_id, 'tool:x402:video.example/text-to-video#call', 'merit only');
});

test('same_as duplicates collapse into fallbacks; quarantined candidates are not executable', () => {
  const a = { ...s.get('tool:x402:video.example/text-to-video')!, same_as: ['tool:mcp:video.example/dup'] };
  const b = { ...a, id: 'tool:mcp:video.example/dup', same_as: ['tool:x402:video.example/text-to-video'] };
  const r = generate([fake(a, 0.9), fake(b, 0.8)], node, SWARM, { mode: 'discover' });
  assert.equal(r.candidates.length, 1);
  assert.deepEqual(r.candidates[0].fallbacks, ['tool:mcp:video.example/dup#call']);
  assert.equal(r.candidates[0].executable, false);
});

test('no fabricated ids: every candidate is a catalog row', () => {
  const recs = [...s.latest()].filter((r) => r.operations.length);
  const r = generate(recs.map((x, i) => fake(x, 1 - i / 100)), node, SWARM, { mode: 'discover' });
  for (const c of r.candidates) {
    const [id, op] = c.tool_id.split('#');
    const row = s.get(id, c.version);
    assert.ok(row, c.tool_id);
    assert.ok(row!.operations.some((o) => o.op === op));
  }
});

test('a connected account ranks above the same tool on an account still to connect', () => {
  const g = s.get('tool:kognai:connectors/gmail')!;
  const out = { ...g, id: 'tool:kognai:connectors/outlook', auth: { kind: 'oauth' as const, provider: 'outlook' } };
  const conn = { ...CITIZEN, connected: [{ provider: 'gmail', scopes: ['gmail.readonly'] }] };
  const r = generate([fake(out, 0.61), fake(g, 0.60)], node, conn, { mode: 'execute_plan' });
  assert.equal(r.candidates[0].tool_id.split('#')[0], 'tool:kognai:connectors/gmail');
  assert.ok(r.candidates[0].reasons.includes("the owner's account is already connected"));
});
