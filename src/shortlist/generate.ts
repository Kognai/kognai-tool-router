/**
 * Shortlist (plan.md S3): at most min(10, max_candidates) per node, eligible only, above the relevance floor, with
 * reasons, fallbacks and auth needs. Kognai first (ADR-008): with kognai_first 'hard', when a Kognai product covers the
 * step, outside tools are returned only as fallbacks of the first Kognai candidate; with 'prior' Kognai tools get a
 * small bonus; with 'off' merit alone. Linked duplicates (same_as) collapse into fallbacks. Nothing in a candidate is
 * copied from provider text except its name.
 */
import type { Candidate, CallerContext, PlanNode } from '../types/route';
import type { Ranked } from '../rank/ranker';
import { authNeeded, isKognaiProduct } from '../eligibility/rules';
import { RELEVANCE_FLOOR } from '../rank/weights';

export const MAX_CANDIDATES = 10;
export const PRIOR_BONUS = 0.05;
export const CONNECTED_BONUS = 0.02;

const r4 = (x: number) => Math.round(x * 10000) / 10000;

export interface ShortlistOpts { max?: number; floor?: number; mode: 'discover' | 'execute_plan' }

export function generate(ranked: Ranked[], node: PlanNode, ctx: CallerContext, o: ShortlistOpts): { candidates: Candidate[]; kognaiFirst: boolean } {
  const max = Math.max(0, Math.min(MAX_CANDIDATES, o.max ?? MAX_CANDIDATES));
  let list = ranked.filter((x) => x.fit >= (o.floor ?? RELEVANCE_FLOOR));
  // an account the owner already connected beats the same tool on an account still to connect
  list = list.map((x) => (x.r.item.rec.auth.kind === 'oauth' && authNeeded(x.r.item.rec, x.r.item.op, ctx) === null ? { ...x, score: x.score + CONNECTED_BONUS, reasons: [...x.reasons, "the owner's account is already connected"] } : x))
    .sort((a, b) => b.score - a.score || (a.r.item.key < b.r.item.key ? -1 : 1));
  let outsideFallbacks: string[] = [];
  let kognaiFirst = false;
  if (ctx.kognai_first === 'prior') {
    list = list.map((x) => (isKognaiProduct(x.r.item.rec) ? { ...x, score: x.score + PRIOR_BONUS } : x)).sort((a, b) => b.score - a.score || (a.r.item.key < b.r.item.key ? -1 : 1));
  } else if (ctx.kognai_first === 'hard') {
    const covers = list.some((x) => isKognaiProduct(x.r.item.rec) && x.r.signals.capability === 1);
    if (covers) {
      kognaiFirst = true;
      outsideFallbacks = list.filter((x) => !isKognaiProduct(x.r.item.rec)).slice(0, max).map((x) => x.r.item.key);
      list = list.filter((x) => isKognaiProduct(x.r.item.rec));
    }
  }
  // same_as: keep the first (best) of a linked group, the others become its fallbacks
  const kept: Ranked[] = [];
  const extra = new Map<string, string[]>();
  for (const x of list) {
    const rec = x.r.item.rec;
    const head = kept.find((k) => k.r.item.rec.same_as.includes(rec.id) || rec.same_as.includes(k.r.item.rec.id));
    if (head) { (extra.get(head.r.item.key) || extra.set(head.r.item.key, []).get(head.r.item.key)!).push(x.r.item.key); continue; }
    kept.push(x);
    if (kept.length >= max) break;
  }
  const candidates: Candidate[] = kept.map((x, i) => {
    const { rec, op } = x.r.item;
    const reasons = [...x.reasons];
    if (kognaiFirst && i === 0) reasons.unshift('Kognai product first (ADR-008): outside tools are fallbacks');
    const auth = authNeeded(rec, op, ctx);
    if (auth?.kind === 'oauth') reasons.push(`needs the owner's ${auth.provider} connection`);
    if (auth?.kind === 'approval') reasons.push('needs an approval before it runs');
    return {
      tool_id: x.r.item.key,
      version: rec.version,
      operation: op.op,
      name: rec.name,
      input_schema: op.input_schema,
      output_schema: op.output_schema,
      score: r4(x.score),
      score_parts: Object.fromEntries(Object.entries(x.parts).map(([k, v]) => [k, r4(v)])) as Candidate['score_parts'],
      reasons,
      cost: rec.pricing,
      skills: x.skills.map((s) => ({ skill_id: s.skill_id, version: s.version, uplift: r4(s.uplift) })),
      auth_needed: auth,
      confidence: r4(x.confidence),
      fallbacks: [...(extra.get(x.r.item.key) || []), ...(i === 0 ? outsideFallbacks : [])],
      evidence: { verified_n: x.stats.verified_n, cold_start: x.cold },
      trust_state: rec.trust_state,
      executable: rec.trust_state === 'verified' || rec.trust_state === 'reviewed',
    };
  });
  return { candidates, kognaiFirst };
}
