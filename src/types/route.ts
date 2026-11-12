/**
 * Request, classification and response types (plan.md sections 3 and 4). "task_complexity" is the field name for the
 * ToolRouter's SIMPLE to REASONING scale (decision D3, ADR-002); "tier" alone always means a ClawRouter tier.
 */
import type { BusinessTier, JSONSchema, Network, Pricing, RiskClass, TrustState } from './tool';

export type TaskComplexity = 'SIMPLE' | 'MEDIUM' | 'COMPLEX' | 'REASONING';
export const TASK_COMPLEXITIES: TaskComplexity[] = ['SIMPLE', 'MEDIUM', 'COMPLEX', 'REASONING'];
export type Requirement = 'tool' | 'no_tool' | 'no_eligible_tool' | 'clarify';
export const REQUIREMENTS: Requirement[] = ['tool', 'no_tool', 'no_eligible_tool', 'clarify'];
export type Lang = 'en' | 'fr' | 'derja' | 'other';

export interface CallerContext {
  caller_id: string;
  principal_id: string;
  kind: 'citizen' | 'swarm' | 'engine' | 'external';
  business_tier: BusinessTier;
  connected: Array<{ provider: string; scopes: string[] }>;
  budget_remaining_micro?: string;
  kognai_first: 'hard' | 'prior' | 'off';
  /** Whose data the request is about (E7). Defaults to principal_id: a citizen reading its own owner's mail. */
  data_owner_id?: string;
}

export interface PlanNode {
  node_id: string;
  capability: string;
  depends_on: string[];
  risk_classes: RiskClass[];
  args_known: string[];
  args_missing: string[];
  /** false for model work (summarise given text, synthesise): no shortlist is built for the node. */
  needs_tool: boolean;
}

export interface CapabilityHit { id: string; confidence: number; span: string }

export interface Classification {
  task_complexity: TaskComplexity;
  risk_classes: RiskClass[];
  requirement: Requirement;
  capabilities: string[];
  hits: CapabilityHit[];
  confidence: number;
  method: 'rules' | 'model';
  language: Lang;
  args_known: string[];
  /** Words that asked for analysis, comparison or synthesis (REASONING). */
  reasoning_cues: string[];
  /** Text recognised as quoted data (an email body, a pasted page), excluded from cue detection (T5). */
  data_spans: number;
}

export interface RouteRequest {
  request_id?: string;
  text: string;
  context: CallerContext;
  mode?: 'discover' | 'execute_plan';
  constraints?: { max_candidates?: number; max_cost_micro?: string; networks?: Network[]; regions?: string[] };
  request_step?: 'simple' | 'product' | 'lax' | 'swarm';
}

export type ScorePart = 'fit' | 'schema' | 'success' | 'cost' | 'latency' | 'skills' | 'exploration' | 'aiax';

export interface Candidate {
  tool_id: string;
  version: string;
  operation: string;
  name: string;
  input_schema: JSONSchema;
  output_schema: JSONSchema | null;
  score: number;
  score_parts: Record<ScorePart, number>;
  reasons: string[];
  cost: Pricing;
  skills: Array<{ skill_id: string; version: string; uplift: number }>;
  auth_needed: { kind: 'oauth' | 'api_key' | 'x402' | 'approval'; provider?: string; scopes?: string[] } | null;
  confidence: number;
  fallbacks: string[];
  evidence: { verified_n: number; cold_start: boolean };
  trust_state: TrustState;
  /** false for a quarantined tool shown in discover mode: listed, never executable (threat T2). */
  executable: boolean;
}

export interface NodeShortlist { node_id: string; candidates: Candidate[]; excluded: Record<string, number> }

export interface RouteResponse {
  route_id: string;
  created_at: string;
  catalog_snapshot: string;
  mode: 'discover' | 'execute_plan';
  task_complexity: TaskComplexity;
  risk_classes: RiskClass[];
  requirement: Requirement;
  classifier: { method: 'rules' | 'model'; confidence: number };
  plan: PlanNode[];
  shortlists: NodeShortlist[];
  request_step?: string;
  notes: string[];
}
