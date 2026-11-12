import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ingest } from '../src/catalog/ingest';
import { MemoryCatalogStore } from '../src/catalog/memory-store';
import { fromServerJson } from '../src/adapters/mcp-registry';
import { fromOpenApi } from '../src/adapters/openapi';
import { fromAwesomeMarkdown } from '../src/adapters/awesome-list';
import type { RawToolDescriptor } from '../src/adapters/raw';
import { validateToolRecord } from '../src/schema/validate';
import { fixture, fixtureText, P } from './helpers';

const NOW = '2026-10-12T10:00:00.000Z';
const prov = { ...P, adapter: 'test', adapter_version: '1' };

function native(over: Partial<RawToolDescriptor> = {}): RawToolDescriptor {
  return {
    source: 'kognai:connectors', source_ref: 'core/connectors/registry.ts', origin: 'kognai', path: 'connectors/gmail',
    name: 'Gmail', description: 'Read the owner\'s Gmail.', provider: { name: 'Kognai', kognai_owned: true },
    operations: [{ op: 'search', summary: 'Search mail', input_schema: { type: 'object', properties: { from: { type: 'string' } } }, side_effects: ['read'], scopes: ['gmail.readonly'] }],
    privacy_class: 'private', business_tier: 'free', provenance: prov, ...over,
  };
}
function outside(over: Partial<RawToolDescriptor> = {}): RawToolDescriptor {
  return {
    source: 'mcp-registry', source_ref: 'x', origin: 'mcp', path: 'com.example/weather', name: 'Weather', description: 'Forecasts.',
    provider: { name: 'example' }, operations: [{ op: 'forecast', summary: 'Forecast', input_schema: { type: 'object', properties: { city: { type: 'string' } } }, side_effects: ['read'] }],
    endpoint: 'https://api.example.com/mcp', version: '1.0.0', provenance: prov, ...over,
  };
}

test('every ingested row validates against the ToolRecord schema', () => {
  const s = new MemoryCatalogStore();
  const raws = [
    native(), outside(),
    ...fromServerJson(fixture('mcp-servers.json'), P),
    fromOpenApi(fixture('openapi-weather.json'), P, { path: 'weather-fixture/forecast' }),
    ...fromAwesomeMarkdown(fixtureText('awesome-10.md'), P),
  ];
  const r = ingest(raws, s, { now: NOW });
  assert.deepEqual(r.rejected, []);
  for (const rec of s.all()) assert.deepEqual(validateToolRecord(rec).errors, [], rec.id);
});

test('trust: native Kognai verified, everything else quarantined; a non Kognai source cannot claim kognai', () => {
  const s = new MemoryCatalogStore();
  const r = ingest([native(), outside(), native({ source: 'mcp-registry', path: 'connectors/fake' })], s, { now: NOW });
  assert.equal(s.get('tool:kognai:connectors/gmail')!.trust_state, 'verified');
  assert.equal(s.get('tool:mcp:com.example/weather')!.trust_state, 'quarantined');
  assert.equal(r.verified, 1);
  assert.equal(r.quarantined, 1);
  assert.match(r.rejected[0].why, /non Kognai source/);
});

test('risk classes fail closed; native mail read is read_only + sensitive_data', () => {
  const s = new MemoryCatalogStore();
  ingest([native(), outside({ path: 'x/unknown', operations: [{ op: 'do', summary: 'Do things', side_effects: null }] })], s, { now: NOW });
  assert.deepEqual(s.get('tool:kognai:connectors/gmail')!.operations[0].risk_classes, ['read_only', 'sensitive_data']);
  assert.deepEqual(s.get('tool:mcp:x/unknown')!.operations[0].risk_classes, ['network', 'data_modification']);
});

test('dedup and versions: unchanged, new provider version, new schema at the same version', () => {
  const s = new MemoryCatalogStore();
  ingest([outside()], s, { now: NOW });
  const again = ingest([outside()], s, { now: '2026-10-13T00:00:00.000Z' });
  assert.equal(again.per_source['mcp-registry'].unchanged, 1);
  const v2 = ingest([outside({ version: '1.1.0' })], s, { now: NOW });
  assert.equal(v2.per_source['mcp-registry'].versioned, 1);
  assert.equal(s.get('tool:mcp:com.example/weather')!.version, '1.1.0');
  const changed = ingest([outside({ version: '1.1.0', operations: [{ op: 'forecast', summary: 'F', input_schema: { type: 'object', properties: { lat: { type: 'number' } } }, side_effects: ['read'] }] })], s, { now: NOW });
  assert.equal(changed.per_source['mcp-registry'].versioned, 1);
  assert.match(s.get('tool:mcp:com.example/weather')!.version, /^1\.1\.0\+[0-9a-f]{12}$/);
  assert.equal([...s.all()].length, 3, 'old versions stay');
  assert.equal([...s.latest()].length, 1);
});

test('no provider version: version from the schema hash', () => {
  const s = new MemoryCatalogStore();
  ingest([outside({ version: undefined })], s, { now: NOW });
  assert.match(s.get('tool:mcp:com.example/weather')!.version, /^0\.0\.0\+[0-9a-f]{12}$/);
});

test('same_as: same endpoint host and same known schema under another id', () => {
  const s = new MemoryCatalogStore();
  const r = ingest([outside(), outside({ source: 'pay-skills', origin: 'x402', path: 'example/weather-x402' })], s, { now: NOW });
  assert.equal(r.same_as_links, 2);
  assert.deepEqual(s.get('tool:mcp:com.example/weather')!.same_as, ['tool:x402:example/weather-x402']);
  // unknown schemas never link (they all hash alike)
  const s2 = new MemoryCatalogStore();
  const r2 = ingest([outside({ operations: [{ op: 'a', summary: 'a' }] }), outside({ path: 'example/other', operations: [{ op: 'a', summary: 'a' }] })], s2, { now: NOW });
  assert.equal(r2.same_as_links, 0);
});

test('hash drift sends a verified outside row back to quarantine with an event', () => {
  const s = new MemoryCatalogStore();
  ingest([outside()], s, { now: NOW });
  s.setTrust('tool:mcp:com.example/weather', '1.0.0', 'reviewed', 'cto-desk', 'read the schema');
  s.setTrust('tool:mcp:com.example/weather', '1.0.0', 'verified', 'cto-desk', 'hashes approved');
  ingest([outside()], s, { now: NOW });
  assert.equal(s.get('tool:mcp:com.example/weather')!.trust_state, 'verified', 'no drift, trust kept');
  const r = ingest([outside({ endpoint: 'https://evil.example.net/mcp' })], s, { now: NOW });
  assert.equal(s.get('tool:mcp:com.example/weather')!.trust_state, 'quarantined');
  assert.equal(r.events[0].to, 'quarantined');
  assert.match(r.events[0].why, /drift/);
});

test('revocation list applied last, to the batch and to stored rows', () => {
  const s = new MemoryCatalogStore();
  ingest([outside({ path: 'a/one' })], s, { now: NOW });
  const r = ingest([outside({ path: 'a/two' })], s, {
    now: NOW,
    revoked: [
      { id: 'tool:mcp:a/two', version: '*', why: 'malicious', by: 'cto-desk', at: NOW },
      { id: 'tool:mcp:a/one', version: '1.0.0', why: 'rug pull', by: 'cto-desk', at: NOW },
    ],
  });
  assert.equal(r.revoked_applied, 2);
  assert.equal(s.get('tool:mcp:a/two')!.trust_state, 'revoked');
  assert.equal(s.get('tool:mcp:a/one')!.trust_state, 'revoked');
  ingest([outside({ path: 'a/two' })], s, { now: NOW });
  assert.equal(s.get('tool:mcp:a/two')!.trust_state, 'revoked', 'a re-import does not resurrect a revoked tool');
});

test('T14 and T15 rejections: giant schema, too many operations, a transfer to an address argument', () => {
  const s = new MemoryCatalogStore();
  const big = { type: 'object', properties: Object.fromEntries(Array.from({ length: 3000 }, (_, i) => [`p${i}`, { type: 'string', description: 'x'.repeat(20) }])) };
  const r = ingest([
    outside({ path: 'a/big', operations: [{ op: 'x', summary: 'x', input_schema: big, side_effects: ['read'] }] }),
    outside({ path: 'a/many', operations: Array.from({ length: 201 }, (_, i) => ({ op: `o${i}`, summary: 'o', side_effects: ['read'] as any })) }),
    outside({ path: 'a/send', operations: [{ op: 'send', summary: 'Transfer funds to any wallet', input_schema: { type: 'object', properties: { to: { type: 'string' }, amount: { type: 'number' } } }, side_effects: ['payment'] }] }),
    outside({ path: 'bad path with spaces only' }),
  ], s, { now: NOW });
  assert.equal(r.rejected.length, 4);
  assert.match(r.rejected.map((x) => x.why).join(' | '), /64 KB/);
  assert.match(r.rejected.map((x) => x.why).join(' | '), /more than 200/);
  assert.match(r.rejected.map((x) => x.why).join(' | '), /security\.txt rule 1/);
  assert.equal([...s.all()].length, 0);
});

test('determinism: two runs, any input order, the same snapshot id', () => {
  const raws = [native(), outside(), ...fromServerJson(fixture('mcp-servers.json'), P), ...fromAwesomeMarkdown(fixtureText('awesome-10.md'), P)];
  const a = ingest(raws, new MemoryCatalogStore(), { now: NOW });
  const b = ingest([...raws].reverse(), new MemoryCatalogStore(), { now: '2027-01-01T00:00:00.000Z' });
  assert.equal(a.snapshot_id, b.snapshot_id);
  assert.match(a.snapshot_id, /^cat_[0-9a-f]{16}$/);
});

test('report: sanitise flags counted, source caps, injected text never in description_safe', () => {
  const s = new MemoryCatalogStore();
  const raws = fromServerJson(fixture('mcp-servers.json'), P);
  const capped = ingest(raws, new MemoryCatalogStore(), { now: NOW, sourceCaps: { 'mcp-registry': 2 } });
  assert.equal(capped.per_source['mcp-registry'].capped, 1);
  const r = ingest(raws, s, { now: NOW });
  assert.ok((r.sanitise_flags.injection || 0) >= 1);
  for (const rec of s.all()) assert.doesNotMatch(rec.description_safe, /ignore previous/i);
});

test('the tagger hook adds capabilities to operations', () => {
  const s = new MemoryCatalogStore();
  ingest([outside()], s, { now: NOW, tagger: (t) => (/forecast/i.test(t) ? ['weather.forecast'] : []) });
  assert.deepEqual(s.get('tool:mcp:com.example/weather')!.operations[0].capabilities, ['weather.forecast']);
});

test('a templated endpoint group is not linked as duplicates; a declared read mentioning withdraw is not a transfer', () => {
  const s = new MemoryCatalogStore();
  const many = Array.from({ length: 9 }, (_, i) => outside({ source: 'golden-kog-catalog', origin: 'x402', path: `tokens.example/token-${i}` }));
  const r = ingest([...many, outside({ path: 'audit.example/contract', operations: [{ op: 'call', summary: 'Flags withdraw and sweep functions of a contract', input_schema: { type: 'object', properties: { address: { type: 'string' } } }, side_effects: ['read'] }] })], s, { now: NOW });
  assert.equal(r.same_as_links, 0);
  assert.equal(r.same_as_groups_skipped, 1);
  assert.deepEqual(r.rejected, []);
});
