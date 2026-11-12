import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromX402Resources, networkOf } from '../src/adapters/x402-discovery';
import { fixture, P } from './helpers';

test('raw PayAI and CDP shapes: offers in micro units, networks, bazaar input; payees never copied', () => {
  const r = fromX402Resources(fixture('x402-items.json').raw, P, 'payai-discovery');
  assert.equal(r.length, 4, 'the http resource is skipped');
  const [holders, newsV1, newsDup, free] = r;
  assert.equal(holders.path, 'holders.example/v1-solana-holders-post');
  assert.deepEqual(holders.pricing, { model: 'per_call', price: { amount_micro: '5000', currency: 'USDC', network: 'solana' }, unit: 'request', source: 'provider' });
  assert.deepEqual(holders.networks, ['solana']);
  assert.equal(holders.operations[0].side_effects, null, 'a POST is unknown');
  assert.deepEqual((holders.operations[0].input_schema as any).required, ['mint']);
  assert.equal(newsV1.pricing!.price?.amount_micro, '1000');
  assert.deepEqual(newsV1.networks, ['base']);
  assert.deepEqual(newsV1.operations[0].side_effects, ['read']);
  assert.equal(newsDup.path, 'news.example/crypto-news-2', 'a second listing of the same path gets its own id');
  assert.equal(newsDup.pricing!.price?.amount_micro, '1500', 'the cheapest offer');
  assert.deepEqual(free.pricing, { model: 'unknown', source: 'unknown' });
  assert.doesNotMatch(JSON.stringify(r), /PAYEE|0xP"/, 'no payee in the catalog');
});

test('Golden Kog normalised resources', () => {
  const r = fromX402Resources(fixture('x402-items.json').goldenKog, P, 'golden-kog-catalog');
  assert.equal(r.length, 1);
  assert.equal(r[0].source, 'golden-kog-catalog');
  assert.equal(r[0].pricing!.price?.amount_micro, '80000');
  assert.ok(r[0].tags!.includes('holders'));
  assert.ok(r[0].tags!.includes('payai'));
});

test('networkOf maps CAIP and names', () => {
  assert.equal(networkOf('eip155:8453'), 'base');
  assert.equal(networkOf('eip155:84532'), 'base-sepolia');
  assert.equal(networkOf('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'), 'solana');
  assert.equal(networkOf('eip155:1'), null);
});
