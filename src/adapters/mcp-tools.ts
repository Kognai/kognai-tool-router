/**
 * MCP tools/list results to raw descriptors, for APPROVED servers only (policy/tool-router.txt rule 2).
 *
 * fromMcpToolsList() reads a tools/list result that is already a file (a fixture in tests, a pinned snapshot
 * otherwise). listToolsLive() is the only path that talks to a server, and it refuses unless all of these hold: the
 * flag TOOL_ROUTER_MCP_LIST_LIVE is on, the server is in the approved list (workspace/ktr/mcp-approved.json, the CTO
 * desk's file, decision D10), and the server has an https remote endpoint. A package-only server is refused always:
 * KTR never installs or launches third party code, so there is no stdio transport here at all.
 *
 * Tool annotations (readOnlyHint, destructiveHint) come from the server and are untrusted: a destructive hint adds
 * risk; a read only hint is believed only when the approval entry says the CTO desk checked it (trust_annotations).
 */
import type { KtrFlags } from '../flags';
import type { SideEffect } from '../types/tool';
import type { ProvenanceIn, RawOp, RawToolDescriptor } from './raw';
import { prov } from './raw';

export const ADAPTER = 'mcp-tools';
export const ADAPTER_VERSION = '1.0.0';

export interface ApprovedServer {
  name: string;                 // registry name, reverse DNS, e.g. io.github.acme/weather
  remote_url?: string;          // https endpoint; absent = package only = never listed live
  approved_by: string;          // 'cto-desk'
  approved_at: string;
  schema_hash?: string;         // the schema hash approved
  trust_annotations?: boolean;
}

export interface McpTool {
  name: string; title?: string; description?: string;
  inputSchema?: Record<string, unknown>; outputSchema?: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
}

export class NotApproved extends Error {}

export function approvedEntry(name: string, approved: ApprovedServer[]): ApprovedServer | null {
  return approved.find((a) => a.name === name && a.approved_by === 'cto-desk') || null;
}

function sideEffectsOf(t: McpTool, a: ApprovedServer): SideEffect[] | null {
  if (t.annotations?.destructiveHint === true) return ['delete'];
  if (t.annotations?.readOnlyHint === true && a.trust_annotations === true) return ['read'];
  return null;
}

export function fromMcpToolsList(serverName: string, result: unknown, approved: ApprovedServer[], p: ProvenanceIn): RawToolDescriptor {
  const a = approvedEntry(serverName, approved);
  if (!a) throw new NotApproved(`${serverName} is not in the approved MCP list (CTO desk, D10)`);
  const tools: McpTool[] = Array.isArray((result as any)?.tools) ? (result as any).tools : [];
  if (tools.length > 200) throw new Error(`${serverName} lists ${tools.length} tools, more than 200 (T14)`);
  const ops: RawOp[] = tools.filter((t) => t && typeof t.name === 'string').map((t) => ({
    op: t.name,
    summary: String(t.description || t.title || t.name),
    input_schema: (t.inputSchema && typeof t.inputSchema === 'object') ? t.inputSchema : null,
    output_schema: (t.outputSchema && typeof t.outputSchema === 'object') ? t.outputSchema : null,
    side_effects: sideEffectsOf(t, a),
    idempotent: t.annotations?.idempotentHint === true && a.trust_annotations === true ? true : null,
  }));
  const [ns, nm] = serverName.split('/');
  return {
    source: 'mcp-tools', source_ref: serverName, origin: 'mcp', path: `${ns}/${nm}`,
    name: nm, description: ops.map((o) => o.summary).join(' ').slice(0, 2000),
    provider: { name: ns, kognai_owned: false }, category: 'mcp-server', tags: ['mcp', 'remote', 'tools-listed'],
    operations: ops, auth: { kind: 'none' }, pricing: { model: 'unknown', source: 'unknown' },
    licence: p.licence, endpoint: a.remote_url, implementation: 'remote', lifecycle: 'active',
    provenance: prov(p, ADAPTER, ADAPTER_VERSION),
  };
}

/** JSON-RPC over an https remote; injected so tests never touch the network. */
export type McpHttpTransport = (url: string, body: { jsonrpc: '2.0'; id: number; method: 'tools/list'; params: Record<string, unknown> }) => Promise<unknown>;

export async function listToolsLive(serverName: string, approved: ApprovedServer[], flags: Pick<KtrFlags, 'mcpListLive' | 'stopped'>, transport: McpHttpTransport): Promise<unknown> {
  if (flags.stopped) throw new Error('KTR is stopped (.swarm-state/ktr-stop)');
  if (!flags.mcpListLive) throw new Error('TOOL_ROUTER_MCP_LIST_LIVE is off');
  const a = approvedEntry(serverName, approved);
  if (!a) throw new NotApproved(`${serverName} is not in the approved MCP list (CTO desk, D10)`);
  if (!a.remote_url || !/^https:\/\//i.test(a.remote_url)) throw new Error(`${serverName} has no https remote: KTR never launches a package (policy/tool-router.txt rule 2)`);
  const res = await transport(a.remote_url, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
  return (res as any)?.result ?? res;
}
