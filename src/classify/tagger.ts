/**
 * Capability tagging of tool text at ingestion: the request cues plus each capability's tool_cues, matched on the
 * sanitised name, summary and description. Deterministic; tags only add evidence for retrieval (the capability
 * signal), they never change a tool's risk or trust.
 */
import { normalise } from './text';
import { findCues } from './rules';

/**
 * A capability is tagged when one of its tool cues appears, or when two different request cues do: one generic word
 * ("temperature", "transfer", "server") is not enough evidence on its own.
 */
export function tagCapabilities(toolText: string): string[] {
  const hits = findCues(normalise(toolText), undefined, true).filter((h) => !h.negated);
  const tool = new Set<string>();
  const req = new Map<string, Set<string>>();
  for (const h of hits) {
    if (h.kind === 'tool') tool.add(h.id);
    else (req.get(h.id) || req.set(h.id, new Set()).get(h.id)!).add(h.text);
  }
  for (const [id, texts] of req) if (texts.size >= 2) tool.add(id);
  return [...tool].sort();
}
