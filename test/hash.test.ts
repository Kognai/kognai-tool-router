import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonical, sha256, schemaHash } from '../src/hash';

test('canonical JSON is independent of key order', () => {
  assert.equal(canonical({ b: 1, a: { d: [1, 2], c: null } }), canonical({ a: { c: null, d: [1, 2] }, b: 1 }));
  assert.equal(canonical({ a: 1, b: undefined }), '{"a":1}');
  assert.equal(canonical([3, 'x', true]), '[3,"x",true]');
});

test('schema hash is stable across whitespace and key order', () => {
  const a = JSON.parse('{ "type": "object", "properties": { "q": { "type": "string" } }, "required": ["q"] }');
  const b = JSON.parse('{"required":["q"],"properties":{"q":{"type":"string"}},"type":"object"}');
  assert.equal(schemaHash([{ op: 'search', input_schema: a, output_schema: null }]), schemaHash([{ op: 'search', input_schema: b, output_schema: null }]));
  assert.notEqual(schemaHash([{ op: 'search', input_schema: a, output_schema: null }]), schemaHash([{ op: 'find', input_schema: a, output_schema: null }]));
});

test('sha256 hex', () => {
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
