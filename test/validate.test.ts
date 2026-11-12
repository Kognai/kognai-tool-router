import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, TOOL_SCHEMA } from '../src/schema/validate';

test('type, including integer, number and nullable unions', () => {
  assert.equal(validate({ type: 'string' }, 'x').ok, true);
  assert.equal(validate({ type: 'string' }, 1).ok, false);
  assert.equal(validate({ type: 'number' }, 3).ok, true);
  assert.equal(validate({ type: 'integer' }, 3.5).ok, false);
  assert.equal(validate({ type: ['string', 'null'] }, null).ok, true);
  assert.equal(validate({ type: 'array' }, {}).ok, false);
  assert.equal(validate({ type: 'object' }, []).ok, false);
});

test('required, properties and additionalProperties', () => {
  const s = { type: 'object', required: ['a'], properties: { a: { type: 'string' } }, additionalProperties: false };
  assert.equal(validate(s, { a: 'x' }).ok, true);
  assert.match(validate(s, {}).errors[0], /\/a: required/);
  assert.match(validate(s, { a: 'x', b: 1 }).errors[0], /\/b: not allowed/);
  assert.equal(validate({ type: 'object', additionalProperties: { type: 'number' } }, { x: 'no' }).ok, false);
});

test('enum, const, pattern, lengths and items', () => {
  assert.equal(validate({ enum: ['a', null] }, null).ok, true);
  assert.equal(validate({ enum: ['a'] }, 'b').ok, false);
  assert.equal(validate({ const: 1 }, 2).ok, false);
  assert.equal(validate({ type: 'string', pattern: '^[a-z]+$' }, 'abc').ok, true);
  assert.equal(validate({ type: 'string', pattern: '^[a-z]+$' }, 'aBc').ok, false);
  assert.equal(validate({ type: 'string', maxLength: 2 }, 'abc').ok, false);
  assert.equal(validate({ type: 'string', minLength: 2 }, 'a').ok, false);
  assert.equal(validate({ type: 'array', items: { type: 'integer' }, maxItems: 2 }, [1, 2, 3]).ok, false);
  assert.match(validate({ type: 'array', items: { type: 'integer' } }, [1, 'x']).errors[0], /\/1: expected integer/);
  assert.equal(validate({ type: 'array', minItems: 1 }, []).ok, false);
});

test('unknown keywords are ignored but reported', () => {
  const r = validate({ type: 'object', oneOf: [{}], properties: { a: { type: 'string', format: 'uri' } } }, { a: 'x' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.ignored, ['format', 'oneOf']);
});

test('the ToolRecord schema loads and refuses an empty object', () => {
  assert.equal(TOOL_SCHEMA.title, 'KTR ToolRecord v1');
  const r = validate(TOOL_SCHEMA, {});
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('/id: required')));
});
