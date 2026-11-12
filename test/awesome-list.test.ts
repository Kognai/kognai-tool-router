import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromAwesomeMarkdown } from '../src/adapters/awesome-list';
import { fixtureText, P } from './helpers';

test('10 lines with the emoji legend: metadata only, draft, never runnable', () => {
  const r = fromAwesomeMarkdown(fixtureText('awesome-10.md'), P);
  assert.equal(r.length, 10, 'clients and frameworks sections are skipped');
  for (const d of r) {
    assert.equal(d.origin, 'community');
    assert.equal(d.lifecycle, 'draft');
    assert.equal(d.implementation, 'metadata');
    assert.equal(d.licence, null, 'each server keeps its own licence: unknown');
    assert.equal(d.operations[0].side_effects, null);
  }
  const w = r[0];
  assert.equal(w.path, 'acme/weather-mcp');
  assert.equal(w.category, 'weather');
  assert.ok(w.tags!.includes('typescript') && w.tags!.includes('cloud'));
  assert.equal(w.description, 'Forecasts for any city through Open Meteo.');
  assert.equal(r[1].path, 'scope-org/meteo-server');
  assert.deepEqual(r[1].tags!.filter((t) => ['python', 'local', 'macos', 'windows', 'linux'].includes(t)).sort(), ['linux', 'local', 'macos', 'python', 'windows']);
  assert.equal(r[2].path, 'acme/weather-mcp-fork');
  const pub = r.find((d) => d.path === 'bio/pubmed-mcp')!;
  assert.equal(pub.description, 'Search PubMed and read abstracts.', 'badges stripped');
  assert.equal(pub.category, 'research');
  assert.ok(r.find((d) => d.path === 'trials/ct-gov')!.tags!.includes('official'));
  assert.equal(r.find((d) => d.path === 'quotes/stocks')!.provider.name, 'gitlab.com');
  assert.ok(r.find((d) => d.path === 'db/sql')!.tags!.includes('csharp'));
  assert.equal(r.find((d) => d.path === 'db/sql')!.category, 'finance--fintech');
});
