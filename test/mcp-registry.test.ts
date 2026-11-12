import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromServerJson } from '../src/adapters/mcp-registry';
import { fromMcpToolsList, listToolsLive, NotApproved, type ApprovedServer } from '../src/adapters/mcp-tools';
import { fixture, P } from './helpers';

test('server.json: package only, remote only, both; invalid names skipped', () => {
  const r = fromServerJson(fixture('mcp-servers.json'), P);
  assert.equal(r.length, 3);
  const [pkg, remote, both] = r;
  assert.equal(pkg.implementation, 'package');
  assert.equal(pkg.endpoint, undefined);
  assert.deepEqual(pkg.package, { registry: 'npm', identifier: '@example/weather-mcp', version: '1.2.0' });
  assert.equal(remote.implementation, 'remote');
  assert.equal(remote.endpoint, 'https://mcp.example.com/pubmed');
  assert.equal(both.implementation, 'remote');
  assert.equal(both.endpoint, 'https://maps.example.ai/sse', 'http remotes are ignored');
  assert.equal(both.lifecycle, 'deprecated');
  for (const d of r) {
    assert.equal(d.origin, 'mcp');
    assert.equal(d.operations.length, 1);
    assert.equal(d.operations[0].side_effects, null, 'unknown side effects stay unknown');
    assert.equal(d.provider.kognai_owned, false);
  }
  assert.equal(pkg.path, 'io.github.example/weather-pkg');
});

test('one server.json object is accepted too', () => {
  const one = fixture('mcp-servers.json').servers[1].server;
  assert.equal(fromServerJson(one, P).length, 1);
});

const APPROVED: ApprovedServer[] = [
  { name: 'com.example/pubmed-remote', remote_url: 'https://mcp.example.com/pubmed', approved_by: 'cto-desk', approved_at: '2026-10-12' },
  { name: 'io.github.example/weather-pkg', approved_by: 'cto-desk', approved_at: '2026-10-12' },
  { name: 'com.example/self-approved', remote_url: 'https://x.example', approved_by: 'some-agent', approved_at: '2026-10-12' },
];

test('tools/list from a fixture, approved server only; annotations untrusted', () => {
  const d = fromMcpToolsList('com.example/pubmed-remote', fixture('mcp-tools-list.json'), APPROVED, P);
  assert.equal(d.operations.length, 3);
  assert.equal(d.operations[0].op, 'search_articles');
  assert.equal(d.operations[0].side_effects, null, 'readOnlyHint is not believed without trust_annotations');
  assert.deepEqual(d.operations[2].side_effects, ['delete'], 'destructiveHint always adds risk');
  const trusted = fromMcpToolsList('com.example/pubmed-remote', fixture('mcp-tools-list.json'), [{ ...APPROVED[0], trust_annotations: true }], P);
  assert.deepEqual(trusted.operations[0].side_effects, ['read']);
  assert.deepEqual(trusted.operations[2].side_effects, ['delete']);
  assert.throws(() => fromMcpToolsList('com.example/unknown', { tools: [] }, APPROVED, P), NotApproved);
  assert.throws(() => fromMcpToolsList('com.example/self-approved', { tools: [] }, APPROVED, P), NotApproved, 'only the CTO desk approves');
});

test('live listing refuses unless flag on, approved, and an https remote; never a package', async () => {
  let calls = 0;
  const transport = async () => { calls++; return { result: { tools: [] } }; };
  await assert.rejects(listToolsLive('com.example/pubmed-remote', APPROVED, { mcpListLive: false, stopped: false }, transport), /MCP_LIST_LIVE is off/);
  await assert.rejects(listToolsLive('com.example/pubmed-remote', APPROVED, { mcpListLive: true, stopped: true }, transport), /stopped/);
  await assert.rejects(listToolsLive('com.example/other', APPROVED, { mcpListLive: true, stopped: false }, transport), NotApproved);
  await assert.rejects(listToolsLive('io.github.example/weather-pkg', APPROVED, { mcpListLive: true, stopped: false }, transport), /never launches a package/);
  assert.equal(calls, 0);
  assert.deepEqual(await listToolsLive('com.example/pubmed-remote', APPROVED, { mcpListLive: true, stopped: false }, transport), { tools: [] });
  assert.equal(calls, 1);
});
