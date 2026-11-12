/** Canonical JSON (sorted keys, no whitespace) and sha256, the basis of schema hashes and snapshot ids. */
import { createHash } from 'node:crypto';

export function canonical(v: unknown): string {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'number' && !Number.isFinite(v)) return 'null';
    if (typeof v === 'bigint') return JSON.stringify(v.toString());
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}

export function sha256(s: string | Buffer): string {
  return createHash('sha256').update(s).digest('hex');
}

/** sha256 of the canonical input and output schemas of every operation, in operation order. */
export function schemaHash(ops: Array<{ op: string; input_schema: unknown; output_schema: unknown }>): string {
  return sha256(canonical(ops.map((o) => ({ op: o.op, input: o.input_schema ?? null, output: o.output_schema ?? null }))));
}
