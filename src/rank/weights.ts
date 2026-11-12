/**
 * Ranking weights (plan.md S3, the directive's split): fit 30, schema 20, success 20, cost 10, latency 10, skills 10,
 * plus up to 0.03 exploration. fit = 0.45 capability + 0.35 vector + 0.20 lexical. Configurable; validated to sum to 1.
 */
export interface Weights { fit: number; schema: number; success: number; cost: number; latency: number; skills: number }
export interface FitWeights { capability: number; vector: number; lexical: number }

export const DEFAULT_WEIGHTS: Weights = { fit: 0.30, schema: 0.20, success: 0.20, cost: 0.10, latency: 0.10, skills: 0.10 };
export const DEFAULT_FIT: FitWeights = { capability: 0.45, vector: 0.35, lexical: 0.20 };
export const EXPLORATION_MAX = 0.03;
/**
 * AIAX ready (2026-10-12, AIAX rollout): a tool whose provider serves a valid AIAX manifest (/aiax/manifest.json,
 * spec github.com/Godman-s/aiax) gets this flat bonus on top of the weighted parts, like exploration. A tie breaker
 * only: at 0.02 it is smaller than a 0.07 gap in fit (0.30 x 0.07), so it never beats a clearly better match.
 * Configurable per call (RankOpts.aiaxWeight, RouterConfig.aiaxWeight); 0 turns it off.
 */
export const AIAX_READY_WEIGHT = 0.02;
/** A candidate whose fit is under this is not shown (fewer than 10 is normal). */
export const RELEVANCE_FLOOR = 0.35;

export function checkWeights(w: Weights, f: FitWeights = DEFAULT_FIT): void {
  const s = w.fit + w.schema + w.success + w.cost + w.latency + w.skills;
  if (Math.abs(s - 1) > 1e-9) throw new Error(`ranking weights sum to ${s}, not 1`);
  const t = f.capability + f.vector + f.lexical;
  if (Math.abs(t - 1) > 1e-9) throw new Error(`fit weights sum to ${t}, not 1`);
  for (const v of [...Object.values(w), ...Object.values(f)]) if (v < 0) throw new Error('negative weight');
}

/** Fit from the signals in use: weights of signals that are off are spread over the others. */
export function fitOf(s: { capability: number; vector: number; lexical: number }, use: { capability: boolean; vector: boolean; lexical: boolean }, f: FitWeights = DEFAULT_FIT): number {
  let num = 0; let den = 0;
  if (use.capability) { num += f.capability * s.capability; den += f.capability; }
  if (use.vector) { num += f.vector * s.vector; den += f.vector; }
  if (use.lexical) { num += f.lexical * s.lexical; den += f.lexical; }
  return den ? num / den : 0;
}
