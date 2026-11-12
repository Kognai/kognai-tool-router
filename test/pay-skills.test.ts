import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromPaySkills, frontMatter, priceMicro } from '../src/adapters/pay-skills';
import { P } from './helpers';

const TIERED_MD = `---
name: shopping
title: "Retail Prices"
description: "Compare retail prices across stores."
use_case: "Use for price comparison and deal alerts."
category: shopping
service_url: https://x402.retail.example
openapi:
  path: openapi.json
version: 1.1.0
---

x402 payment accepted in USDC on Base or Solana mainnet. Shopper endpoints are $0.01; analyst endpoints are $0.02.
`;
const TIERED_OPENAPI = {
  openapi: '3.0.0', info: { title: 'Retail', version: '1.1.0' }, servers: [{ url: 'https://x402.retail.example' }],
  paths: {
    '/v1/shopper/best-price': { get: { operationId: 'bestPrice', summary: 'Best price for a product', 'x-payment-info': { price: '$0.01' }, parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string' } }] } },
    '/v1/analyst/inflation': { get: { operationId: 'inflation', summary: 'Inflation trends', 'x-payment-info': { price: '$0.02' } } },
  },
};
const PLAIN_MD = `---
name: voice
title: "Voice"
description: "Speech to text and text to speech for agents."
use_case: "Use for transcription."
category: ai_ml
service_url: https://x402.voice.example
openapi:
  url: https://x402.voice.example/openapi.json
---
Body text without a price.
`;

test('front matter: scalars, quoted strings, one nested level', () => {
  const fm = frontMatter(TIERED_MD)!;
  assert.equal(fm.title, 'Retail Prices');
  assert.deepEqual(fm.openapi, { path: 'openapi.json' });
  assert.equal(fm.version, '1.1.0');
  assert.equal(frontMatter('no front matter'), null);
});

test('two fixture entries: tiered pricing to micro units, unknown when no openapi', () => {
  const r = fromPaySkills([
    { path: 'providers/retail/shopping/PAY.md', md: TIERED_MD, openapi: TIERED_OPENAPI },
    { path: 'providers/voicecorp/voice/PAY.md', md: PLAIN_MD },
    { path: 'providers/bad/PAY.md', md: PLAIN_MD },
  ], P);
  assert.equal(r.length, 2);
  const [shop, voice] = r;
  assert.equal(shop.path, 'retail/shopping');
  assert.equal(shop.origin, 'x402');
  assert.equal(shop.operations.length, 2);
  assert.deepEqual(shop.pricing, { model: 'per_call', price: { amount_micro: '10000', currency: 'USDC', network: 'base' }, unit: 'request', source: 'provider' });
  assert.deepEqual(shop.networks, ['base', 'solana']);
  assert.equal(shop.pricing_text, '$0.01');
  assert.equal(voice.operations.length, 1);
  assert.equal(voice.operations[0].side_effects, null);
  assert.deepEqual(voice.pricing, { model: 'unknown', source: 'unknown' });
  assert.match(voice.description, /transcription/);
});

test('priceMicro', () => {
  assert.equal(priceMicro('$0.01'), 10000n);
  assert.equal(priceMicro('0.25'), 250000n);
  assert.equal(priceMicro('free'), null);
  assert.equal(priceMicro('$1e3'), null);
});
