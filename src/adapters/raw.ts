/**
 * The adapter contract: what every source adapter emits before ingestion. Adapters are pure functions over pinned
 * input (a parsed file); none of them fetches, installs or runs anything.
 */
import type {
  BusinessTier, JSONSchema, Lifecycle, Network, Origin, Pricing, PrivacyClass, SideEffect, ToolRecord,
} from '../types/tool';

export interface RawOp {
  op: string;
  summary: string;
  input_schema?: JSONSchema | null;
  output_schema?: JSONSchema | null;
  /** null or absent = unknown, which ingestion treats as network + data modification (never safe). */
  side_effects?: SideEffect[] | null;
  scopes?: string[];
  idempotent?: boolean | null;
  capabilities?: string[];
  method?: string;
  path?: string;
}

/** Where a descriptor came from; every adapter receives this from the caller. */
export interface ProvenanceIn {
  source: string;
  retrieved_at: string;
  licence: string | null;
  snapshot_sha256: string;
}

export interface RawToolDescriptor {
  source: string;
  source_ref: string;
  origin: Origin;
  /** namespace/name for the tool id (ADR-004), before normalisation. */
  path: string;
  name: string;
  description: string;
  provider: { name: string; url?: string; kognai_owned?: boolean };
  category?: string;
  tags?: string[];
  operations: RawOp[];
  auth?: ToolRecord['auth'];
  pricing?: Pricing;
  pricing_text?: string;
  licence?: string | null;
  endpoint?: string;
  package?: { registry: string; identifier: string; version?: string };
  /** 'package' = code to install (never run by KTR), 'remote' = a hosted endpoint, 'native' = Kognai code in repo. */
  implementation?: 'package' | 'remote' | 'native' | 'http' | 'metadata';
  version?: string;
  privacy_class?: PrivacyClass;
  business_tier?: BusinessTier | null;
  regions?: string[];
  networks?: Network[];
  product_id?: string;
  /** The provider serves a valid AIAX manifest (checked by the caller; only true is carried into the record). */
  aiax_ready?: boolean;
  aliases?: string[];
  skill_ids?: string[];
  lifecycle?: Lifecycle;
  dependencies?: string[];
  /** A digest of the implementation when the source knows it (package version, file content of native code). */
  implementation_hash?: string;
  /** Tags the tool as a Kognai release path that keeps the Founder's approval (E4 publish exception). */
  founder_approval?: boolean;
  provenance: ProvenanceIn & { adapter: string; adapter_version: string };
}

export const prov = (p: ProvenanceIn, adapter: string, adapter_version: string) => ({ ...p, adapter, adapter_version });
