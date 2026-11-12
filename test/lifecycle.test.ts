import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, canMoveLifecycle, trustAfterDrift, trustMoveProblem, VERIFY_AUTHORITY } from '../src/catalog/lifecycle';
import { TRUST_STATES } from '../src/types/tool';

const ALLOWED = new Set([
  'quarantined>reviewed', 'quarantined>revoked',
  'reviewed>verified', 'reviewed>quarantined', 'reviewed>deprecated', 'reviewed>revoked',
  'verified>quarantined', 'verified>deprecated', 'verified>revoked',
  'deprecated>revoked',
]);

test('every trust transition, allowed and forbidden', () => {
  for (const a of TRUST_STATES) for (const b of TRUST_STATES) {
    assert.equal(canTransition(a, b), ALLOWED.has(`${a}>${b}`), `${a} -> ${b}`);
  }
  assert.equal(canTransition('quarantined', 'verified'), false, 'no skipping review');
  for (const b of TRUST_STATES) assert.equal(canTransition('revoked', b), false, 'revoked is terminal');
});

test('lifecycle moves', () => {
  assert.equal(canMoveLifecycle('draft', 'active'), true);
  assert.equal(canMoveLifecycle('active', 'draft'), false);
  assert.equal(canMoveLifecycle('retired', 'active'), false);
  assert.equal(canMoveLifecycle('deprecated', 'retired'), true);
});

test('only the CTO desk may review or verify an outside tool (D10)', () => {
  assert.match(trustMoveProblem({ origin: 'mcp', trust_state: 'quarantined' }, 'reviewed', 'some-agent')!, /cto-desk/);
  assert.equal(trustMoveProblem({ origin: 'mcp', trust_state: 'quarantined' }, 'reviewed', VERIFY_AUTHORITY), null);
  assert.equal(trustMoveProblem({ origin: 'mcp', trust_state: 'reviewed' }, 'verified', VERIFY_AUTHORITY), null);
  assert.match(trustMoveProblem({ origin: 'mcp', trust_state: 'quarantined' }, 'verified', VERIFY_AUTHORITY)!, /not an allowed/);
  assert.equal(trustMoveProblem({ origin: 'mcp', trust_state: 'verified' }, 'revoked', 'anyone'), null);
});

test('hash drift sends a verified outside row back to quarantine; native rows keep their state', () => {
  const prev = { origin: 'mcp' as const, trust_state: 'verified' as const, schema_hash: 'a', implementation_hash: 'i1' };
  assert.deepEqual(trustAfterDrift(prev, { schema_hash: 'b', implementation_hash: 'i1' }), { trust: 'quarantined', drifted: true });
  assert.deepEqual(trustAfterDrift(prev, { schema_hash: 'a', implementation_hash: 'i2' }), { trust: 'quarantined', drifted: true });
  assert.deepEqual(trustAfterDrift(prev, { schema_hash: 'a', implementation_hash: 'i1' }), { trust: 'verified', drifted: false });
  assert.deepEqual(trustAfterDrift({ ...prev, origin: 'kognai' }, { schema_hash: 'b', implementation_hash: 'i1' }), { trust: 'verified', drifted: true });
  assert.deepEqual(trustAfterDrift({ ...prev, trust_state: 'revoked' }, { schema_hash: 'b', implementation_hash: null }), { trust: 'revoked', drifted: true });
});
