/**
 * x402 discovery catalogs: PayAI (facilitator.payai.network/discovery/resources) and the Coinbase CDP Bazaar
 * (api.cdp.coinbase.com/platform/v2/x402/discovery/resources). Accepts both the raw discovery items and the
 * normalised resources Golden Kog keeps in its daily catalog (scripts/labor/golden-kog/intel.ts). The field mapping
 * follows Golden Kog's (resource url, accepts[] offers in micro units, bazaar input), re-implemented here: the package
 * imports nothing from scripts/. Payees are not copied into the catalog: an agent never chooses where money goes.
 */
import { createHash } from 'node:crypto';
import type { JSONSchema, Network, Pricing, SideEffect } from '../types/tool';
import type { ProvenanceIn, RawToolDescriptor } from './raw';
import { prov } from './raw';

export const ADAPTER = 'x402-discovery';
export const ADAPTER_VERSION = '1.0.0';

const CAIP: Record<string, Network> = {
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': 'solana',
  'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1': 'solana-devnet',
  'eip155:8453': 'base',
  'eip155:84532': 'base-sepolia',
  solana: 'solana', base: 'base', 'base-sepolia': 'base-sepolia', 'solana-devnet': 'solana-devnet',
};
export const networkOf = (n: unknown): Network | null => CAIP[String(n || '')] || null;

function schemaFromInput(input: any): JSONSchema | null {
  if (!input || typeof input !== 'object') return null;
  const properties: Record<string, JSONSchema> = {};
  const fromShape = (o: any) => {
    if (!o || typeof o !== 'object') return;
    const props = o.properties && typeof o.properties === 'object' ? o.properties : o;
    for (const [k, v] of Object.entries<any>(props)) {
      if (k === 'type' || k === 'required' || k === 'properties') continue;
      properties[k] = v && typeof v === 'object' && typeof v.type === 'string' ? { type: v.type, ...(v.description ? { description: String(v.description).slice(0, 200) } : {}) } : { type: typeof v === 'number' ? 'number' : 'string' };
    }
  };
  fromShape(input.queryParams);
  fromShape(input.body);
  const required: string[] = Array.isArray(input.required) ? input.required.map(String) : [];
  if (!Object.keys(properties).length && !required.length) return null;
  return { type: 'object', properties, ...(required.length ? { required } : {}) };
}

/** One item, raw (resource string, accepts[]) or Golden Kog normalised (url, offers[]). */
function norm(it: any): { url: string; method: string; description: string; amounts: Array<{ micro: string; network: Network | null }>; input: any; tags: string[]; source: string } | null {
  const url = String(typeof it?.resource === 'string' ? it.resource : it?.url || it?.resource?.url || '');
  if (!/^https:\/\//i.test(url)) return null;
  const offers: any[] = Array.isArray(it.accepts) ? it.accepts : Array.isArray(it.offers) ? it.offers : [];
  const amounts = offers
    .map((o) => ({ micro: String(o?.amount ?? o?.maxAmountRequired ?? ''), network: networkOf(o?.network) }))
    .filter((a) => /^\d{1,15}$/.test(a.micro));
  const baseInput = it?.input || it?.extensions?.bazaar?.info?.input || it?.inputSchema || it?.accepts?.[0]?.outputSchema?.input || null;
  const req = baseInput?.required
    || it?.extensions?.bazaar?.schema?.properties?.input?.properties?.body?.required
    || it?.extensions?.bazaar?.schema?.properties?.input?.properties?.queryParams?.required || [];
  const input = baseInput ? { ...baseInput, required: Array.isArray(req) ? req.map(String) : [] } : null;
  const method = String(baseInput?.method || it.method || 'GET').toUpperCase();
  const description = String(it.description || it.metadata?.description || offers.map((o) => o?.description).filter(Boolean)[0] || '');
  const tags = [...(Array.isArray(it.topics) ? it.topics : []), ...(Array.isArray(it.tags) ? it.tags : [])].map(String).slice(0, 10);
  return { url, method, description, amounts, input, tags, source: String(it.source || '') };
}

export function fromX402Resources(items: unknown, p: ProvenanceIn, sourceName = 'x402-discovery'): RawToolDescriptor[] {
  const list: any[] = Array.isArray(items) ? items : Array.isArray((items as any)?.resources) ? (items as any).resources : Array.isArray((items as any)?.items) ? (items as any).items : [];
  const out: RawToolDescriptor[] = [];
  const used = new Set<string>();
  for (const it of list) {
    const r = norm(it);
    if (!r) continue;
    const u = new URL(r.url);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    let name = (u.pathname.replace(/^\/+|\/+$/g, '').replace(/\//g, '-') || 'root') + (r.method !== 'GET' ? `-${r.method.toLowerCase()}` : '');
    // long resource paths (token addresses in the path) keep a readable head and a digest of the full resource
    if (name.length > 48) name = `${name.slice(0, 39).replace(/[-.]+$/, '')}-${createHash('sha256').update(`${r.method} ${r.url}`).digest('hex').slice(0, 8)}`;
    let path = `${host}/${name}`;
    for (let i = 2; used.has(path.toLowerCase()); i++) path = `${host}/${name}-${i}`;
    used.add(path.toLowerCase());
    const networks = [...new Set(r.amounts.map((a) => a.network).filter(Boolean))] as Network[];
    const micros = r.amounts.map((a) => BigInt(a.micro));
    const pricing: Pricing = micros.length
      ? { model: 'per_call', price: { amount_micro: micros.reduce((a, b) => (b < a ? b : a)).toString(), currency: 'USDC', ...(networks[0] ? { network: networks[0] } : {}) }, unit: 'request', source: 'provider' }
      : { model: 'unknown', source: 'unknown' };
    const side: SideEffect[] | null = r.method === 'GET' || r.method === 'HEAD' ? ['read'] : null;
    out.push({
      source: sourceName, source_ref: `${r.method} ${r.url}`, origin: 'x402', path,
      name: `${host} ${u.pathname}`.slice(0, 120), description: r.description,
      provider: { name: host, url: `${u.protocol}//${u.host}`, kognai_owned: false },
      category: 'x402-service', tags: ['x402', ...(r.source ? [r.source] : []), ...r.tags],
      operations: [{ op: 'call', method: r.method, summary: r.description || `${r.method} ${u.pathname}`, input_schema: schemaFromInput(r.input), output_schema: null, side_effects: side }],
      auth: { kind: 'x402' }, pricing, licence: p.licence, endpoint: r.url, implementation: 'http',
      networks, lifecycle: 'active', provenance: prov(p, ADAPTER, ADAPTER_VERSION),
    });
  }
  return out;
}
