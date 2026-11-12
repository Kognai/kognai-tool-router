/**
 * Ingestion (plan.md S1): raw descriptors to ToolRecords in a CatalogStore.
 *
 *   1. validate: at most 200 operations, schemas at most 64 KB each (T14), a valid id (ADR-004)
 *   2. sanitise text (T1); raw text kept by hash only
 *   3. risk classes per operation (fail closed); a payment operation taking a destination is refused (security.txt 1)
 *   4. schema hash and implementation hash (no probe)
 *   5. dedup and versions: same id + same version + same schema = unchanged; a new provider version or a new schema =
 *      a new version row; same endpoint host + same known schema under another id = same_as link
 *   6. trust: native Kognai rows from Kognai sources are verified; everything else is quarantined; a reviewed or
 *      verified outside row whose hashes change goes back to quarantine with an event
 *   7. revocation list applied last
 *   8. report: counts per source, quarantined, rejected with reasons, sanitise flags
 *
 * Deterministic: input order does not matter (sorted), and nothing time based enters the snapshot id.
 */
import { canonical, schemaHash, sha256 } from '../hash';
import { formatToolId } from '../ids';
import type { RawToolDescriptor } from '../adapters/raw';
import type { CatalogStore, TrustEvent } from '../types/ports';
import { EMPTY_SUCCESS } from '../types/tool';
import type { BusinessTier, Network, PrivacyClass, ToolOperation, ToolRecord, TrustState } from '../types/tool';
import { trustAfterDrift } from './lifecycle';
import { deriveRisk, takesDestination } from './risk';
import { sanitise, sanitiseShort, type SanitiseFlag } from './sanitise';
import { validateToolRecord } from '../schema/validate';

export const MAX_SCHEMA_BYTES = 64 * 1024;
export const MAX_OPS = 200;
export const MAX_SAME_AS_GROUP = 8;

export interface Revocation { id: string; version: string | '*'; why: string; by: string; at: string }

export interface IngestOpts {
  /** ISO time stamped on rows as ingested_at (not part of the snapshot id). */
  now: string;
  revoked?: Revocation[];
  /** Capability tagger (S2): returns capability ids for an operation's text. */
  tagger?: (text: string) => string[];
  /** Maximum rows kept per source (T14). */
  sourceCaps?: Record<string, number>;
  /** Raw text sink (catalog/raw/<sha>.txt in the file store). */
  rawSink?: (sha: string, text: string) => void;
}

export interface SourceCount { seen: number; added: number; versioned: number; unchanged: number; rejected: number; capped: number }
export interface IngestReport {
  per_source: Record<string, SourceCount>;
  quarantined: number;
  verified: number;
  rejected: Array<{ source: string; source_ref: string; why: string }>;
  sanitise_flags: Partial<Record<SanitiseFlag, number>>;
  same_as_links: number;
  same_as_groups_skipped: number;
  revoked_applied: number;
  events: TrustEvent[];
  snapshot_id: string;
}

const KOGNAI_SOURCE = /^kognai:/;
/** Operations that move value somewhere (T15), as opposed to reading about tokens. */
const TRANSFER_CUE = /\b(transfer|send|withdraw|payout|pay out|remit|disburse)\b/;
const cleanName = (s: string) => sanitiseShort(s, 120) || 'unnamed';
const hostOf = (u?: string) => { try { return u ? new URL(u).hostname.toLowerCase() : null; } catch { return null; } };

function implHash(r: RawToolDescriptor): string | null {
  if (r.implementation_hash) return r.implementation_hash;
  if (r.package) return sha256(`${r.package.registry}:${r.package.identifier}@${r.package.version || '?'}`);
  const h = hostOf(r.endpoint);
  return h ? sha256(`endpoint:${h}`) : null;
}

export function toRecord(r: RawToolDescriptor, opts: IngestOpts, flagSink: (f: SanitiseFlag[]) => void): ToolRecord | { reject: string } {
  if (!Array.isArray(r.operations)) return { reject: 'no operations array' };
  if (r.operations.length > MAX_OPS) return { reject: `more than ${MAX_OPS} operations (T14)` };
  let id: string;
  try { id = formatToolId(r.origin, r.path); } catch (e: any) { return { reject: `bad id: ${e.message}` }; }
  const native = r.origin === 'kognai' && KOGNAI_SOURCE.test(r.source);
  if (r.origin === 'kognai' && !native) return { reject: 'origin kognai claimed by a non Kognai source' };
  const desc = sanitise(r.description || '');
  flagSink(desc.flags);
  const rawSha = sha256(String(r.description || ''));
  opts.rawSink?.(rawSha, String(r.description || ''));
  const externalNet = !native || !!hostOf(r.endpoint);
  const ops: ToolOperation[] = [];
  const seenOps = new Set<string>();
  for (const o of r.operations) {
    const op = String(o.op || 'call').toLowerCase().replace(/[^a-z0-9_.-]+/g, '_').slice(0, 64) || 'call';
    if (seenOps.has(op)) continue;
    seenOps.add(op);
    for (const s of [o.input_schema, o.output_schema]) {
      if (s && Buffer.byteLength(canonical(s)) > MAX_SCHEMA_BYTES) return { reject: `schema of ${op} over 64 KB (T14)` };
    }
    const summaryRaw = o.summary || r.name;
    const sum = sanitise(summaryRaw);
    flagSink(sum.flags);
    const text = native ? sum.text : `${r.name} ${desc.text} ${sum.text}`;
    const risk = deriveRisk({ origin: r.origin, side_effects: o.side_effects, scopes: o.scopes, text, input_schema: o.input_schema, external_network: externalNet });
    // a declared read is not a transfer; a declared payment, or unknown side effects with a transfer cue, is
    const movesMoney = risk.side_effects.includes('payment') || (risk.side_effects.length === 0 && TRANSFER_CUE.test(text.toLowerCase()));
    if (risk.risk.includes('payment') && movesMoney && takesDestination(o.input_schema)) return { reject: `operation ${op} moves money to an address it takes as input (security.txt rule 1, T15)` };
    // explicit capabilities (native sources) are authoritative; only untagged operations are tagged from text
    const tagged = opts.tagger && !(o.capabilities && o.capabilities.length) ? opts.tagger(`${cleanName(r.name)} ${sum.text} ${native ? '' : desc.text} ${(r.tags || []).join(' ')}`) : [];
    ops.push({
      op,
      summary: sanitiseShort(summaryRaw, 200),
      capabilities: [...new Set([...(o.capabilities || []), ...tagged])].sort(),
      input_schema: (o.input_schema && typeof o.input_schema === 'object') ? o.input_schema : {},
      output_schema: (o.output_schema && typeof o.output_schema === 'object') ? o.output_schema : null,
      side_effects: risk.side_effects,
      risk_classes: risk.risk,
      scopes: [...(o.scopes || [])],
      idempotent: o.idempotent ?? null,
      url_from_user: risk.url_from_user,
    });
  }
  const sh = schemaHash(ops);
  const providerVersion = r.version && /^[0-9A-Za-z.+_-]{1,40}$/.test(r.version) ? r.version : null;
  const version = providerVersion || `0.0.0+${sh.slice(0, 12)}`;
  const privacy: PrivacyClass = r.privacy_class || 'public';
  const tier: BusinessTier | null = r.business_tier === undefined ? null : r.business_tier;
  const rec: ToolRecord = {
    schema_version: 1,
    id,
    version,
    name: cleanName(r.name),
    description_safe: desc.text,
    description_raw_sha256: rawSha,
    provider: { name: cleanName(r.provider?.name || 'unknown'), ...(r.provider?.url ? { url: String(r.provider.url).slice(0, 300) } : {}), kognai_owned: native && r.provider?.kognai_owned !== false },
    origin: r.origin,
    category: String(r.category || 'other').toLowerCase().slice(0, 60),
    tags: [...new Set([...(r.tags || []).map((t) => String(t).toLowerCase().slice(0, 60)), ...(r.founder_approval ? ['founder_approval'] : [])])].slice(0, 40),
    operations: ops,
    auth: r.auth ? { ...r.auth } : { kind: 'none' },
    privacy_class: privacy,
    business_tier: tier,
    regions: r.regions && r.regions.length ? [...r.regions] : ['*'],
    networks: [...new Set(r.networks || [])] as Network[],
    pricing: r.pricing ? { ...r.pricing } : { model: 'unknown', source: 'unknown' },
    success: { ...EMPTY_SUCCESS },
    latency: { p50_ms: null, p95_ms: null, n: 0 },
    rate_limits: null,
    health: { state: 'unknown', checked_at: null, source: 'none' },
    dependencies: [...(r.dependencies || [])],
    trust_state: native ? 'verified' : 'quarantined',
    skill_ids: [...(r.skill_ids || [])],
    last_validated: null,
    schema_hash: sh,
    implementation_hash: implHash(r),
    lifecycle: r.lifecycle || 'active',
    aliases: [...new Set(r.aliases || [])],
    same_as: [],
    ...(r.product_id ? { product_id: r.product_id } : {}),
    ...(r.aiax_ready === true ? { aiax_ready: true } : {}),
    provenance: [{
      source: r.source, source_ref: String(r.source_ref).slice(0, 400), retrieved_at: r.provenance.retrieved_at,
      licence: r.provenance.licence ?? r.licence ?? null, adapter: r.provenance.adapter, adapter_version: r.provenance.adapter_version,
      snapshot_sha256: r.provenance.snapshot_sha256,
    }],
    ingested_at: opts.now,
  };
  const v = validateToolRecord(rec);
  if (!v.ok) return { reject: `schema: ${v.errors.slice(0, 3).join('; ')}` };
  return rec;
}

const knownSchema = (r: ToolRecord) => r.operations.some((o) => Object.keys(o.input_schema || {}).length > 0);

export function ingest(raws: RawToolDescriptor[], store: CatalogStore, opts: IngestOpts): IngestReport {
  const report: IngestReport = { per_source: {}, quarantined: 0, verified: 0, rejected: [], sanitise_flags: {}, same_as_links: 0, same_as_groups_skipped: 0, revoked_applied: 0, events: [], snapshot_id: '' };
  const count = (s: string) => (report.per_source[s] ||= { seen: 0, added: 0, versioned: 0, unchanged: 0, rejected: 0, capped: 0 });
  const flagSink = (fs: SanitiseFlag[]) => { for (const f of fs) report.sanitise_flags[f] = (report.sanitise_flags[f] || 0) + 1; };
  const sorted = [...raws].sort((a, b) => (`${a.source}\u0000${a.path}\u0000${a.source_ref}` < `${b.source}\u0000${b.path}\u0000${b.source_ref}` ? -1 : 1));
  const keptPerSource = new Map<string, number>();
  const batch = new Map<string, ToolRecord>(); // id -> record (latest in this batch)

  for (const raw of sorted) {
    const c = count(raw.source);
    c.seen++;
    const cap = opts.sourceCaps?.[raw.source];
    if (cap !== undefined && (keptPerSource.get(raw.source) || 0) >= cap) { c.capped++; continue; }
    const rec = toRecord(raw, opts, flagSink);
    if ('reject' in rec) { c.rejected++; report.rejected.push({ source: raw.source, source_ref: raw.source_ref, why: rec.reject }); continue; }
    keptPerSource.set(raw.source, (keptPerSource.get(raw.source) || 0) + 1);
    const prevInBatch = batch.get(rec.id);
    if (prevInBatch) {
      // two descriptors with one id in one batch: the first stays, the second is reported (not merged silently)
      c.rejected++; report.rejected.push({ source: raw.source, source_ref: raw.source_ref, why: `duplicate id ${rec.id} in this batch` });
      continue;
    }
    // versions against the store
    const prev = store.get(rec.id);
    if (prev) {
      if (prev.version === rec.version && prev.schema_hash !== rec.schema_hash) rec.version = `${rec.version.split('+')[0]}+${rec.schema_hash.slice(0, 12)}`;
      const drift = trustAfterDrift(prev, rec);
      if (rec.origin !== 'kognai') {
        const carried: TrustState = prev.trust_state === 'revoked' ? 'revoked' : drift.drifted ? drift.trust : prev.trust_state;
        if (drift.drifted && (prev.trust_state === 'verified' || prev.trust_state === 'reviewed')) {
          const e: TrustEvent = { at: opts.now, id: rec.id, version: rec.version, from: prev.trust_state, to: 'quarantined', by: 'ktr-ingest', why: 'hash drift: schema or implementation changed' };
          report.events.push(e); store.recordEvent(e);
        }
        rec.trust_state = carried;
      }
      rec.same_as = [...prev.same_as];
    }
    batch.set(rec.id, rec);
  }

  // same_as: same endpoint host and same known schema under another id
  const all = new Map<string, ToolRecord>();
  for (const r of store.latest()) all.set(r.id, r);
  for (const r of batch.values()) all.set(r.id, r);
  const byKey = new Map<string, string[]>();
  for (const r of all.values()) {
    // native rows share a source file hash, not an endpoint: they are never duplicates of each other
    if (r.origin === 'kognai' || !knownSchema(r) || !r.implementation_hash) continue;
    const k = `${r.implementation_hash}|${r.schema_hash}`;
    (byKey.get(k) || byKey.set(k, []).get(k)!).push(r.id);
  }
  for (const ids of byKey.values()) {
    if (ids.length < 2) continue;
    // a large group is one templated endpoint (a token address in the path): not duplicates of one tool
    if (ids.length > MAX_SAME_AS_GROUP) { report.same_as_groups_skipped++; continue; }
    for (const id of ids) {
      const r = batch.get(id);
      if (!r) continue;
      const before = r.same_as.length;
      r.same_as = [...new Set([...r.same_as, ...ids.filter((x) => x !== id)])].sort();
      report.same_as_links += r.same_as.length - before;
    }
  }

  // revocation last
  for (const rv of opts.revoked || []) {
    const r = batch.get(rv.id);
    if (r && (rv.version === '*' || rv.version === r.version) && r.trust_state !== 'revoked') {
      const e: TrustEvent = { at: rv.at, id: r.id, version: r.version, from: r.trust_state, to: 'revoked', by: rv.by, why: rv.why };
      r.trust_state = 'revoked'; report.revoked_applied++; report.events.push(e); store.recordEvent(e);
    }
  }

  // a revocation of a stored row that is not in this batch
  for (const rv of opts.revoked || []) {
    if (batch.has(rv.id)) continue;
    const r = store.get(rv.id);
    if (r && (rv.version === '*' || rv.version === r.version) && r.trust_state !== 'revoked') {
      store.setTrust(r.id, r.version, 'revoked', rv.by, rv.why);
      report.revoked_applied++;
    }
  }

  const rows = [...batch.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  const before = new Map(rows.map((r) => [r.id, store.get(r.id)]));
  store.upsert(rows);
  for (const r of rows) {
    const c = count(r.provenance[0].source);
    const p = before.get(r.id);
    if (!p) c.added++;
    else if (p.version === r.version) c.unchanged++;
    else c.versioned++;
    if (r.trust_state === 'quarantined') report.quarantined++;
    if (r.trust_state === 'verified') report.verified++;
  }
  report.snapshot_id = store.snapshotId();
  return report;
}
