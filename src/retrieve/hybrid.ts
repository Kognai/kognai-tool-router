/**
 * Hybrid retrieval (plan.md S3). RouterIndex is built once per catalog snapshot: one document per operation of the
 * newest version of each tool (name, sanitised description, summary, tags, capability words), a BM25 index, an
 * inverted capability index and, when the catalog has vectors for the model, a normalised vector matrix.
 *
 * retrieve() takes the union of the top 50 by each signal plus every exact capability match (capped), then returns
 * per candidate signals in 0..1: lexical, vector, capability, schema, health. History (success) is the ranker's.
 */
import type { CatalogStore } from '../types/ports';
import type { PlanNode } from '../types/route';
import type { ToolOperation, ToolRecord } from '../types/tool';
import { capabilityById } from '../classify/taxonomy';
import { Bm25Index } from './bm25';
import { capabilityScore } from './capability';
import { schemaFit } from './schema-fit';
import { tokenise } from './tokenise';
import { checkQuery, cosineAll, normaliseRows } from './vector';

export interface IndexedOp { key: string; rec: ToolRecord; op: ToolOperation }

export interface VectorCalibration { lo: number; hi: number }
/** Cosine to 0..1: below lo is no semantic match, above hi a full one. Per model, measured (bench report). */
export const CALIBRATION: Record<string, VectorCalibration> = {
  'bge-m3': { lo: 0.35, hi: 0.7 },
  'ktr-hash-256': { lo: 0.05, hi: 0.6 },
};

export class RouterIndex {
  readonly ops: IndexedOp[] = [];
  readonly byKey = new Map<string, number>();
  readonly byCap = new Map<string, number[]>();
  readonly bm25: Bm25Index;
  vectors: { model: string; dims: number; data: Float32Array; rowOf: Int32Array } | null = null;
  readonly snapshot: string;

  constructor(store: CatalogStore, opts: { vectorModel?: string; records?: Iterable<ToolRecord> } = {}) {
    this.snapshot = store.snapshotId();
    const docs: Array<{ key: string; text: string }> = [];
    for (const rec of opts.records ?? store.latest()) {
      for (const op of rec.operations) {
        const key = `${rec.id}#${op.op}`;
        const i = this.ops.length;
        this.ops.push({ key, rec, op });
        this.byKey.set(key, i);
        for (const c of op.capabilities) (this.byCap.get(c) || this.byCap.set(c, []).get(c)!).push(i);
        docs.push({ key, text: docText(rec, op) });
      }
    }
    this.bm25 = new Bm25Index(docs);
    if (opts.vectorModel) {
      const v = store.vectors(opts.vectorModel);
      if (v) {
        const data = normaliseRows(v.data, v.dims);
        const rowOf = new Int32Array(this.ops.length).fill(-1);
        const pos = new Map(v.ids.map((id, r) => [id, r]));
        for (let i = 0; i < this.ops.length; i++) rowOf[i] = pos.get(this.ops[i].key) ?? -1;
        this.vectors = { model: opts.vectorModel, dims: v.dims, data, rowOf };
      }
    }
  }

  /** Cosine of the query against every operation (NaN where an operation has no vector). */
  cosines(model: string, q: Float32Array): Float32Array | null {
    if (!this.vectors) return null;
    checkQuery(this.vectors, model, q);
    const rows = cosineAll(q, this.vectors.data, this.vectors.dims);
    const out = new Float32Array(this.ops.length).fill(NaN);
    for (let i = 0; i < this.ops.length; i++) { const r = this.vectors.rowOf[i]; if (r >= 0) out[i] = rows[r]; }
    return out;
  }
}

export function docText(rec: ToolRecord, op: ToolOperation): string {
  const capWords = op.capabilities.map((c) => c.replace(/[._]/g, ' ')).join(' ');
  return `${rec.name} ${rec.description_safe} ${op.op.replace(/[_.-]/g, ' ')} ${op.summary} ${rec.tags.join(' ')} ${capWords}`;
}

/** The text embedded for an operation: provider facts only (sanitised), no KTR tags, so vectors survive a taxonomy change. */
export function embedDocText(rec: ToolRecord, op: ToolOperation): string {
  return `${rec.name}. ${op.op.replace(/[_.-]/g, ' ')}: ${op.summary}. ${rec.description_safe}`.slice(0, 2000);
}

/** Words for a node's lexical query: the request plus the capability's own label and first cues. */
export function nodeQueryTokens(text: string, capability: string): string[] {
  const def = capabilityById(capability);
  const label = capability.replace(/[._]/g, ' ');
  const cueWords = def ? def.cues.en.slice(0, 3).map((c) => c.replace(/\\[a-z]|[()?|.*+\[\]{}^$\\]/g, ' ')).join(' ') : '';
  return [...tokenise(text), ...tokenise(label), ...tokenise(label), ...tokenise(cueWords)];
}

export interface Signals { lexical: number; vector: number; capability: number; schema: number; health: number; cosine: number | null }
export interface Retrieved { index: number; item: IndexedOp; signals: Signals }

export interface RetrieveOpts {
  topN?: number;          // per signal (50)
  capCap?: number;        // exact capability matches kept (300)
  useLexical?: boolean;
  useVector?: boolean;
  useCapability?: boolean;
  queryVector?: { model: string; vector: Float32Array } | null;
  cosines?: Float32Array | null; // precomputed for the request (shared by its nodes)
  prevOutput?: (node: PlanNode) => Record<string, unknown> | null;
}

const HEALTH: Record<string, number> = { up: 1, degraded: 0.5, unknown: 0.5, down: 0 };

export function retrieve(ix: RouterIndex, node: PlanNode, text: string, o: RetrieveOpts = {}): Retrieved[] {
  const topN = o.topN ?? 50;
  const useLex = o.useLexical !== false;
  const useVec = o.useVector !== false && !!o.cosines;
  const useCap = o.useCapability !== false;
  const pool = new Set<number>();
  let lexScores = new Map<number, number>();
  if (useLex) {
    lexScores = ix.bm25.scoreAll(nodeQueryTokens(text, node.capability));
    [...lexScores].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, topN).forEach(([i]) => pool.add(i));
  }
  const cos = useVec ? o.cosines! : null;
  if (cos) {
    const idx: number[] = [];
    for (let i = 0; i < cos.length; i++) if (!Number.isNaN(cos[i])) idx.push(i);
    idx.sort((a, b) => cos[b] - cos[a] || a - b).slice(0, topN).forEach((i) => pool.add(i));
  }
  if (useCap) (ix.byCap.get(node.capability) || []).slice(0, o.capCap ?? 300).forEach((i) => pool.add(i));
  const maxLex = Math.max(1e-9, ...[...pool].map((i) => lexScores.get(i) || 0));
  const cal = CALIBRATION[o.queryVector?.model || ''] || { lo: 0.3, hi: 0.8 };
  const out: Retrieved[] = [];
  for (const i of pool) {
    const item = ix.ops[i];
    const c = cos && !Number.isNaN(cos[i]) ? cos[i] : null;
    out.push({
      index: i, item,
      signals: {
        lexical: useLex ? (lexScores.get(i) || 0) / maxLex : 0,
        vector: c === null ? 0 : Math.max(0, Math.min(1, (c - cal.lo) / (cal.hi - cal.lo))),
        capability: useCap ? capabilityScore(node.capability, item.op.capabilities) : 0,
        schema: schemaFit(node, item.op.input_schema, o.prevOutput?.(node) ?? null),
        health: HEALTH[item.rec.health.state] ?? 0.5,
        cosine: c,
      },
    });
  }
  return out;
}
