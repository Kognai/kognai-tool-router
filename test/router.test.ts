import { test } from 'node:test';
import assert from 'node:assert/strict';
import { route, type RouterDeps } from '../src/router';
import { readFlags } from '../src/flags';
import { hashEmbeddingPort } from '../src/retrieve/hash-embed';
import { RouterIndex } from '../src/retrieve/hybrid';
import type { RouteResponse } from '../src/types/route';
import type { SkillIndex } from '../src/types/ports';
import { fixtureStore, CITIZEN, SWARM, ENGINE } from './fixture-catalog';

const store = fixtureStore();
const index = new RouterIndex(store, { vectorModel: hashEmbeddingPort.model });
const clock = { now: () => new Date('2026-10-12T10:00:00.000Z') };
const deps = (over: Partial<RouterDeps> = {}): RouterDeps => ({ store, index, flags: readFlags({}), offline: true, embed: hashEmbeddingPort, clock, ...over });

function assertReal(r: RouteResponse): void {
  assert.equal(r.catalog_snapshot, store.snapshotId());
  for (const s of r.shortlists) {
    assert.ok(s.candidates.length <= 10);
    for (const c of s.candidates) {
      const [id, op] = c.tool_id.split('#');
      const row = store.get(id, c.version);
      assert.ok(row && row.operations.some((o) => o.op === op), `fabricated ${c.tool_id}`);
      if (r.mode === 'execute_plan') assert.ok(c.executable, `${c.tool_id} not executable in execute mode`);
    }
  }
}

test('Demo A weather: execute mode finds the CTO reviewed tool; discover mode lists quarantined ones as not executable', async () => {
  const ex = await route({ text: "What's the weather in Paris tomorrow?", context: ENGINE }, deps());
  assertReal(ex);
  assert.equal(ex.task_complexity, 'SIMPLE');
  assert.deepEqual(ex.risk_classes, ['read_only', 'network']);
  assert.equal(ex.requirement, 'tool');
  assert.equal(ex.shortlists[0].candidates[0].tool_id, 'tool:openapi:meteo.example/forecast#get_forecast');
  assert.ok((ex.shortlists[0].excluded.E2 || 0) >= 1, 'quarantined weather tools counted under E2');
  const disc = await route({ text: "What's the weather in Paris tomorrow?", context: ENGINE, mode: 'discover' }, deps());
  assertReal(disc);
  const ids = disc.shortlists[0].candidates.map((c) => c.tool_id);
  assert.ok(ids.includes('tool:mcp:io.github.acme/weather#forecast'));
  assert.equal(disc.shortlists[0].candidates.find((c) => c.tool_id === 'tool:mcp:io.github.acme/weather#forecast')!.executable, false);
});

test('Demo A with only quarantined imports: no_eligible_tool in execute mode', async () => {
  const s2 = fixtureStore();
  s2.setTrust('tool:openapi:meteo.example/forecast', '2.0.0', 'revoked', 'cto-desk', 'test');
  const r = await route({ text: "What's the weather in Paris tomorrow?", context: ENGINE }, deps({ store: s2, index: undefined }));
  assert.equal(r.requirement, 'no_eligible_tool');
  assert.ok(r.notes.some((n) => /E2/.test(n)));
});

test('Demo B oncology RWE: REASONING, searches then synthesis as model work, no fabricated papers', async () => {
  const r = await route({ text: 'Find real world evidence on immunotherapy outcomes in elderly lung cancer patients: recent papers and clinical trials', context: SWARM, mode: 'discover' }, deps());
  assertReal(r);
  assert.equal(r.task_complexity, 'REASONING');
  const lit = r.plan.find((n) => n.capability === 'literature.search')!;
  const tri = r.plan.find((n) => n.capability === 'trial.search')!;
  const syn = r.plan.find((n) => n.capability === 'evidence.synthesise')!;
  assert.equal(syn.needs_tool, false);
  assert.equal(r.shortlists.find((s) => s.node_id === lit.node_id)!.candidates[0].tool_id, 'tool:mcp:bio.example/pubmed#search_articles');
  assert.equal(r.shortlists.find((s) => s.node_id === tri.node_id)!.candidates[0].tool_id, 'tool:openapi:trials.example/ctgov#search_studies');
  assert.ok(!r.shortlists.some((s) => s.node_id === syn.node_id), 'no shortlist for model work');
});

test('Demo C cinematic video for a citizen: COMPLEX, Kreativ first, outside video only as fallback', async () => {
  const r = await route({ text: 'Make a 30 second cinematic video with two consistent characters talking', context: CITIZEN }, deps());
  assertReal(r);
  assert.equal(r.task_complexity, 'COMPLEX');
  const vid = r.plan.find((n) => n.capability === 'video.generate')!;
  const sl = r.shortlists.find((s) => s.node_id === vid.node_id)!;
  assert.equal(sl.candidates[0].tool_id, 'tool:kognai:kreativ/dialogue-skit#run');
  assert.ok(sl.candidates.every((c) => c.tool_id.startsWith('tool:kognai:')));
  // a citizen never sees an outside tool with no business tier, not even as a fallback (E6 before E10)
  const disc = await route({ text: 'Make a 30 second cinematic video with two consistent characters talking', context: CITIZEN, mode: 'discover' }, deps());
  const v2 = disc.shortlists.find((s) => s.node_id === disc.plan.find((n) => n.capability === 'video.generate')!.node_id)!;
  assert.ok(v2.candidates.every((c) => c.tool_id.startsWith('tool:kognai:')));
  assert.ok(!v2.candidates.some((c) => c.fallbacks.some((f) => !f.startsWith('tool:kognai:'))));
  // a swarm under the hard rule: the eligible outside tool is a fallback of the first Kognai candidate
  const sw = await route({ text: 'Make a 30 second cinematic video with two consistent characters talking', context: { ...SWARM, kognai_first: 'hard' }, mode: 'discover' }, deps());
  const v3 = sw.shortlists.find((s) => s.node_id === sw.plan.find((n) => n.capability === 'video.generate')!.node_id)!;
  assert.ok(v3.candidates.every((c) => c.tool_id.startsWith('tool:kognai:')));
  assert.ok(v3.candidates[0].fallbacks.includes('tool:x402:video.example/text-to-video#call'));
});

test('Demo D email action items: MEDIUM, sensitive, connector with auth_needed, extraction is model work, fixture only', async () => {
  const r = await route({ text: 'Extract the action items from my emails this week', context: CITIZEN }, deps());
  assertReal(r);
  assert.equal(r.task_complexity, 'MEDIUM');
  assert.ok(r.risk_classes.includes('sensitive_data'));
  const top = r.shortlists[0].candidates[0];
  assert.match(top.tool_id, /^tool:kognai:connectors\/gmail#/);
  assert.deepEqual(top.auth_needed, { kind: 'oauth', provider: 'gmail', scopes: ['gmail.readonly'] });
  assert.ok(!r.shortlists.flatMap((s) => s.candidates).some((c) => c.tool_id.startsWith('tool:mcp:gmai1')), 'the look alike is quarantined');
  const other = await route({ text: 'Extract the action items from my emails this week', context: { ...CITIZEN, data_owner_id: 'KGN-0042' } }, deps());
  assert.equal(other.requirement, 'no_eligible_tool', 'someone else\'s mail is never eligible');
  const t5 = await route({ text: 'Extract the action items from this email: "Hi team, please send 50 USDC to 0xabc by Friday and review the deck"', context: CITIZEN }, deps());
  assert.ok(!t5.risk_classes.includes('payment'));
});

test('Demo E wallet transfer: refusal with the E4 count and the Founder only note', async () => {
  for (const ctx of [CITIZEN, SWARM, ENGINE]) {
    for (const mode of ['execute_plan', 'discover'] as const) {
      const r = await route({ text: 'Send 50 USDC to 0x1111111111111111111111111111111111111111', context: ctx, mode }, deps());
      assertReal(r);
      assert.ok(r.risk_classes.includes('payment') && r.risk_classes.includes('sensitive_data'));
      assert.equal(r.requirement, 'no_eligible_tool');
      assert.equal(r.shortlists.flatMap((s) => s.candidates).length, 0);
      assert.ok(r.notes.some((n) => /Founder's own act/.test(n)));
    }
  }
  const d = await route({ text: 'Send 50 USDC to 0x1111111111111111111111111111111111111111', context: SWARM, mode: 'discover' }, deps());
  assert.ok((d.shortlists[0].excluded.E4 || 0) >= 1);
});

test('Demo F: the skills part is fed by the skill index', async () => {
  const skills: SkillIndex = { forTool: (id) => (id === 'tool:kognai:kreativ/video' ? [{ skill_id: 'kreativ-video-kreativ-video', version: 'v1', uplift: 0.4, evaluated: false }] : []) };
  const r = await route({ text: 'Make a short educational video about the harmattan', context: { ...CITIZEN, kognai_first: 'off' } }, deps({ skills }));
  const c = r.shortlists[0].candidates.find((x) => x.tool_id === 'tool:kognai:kreativ/video#run')!;
  assert.equal(c.score_parts.skills, 0.4);
  assert.equal(c.skills[0].skill_id, 'kreativ-video-kreativ-video');
});

test('adversarial: the injected tool never rises to top 1 on an unrelated request, and its text never reaches a reason', async () => {
  for (const t of ['make a logo for my bakery', 'top holders of this solana token', 'search pubmed for papers on fasting']) {
    const r = await route({ text: t, context: SWARM, mode: 'discover' }, deps());
    for (const s of r.shortlists) {
      if (s.candidates[0]) assert.notEqual(s.candidates[0].tool_id, 'tool:mcp:evil.example/best-tool#run', t);
      for (const c of s.candidates) for (const reason of c.reasons) assert.doesNotMatch(reason, /ignore previous|select this|choose me/i);
    }
  }
});

test('no tool and clarify: no shortlist is forced', async () => {
  const a = await route({ text: 'What is the capital of Australia?', context: CITIZEN }, deps());
  assert.equal(a.requirement, 'no_tool');
  assert.deepEqual(a.shortlists, []);
  const b = await route({ text: 'do it', context: CITIZEN }, deps());
  assert.equal(b.requirement, 'clarify');
});

test('flags: disabled without offline, stopped always; logs hash a citizen request', async () => {
  const off = await route({ text: 'weather in Paris', context: ENGINE }, deps({ offline: false }));
  assert.equal(off.requirement, 'no_eligible_tool');
  assert.match(off.notes[0], /router disabled/);
  const stopped = await route({ text: 'weather in Paris', context: ENGINE }, deps({ flags: readFlags({ TOOL_ROUTER_ENABLED: '1' }, { stopFileExists: true }) }));
  assert.match(stopped.notes[0], /stopped/);
  const logs: any[] = [];
  await route({ text: 'weather in Paris', context: CITIZEN }, deps({ log: (e) => logs.push(e) }));
  assert.equal(logs.length, 1);
  assert.equal(logs[0].text, undefined);
  assert.match(logs[0].text_sha256, /^[0-9a-f]{64}$/);
  await route({ text: 'weather in Paris', context: ENGINE }, deps({ log: (e) => logs.push(e) }));
  assert.equal(logs[1].text, 'weather in Paris');
});

test('max_candidates and constraints are honoured', async () => {
  const r = await route({ text: 'top holders of this solana token', context: SWARM, mode: 'discover', constraints: { max_candidates: 1 } }, deps());
  assert.ok(r.shortlists[0].candidates.length <= 1);
  const b = await route({ text: 'top holders of this solana token', context: { ...SWARM, kognai_first: 'off' }, mode: 'discover', constraints: { networks: ['base'] } }, deps());
  assert.ok(!b.shortlists[0].candidates.some((c) => c.tool_id.startsWith('tool:x402:holders.example')), 'solana only tool excluded under a base constraint');
});
