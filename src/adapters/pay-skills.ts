/**
 * pay-skills providers (solana-foundation/pay-skills and its forks, MIT):
 * providers/<operator>/<name>/PAY.md with YAML front matter (name, title, description, use_case, category,
 * service_url, openapi: { url | path }, version) and an optional local openapi.json carrying x-payment-info prices.
 * The repository has no built dist/skills.json, so this adapter reads the PAY.md files themselves (pinned snapshot).
 * When a local openapi.json exists, operations and per call prices come from it; otherwise the provider is one tool
 * with one unknown operation and unknown price (fail closed).
 */
import type { Network, Pricing } from '../types/tool';
import { toMicro } from '../money';
import { fromOpenApi } from './openapi';
import type { ProvenanceIn, RawOp, RawToolDescriptor } from './raw';
import { prov } from './raw';

export const ADAPTER = 'pay-skills';
export const ADAPTER_VERSION = '1.0.0';

export interface PayMdFile { path: string; md: string; openapi?: unknown }

/** The front matter subset pay-skills uses: top level scalars and one level of nested scalars. */
export function frontMatter(md: string): Record<string, any> | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  if (!m) return null;
  const out: Record<string, any> = {};
  let parent: string | null = null;
  const unq = (v: string) => {
    const t = v.trim();
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
      try { return t.startsWith('"') ? JSON.parse(t) : t.slice(1, -1); } catch { return t.slice(1, -1); }
    }
    return t;
  };
  for (const line of m[1].split(/\r?\n/)) {
    const top = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    const nested = /^\s{2,}([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (top) {
      if (top[2] === '') { out[top[1]] = {}; parent = top[1]; } else { out[top[1]] = unq(top[2]); parent = null; }
    } else if (nested && parent) {
      out[parent][nested[1]] = unq(nested[2]);
    }
  }
  return out;
}

/** '$0.01' or '0.01' to micro units; null when it is not a plain USD amount. */
export function priceMicro(s: unknown): bigint | null {
  const m = /^\s*\$?\s*(\d+(?:\.\d{1,6})?)\s*$/.exec(String(s ?? ''));
  if (!m) return null;
  try { return toMicro(m[1]); } catch { return null; }
}

function networksOf(text: string): Network[] {
  const n: Network[] = [];
  if (/\bbase\b/i.test(text)) n.push('base');
  if (/\bsolana\b/i.test(text)) n.push('solana');
  return n;
}

export function fromPaySkills(files: PayMdFile[], p: ProvenanceIn): RawToolDescriptor[] {
  const out: RawToolDescriptor[] = [];
  for (const f of files) {
    const fm = frontMatter(f.md);
    const parts = /(?:^|\/)providers\/(.+)\/PAY\.md$/.exec(f.path);
    if (!fm || !parts || !fm.name) continue;
    const segs = parts[1].split('/');
    if (segs.length < 2) continue;
    const operator = segs[0];
    const name = segs.slice(1).join('-');
    const body = f.md.replace(/^---[\s\S]*?---/, '');
    const description = [fm.description, fm.use_case].filter(Boolean).join(' ');
    let ops: RawOp[] = [{ op: 'call', summary: String(fm.description || fm.title || name), input_schema: null, output_schema: null, side_effects: null }];
    let pricing: Pricing = { model: 'unknown', source: 'unknown' };
    const networks = networksOf(body);
    if (f.openapi) {
      try {
        const d = fromOpenApi(f.openapi, p, { origin: 'x402', path: `${operator}/${name}` });
        if (d.operations.length) ops = d.operations;
        const prices: bigint[] = [];
        for (const [, item] of Object.entries<any>((f.openapi as any).paths || {})) {
          for (const o of Object.values<any>(item || {})) {
            const pm = priceMicro(o?.['x-payment-info']?.price);
            if (pm !== null) prices.push(pm);
          }
        }
        if (prices.length) {
          const min = prices.reduce((a, b) => (b < a ? b : a));
          pricing = { model: 'per_call', price: { amount_micro: min.toString(), currency: 'USDC', ...(networks[0] ? { network: networks[0] } : {}) }, unit: 'request', source: 'provider' };
        }
      } catch { /* a broken openapi keeps the single unknown operation */ }
    }
    const priceLine = /\$\d+(?:\.\d+)?(?:\s*(?:per|\/)\s*\w+)?/.exec(body)?.[0];
    out.push({
      source: 'pay-skills', source_ref: f.path, origin: 'x402', path: `${operator}/${name}`,
      name: String(fm.title || name).slice(0, 120), description,
      provider: { name: operator, url: fm.service_url, kognai_owned: false },
      category: String(fm.category || 'other'), tags: ['pay-skills', 'x402', String(fm.category || 'other')],
      operations: ops, auth: { kind: 'x402' }, pricing, pricing_text: priceLine,
      licence: p.licence, endpoint: fm.service_url, implementation: 'http', version: fm.version ? String(fm.version) : undefined,
      networks, lifecycle: 'active', provenance: prov(p, ADAPTER, ADAPTER_VERSION),
    });
  }
  return out;
}
