/**
 * Eligibility (plan.md S3), applied before any scoring, in order; the first failing rule excludes. Missing evidence is
 * never safe: each rule says what happens when the evidence is absent. E10 (Kognai first) and E11 (authorisation) do
 * not exclude: E10 is applied by the shortlist (fallbacks), E11 marks auth_needed on the candidate.
 */
import type { KtrFlags } from '../flags';
import type { CallerContext, PlanNode, RouteRequest } from '../types/route';
import type { BusinessTier, RiskClass, ToolOperation, ToolRecord } from '../types/tool';
import { microOf } from '../money';

export type RuleId = 'E1' | 'E2' | 'E3' | 'E4' | 'E5' | 'E6' | 'E7' | 'E8' | 'E9';
export const RULE_IDS: RuleId[] = ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9'];
export const RULE_LABEL: Record<RuleId, string> = {
  E1: 'not active (draft, deprecated or retired)',
  E2: 'trust: revoked, deprecated, or quarantined outside discover mode',
  E3: 'KTR stopped or disabled',
  E4: 'risk class not allowed without an approval path (payment, destructive, privileged infrastructure; publish or message for citizens)',
  E5: 'takes a URL from the conversation (no fetch from chat)',
  E6: 'business tier above the caller, or not yet classified',
  E7: 'private data of someone other than the principal',
  E8: 'region or network outside the caller constraints',
  E9: 'price above the budget, or unknown with a budget',
};

export const NEVER_AUTONOMOUS: RiskClass[] = ['payment', 'destructive', 'privileged_infra'];
const TIER_RANK: Record<BusinessTier, number> = { free: 0, citizen_plus: 1, citizen_pro: 2, citizen_pro_max: 3, enterprise: 4 };
/** 3000 KGC = 1 USD (policy/kgc-revenue.txt): 1 KGC = 333.33 micro USD, rounded up so a KGC price never looks cheaper. */
const KGC_TO_MICRO = (kgc: bigint) => (kgc * 1_000_000n + 2_999n) / 3_000n;

export interface EligibilityInput {
  rec: ToolRecord;
  op: ToolOperation;
  node: PlanNode;
  ctx: CallerContext;
  mode: 'discover' | 'execute_plan';
  flags: Pick<KtrFlags, 'stopped' | 'enabled'>;
  offline: boolean;
  constraints?: RouteRequest['constraints'];
}

export function isKognaiProduct(rec: ToolRecord): boolean {
  return rec.origin === 'kognai' && rec.provider.kognai_owned === true;
}

export function budgetMicro(ctx: CallerContext, c?: RouteRequest['constraints']): bigint | null {
  const a = microOf(ctx.budget_remaining_micro ?? null);
  const b = microOf(c?.max_cost_micro ?? null);
  if (a === null) return b;
  if (b === null) return a;
  return a < b ? a : b;
}

export function priceMicroUsd(rec: ToolRecord): bigint | null {
  if (rec.pricing.model === 'free') return 0n;
  const p = rec.pricing.price;
  if (!p) return null;
  const m = microOf(p.amount_micro);
  if (m === null) return null;
  return p.currency === 'KGC' ? KGC_TO_MICRO(m) : m;
}

/** The first rule that excludes, or null when eligible. */
export function firstFailure(x: EligibilityInput): RuleId | null {
  const { rec, op, node, ctx, mode } = x;
  // E4 for the step itself comes first: a payment, destructive or privileged step is refused whatever tool would do it
  if (NEVER_AUTONOMOUS.some((r) => node.risk_classes.includes(r))) return 'E4';
  // E1 lifecycle
  if (rec.lifecycle !== 'active') return 'E1';
  // E2 trust
  if (rec.trust_state === 'revoked' || rec.trust_state === 'deprecated') return 'E2';
  if (rec.trust_state === 'quarantined' && mode !== 'discover') return 'E2';
  // E3 kill switch and flags
  if (x.flags.stopped || (!x.flags.enabled && !x.offline)) return 'E3';
  // E4 risk policy, for the tool's operation and for the step asked
  const risks = new Set<RiskClass>([...op.risk_classes, ...node.risk_classes]);
  if (NEVER_AUTONOMOUS.some((r) => risks.has(r))) return 'E4';
  if (ctx.kind === 'citizen' && risks.has('publish_or_message') && !(isKognaiProduct(rec) && rec.tags.includes('founder_approval'))) return 'E4';
  // E5 no fetch from chat
  if (ctx.kind === 'citizen' && op.url_from_user) return 'E5';
  // E6 business tier
  if (rec.business_tier === null) { if (ctx.kind === 'citizen') return 'E6'; }
  else if (TIER_RANK[rec.business_tier] > TIER_RANK[ctx.business_tier]) return 'E6';
  // E7 privacy: private and sensitive tools only for the data owner's own principal
  if (rec.privacy_class === 'private' || rec.privacy_class === 'sensitive') {
    const owner = ctx.data_owner_id ?? ctx.principal_id;
    if (!ctx.principal_id || owner !== ctx.principal_id || ctx.kind === 'external') return 'E7';
  }
  // E8 regions and networks, when the caller sets constraints
  const c = x.constraints;
  if (c?.regions?.length && !rec.regions.includes('*') && !rec.regions.some((r) => c.regions!.includes(r))) return 'E8';
  if (c?.networks?.length) {
    const paid = rec.auth.kind === 'x402' || (rec.pricing.model !== 'free' && rec.pricing.model !== 'unknown');
    if (paid && !rec.networks.some((n) => c.networks!.includes(n))) return 'E8';
  }
  // E9 budget
  const budget = budgetMicro(ctx, c);
  if (budget !== null) {
    const price = priceMicroUsd(rec);
    if (price === null || price > budget) return 'E9';
  }
  return null;
}

/** E11: what the caller must still provide before this tool could run. Never an exclusion. */
export function authNeeded(rec: ToolRecord, op: ToolOperation, ctx: CallerContext): { kind: 'oauth' | 'api_key' | 'x402' | 'approval'; provider?: string; scopes?: string[] } | null {
  if (rec.tags.includes('founder_approval') || op.risk_classes.includes('publish_or_message')) return { kind: 'approval' };
  if (rec.auth.kind === 'oauth') {
    const conn = ctx.connected.find((c) => c.provider === rec.auth.provider);
    if (!conn || op.scopes.some((s) => !conn.scopes.includes(s))) return { kind: 'oauth', provider: rec.auth.provider, scopes: op.scopes };
    return null;
  }
  if (rec.auth.kind === 'x402') return { kind: 'x402' };
  if (rec.auth.kind === 'api_key' && rec.origin !== 'kognai') return { kind: 'api_key', provider: rec.provider.name };
  return null;
}
