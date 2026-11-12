/**
 * Tool ids (ADR-004): tool:<origin>:<namespace>/<name>[#<operation>]. Lower case, version free, URL and file safe.
 */
import type { Origin } from './types/tool';

export const TOOL_ID_RE = /^tool:(kognai|mcp|openapi|x402|community|composio):[a-z0-9._-]+(\/[a-z0-9._-]+)+(#[a-z0-9_.-]+)?$/;
const SEG_RE = /^[a-z0-9._-]+$/;
const MAX_PATH = 128;

export interface ParsedToolId { origin: Origin; path: string; op?: string }

export function parseToolId(s: string): ParsedToolId | null {
  if (typeof s !== 'string' || !TOOL_ID_RE.test(s)) return null;
  const rest = s.slice(5);
  const colon = rest.indexOf(':');
  const origin = rest.slice(0, colon) as Origin;
  let path = rest.slice(colon + 1);
  let op: string | undefined;
  const hash = path.indexOf('#');
  if (hash >= 0) { op = path.slice(hash + 1); path = path.slice(0, hash); }
  if (path.length > MAX_PATH) return null;
  if (path.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) return null;
  return op === undefined ? { origin, path } : { origin, path, op };
}

/** Normalises any string to one id segment: lower case, [a-z0-9._-], no leading or trailing separators. */
export function slugSegment(s: string): string {
  const out = String(s ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return out.slice(0, 60) || 'x';
}

export function formatToolId(origin: Origin, path: string, op?: string): string {
  const segs = path.split('/').map(slugSegment);
  if (segs.length < 2) throw new Error(`tool id path needs namespace/name, got "${path}"`);
  if (!segs.every((x) => SEG_RE.test(x))) throw new Error(`bad tool id path "${path}"`);
  const id = `tool:${origin}:${segs.join('/')}${op ? `#${slugSegment(op).replace(/-/g, '_')}` : ''}`;
  if (!parseToolId(id)) throw new Error(`could not form a valid tool id from "${path}"`);
  return id;
}

/** The id without '#operation'. */
export const baseId = (id: string): string => id.split('#')[0];
export const withOp = (id: string, op: string): string => `${baseId(id)}#${op}`;
