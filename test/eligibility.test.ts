import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstFailure, authNeeded, priceMicroUsd, budgetMicro, type EligibilityInput } from '../src/eligibility/rules';
import { filter } from '../src/eligibility/engine';
import { fixtureStore, CITIZEN, SWARM, ENGINE } from './fixture-catalog';
import type { PlanNode } from '../src/types/route';
import type { ToolRecord } from '../src/types/tool';

const s = fixtureStore();
const rec = (id: string) => s.get(id)!;
const node = (capability: string, risk: PlanNode['risk_classes'] = []): PlanNode => ({ node_id: 'n1', capability, depends_on: [], risk_classes: risk, args_known: ['query'], args_missing: [], needs_tool: true });
const ON = { stopped: false, enabled: true };
const at = (r: ToolRecord, over: Partial<EligibilityInput> = {}): EligibilityInput => ({ rec: r, op: r.operations[0], node: node('x'), ctx: SWARM, mode: 'execute_plan', flags: ON, offline: false, ...over });

test('E1 lifecycle: only active rows; missing = excluded', () => {
  const r = { ...rec('tool:kognai:connectors/gmail'), lifecycle: 'draft' as const };
  assert.equal(firstFailure(at(r)), 'E1');
});

test('E2 trust: quarantined only in discover mode; revoked never; reviewed allowed', () => {
  const q = rec('tool:mcp:io.github.acme/weather');
  assert.equal(firstFailure(at(q)), 'E2');
  assert.equal(firstFailure(at(q, { mode: 'discover' })), null);
  assert.equal(firstFailure(at({ ...q, trust_state: 'revoked' }, { mode: 'discover' })), 'E2');
  assert.equal(firstFailure(at(rec('tool:openapi:meteo.example/forecast'))), null, 'reviewed by the CTO desk');
});

test('E3 stop file and flags; offline CLIs pass with the flag off, never with the stop file', () => {
  const g = rec('tool:kognai:products/golden-kog');
  assert.equal(firstFailure(at(g, { flags: { stopped: true, enabled: true } })), 'E3');
  assert.equal(firstFailure(at(g, { flags: { stopped: false, enabled: false } })), 'E3');
  assert.equal(firstFailure(at(g, { flags: { stopped: false, enabled: false }, offline: true })), null);
  assert.equal(firstFailure(at(g, { flags: { stopped: true, enabled: false }, offline: true })), 'E3');
});

test('E4 risk: payment, destructive, privileged excluded for every caller; publish for citizens unless the release path', () => {
  const w = rec('tool:mcp:pay.example/wallet');
  const pay = w.operations.find((o) => o.op === 'pay')!;
  for (const ctx of [CITIZEN, SWARM, ENGINE]) assert.equal(firstFailure(at(w, { op: pay, ctx, mode: 'discover' })), 'E4');
  const bal = w.operations.find((o) => o.op === 'balance')!;
  assert.equal(firstFailure(at(w, { op: bal, node: node('wallet.transfer', ['payment']), mode: 'discover' })), 'E4', 'the step itself is a payment');
  const pub = rec('tool:kognai:kreativ/social-publish');
  assert.equal(firstFailure(at(pub, { ctx: { ...CITIZEN, business_tier: 'enterprise' } })), null, 'Kognai release path keeps the Founder approval');
  const mcpPub = { ...rec('tool:mcp:io.github.acme/weather'), trust_state: 'reviewed' as const };
  const op = { ...mcpPub.operations[0], risk_classes: ['publish_or_message' as const] };
  assert.equal(firstFailure(at(mcpPub, { op, ctx: CITIZEN })), 'E4');
  assert.notEqual(firstFailure(at(mcpPub, { op, ctx: SWARM })), 'E4');
});

test('E5 a URL from the conversation is excluded for citizens; missing = treated as a URL', () => {
  const f = { ...rec('tool:mcp:scrape.example/fetch'), trust_state: 'reviewed' as const, business_tier: 'free' as const };
  assert.equal(f.operations[0].url_from_user, true);
  assert.equal(firstFailure(at(f, { ctx: CITIZEN })), 'E5');
  assert.equal(firstFailure(at(f, { ctx: SWARM })), null);
});

test('E6 business tier: null tier excluded for citizens, allowed for the engine; above the caller excluded', () => {
  const img = rec('tool:kognai:clawrouter/image');
  assert.equal(firstFailure(at(img, { ctx: CITIZEN })), 'E6');
  assert.equal(firstFailure(at(img, { ctx: ENGINE })), null);
  const skit = rec('tool:kognai:kreativ/dialogue-skit');
  assert.equal(firstFailure(at(skit, { ctx: { ...CITIZEN, business_tier: 'citizen_plus' } })), 'E6');
  assert.equal(firstFailure(at(skit, { ctx: CITIZEN })), null);
});

test('E7 privacy: the owner\'s own principal only', () => {
  const g = rec('tool:kognai:connectors/gmail');
  assert.equal(firstFailure(at(g, { ctx: CITIZEN })), null);
  assert.equal(firstFailure(at(g, { ctx: { ...CITIZEN, data_owner_id: 'KGN-0042' } })), 'E7');
  assert.equal(firstFailure(at(g, { ctx: { ...CITIZEN, kind: 'external' } })), 'E7');
});

test('E8 networks and regions under constraints; missing network evidence excluded', () => {
  const h = { ...rec('tool:x402:holders.example/solana-holders'), trust_state: 'reviewed' as const };
  assert.equal(firstFailure(at(h, { constraints: { networks: ['base'] } })), 'E8');
  assert.equal(firstFailure(at(h, { constraints: { networks: ['solana'] } })), null);
  assert.equal(firstFailure(at({ ...h, networks: [] }, { constraints: { networks: ['solana'] } })), 'E8');
  assert.equal(firstFailure(at({ ...h, regions: ['FR'] }, { constraints: { regions: ['TN'] } })), 'E8');
  assert.equal(firstFailure(at(h, { constraints: { regions: ['TN'] } })), null, "'*' covers every region");
});

test('E9 budget: known price above it excluded, unknown price with a budget excluded, free passes', () => {
  const h = { ...rec('tool:x402:holders.example/solana-holders'), trust_state: 'reviewed' as const };
  assert.equal(priceMicroUsd(h), 5000n);
  assert.equal(firstFailure(at(h, { ctx: { ...SWARM, budget_remaining_micro: '4999' } })), 'E9');
  assert.equal(firstFailure(at(h, { ctx: { ...SWARM, budget_remaining_micro: '5000' } })), null);
  const v = rec('tool:kognai:products/create-video');
  assert.equal(firstFailure(at(v, { ctx: { ...SWARM, budget_remaining_micro: '1000000' } })), 'E9', 'unknown price with a budget');
  assert.equal(firstFailure(at(rec('tool:kognai:products/golden-kog'), { ctx: { ...SWARM, budget_remaining_micro: '0' } })), null, 'free');
  assert.equal(budgetMicro({ ...SWARM, budget_remaining_micro: '500' }, { max_cost_micro: '300' }), 300n);
});

test('the order: the first failing rule is the one counted', () => {
  const w = { ...rec('tool:mcp:pay.example/wallet'), lifecycle: 'draft' as const };
  assert.equal(firstFailure(at(w, { op: w.operations[1] })), 'E1', 'E1 before E4');
});

test('E11 auth needs: OAuth when not connected, x402, approval; never an exclusion', () => {
  const g = rec('tool:kognai:connectors/gmail');
  assert.deepEqual(authNeeded(g, g.operations[0], CITIZEN), { kind: 'oauth', provider: 'gmail', scopes: ['gmail.readonly'] });
  assert.equal(authNeeded(g, g.operations[0], { ...CITIZEN, connected: [{ provider: 'gmail', scopes: ['gmail.readonly'] }] }), null);
  const h = rec('tool:x402:holders.example/solana-holders');
  assert.deepEqual(authNeeded(h, h.operations[0], SWARM), { kind: 'x402' });
  const pub = rec('tool:kognai:kreativ/social-publish');
  assert.deepEqual(authNeeded(pub, pub.operations[0], SWARM), { kind: 'approval' });
});

test('engine: counts per rule, only for relevant candidates', () => {
  const items = [...s.latest()].flatMap((r) => r.operations.map((op) => ({ index: 0, item: { key: `${r.id}#${op.op}`, rec: r, op }, signals: { lexical: 0, vector: 0, capability: 0, schema: 0, health: 0, cosine: null } })));
  const all = filter(items, { node: node('x'), ctx: CITIZEN, mode: 'execute_plan', flags: ON, offline: false });
  assert.ok((all.excluded.E2 || 0) > 0);
  const none = filter(items, { node: node('x'), ctx: CITIZEN, mode: 'execute_plan', flags: ON, offline: false }, () => false);
  assert.deepEqual(none.excluded, {});
  assert.equal(none.eligible.length, all.eligible.length);
});
