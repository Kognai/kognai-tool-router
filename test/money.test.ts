import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMicro, fromMicro, microOf, fmt } from '../src/money';

test('toMicro parses decimals without a float path', () => {
  assert.equal(toMicro('0.17'), 170000n);
  assert.equal(toMicro('1.5'), 1500000n);
  assert.equal(toMicro('0.000001'), 1n);
  assert.equal(toMicro('12'), 12000000n);
  assert.equal(toMicro('0.1000000'), 100000n);
  // the classic float trap: 0.1 + 0.2 is exact here
  assert.equal(toMicro('0.1') + toMicro('0.2'), toMicro('0.3'));
});

test('negative, malformed and over precise amounts are refused', () => {
  assert.throws(() => toMicro('-1'));
  assert.throws(() => toMicro('1e3'));
  assert.throws(() => toMicro('abc'));
  assert.throws(() => toMicro('0.0000001'));
});

test('fromMicro round trips', () => {
  for (const s of ['0.17', '1.5', '0.000001', '12', '1234.56789']) assert.equal(fromMicro(toMicro(s)), s);
  assert.throws(() => fromMicro(-1n));
});

test('microOf and fmt', () => {
  assert.equal(microOf('1500000'), 1500000n);
  assert.equal(microOf('1.5'), null);
  assert.equal(microOf(undefined), null);
  assert.equal(fmt({ amount_micro: '1500000', currency: 'USDC', network: 'base' }), '1.5 USDC on base');
  assert.equal(fmt({ amount_micro: '3000', currency: 'KGC' }), '3000 KGC');
});
