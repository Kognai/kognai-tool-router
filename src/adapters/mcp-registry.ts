/**
 * MCP registry server.json entries (registry.modelcontextprotocol.io, `GET /v0/servers` pages) to raw descriptors.
 * Metadata only: the registry does not list a server's tools, so each server becomes one tool with one unknown
 * operation ("server"), unknown schema and unknown side effects (fail closed). Servers that ship only `packages` are
 * marked implementation "package" and are never runnable by KTR; `remotes` make a server a candidate for a later
 * CTO desk verification. Nothing here installs or launches anything.
 */
import type { ProvenanceIn, RawToolDescriptor } from './raw';
import { prov } from './raw';

export const ADAPTER = 'mcp-registry';
export const ADAPTER_VERSION = '1.0.0';

interface ServerJson {
  name?: string; title?: string; description?: string; version?: string; websiteUrl?: string;
  repository?: { url?: string; source?: string };
  packages?: Array<{ registryType?: string; registry_name?: string; identifier?: string; name?: string; version?: string; transport?: { type?: string } }>;
  remotes?: Array<{ type?: string; url?: string }>;
}
interface Entry { server?: ServerJson; _meta?: Record<string, any> }

const NAME_RE = /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/;

/** Accepts a registry page ({servers: [...]}), an array of entries, or one server.json. */
export function fromServerJson(input: unknown, p: ProvenanceIn): RawToolDescriptor[] {
  const list: Entry[] = Array.isArray(input) ? input as Entry[]
    : (input && typeof input === 'object' && Array.isArray((input as any).servers)) ? (input as any).servers
      : [input as Entry];
  const out: RawToolDescriptor[] = [];
  for (const e of list) {
    const s: ServerJson | undefined = (e && (e as Entry).server) || (e as ServerJson);
    if (!s || typeof s !== 'object' || typeof s.name !== 'string' || !NAME_RE.test(s.name)) continue;
    const official = (e as Entry)?._meta?.['io.modelcontextprotocol.registry/official'] || {};
    // the registry lists every published version; only the latest one enters the catalog
    if (official.isLatest === false) continue;
    const status = String(official.status || 'active');
    const remotes = (s.remotes || []).filter((r) => typeof r?.url === 'string' && /^https:\/\//i.test(r.url!));
    const pkg = (s.packages || []).find((x) => x && (x.identifier || x.name));
    const implementation = remotes.length ? 'remote' : pkg ? 'package' : 'metadata';
    const [ns, nm] = s.name.split('/');
    out.push({
      source: 'mcp-registry',
      source_ref: `${s.name}@${s.version || '?'}`,
      origin: 'mcp',
      path: `${ns}/${nm}`,
      name: (s.title || nm).slice(0, 120),
      description: String(s.description || ''),
      provider: { name: ns, url: s.websiteUrl || s.repository?.url, kognai_owned: false },
      category: 'mcp-server',
      tags: ['mcp', implementation],
      operations: [{ op: 'server', summary: String(s.description || s.title || nm), input_schema: null, output_schema: null, side_effects: null }],
      auth: { kind: 'none' },
      pricing: { model: 'unknown', source: 'unknown' },
      licence: p.licence,
      endpoint: remotes[0]?.url,
      package: pkg ? { registry: String(pkg.registryType || pkg.registry_name || 'unknown'), identifier: String(pkg.identifier || pkg.name), version: pkg.version } : undefined,
      implementation,
      version: s.version,
      lifecycle: status === 'deleted' ? 'retired' : status === 'deprecated' ? 'deprecated' : 'active',
      provenance: prov(p, ADAPTER, ADAPTER_VERSION),
    });
  }
  return out;
}
