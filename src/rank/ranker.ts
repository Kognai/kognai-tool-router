/**
 * The ranker (plan.md S3): score = weighted parts + exploration. Reasons are written from the parts by this code,
 * never copied from provider text (T1). Deterministic for a given seed: exploration is a hash of the route id and the
 * tool id, off unless asked for.
 */
import { createHash } from 'node:crypto';
import type { Retrieved } from '../retrieve/hybrid';
import type { ScorePart } from '../types/route';
import type { EvidenceStore, SkillIndex, SkillRef } from '../types/ports';
import type { SuccessStats } from '../types/tool';
import { priceMicroUsd } from '../eligibility/rules';
import { evidenceConfidence, successScore } from './confidence';
import { AIAX_READY_WEIGHT, DEFAULT_FIT, DEFAULT_WEIGHTS, EXPLORATION_MAX, fitOf, type FitWeights, type Weights } from './weights';

export interface RankOpts {
  weights?: Weights;
  fitWeights?: FitWeights;
  use?: { capability: boolean; vector: boolean; lexical: boolean };
  /** 'full' = every part; 'fit' = fit only (the hybrid retrieval baseline of the benchmark). */
  scoring?: 'full' | 'fit';
  seed?: string;
  exploration?: boolean;
  evidence?: EvidenceStore | null;
  skills?: SkillIndex | null;
  /** The AIAX ready bonus (weights.ts AIAX_READY_WEIGHT by default); 0 turns it off. */
  aiaxWeight?: number;
}

export interface Ranked {
  r: Retrieved;
  fit: number;
  score: number;
  parts: Record<ScorePart, number>;
  reasons: string[];
  confidence: number;
  skills: SkillRef[];
  stats: SuccessStats;
  cold: boolean;
}

const unitHash = (s: string) => createHash('sha256').update(s).digest().readUInt32BE(0) / 0xffffffff;

export function rank(cands: Retrieved[], o: RankOpts = {}): Ranked[] {
  const w = o.weights || DEFAULT_WEIGHTS;
  const aiaxW = typeof o.aiaxWeight === 'number' && Number.isFinite(o.aiaxWeight) && o.aiaxWeight >= 0 ? o.aiaxWeight : AIAX_READY_WEIGHT;
  const use = o.use || { capability: true, vector: true, lexical: true };
  // cost and latency are normalised inside the node's candidate set
  const prices = cands.map((c) => priceMicroUsd(c.item.rec));
  const known = prices.filter((p): p is bigint => p !== null && p > 0n).map((p) => Math.log10(Number(p) + 1));
  const pMin = known.length ? Math.min(...known) : 0; const pMax = known.length ? Math.max(...known) : 0;
  const lats = cands.map((c) => c.item.rec.latency.p50_ms).filter((x): x is number => typeof x === 'number');
  const lMin = lats.length ? Math.min(...lats) : 0; const lMax = lats.length ? Math.max(...lats) : 0;

  const out: Ranked[] = cands.map((c, i) => {
    const rec = c.item.rec;
    const fit = fitOf(c.signals, use, o.fitWeights || DEFAULT_FIT);
    const stats = o.evidence?.stats(rec.id) || rec.success;
    const success = successScore(rec, stats);
    const p = prices[i];
    const cost = p === null ? 0.5 : p === 0n ? 1 : (pMax > pMin ? 1 - (Math.log10(Number(p) + 1) - pMin) / (pMax - pMin) : 0.8);
    const l = rec.latency.p50_ms;
    const latency = typeof l !== 'number' ? 0.5 : lMax > lMin ? 1 - (l - lMin) / (lMax - lMin) : 0.8;
    const skills = (o.skills?.forTool(rec.id, c.item.op.op) || []).filter((s) => s.uplift > 0).sort((a, b) => b.uplift - a.uplift);
    const skillPart = skills.length ? Math.min(1, skills[0].uplift) : 0;
    const cold = stats.verified_n < 5;
    const exploration = o.exploration && cold && fit >= 0.7 ? EXPLORATION_MAX * unitHash(`${o.seed || ''}|${rec.id}`) : 0;
    const aiax = rec.aiax_ready === true ? aiaxW : 0;
    const parts: Record<ScorePart, number> = { fit, schema: c.signals.schema, success, cost, latency, skills: skillPart, exploration, aiax };
    const score = o.scoring === 'fit' ? fit
      : w.fit * fit + w.schema * c.signals.schema + w.success * success + w.cost * cost + w.latency * latency + w.skills * skillPart + exploration + aiax;
    return { r: c, fit, score, parts, reasons: reasonsOf(c, parts, rec.trust_state, rec.origin, p, cold, skills), confidence: Math.min(fit, evidenceConfidence(rec, stats)), skills, stats, cold };
  });
  return out.sort((a, b) => b.score - a.score || (a.r.item.key < b.r.item.key ? -1 : 1));
}

function reasonsOf(c: Retrieved, parts: Record<ScorePart, number>, trust: string, origin: string, price: bigint | null, cold: boolean, skills: SkillRef[]): string[] {
  const r: string[] = [];
  if (c.signals.capability === 1) r.push('capability matches the step');
  else if (c.signals.capability === 0.5) r.push('related capability (same family)');
  if (c.signals.lexical >= 0.5) r.push('strong match on the request words');
  else if (c.signals.lexical > 0) r.push('partial match on the request words');
  if (c.signals.cosine !== null) r.push(`semantic similarity ${c.signals.cosine.toFixed(2)}`);
  if (c.signals.schema === 0.3) r.push('input schema unknown');
  else if (c.signals.schema >= 0.8) r.push('the request supplies the required inputs');
  else r.push('some required inputs are missing');
  if (trust === 'verified' && origin === 'kognai') r.push('Kognai tool, verified in the repository');
  else if (trust === 'verified' || trust === 'reviewed') r.push(`outside tool, ${trust} by the CTO desk`);
  else if (trust === 'quarantined') r.push('quarantined: listed for discovery, not executable');
  r.push(price === null ? 'price unknown' : price === 0n ? 'free' : 'priced per call');
  if (cold) r.push('no verified runs yet (cold start)');
  if (skills.length) r.push(`a skill applies (${skills[0].evaluated ? 'evaluated' : 'unevaluated'} uplift ${skills[0].uplift.toFixed(2)})`);
  if (parts.exploration > 0) r.push('exploration bonus for a new tool');
  if (parts.aiax > 0) r.push('provider publishes a valid AIAX manifest');
  return r;
}
