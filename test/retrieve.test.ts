import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenise } from '../src/retrieve/tokenise';
import { Bm25Index } from '../src/retrieve/bm25';
import { topK, cosineAll, checkQuery, normaliseRows } from '../src/retrieve/vector';
import { capabilityScore } from '../src/retrieve/capability';
import { schemaFit, UNKNOWN_SCHEMA } from '../src/retrieve/schema-fit';
import { RouterIndex, retrieve } from '../src/retrieve/hybrid';
import { hashEmbed, HASH_MODEL } from '../src/retrieve/hash-embed';
import { fixtureStore } from './fixture-catalog';
import type { PlanNode } from '../src/types/route';

const node = (capability: string, over: Partial<PlanNode> = {}): PlanNode => ({ node_id: 'n1', capability, depends_on: [], risk_classes: [], args_known: ['query'], args_missing: [], needs_tool: true, ...over });

test('tokenise: stop words, plurals, accents, Arabic article, derja digits', () => {
  assert.deepEqual(tokenise('The weather forecasts for Paris'), ['weather', 'forecast', 'pari']);
  assert.deepEqual(tokenise('Prévisions météo à Tunis'), ['prevision', 'meteo', 'tuni']);
  assert.deepEqual(tokenise('الطقس في تونس'), ['طقس', 'تونس']);
  assert.ok(tokenise('a3melli fidyo').includes('a3melli'));
});

test('BM25 ranks the matching document first and saturates repeats', () => {
  const ix = new Bm25Index([
    { key: 'a', text: 'weather forecast for a city' },
    { key: 'b', text: 'search pubmed papers' },
    { key: 'c', text: 'weather weather weather weather weather weather' },
  ]);
  const r = ix.search('weather forecast', 3);
  assert.equal(r[0].key, 'a');
  assert.ok(r.length === 2);
  assert.deepEqual(ix.search('nothing here', 3), []);
});

test('vectors: cosine, topK, refusals on model or dimension mismatch', () => {
  const data = normaliseRows(new Float32Array([1, 0, 0, 1, 1, 1]), 2);
  const r = topK(new Float32Array([1, 0]), data, 2, 2);
  assert.equal(r[0].row, 0);
  assert.ok(Math.abs(cosineAll(new Float32Array([0, 2]), data, 2)[1] - 1) < 1e-6);
  assert.throws(() => checkQuery({ model: 'bge-m3', dims: 1024 }, 'nomic', new Float32Array(1024)), /refused/);
  assert.throws(() => checkQuery({ model: 'bge-m3', dims: 1024 }, 'bge-m3', new Float32Array(768)), /refused/);
  const a = hashEmbed('weather forecast in Paris'); const b = hashEmbed('forecast of the weather for Paris'); const c = hashEmbed('send money to a wallet');
  const dot = (x: Float32Array, y: Float32Array) => x.reduce((s, v, i) => s + v * y[i], 0);
  assert.ok(dot(a, b) > dot(a, c));
});

test('capability: exact 1, same family 0.5, else 0', () => {
  assert.equal(capabilityScore('weather.forecast', ['weather.forecast']), 1);
  assert.equal(capabilityScore('mail.search', ['mail.read']), 0.5);
  assert.equal(capabilityScore('mail.search', ['video.generate']), 0);
});

test('schema fit: unknown 0.3 and never 1; required inputs the request supplies; chained nodes', () => {
  assert.equal(schemaFit(node('x'), {}), UNKNOWN_SCHEMA);
  assert.equal(schemaFit(node('x'), null), UNKNOWN_SCHEMA);
  const city = { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] };
  assert.ok(schemaFit(node('x', { args_known: ['query', 'location'] }), city) > schemaFit(node('x'), city));
  assert.ok(schemaFit(node('x', { args_known: ['query', 'location'] }), city) < 1);
  assert.equal(schemaFit(node('x'), { type: 'object', properties: { max: { type: 'integer' } } }), 0.8);
  assert.equal(schemaFit(node('x', { depends_on: ['n0'] }), city, null), 0.6);
  assert.ok(schemaFit(node('x', { depends_on: ['n0'] }), city, { properties: { city: {} } }) > 0.9);
});

test('hybrid: union of signals, every signal in 0..1, exact capability matches included', () => {
  const s = fixtureStore();
  const ix = new RouterIndex(s, { vectorModel: HASH_MODEL });
  assert.ok(ix.vectors);
  const q = hashEmbed("What's the weather in Paris tomorrow?");
  const got = retrieve(ix, node('weather.forecast', { args_known: ['query', 'location'] }), "What's the weather in Paris tomorrow?", { queryVector: { model: HASH_MODEL, vector: q }, cosines: ix.cosines(HASH_MODEL, q) });
  const keys = got.map((g) => g.item.key);
  assert.ok(keys.includes('tool:mcp:io.github.acme/weather#forecast'));
  assert.ok(keys.includes('tool:openapi:meteo.example/forecast#get_forecast'));
  for (const g of got) for (const v of [g.signals.lexical, g.signals.vector, g.signals.capability, g.signals.schema, g.signals.health]) assert.ok(v >= 0 && v <= 1);
  assert.throws(() => ix.cosines('bge-m3', q), /refused/);
});
