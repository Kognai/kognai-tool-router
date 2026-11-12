/**
 * decompose(): a classification to a DAG of atomic operations (plan.md S2). Known chains use templates; anything else
 * becomes one node per capability in mention order, sequential when the text chains the steps ("then", "and send
 * it"), parallel otherwise. Templates are fixed acyclic shapes and generic edges only point to earlier nodes, so a
 * cycle cannot be built; topoOrder() checks it anyway.
 */
import type { Classification, PlanNode } from '../types/route';
import type { RiskClass } from '../types/tool';
import { capabilityById } from './taxonomy';
import { normalise } from './text';
import { CHAIN_HINT } from './rules';

const VIDEO_CHAIN = ['script.write', 'character.design', 'video.generate', 'voice.speak', 'video.edit'];
const RICH_VIDEO = /(?<![\p{L}])(cinematic|characters?|consistent|dialogue|scenes?|story|talking|conversation|personnages?|\d{2,3} ?(s|sec|secondes?|seconds?)|minutes?)(?![\p{L}])/u;
const SEARCHES = ['literature.search', 'trial.search', 'patent.search', 'web.search', 'news.search'];
const READS_FOR_EXTRACTION = ['mail.read', 'mail.search', 'drive.search', 'doc.read', 'calendar.read'];

function node(i: number, cap: string, depends: string[], c: Classification): PlanNode {
  const def = capabilityById(cap)!;
  const needs = def.args || [];
  const known = needs.filter((a) => c.args_known.includes(a));
  // a chained node gets its inputs from the node before it: nothing is missing
  const missing = depends.length ? [] : needs.filter((a) => !c.args_known.includes(a));
  return { node_id: `n${i}`, capability: cap, depends_on: depends, risk_classes: [...def.default_risk] as RiskClass[], args_known: known.length ? known : (c.args_known.includes('query') ? ['query'] : []), args_missing: missing, needs_tool: def.needs_tool };
}

export function decompose(c: Classification, text = ''): PlanNode[] {
  if (c.requirement === 'clarify' || !c.capabilities.length) return [];
  const caps = c.capabilities.filter((x) => capabilityById(x));
  const norm = normalise(text);
  const out: PlanNode[] = [];
  const add = (cap: string, deps: string[]) => { const n = node(out.length + 1, cap, deps, c); out.push(n); return n.node_id; };

  // video chain (Demo C): a produced piece with characters, dialogue, a story or a duration
  if (caps.includes('video.generate') && (caps.includes('character.design') || caps.includes('script.write') || RICH_VIDEO.test(norm))) {
    let prev: string[] = [];
    for (const cap of VIDEO_CHAIN) prev = [add(cap, prev)];
    if (caps.includes('music.generate')) { const m = add('music.generate', [out[0].node_id]); out[out.length - 2].depends_on.push(m); }
    for (const cap of caps) if (!out.some((n) => n.capability === cap)) add(cap, []);
    return fixEditDeps(out);
  }

  // research (Demo B): searches in parallel, synthesis after all of them
  const searches = caps.filter((x) => SEARCHES.includes(x));
  if (searches.length && (caps.includes('evidence.synthesise') || c.task_complexity === 'REASONING') && searches.some((s) => s !== 'web.search' && s !== 'news.search')) {
    const ids = searches.map((s) => add(s, []));
    add('evidence.synthesise', ids);
    for (const cap of caps) if (!out.some((n) => n.capability === cap)) add(cap, []);
    return out;
  }

  // extraction from the owner's data (Demo D): read first, model work after
  if (caps.includes('mail.extract_actions') || caps.includes('text.summarise')) {
    const reads = caps.filter((x) => READS_FOR_EXTRACTION.includes(x));
    if (reads.length) {
      const ids = reads.map((r) => add(r, []));
      for (const cap of caps) if (!reads.includes(cap)) add(cap, capabilityById(cap)!.needs_tool ? [] : ids);
      return out;
    }
  }

  // generic: sequential when the text chains the steps, otherwise parallel
  const chained = CHAIN_HINT.test(norm);
  let prev: string[] = [];
  for (const cap of caps) {
    const id = add(cap, chained ? prev : []);
    prev = [id];
  }
  // model work (summarise, synthesise) after the tool nodes it follows
  for (let i = 0; i < out.length; i++) {
    const n = out[i];
    if (n.needs_tool || n.depends_on.length) continue;
    n.depends_on = out.slice(0, i).filter((x) => x.needs_tool).map((x) => x.node_id);
  }
  return out;
}

function fixEditDeps(nodes: PlanNode[]): PlanNode[] {
  for (const n of nodes) n.depends_on = [...new Set(n.depends_on)];
  return nodes;
}

/** Topological order; throws on a cycle or an unknown dependency. */
export function topoOrder(nodes: PlanNode[]): string[] {
  const ids = new Set(nodes.map((n) => n.node_id));
  for (const n of nodes) for (const d of n.depends_on) if (!ids.has(d)) throw new Error(`${n.node_id} depends on unknown ${d}`);
  const order: string[] = [];
  const state = new Map<string, 1 | 2>();
  const byId = new Map(nodes.map((n) => [n.node_id, n]));
  const visit = (id: string) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) throw new Error(`cycle at ${id}`);
    state.set(id, 1);
    for (const d of byId.get(id)!.depends_on) visit(d);
    state.set(id, 2);
    order.push(id);
  };
  for (const n of nodes) visit(n.node_id);
  return order;
}
