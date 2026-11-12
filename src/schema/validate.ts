/**
 * A minimal JSON Schema validator for the subset KTR emits (plan.md S1): type, required, enum, const, pattern,
 * minLength, maxLength, minItems, maxItems, items, properties, additionalProperties. Any other keyword is ignored and
 * reported in `ignored`, so a schema that relies on it is visible instead of silently passing. External tool schemas
 * are only stored and hashed, never validated against arguments in milestone 1.
 */
import toolSchemaJson from './tool.schema.json';

export interface ValidateResult { ok: boolean; errors: string[]; ignored: string[] }

const SUPPORTED = new Set([
  'type', 'required', 'enum', 'const', 'pattern', 'minLength', 'maxLength', 'minItems', 'maxItems', 'items', 'properties',
  'additionalProperties', '$schema', '$id', 'title', 'description', 'default', 'examples',
]);

const typeOf = (v: unknown): string => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
};
const typeMatches = (want: string, v: unknown): boolean => {
  const t = typeOf(v);
  return want === t || (want === 'number' && t === 'integer');
};
const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function validate(schema: Record<string, any>, value: unknown, max = 50): ValidateResult {
  const errors: string[] = [];
  const ignored = new Set<string>();
  const walk = (s: Record<string, any>, v: unknown, path: string): void => {
    if (errors.length >= max || !s || typeof s !== 'object') return;
    for (const k of Object.keys(s)) if (!SUPPORTED.has(k)) ignored.add(k);
    if (s.type !== undefined) {
      const types: string[] = Array.isArray(s.type) ? s.type : [s.type];
      if (!types.some((t) => typeMatches(t, v))) { errors.push(`${path || '/'}: expected ${types.join(' or ')}, got ${typeOf(v)}`); return; }
    }
    if (s.enum !== undefined && !s.enum.some((e: unknown) => eq(e, v))) errors.push(`${path || '/'}: not one of ${JSON.stringify(s.enum)}`);
    if (s.const !== undefined && !eq(s.const, v)) errors.push(`${path || '/'}: must be ${JSON.stringify(s.const)}`);
    if (typeof v === 'string') {
      if (typeof s.maxLength === 'number' && [...v].length > s.maxLength) errors.push(`${path}: longer than ${s.maxLength}`);
      if (typeof s.minLength === 'number' && [...v].length < s.minLength) errors.push(`${path}: shorter than ${s.minLength}`);
      if (typeof s.pattern === 'string' && !new RegExp(s.pattern, 'u').test(v)) errors.push(`${path}: does not match ${s.pattern}`);
    }
    if (Array.isArray(v)) {
      if (typeof s.maxItems === 'number' && v.length > s.maxItems) errors.push(`${path}: more than ${s.maxItems} items`);
      if (typeof s.minItems === 'number' && v.length < s.minItems) errors.push(`${path}: fewer than ${s.minItems} items`);
      if (s.items && typeof s.items === 'object') v.forEach((x, i) => walk(s.items, x, `${path}/${i}`));
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      if (Array.isArray(s.required)) for (const r of s.required) if (!(r in o)) errors.push(`${path}/${r}: required`);
      const props: Record<string, any> = s.properties || {};
      for (const [k, x] of Object.entries(o)) {
        if (props[k]) walk(props[k], x, `${path}/${k}`);
        else if (s.additionalProperties === false) errors.push(`${path}/${k}: not allowed`);
        else if (s.additionalProperties && typeof s.additionalProperties === 'object') walk(s.additionalProperties, x, `${path}/${k}`);
      }
    }
  };
  walk(schema, value, '');
  return { ok: errors.length === 0, errors, ignored: [...ignored].sort() };
}

export const TOOL_SCHEMA: Record<string, any> = toolSchemaJson as Record<string, any>;

/** Validates a ToolRecord against the KTR schema. */
export const validateToolRecord = (rec: unknown): ValidateResult => validate(TOOL_SCHEMA, rec);
