/**
 * awesome-mcp-servers (github punkpeye/awesome-mcp-servers, MIT list; each server under its own licence) Markdown
 * lines to metadata only descriptors. Lifecycle "draft": never eligible, not even in discover mode; they exist in the
 * catalog so the router can say that unverified community servers exist (exclusion counts) and so the benchmark has
 * realistic volume. The emoji legend becomes tags.
 */
import type { ProvenanceIn, RawToolDescriptor } from './raw';
import { prov } from './raw';

export const ADAPTER = 'awesome-list';
export const ADAPTER_VERSION = '1.0.0';

const LEGEND: Array<[string, string]> = [
  ['🎖️', 'official'], ['🎖', 'official'], ['📇', 'typescript'], ['🐍', 'python'], ['🏎️', 'go'], ['🏎', 'go'], ['🦀', 'rust'],
  ['#️⃣', 'csharp'], ['☕', 'java'], ['🌊', 'c-cpp'], ['💎', 'ruby'], ['☁️', 'cloud'], ['☁', 'cloud'], ['🏠', 'local'],
  ['📟', 'embedded'], ['🍎', 'macos'], ['🪟', 'windows'], ['🐧', 'linux'],
];

const LINE = /^\s*[-*]\s+\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)(.*)$/;
const HEADING = /^###\s+(.*)$/;

export function fromAwesomeMarkdown(md: string, p: ProvenanceIn): RawToolDescriptor[] {
  const out: RawToolDescriptor[] = [];
  const used = new Set<string>();
  let category = 'uncategorised';
  let inServers = false;
  for (const line of md.split(/\r?\n/)) {
    if (/^##\s/.test(line)) { inServers = /^##\s+Server Implementations/i.test(line); continue; }
    const h = HEADING.exec(line);
    if (h) {
      const anchor = /<a name="([^"]+)"/.exec(h[1]);
      category = (anchor ? anchor[1] : h[1].replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N} &-]/gu, '').trim()).toLowerCase().replace(/\s+/g, '-') || 'uncategorised';
      continue;
    }
    if (!inServers) continue;
    const m = LINE.exec(line);
    if (!m) continue;
    const [, label, url, rest] = m;
    const gh = /github\.com\/([^/\s]+)\/([^/\s#?]+)/i.exec(url);
    let host = 'unknown'; let segs: string[] = [];
    try { const u = new URL(url); host = u.hostname; segs = u.pathname.split('/').filter(Boolean); } catch { /* keep unknown */ }
    const ns = gh ? gh[1] : segs[0] || host;
    const nm = (gh ? gh[2] : segs[1] || label.replace(/^@/, '').split('/').pop() || label).replace(/\.git$/, '');
    const providerName = gh ? gh[1] : host;
    let path = `${ns}/${nm}`;
    for (let i = 2; used.has(path.toLowerCase()); i++) path = `${ns}/${nm}-${i}`;
    used.add(path.toLowerCase());
    const noBadges = rest.replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
    const dash = noBadges.search(/\s[-–—]\s/);
    const legendPart = dash >= 0 ? noBadges.slice(0, dash) : noBadges;
    const description = dash >= 0 ? noBadges.slice(dash).replace(/^\s*[-–—]\s*/, '').trim() : '';
    const tags = [...new Set(LEGEND.filter(([e]) => legendPart.includes(e)).map(([, t]) => t))];
    out.push({
      source: 'awesome-mcp-servers', source_ref: url, origin: 'community', path,
      name: label.slice(0, 120), description,
      provider: { name: providerName, url, kognai_owned: false }, category, tags: ['community', 'metadata-only', category, ...tags],
      operations: [{ op: 'server', summary: description || label, input_schema: null, output_schema: null, side_effects: null }],
      auth: { kind: 'none' }, pricing: { model: 'unknown', source: 'unknown' }, licence: null,
      implementation: 'metadata', lifecycle: 'draft', provenance: prov(p, ADAPTER, ADAPTER_VERSION),
    });
  }
  return out;
}
