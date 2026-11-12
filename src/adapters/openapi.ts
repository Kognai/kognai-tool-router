/**
 * OpenAPI 3.0 and 3.1 documents to one raw descriptor with one operation per path and method. The input schema is
 * built from parameters plus the JSON request body; local $ref pointers are resolved (depth and size capped, cycles
 * cut). Side effects come from the method and fail closed: GET and HEAD read, POST, PUT and PATCH write, DELETE
 * deletes. A POST is read only when the caller's own reviewed list says so (`safePostOps`), never because the
 * provider's text claims it.
 */
import type { JSONSchema, SideEffect } from '../types/tool';
import type { ProvenanceIn, RawOp, RawToolDescriptor } from './raw';
import { prov } from './raw';

export const ADAPTER = 'openapi';
export const ADAPTER_VERSION = '1.0.0';

const METHODS = ['get', 'head', 'post', 'put', 'patch', 'delete'] as const;

export interface OpenApiOpts {
  /** namespace/name for the tool id; defaults to the server host and the title. */
  path?: string;
  origin?: 'openapi' | 'x402';
  provider?: { name: string; url?: string };
  safePostOps?: string[];
  category?: string;
  tags?: string[];
}

function resolver(doc: any) {
  const lookup = (ref: string): any => {
    if (!ref.startsWith('#/')) return null;
    return ref.slice(2).split('/').reduce((o: any, k) => (o == null ? o : o[k.replace(/~1/g, '/').replace(/~0/g, '~')]), doc);
  };
  // `hops` counts $ref follows (cap 8), `level` counts nesting (cap 32); a ref already on the path is a cycle.
  const resolve = (s: any, hops = 0, seen = new Set<string>(), level = 0): any => {
    if (!s || typeof s !== 'object') return s;
    if (hops > 8 || level > 32) return {};
    if (typeof s.$ref === 'string') {
      if (seen.has(s.$ref)) return { type: 'object', description: 'recursive' };
      const t = lookup(s.$ref);
      return t ? resolve(t, hops + 1, new Set([...seen, s.$ref]), level + 1) : {};
    }
    if (Array.isArray(s)) return s.map((x) => resolve(x, hops, seen, level + 1));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s)) out[k] = typeof v === 'object' ? resolve(v, hops, seen, level + 1) : v;
    return out;
  };
  return resolve;
}

const opName = (method: string, path: string, operationId?: string) =>
  (operationId || `${method}_${path}`).replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').toLowerCase().slice(0, 64) || method;

export function sideEffectOf(method: string, op: string, safePostOps: string[] = []): SideEffect[] {
  switch (method) {
    case 'get': case 'head': return ['read'];
    case 'delete': return ['delete'];
    case 'post': return safePostOps.includes(op) ? ['read'] : ['write'];
    default: return ['write'];
  }
}

export function fromOpenApi(doc: any, p: ProvenanceIn, opts: OpenApiOpts = {}): RawToolDescriptor {
  if (!doc || typeof doc !== 'object' || !/^3\./.test(String(doc.openapi || ''))) throw new Error('not an OpenAPI 3.x document');
  const resolve = resolver(doc);
  const server = String(doc.servers?.[0]?.url || '');
  let host = 'unknown';
  try { host = new URL(server).hostname; } catch { /* relative server */ }
  const title = String(doc.info?.title || host);
  const ops: RawOp[] = [];
  for (const [path, item] of Object.entries<any>(doc.paths || {})) {
    const shared: any[] = Array.isArray(item?.parameters) ? item.parameters : [];
    for (const method of METHODS) {
      const o = item?.[method];
      if (!o || typeof o !== 'object') continue;
      const op = opName(method, path, o.operationId);
      const properties: Record<string, JSONSchema> = {};
      const required: string[] = [];
      for (const prm of [...shared, ...(Array.isArray(o.parameters) ? o.parameters : [])].map((x) => resolve(x))) {
        if (!prm || typeof prm.name !== 'string' || prm.in === 'header' || prm.in === 'cookie') continue;
        properties[prm.name] = { ...(resolve(prm.schema) || { type: 'string' }), ...(prm.description ? { description: String(prm.description).slice(0, 200) } : {}) };
        if (prm.required || prm.in === 'path') required.push(prm.name);
      }
      const body = resolve(o.requestBody);
      const bodySchema = body?.content?.['application/json']?.schema;
      if (bodySchema) { properties.body = resolve(bodySchema); if (body.required) required.push('body'); }
      const ok = o.responses?.['200'] || o.responses?.['201'] || o.responses?.default;
      const outSchema = resolve(ok)?.content?.['application/json']?.schema;
      ops.push({
        op, method: method.toUpperCase(), path,
        summary: String(o.summary || o.description || `${method.toUpperCase()} ${path}`),
        input_schema: { type: 'object', properties, ...(required.length ? { required: [...new Set(required)] } : {}) },
        output_schema: outSchema ? resolve(outSchema) : null,
        side_effects: sideEffectOf(method, op, opts.safePostOps),
        idempotent: method === 'get' || method === 'head' || method === 'put' || method === 'delete',
      });
    }
  }
  return {
    source: p.source, source_ref: `${title}@${doc.info?.version || '?'}`,
    origin: opts.origin || 'openapi',
    path: opts.path || `${host}/${title}`,
    name: title.slice(0, 120),
    description: String(doc.info?.description || title),
    provider: { name: opts.provider?.name || host, url: opts.provider?.url || server || undefined, kognai_owned: false },
    category: opts.category || 'api', tags: ['openapi', ...(opts.tags || [])],
    operations: ops, auth: { kind: doc.components?.securitySchemes ? 'api_key' : 'none' },
    pricing: { model: 'unknown', source: 'unknown' }, licence: p.licence,
    endpoint: server || undefined, implementation: 'http', version: doc.info?.version ? String(doc.info.version) : undefined,
    lifecycle: 'active', provenance: prov(p, ADAPTER, ADAPTER_VERSION),
  };
}
