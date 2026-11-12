/**
 * Ports (ADR-001, ADR-002). The package imports nothing from Kognai; Kognai wires these to files and to the ClawRouter
 * gateway. Tests wire fakes.
 */
import type { SuccessStats, ToolRecord, TrustState } from './tool';

export interface CatalogStore {
  /** Hash of the index (ids, versions, schema hashes, trust, lifecycle), stamped on every route. */
  snapshotId(): string;
  /** Every row, every version. */
  all(): Iterable<ToolRecord>;
  /** The newest version of each tool id: what the router reads. */
  latest(): Iterable<ToolRecord>;
  get(id: string, version?: string): ToolRecord | null;
  upsert(rows: ToolRecord[]): { added: number; versioned: number; unchanged: number };
  setTrust(id: string, version: string, to: TrustState, by: string, why: string): void;
  /** Appends a trust event without a state check (ingestion: drift, revocation). */
  recordEvent(e: TrustEvent): void;
  events(): TrustEvent[];
  vectors(model: string): { dims: number; ids: string[]; data: Float32Array } | null;
}

export interface EvidenceStore { stats(toolId: string): SuccessStats | null }

export interface EmbeddingPort { model: string; dims: number; embed(texts: string[]): Promise<Float32Array[]> }

export interface ClassifierLabels { capabilities: string[]; requirements: string[]; complexities: string[] }
export interface ClassifierAnswer { capabilities: string[]; requirement?: string; task_complexity?: string; confidence?: number }
export interface ClassifierPort { classify(text: string, labels: ClassifierLabels): Promise<ClassifierAnswer | null> }

export interface SkillRef { skill_id: string; version: string; uplift: number; evaluated: boolean }
export interface SkillIndex { forTool(toolId: string, op: string): SkillRef[] }

export interface Clock { now(): Date }

export interface TrustEvent { at: string; id: string; version: string; from: TrustState; to: TrustState; by: string; why: string }
