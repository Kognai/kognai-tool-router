/**
 * The tool record (plan.md section 1). One row per (tool id, version). Everything the router reads about a tool is
 * here; the raw provider text is kept outside the record by hash only and is never shown to a model (threat T1).
 */
export type Origin = 'kognai' | 'mcp' | 'openapi' | 'x402' | 'community' | 'composio';
export type TrustState = 'quarantined' | 'reviewed' | 'verified' | 'deprecated' | 'revoked';
export type Lifecycle = 'draft' | 'active' | 'deprecated' | 'retired';
export type SideEffect = 'none' | 'read' | 'write' | 'publish' | 'message' | 'payment' | 'delete' | 'infra';
export type RiskClass =
  | 'read_only' | 'network' | 'data_modification' | 'publish_or_message'
  | 'payment' | 'destructive' | 'sensitive_data' | 'privileged_infra';
export type PrivacyClass = 'public' | 'internal' | 'private' | 'sensitive';
export type BusinessTier = 'free' | 'citizen_plus' | 'citizen_pro' | 'citizen_pro_max' | 'enterprise';
export type Currency = 'USDC' | 'KGC' | 'USD';
export type Network = 'base' | 'base-sepolia' | 'solana' | 'solana-devnet' | 'offchain';
export type JSONSchema = Record<string, unknown>;

export const ORIGINS: Origin[] = ['kognai', 'mcp', 'openapi', 'x402', 'community', 'composio'];
export const TRUST_STATES: TrustState[] = ['quarantined', 'reviewed', 'verified', 'deprecated', 'revoked'];
export const LIFECYCLES: Lifecycle[] = ['draft', 'active', 'deprecated', 'retired'];
export const SIDE_EFFECTS: SideEffect[] = ['none', 'read', 'write', 'publish', 'message', 'payment', 'delete', 'infra'];
export const RISK_CLASSES: RiskClass[] = [
  'read_only', 'network', 'data_modification', 'publish_or_message',
  'payment', 'destructive', 'sensitive_data', 'privileged_infra',
];
/** The four classes the benchmark measures recall on (plan.md section 6). */
export const HIGH_RISK: RiskClass[] = ['payment', 'destructive', 'publish_or_message', 'sensitive_data'];
export const PRIVACY_CLASSES: PrivacyClass[] = ['public', 'internal', 'private', 'sensitive'];
export const BUSINESS_TIERS: BusinessTier[] = ['free', 'citizen_plus', 'citizen_pro', 'citizen_pro_max', 'enterprise'];
export const NETWORKS: Network[] = ['base', 'base-sepolia', 'solana', 'solana-devnet', 'offchain'];

export interface Money { amount_micro: string; currency: Currency; network?: Network }

export interface Pricing {
  model: 'free' | 'per_call' | 'per_unit' | 'unknown';
  price?: Money;
  unit?: string;
  source: 'measured' | 'provider' | 'cfo_price_book' | 'unknown';
  observed_at?: string;
}

export interface ToolOperation {
  op: string;
  summary: string;
  capabilities: string[];
  input_schema: JSONSchema;
  output_schema: JSONSchema | null;
  side_effects: SideEffect[];
  risk_classes: RiskClass[];
  scopes: string[];
  idempotent: boolean | null;
  url_from_user: boolean;
}

export interface Provenance {
  source: string;
  source_ref: string;
  retrieved_at: string;
  licence: string | null;
  adapter: string;
  adapter_version: string;
  snapshot_sha256: string;
}

export interface SuccessStats {
  exec_ok: number; exec_n: number;
  verified_ok: number; verified_n: number;
  distinct_principals: number; window_days: number;
}

export interface ToolRecord {
  schema_version: 1;
  id: string;
  version: string;
  name: string;
  description_safe: string;
  description_raw_sha256: string;
  provider: { name: string; url?: string; kognai_owned: boolean };
  origin: Origin;
  category: string;
  tags: string[];
  operations: ToolOperation[];
  auth: { kind: 'none' | 'oauth' | 'api_key' | 'x402' | 'internal'; credential_ref?: string; provider?: string };
  privacy_class: PrivacyClass;
  business_tier: BusinessTier | null;
  regions: string[];
  networks: Network[];
  pricing: Pricing;
  success: SuccessStats;
  latency: { p50_ms: number | null; p95_ms: number | null; n: number };
  rate_limits: { per_min?: number; per_day?: number } | null;
  health: { state: 'up' | 'degraded' | 'down' | 'unknown'; checked_at: string | null; source: 'probe' | 'experience' | 'none' };
  dependencies: string[];
  trust_state: TrustState;
  skill_ids: string[];
  last_validated: string | null;
  schema_hash: string;
  implementation_hash: string | null;
  lifecycle: Lifecycle;
  aliases: string[];
  same_as: string[];
  product_id?: string;
  /** The provider's base URL serves a valid AIAX manifest (/aiax/manifest.json). Optional: absent = false, and an
   *  absent field leaves the record's canonical JSON (and every hash over it) unchanged. */
  aiax_ready?: boolean;
  provenance: Provenance[];
  ingested_at: string;
}

export const EMPTY_SUCCESS: SuccessStats = { exec_ok: 0, exec_n: 0, verified_ok: 0, verified_n: 0, distinct_principals: 0, window_days: 0 };
