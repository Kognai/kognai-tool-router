import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveRisk, urlFromUser, takesDestination } from '../src/catalog/risk';

const base = { origin: 'mcp' as const, external_network: true };

test('unknown side effects are never safe', () => {
  assert.deepEqual(deriveRisk({ ...base, side_effects: null, text: 'helpful tool' }).risk, ['network', 'data_modification']);
  assert.deepEqual(deriveRisk({ ...base, side_effects: [], text: 'helpful tool' }).risk, ['network', 'data_modification']);
});

test('side effects map to classes; read only only when nothing stricter applies', () => {
  assert.deepEqual(deriveRisk({ ...base, side_effects: ['read'], text: 'forecast' }).risk, ['read_only', 'network']);
  assert.deepEqual(deriveRisk({ ...base, side_effects: ['delete'], text: 'x' }).risk, ['network', 'data_modification', 'destructive']);
  assert.deepEqual(deriveRisk({ ...base, side_effects: ['read'], text: 'Read and delete old records' }).risk, ['network', 'destructive']);
  assert.deepEqual(deriveRisk({ origin: 'kognai', external_network: false, side_effects: ['read'], text: 'count unread' }).risk, ['read_only']);
});

test('cue words add stricter classes and never remove any', () => {
  assert.ok(deriveRisk({ ...base, side_effects: ['read'], text: 'Swap tokens on a DEX' }).risk.includes('payment'));
  assert.ok(deriveRisk({ ...base, side_effects: ['read'], text: 'Send an email to a contact' }).risk.includes('publish_or_message'));
  assert.ok(deriveRisk({ ...base, side_effects: ['read'], text: 'Deploy to Kubernetes' }).risk.includes('privileged_infra'));
  assert.ok(deriveRisk({ ...base, side_effects: ['read'], text: 'Search your Gmail inbox' }).risk.includes('sensitive_data'));
  assert.ok(!deriveRisk({ ...base, side_effects: ['read'], text: 'Pay per call weather data' }).risk.includes('payment'), 'pay per call is a price, not a payment op');
});

test('url_from_user and destination arguments', () => {
  assert.equal(urlFromUser({ type: 'object', properties: { url: { type: 'string' } } }), true);
  assert.equal(urlFromUser({ type: 'object', properties: { page: { type: 'string', format: 'uri' } } }), true);
  assert.equal(urlFromUser({ type: 'object', properties: { body: { type: 'object', properties: { link: { type: 'string' } } } } }), true);
  assert.equal(urlFromUser({ type: 'object', properties: { city: { type: 'string' } } }), false);
  assert.equal(takesDestination({ type: 'object', properties: { recipient_address: { type: 'string' } } }), true);
  assert.equal(takesDestination({ type: 'object', properties: { mint: { type: 'string' } } }), false);
  const r = deriveRisk({ ...base, side_effects: ['read'], text: 'scrape', input_schema: { type: 'object', properties: { url: { type: 'string' } } } });
  assert.equal(r.url_from_user, true);
});
