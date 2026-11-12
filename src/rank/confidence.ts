/**
 * Success scores that know how sure they are (plan.md S3, threat T10). The Wilson lower bound (z 1.64) of verified
 * successes, with a Beta prior by origin and trust: Kognai verified (4, 1), reviewed outside (2, 2), anything else
 * (1, 1). Execution success (the call returned) counts only when nothing was verified, at half weight, with its sample
 * capped and shrunk by the number of distinct principals, so a tool cannot buy a score with self reports.
 */
import type { SuccessStats, ToolRecord } from '../types/tool';

export const Z = 1.64;

export function wilsonLower(ok: number, n: number, z = Z): number {
  if (n <= 0) return 0;
  const p = Math.min(1, Math.max(0, ok / n));
  const z2 = z * z;
  const den = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return Math.max(0, (centre - margin) / den);
}

export function priorOf(rec: Pick<ToolRecord, 'origin' | 'trust_state'>): [number, number] {
  if (rec.origin === 'kognai' && rec.trust_state === 'verified') return [4, 1];
  if (rec.trust_state === 'reviewed' || rec.trust_state === 'verified') return [2, 2];
  return [1, 1];
}

export const EXEC_CAP = 20;
export const PRINCIPALS_FULL = 10;

export function successScore(rec: Pick<ToolRecord, 'origin' | 'trust_state'>, s: SuccessStats): number {
  const [a, b] = priorOf(rec);
  if (s.verified_n > 0) {
    const shrink = Math.min(1, Math.max(1, s.distinct_principals) / PRINCIPALS_FULL);
    const n = s.verified_n * shrink;
    const ok = s.verified_ok * shrink;
    return wilsonLower(ok + a, n + a + b);
  }
  if (s.exec_n > 0) {
    const shrink = Math.min(1, Math.max(1, s.distinct_principals) / PRINCIPALS_FULL);
    const n = Math.min(EXEC_CAP, s.exec_n) * shrink;
    const ok = n * (s.exec_ok / s.exec_n);
    return 0.5 * wilsonLower(ok + a, n + a + b);
  }
  return wilsonLower(a, a + b);
}

/** How much the evidence says about the tool, 0..1: trust plus sample size. */
export function evidenceConfidence(rec: Pick<ToolRecord, 'trust_state' | 'origin'>, s: SuccessStats): number {
  const base = rec.trust_state === 'verified' ? 0.7 : rec.trust_state === 'reviewed' ? 0.55 : 0.3;
  return Math.min(1, base + 0.3 * (1 - 1 / (1 + s.verified_n / 10)));
}
