import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileCatalogStore } from '../src/catalog/file-store';
import { ingest } from '../src/catalog/ingest';
import { fromServerJson } from '../src/adapters/mcp-registry';
import { fixture, P } from './helpers';

const NOW = '2026-10-12T10:00:00.000Z';

test('atomic write, reload, same snapshot id, no temp files left', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ktr-cat-'));
  const s = new FileCatalogStore(dir);
  const r = ingest(fromServerJson(fixture('mcp-servers.json'), P), s, { now: NOW, rawSink: (sha, t) => s.writeRaw(sha, t) });
  assert.ok(existsSync(join(dir, 'tools.jsonl')));
  assert.deepEqual(readdirSync(dir).filter((n) => n.includes('.tmp')), []);
  const idx = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
  assert.equal(idx.snapshot_id, r.snapshot_id);
  assert.equal(idx.count, 3);
  const again = new FileCatalogStore(dir);
  assert.equal(again.snapshotId(), r.snapshot_id);
  assert.equal([...again.latest()].length, 3);
  assert.equal(readdirSync(join(dir, 'raw')).length, 3, 'raw texts kept by hash');
});

test('trust events are appended and survive a reload', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ktr-cat-'));
  const s = new FileCatalogStore(dir);
  ingest(fromServerJson(fixture('mcp-servers.json'), P), s, { now: NOW });
  const id = 'tool:mcp:com.example/pubmed-remote';
  s.setTrust(id, '0.3.1', 'reviewed', 'cto-desk', 'read');
  assert.throws(() => s.setTrust(id, '0.3.1', 'verified', 'an-agent', 'self'), /cto-desk/);
  s.setTrust(id, '0.3.1', 'verified', 'cto-desk', 'hashes approved');
  const lines = readFileSync(join(dir, 'events.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  const again = new FileCatalogStore(dir);
  assert.equal(again.get(id)!.trust_state, 'verified');
  assert.equal(again.events().length, 2);
});

test('vectors round trip with their metadata; a mismatch is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ktr-cat-'));
  const s = new FileCatalogStore(dir);
  s.writeVectors('fake-hash-8', { dims: 2, ids: ['a#x', 'b#y'], data: new Float32Array([1, 0, 0, 1]) }, NOW);
  const v = new FileCatalogStore(dir).vectors('fake-hash-8')!;
  assert.deepEqual([...v.data], [1, 0, 0, 1]);
  assert.deepEqual(v.ids, ['a#x', 'b#y']);
  assert.equal(new FileCatalogStore(dir).vectors('other-model'), null);
  assert.throws(() => s.writeVectors('m', { dims: 3, ids: ['a'], data: new Float32Array(2) }, NOW));
});
