/**
 * FileCatalogStore (ADR-003): workspace/ktr/catalog/
 *   tools.jsonl            one row per tool version, rewritten by atomic rename
 *   index.json             snapshot id + index entries (id, version, schema hash, trust, lifecycle, latest)
 *   events.jsonl           trust events, append only
 *   raw/<sha>.txt          raw provider descriptions, by hash, never shown to a model
 *   vectors.<model>.f32    float32 little endian, row major; vectors.<model>.json { model, dims, ids, built_at }
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TrustEvent } from '../types/ports';
import type { ToolRecord, TrustState } from '../types/tool';
import { MemoryCatalogStore } from './memory-store';

const MODEL_RE = /^[a-z0-9.:_-]{1,60}$/i;

function atomicWrite(path: string, data: string | Buffer): void {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

export class FileCatalogStore extends MemoryCatalogStore {
  private loading = false;
  constructor(readonly dir: string) {
    super();
    mkdirSync(dir, { recursive: true });
    this.loading = true;
    const tools = join(dir, 'tools.jsonl');
    const index = join(dir, 'index.json');
    if (existsSync(tools)) {
      const rows = readFileSync(tools, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as ToolRecord);
      // restore ingestion order of latest versions from the index
      const latest = existsSync(index) ? new Map<string, string>((JSON.parse(readFileSync(index, 'utf8')).entries || []).filter((e: any) => e.latest).map((e: any) => [e.id, e.version])) : new Map();
      for (const r of rows) this.rows.set(this.key(r.id, r.version), r);
      for (const r of rows) if (!latest.size || latest.get(r.id) === r.version) this.latestVersion.set(r.id, r.version);
    }
    const ev = join(dir, 'events.jsonl');
    if (existsSync(ev)) this.trustEvents = readFileSync(ev, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    this.loading = false;
  }

  private flush(): void {
    const rows = [...this.rows.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.version < b.version ? -1 : 1));
    atomicWrite(join(this.dir, 'tools.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
    atomicWrite(join(this.dir, 'index.json'), JSON.stringify({ snapshot_id: this.snapshotId(), count: rows.length, entries: this.index() }, null, 1) + '\n');
  }

  upsert(rows: ToolRecord[]) {
    const r = super.upsert(rows);
    if (!this.loading) this.flush();
    return r;
  }

  setTrust(id: string, version: string, to: TrustState, by: string, why: string): void {
    super.setTrust(id, version, to, by, why);
    this.flush();
  }

  recordEvent(e: TrustEvent): void {
    super.recordEvent(e);
    if (!this.loading) appendFileSync(join(this.dir, 'events.jsonl'), JSON.stringify(e) + '\n');
  }

  writeRaw(sha: string, text: string): void {
    if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error('bad sha');
    const d = join(this.dir, 'raw');
    mkdirSync(d, { recursive: true });
    const p = join(d, `${sha}.txt`);
    if (!existsSync(p)) atomicWrite(p, text);
  }

  vectors(model: string) {
    const mem = super.vectors(model);
    if (mem) return mem;
    if (!MODEL_RE.test(model)) return null;
    const meta = join(this.dir, `vectors.${model}.json`);
    const bin = join(this.dir, `vectors.${model}.f32`);
    if (!existsSync(meta) || !existsSync(bin)) return null;
    const m = JSON.parse(readFileSync(meta, 'utf8'));
    const buf = readFileSync(bin);
    const data = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    if (m.model !== model || data.length !== m.dims * m.ids.length) throw new Error(`vectors.${model} do not match their metadata`);
    const v = { dims: m.dims as number, ids: m.ids as string[], data };
    super.setVectors(model, v);
    return v;
  }

  writeVectors(model: string, v: { dims: number; ids: string[]; data: Float32Array }, builtAt: string): void {
    if (!MODEL_RE.test(model)) throw new Error('bad model name');
    super.setVectors(model, v);
    atomicWrite(join(this.dir, `vectors.${model}.f32`), Buffer.from(v.data.buffer, v.data.byteOffset, v.data.byteLength));
    atomicWrite(join(this.dir, `vectors.${model}.json`), JSON.stringify({ model, dims: v.dims, count: v.ids.length, built_at: builtAt, ids: v.ids }) + '\n');
  }
}
