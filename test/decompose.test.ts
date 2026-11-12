import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decompose, topoOrder } from '../src/classify/decompose';
import { classifyRules } from '../src/classify/rules';
import type { Classification } from '../src/types/route';

function cls(text: string): Classification {
  const r = classifyRules(text);
  return { task_complexity: r.task_complexity, risk_classes: r.risk_classes, requirement: r.requirement, capabilities: r.capabilities.map((c) => c.id), hits: r.capabilities, confidence: r.confidence, method: 'rules', language: r.language, args_known: r.args_known, reasoning_cues: r.reasoning_cues, data_spans: r.data_spans };
}
const plan = (t: string) => decompose(cls(t), t);

test('Demo C chain: script -> characters -> video -> voice -> edit', () => {
  const p = plan('Make a 30 second cinematic video with two consistent characters talking');
  assert.deepEqual(p.slice(0, 5).map((n) => n.capability), ['script.write', 'character.design', 'video.generate', 'voice.speak', 'video.edit']);
  assert.deepEqual(p[1].depends_on, ['n1']);
  assert.deepEqual(p[4].depends_on, ['n4']);
  assert.equal(p[0].needs_tool, false, 'the script is model work');
  assert.deepEqual(topoOrder(p), ['n1', 'n2', 'n3', 'n4', 'n5']);
});

test('Demo B: searches in parallel, synthesis after both', () => {
  const p = plan('Find real world evidence on immunotherapy outcomes in elderly lung cancer patients: recent papers and clinical trials');
  const syn = p.find((n) => n.capability === 'evidence.synthesise')!;
  const searches = p.filter((n) => n.capability === 'literature.search' || n.capability === 'trial.search');
  assert.equal(searches.length, 2);
  for (const s of searches) assert.deepEqual(s.depends_on, []);
  assert.deepEqual(syn.depends_on.sort(), searches.map((s) => s.node_id).sort());
  assert.equal(syn.needs_tool, false);
});

test('Demo D: read mail, then extraction as model work', () => {
  const p = plan('Extract the action items from my emails this week');
  assert.deepEqual(p.map((n) => n.capability), ['mail.read', 'mail.extract_actions']);
  assert.deepEqual(p[1].depends_on, ['n1']);
  assert.equal(p[1].needs_tool, false);
});

test('independent nodes stay parallel; chained wording makes them sequential', () => {
  const par = plan('weather in Paris and the latest crypto narratives');
  assert.equal(par.length, 2);
  assert.ok(par.every((n) => n.depends_on.length === 0));
  const seq = plan('make a poster for the shop then post it on Instagram');
  assert.deepEqual(seq.map((n) => n.capability), ['image.generate', 'social.post']);
  assert.deepEqual(seq[1].depends_on, ['n1']);
});

test('missing arguments are reported on first nodes only', () => {
  const p = plan('what will the weather be like');
  assert.deepEqual(p[0].args_missing, ['location']);
  assert.equal(cls('what will the weather be like').task_complexity, 'MEDIUM');
});

test('clarify and no capability give no plan; topoOrder rejects cycles', () => {
  assert.deepEqual(plan('do it'), []);
  assert.throws(() => topoOrder([
    { node_id: 'n1', capability: 'a.b', depends_on: ['n2'], risk_classes: [], args_known: [], args_missing: [], needs_tool: true },
    { node_id: 'n2', capability: 'a.b', depends_on: ['n1'], risk_classes: [], args_known: [], args_missing: [], needs_tool: true },
  ]), /cycle/);
  assert.throws(() => topoOrder([{ node_id: 'n1', capability: 'a.b', depends_on: ['n9'], risk_classes: [], args_known: [], args_missing: [], needs_tool: true }]), /unknown/);
});
