/**
 * route(): classify, decompose, then per node retrieve, filter (eligibility before any score), rank and shortlist
 * (plan.md S4 of the spec, "router.ts"). Offline in milestone 1: it selects, it never executes (decision D2).
 *
 * The response names the catalog snapshot it read; every candidate is a row of that snapshot. Requirement:
 *   no_tool / clarify     from the classifier (simple first: a shortlist is never forced, ADR-008)
 *   tool                  at least one tool step has an eligible candidate
 *   no_eligible_tool      tool steps exist but every candidate was excluded, or none exists
 * Routes are logged through deps.log with ids, scores and exclusion counts; a citizen's request text is replaced by
 * its hash (privacy).
 */
import { createHash } from 'node:crypto';
import type { KtrFlags } from './flags';
import type { CatalogStore, ClassifierPort, Clock, EmbeddingPort, EvidenceStore, SkillIndex } from './types/ports';
import type { NodeShortlist, PlanNode, RouteRequest, RouteResponse } from './types/route';
import { classify } from './classify/classifier';
import { decompose } from './classify/decompose';
import { RouterIndex, retrieve } from './retrieve/hybrid';
import { filter } from './eligibility/engine';
import { RULE_IDS, RULE_LABEL } from './eligibility/rules';
import { rank } from './rank/ranker';
import { DEFAULT_WEIGHTS, RELEVANCE_FLOOR, checkWeights, fitOf, type FitWeights, type Weights } from './rank/weights';
import { generate } from './shortlist/generate';

export interface RouterConfig {
  weights?: Weights;
  fitWeights?: FitWeights;
  useLexical?: boolean;
  useVector?: boolean;
  useCapability?: boolean;
  scoring?: 'full' | 'fit';
  exploration?: boolean;
  vectorModel?: string;
  floor?: number;
  /** The AIAX ready bonus (rank/weights.ts AIAX_READY_WEIGHT by default); 0 turns it off. */
  aiaxWeight?: number;
}

export interface RouterDeps {
  store: CatalogStore;
  index?: RouterIndex;
  flags: KtrFlags;
  /** Offline CLIs and the benchmark (stage 0): the router answers with TOOL_ROUTER_ENABLED off; the stop file still wins. */
  offline?: boolean;
  classifier?: ClassifierPort | null;
  embed?: EmbeddingPort | null;
  queryVector?: { model: string; vector: Float32Array } | null;
  evidence?: EvidenceStore | null;
  skills?: SkillIndex | null;
  clock?: Clock;
  config?: RouterConfig;
  log?: (entry: Record<string, unknown>) => void;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export async function route(req: RouteRequest, deps: RouterDeps): Promise<RouteResponse> {
  const now = (deps.clock?.now() || new Date()).toISOString();
  const mode = req.mode || 'execute_plan';
  const route_id = `route_${sha(`${now}|${req.request_id || ''}|${req.context.caller_id}|${req.text}`).slice(0, 24)}`;
  const cfg = deps.config || {};
  const notes: string[] = [];
  const base = { route_id, created_at: now, catalog_snapshot: deps.store.snapshotId(), mode, request_step: req.request_step };

  if (deps.flags.stopped || (!deps.flags.enabled && !deps.offline)) {
    return { ...base, task_complexity: 'SIMPLE', risk_classes: [], requirement: 'no_eligible_tool', classifier: { method: 'rules', confidence: 0 }, plan: [], shortlists: [],
      notes: [deps.flags.stopped ? 'KTR is stopped (.swarm-state/ktr-stop): the caller continues without it' : 'router disabled (TOOL_ROUTER_ENABLED off): the caller continues with request routing as before'] };
  }
  if (cfg.weights) checkWeights(cfg.weights, cfg.fitWeights);

  const c = await classify(req.text, req.context, deps.flags, deps.classifier || null);
  const plan = decompose(c, req.text);
  const resp: RouteResponse = { ...base, task_complexity: c.task_complexity, risk_classes: c.risk_classes, requirement: c.requirement,
    classifier: { method: c.method, confidence: c.confidence }, plan, shortlists: [], notes };
  if (c.requirement === 'no_tool') { notes.push('no tool needed: the model can answer this itself (request routing step 1)'); return finish(resp, req, deps); }
  if (c.requirement === 'clarify') { notes.push('the request is too vague to plan: ask the person what they want'); return finish(resp, req, deps); }

  const ix = deps.index && deps.index.snapshot === resp.catalog_snapshot ? deps.index : new RouterIndex(deps.store, { vectorModel: cfg.vectorModel || deps.queryVector?.model || deps.embed?.model });
  let qv = deps.queryVector || null;
  if (!qv && deps.embed && ix.vectors && cfg.useVector !== false) {
    try { qv = { model: deps.embed.model, vector: (await deps.embed.embed([req.text]))[0] }; } catch { notes.push('query embedding unavailable: lexical and capability signals only'); }
  }
  const cosines = qv && cfg.useVector !== false ? ix.cosines(qv.model, qv.vector) : null;
  const use = { capability: cfg.useCapability !== false, vector: !!cosines, lexical: cfg.useLexical !== false };
  if (!cosines && cfg.useVector !== false) notes.push(ix.vectors ? 'no query vector (not cached, gateway not asked): fit uses capability and lexical signals' : 'no vectors for this catalog: fit uses capability and lexical signals');
  const floor = cfg.floor ?? RELEVANCE_FLOOR;
  const maxC = req.constraints?.max_candidates;

  let anyEligible = false; let anyToolNode = false;
  const excludedTotal: Record<string, number> = {};
  for (const node of plan) {
    if (!node.needs_tool) continue;
    anyToolNode = true;
    const found = retrieve(ix, node, req.text, { useLexical: use.lexical, useVector: use.vector, useCapability: use.capability, queryVector: qv, cosines });
    const relevant = (x: typeof found[number]) => fitOf(x.signals, use, cfg.fitWeights) >= floor;
    const { eligible, excluded } = filter(found, { node, ctx: req.context, mode, flags: deps.flags, offline: !!deps.offline, constraints: req.constraints }, relevant);
    const ranked = rank(eligible, { weights: cfg.weights || DEFAULT_WEIGHTS, fitWeights: cfg.fitWeights, use, scoring: cfg.scoring, seed: route_id, exploration: !!cfg.exploration, evidence: deps.evidence, skills: deps.skills, aiaxWeight: cfg.aiaxWeight });
    const { candidates, kognaiFirst } = generate(ranked, node, req.context, { max: maxC, floor, mode });
    for (const [k, v] of Object.entries(excluded)) excludedTotal[k] = (excludedTotal[k] || 0) + (v || 0);
    const sl: NodeShortlist = { node_id: node.node_id, candidates, excluded: excluded as Record<string, number> };
    resp.shortlists.push(sl);
    if (candidates.length) anyEligible = true;
    if (kognaiFirst) notes.push(`${node.node_id}: a Kognai product covers ${node.capability}; outside tools are fallbacks only (ADR-008)`);
    if (!candidates.length) notes.push(explainEmpty(node, excluded));
  }
  if (anyToolNode && !anyEligible) resp.requirement = 'no_eligible_tool';
  if (resp.risk_classes.includes('payment')) notes.push('payment steps are never autonomous: a transfer is the Founder\'s own act (policy/security.txt rule 1); the Kognai Wallet is a spec only');
  if (mode === 'discover' && resp.shortlists.some((s) => s.candidates.some((x) => !x.executable))) notes.push('discover mode: quarantined tools are listed for review and are not executable');
  return finish(resp, req, deps);
}

function explainEmpty(node: PlanNode, excluded: Record<string, number | undefined>): string {
  const parts = RULE_IDS.filter((r) => excluded[r]).map((r) => `${excluded[r]} ${RULE_LABEL[r]} (${r})`);
  return parts.length ? `${node.node_id} ${node.capability}: no eligible tool; excluded: ${parts.join('; ')}` : `${node.node_id} ${node.capability}: no tool in the catalog covers this step`;
}

function finish(resp: RouteResponse, req: RouteRequest, deps: RouterDeps): RouteResponse {
  if (deps.log) {
    try {
      deps.log({
        route_id: resp.route_id, at: resp.created_at, caller_kind: req.context.kind, caller_id: req.context.caller_id,
        ...(req.context.kind === 'citizen' ? { text_sha256: sha(req.text) } : { text: req.text.slice(0, 500) }),
        snapshot: resp.catalog_snapshot, mode: resp.mode, requirement: resp.requirement, task_complexity: resp.task_complexity, risk: resp.risk_classes,
        nodes: resp.shortlists.map((s) => ({ node_id: s.node_id, top: s.candidates.slice(0, 10).map((c) => [c.tool_id, c.score]), excluded: s.excluded })),
      });
    } catch { /* logging never breaks routing */ }
  }
  return resp;
}
