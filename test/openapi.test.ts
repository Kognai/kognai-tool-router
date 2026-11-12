import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromOpenApi, sideEffectOf } from '../src/adapters/openapi';
import { fixture, P } from './helpers';

test('weather fixture: parameters, body, refs and methods', () => {
  const d = fromOpenApi(fixture('openapi-weather.json'), P, { path: 'weather-fixture/forecast' });
  assert.equal(d.origin, 'openapi');
  assert.equal(d.endpoint, 'https://api.weather-fixture.test/v1');
  const ops = Object.fromEntries(d.operations.map((o) => [o.op, o]));
  assert.deepEqual(Object.keys(ops).sort(), ['delete_stations_id', 'geocode', 'getforecast', 'put_stations_id']);
  const f = ops.getforecast;
  assert.deepEqual(f.side_effects, ['read']);
  assert.deepEqual((f.input_schema as any).required, ['latitude', 'longitude']);
  assert.equal((f.input_schema as any).properties['X-Api-Key'], undefined, 'headers are not inputs');
  assert.equal((f.output_schema as any).properties.hourly.properties.temperature_2m.type, 'array', '$ref resolved');
  assert.equal((f.output_schema as any).properties.self.description, 'recursive', 'cycle cut');
  assert.deepEqual(ops.geocode.side_effects, ['write'], 'POST writes unless our own list says safe');
  assert.deepEqual((ops.geocode.input_schema as any).required, ['body']);
  assert.deepEqual(ops.delete_stations_id.side_effects, ['delete']);
  assert.deepEqual((ops.delete_stations_id.input_schema as any).required, ['id'], 'path params are required');
  assert.deepEqual(ops.put_stations_id.side_effects, ['write']);
});

test('PubMed fixture: method to side effect, api key auth, safe POST only by our list', () => {
  const d = fromOpenApi(fixture('openapi-pubmed.json'), P, { path: 'ncbi/eutils', safePostOps: ['epost'] });
  const ops = Object.fromEntries(d.operations.map((o) => [o.op, o]));
  assert.deepEqual(ops.esearch.side_effects, ['read']);
  assert.deepEqual(ops.epost.side_effects, ['read']);
  assert.equal(d.auth?.kind, 'api_key');
  assert.equal(d.version, '2.0');
  assert.deepEqual((ops.esearch.input_schema as any).properties.db.enum, ['pubmed', 'pmc']);
});

test('sideEffectOf and a non OpenAPI document', () => {
  assert.deepEqual(sideEffectOf('head', 'x'), ['read']);
  assert.deepEqual(sideEffectOf('patch', 'x'), ['write']);
  assert.throws(() => fromOpenApi({ swagger: '2.0' }, P));
});
