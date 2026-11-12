/**
 * In memory CatalogStore: tests, the benchmark, and the base of the file store. Rows are keyed by id and version;
 * `latest` follows ingestion order. The snapshot id hashes the index (id, version, schema hash, content hash, trust,
 * lifecycle), never a timestamp, so the same inputs give the same snapshot id and any change routing can see (a new
 * capability tag, a sanitised description) gives a new one.
 */
import { canonical, sha256 } from '../hash';
import type { CatalogStore, TrustEvent } from '../types/ports';
import type { ToolRecord, TrustState } from '../types/tool';
import { trustMoveProblem } from './lifecycle';

export interface IndexEntry { id: string; version: string; schema_hash: string; content_sha: string; trust_state: TrustState; lifecycle: string; latest: boolean }

/** Hash of what routing reads from a row: everything but ingestion and retrieval times. */
export const contentSha = (r: ToolRecord): string =>
  sha256(canonical({ ...r, ingested_at: '', provenance: r.provenance.map((p) => ({ ...p, retrieved_at: '' })) })).slice(0, 16);

export class MemoryCatalogStore implements CatalogStore {
  protected rows = new Map<string, ToolRecord>();
  protected latestVersion = new Map<string, string>();
  protected trustEvents: TrustEvent[] = [];
  protected vecs = new Map<string, { dims: number; ids: string[]; data: Float32Array }>();
  private snap: string | null = null;

  constructor(rows: ToolRecord[] = []) { if (rows.length) this.upsert(rows); }

  protected key = (id: string, version: string) => `${id}@${version}`;

  index(): IndexEntry[] {
    return [...this.rows.values()]
      .map((r) => ({ id: r.id, version: r.version, schema_hash: r.schema_hash, content_sha: contentSha(r), trust_state: r.trust_state, lifecycle: r.lifecycle, latest: this.latestVersion.get(r.id) === r.version }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.version < b.version ? -1 : a.version > b.version ? 1 : 0));
  }

  snapshotId(): string {
    if (!this.snap) this.snap = `cat_${sha256(canonical(this.index())).slice(0, 16)}`;
    return this.snap;
  }

  all(): Iterable<ToolRecord> { return this.rows.values(); }

  *latest(): Iterable<ToolRecord> {
    for (const [id, v] of this.latestVersion) { const r = this.rows.get(this.key(id, v)); if (r) yield r; }
  }

  get(id: string, version?: string): ToolRecord | null {
    const v = version ?? this.latestVersion.get(id);
    return v === undefined ? null : this.rows.get(this.key(id, v)) || null;
  }

  upsert(rows: ToolRecord[]): { added: number; versioned: number; unchanged: number } {
    let added = 0; let versioned = 0; let unchanged = 0;
    for (const r of rows) {
      const k = this.key(r.id, r.version);
      const existing = this.rows.get(k);
      if (existing) {
        if (canonical({ ...existing, ingested_at: '' }) === canonical({ ...r, ingested_at: '' })) { unchanged++; continue; }
        this.rows.set(k, r); unchanged++; // same id and version: metadata refreshed in place (trust, links)
        continue;
      }
      if (this.latestVersion.has(r.id)) versioned++; else added++;
      this.rows.set(k, r);
      this.latestVersion.set(r.id, r.version);
    }
    this.snap = null;
    return { added, versioned, unchanged };
  }

  setTrust(id: string, version: string, to: TrustState, by: string, why: string): void {
    const r = this.get(id, version);
    if (!r) throw new Error(`no row ${id}@${version}`);
    const problem = trustMoveProblem(r, to, by);
    if (problem) throw new Error(problem);
    this.rows.set(this.key(id, version), { ...r, trust_state: to, last_validated: to === 'verified' ? new Date().toISOString() : r.last_validated });
    this.recordEvent({ at: new Date().toISOString(), id, version, from: r.trust_state, to, by, why });
    this.snap = null;
  }

  recordEvent(e: TrustEvent): void { this.trustEvents.push(e); }
  events(): TrustEvent[] { return [...this.trustEvents]; }

  vectors(model: string) { return this.vecs.get(model) || null; }
  setVectors(model: string, v: { dims: number; ids: string[]; data: Float32Array }): void {
    if (v.data.length !== v.dims * v.ids.length) throw new Error('vector data length does not match ids x dims');
    this.vecs.set(model, v);
  }
}
