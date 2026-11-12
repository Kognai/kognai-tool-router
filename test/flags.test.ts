import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFlags, ALL_OFF, FLAG_ENV } from '../src/flags';

test('every flag is off by default', () => {
  const f = readFlags({});
  for (const k of Object.keys(FLAG_ENV)) assert.equal((f as any)[k], false, k);
  assert.equal(f.stopped, false);
  assert.deepEqual(ALL_OFF, f);
});

test('"true" and "1" turn a flag on; anything else is off', () => {
  assert.equal(readFlags({ TOOL_ROUTER_ENABLED: 'true' }).enabled, true);
  assert.equal(readFlags({ TOOL_ROUTER_ENABLED: '1' }).enabled, true);
  for (const v of ['yes', 'on', 'TRUE', '0', 'false', '']) assert.equal(readFlags({ TOOL_ROUTER_ENABLED: v }).enabled, false, v);
  assert.equal(readFlags({ TOOL_ROUTER_EXTERNAL_DISCOVERY: '1' }).externalDiscovery, true);
  assert.equal(readFlags({ TOOL_ROUTER_MODEL_FALLBACK: 'true' }).modelFallback, true);
});

test('the stop file overrides every flag', () => {
  const env = Object.fromEntries(Object.values(FLAG_ENV).map((n) => [n, '1']));
  const f = readFlags(env, { stopFileExists: true });
  assert.equal(f.stopped, true);
  for (const k of Object.keys(FLAG_ENV)) assert.equal((f as any)[k], false, k);
});

test('S4: execution is off by default and on only when set; marketplace and mainnet stay off even when set', () => {
  assert.equal(readFlags({}).executionEnabled, false);
  assert.equal(readFlags({ TOOL_ROUTER_EXECUTION_ENABLED: 'yes' }).executionEnabled, false);
  assert.equal(readFlags({ TOOL_ROUTER_EXECUTION_ENABLED: '1' }, { stopFileExists: true }).executionEnabled, false);
  const f = readFlags({ TOOL_ROUTER_EXECUTION_ENABLED: '1', SKILLS_MARKETPLACE_ENABLED: '1', SKILL_RENTAL_MAINNET_ENABLED: '1' });
  assert.equal(f.executionEnabled, true);
  assert.equal(f.marketplaceEnabled, false);
  assert.equal(f.rentalMainnet, false);
});
