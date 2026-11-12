/**
 * Trust state and lifecycle transitions (plan.md S1, threat T2). quarantined -> reviewed -> verified; any state ->
 * revoked; revoked is terminal. A hash change on a reviewed or verified external row forces it back to quarantined.
 * Native Kognai rows start verified at ingest (code owned and reviewed in the repo); that is an initial state, not a
 * transition. Who may move an outside tool to verified is the CTO desk (decision D10): `by` is recorded on every event.
 */
import type { Lifecycle, ToolRecord, TrustState } from '../types/tool';

const TRUST: Record<TrustState, TrustState[]> = {
  quarantined: ['reviewed', 'revoked'],
  reviewed: ['verified', 'quarantined', 'deprecated', 'revoked'],
  verified: ['quarantined', 'deprecated', 'revoked'],
  deprecated: ['revoked'],
  revoked: [],
};

export function canTransition(from: TrustState, to: TrustState): boolean {
  return TRUST[from]?.includes(to) ?? false;
}

const LIFE: Record<Lifecycle, Lifecycle[]> = {
  draft: ['active', 'retired'],
  active: ['deprecated', 'retired'],
  deprecated: ['retired', 'active'],
  retired: [],
};

export function canMoveLifecycle(from: Lifecycle, to: Lifecycle): boolean {
  return LIFE[from]?.includes(to) ?? false;
}

/** The authority allowed to move an outside tool into reviewed or verified (decision D10). */
export const VERIFY_AUTHORITY = 'cto-desk';

/** Checks a requested trust move, including who asks. Returns null when allowed, else the reason. */
export function trustMoveProblem(rec: Pick<ToolRecord, 'origin' | 'trust_state'>, to: TrustState, by: string): string | null {
  if (!canTransition(rec.trust_state, to)) return `${rec.trust_state} -> ${to} is not an allowed transition`;
  if ((to === 'verified' || to === 'reviewed') && rec.origin !== 'kognai' && by !== VERIFY_AUTHORITY) {
    return `only ${VERIFY_AUTHORITY} may mark an outside tool ${to} (decision D10)`;
  }
  return null;
}

/**
 * Hash drift: when a reviewed or verified row from outside Kognai arrives with a different schema or implementation
 * hash, the new row is quarantined. Native Kognai rows keep their state (their code is in the repo).
 */
export function trustAfterDrift(
  prev: Pick<ToolRecord, 'origin' | 'trust_state' | 'schema_hash' | 'implementation_hash'>,
  next: { schema_hash: string; implementation_hash: string | null },
): { trust: TrustState; drifted: boolean } {
  const drifted = prev.schema_hash !== next.schema_hash || (prev.implementation_hash ?? null) !== (next.implementation_hash ?? null);
  if (prev.trust_state === 'revoked') return { trust: 'revoked', drifted };
  if (!drifted) return { trust: prev.trust_state, drifted };
  if (prev.origin === 'kognai') return { trust: prev.trust_state, drifted };
  return { trust: 'quarantined', drifted };
}
