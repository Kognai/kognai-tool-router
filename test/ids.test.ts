import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseToolId, formatToolId, TOOL_ID_RE, slugSegment, baseId, withOp } from '../src/ids';

const VALID = [
  'tool:kognai:connectors/gmail',
  'tool:kognai:connectors/gmail#search',
  'tool:kognai:kreativ/dialogue-skit',
  'tool:kognai:clawrouter/image',
  'tool:mcp:io.github.acme/weather',
  'tool:mcp:ac.inference.sh/mcp',
  'tool:x402:solana-foundation/google-translate',
  'tool:openapi:open-meteo/forecast#get_forecast',
  'tool:community:punkpeye/awesome-item',
  'tool:composio:github/issues',
  'tool:x402:api.example.com/v1/holders',
  'tool:kognai:products/create-video#order',
  'tool:mcp:a/b',
  'tool:openapi:ncbi/eutils#esearch',
  'tool:kognai:build/tavily#call',
];
const INVALID = [
  '',
  'tool:kognai:gmail',
  'tool:unknown:a/b',
  'TOOL:kognai:a/b',
  'tool:kognai:A/b',
  'tool:kognai:a/b#',
  'tool:kognai:a/b#Op',
  'tool:kognai:a//b',
  'tool:kognai:/a/b',
  'tool:kognai:a/b/',
  'tool:kognai:a b/c',
  'tool:kognai:a/../b',
  'skill:kognai:a/b',
  'tool::a/b',
  `tool:kognai:${'a'.repeat(100)}/${'b'.repeat(40)}`,
];

test('15 valid ids parse', () => {
  assert.equal(VALID.length, 15);
  for (const id of VALID) assert.ok(parseToolId(id), id);
});

test('15 invalid ids are refused', () => {
  assert.equal(INVALID.length, 15);
  for (const id of INVALID) assert.equal(parseToolId(id), null, id);
});

test('round trip through formatToolId', () => {
  for (const id of VALID) {
    const p = parseToolId(id)!;
    assert.equal(formatToolId(p.origin, p.path, p.op), id);
  }
});

test('operations: parsed, stripped and re-added', () => {
  const p = parseToolId('tool:kognai:connectors/gmail#search')!;
  assert.equal(p.op, 'search');
  assert.equal(p.path, 'connectors/gmail');
  assert.equal(baseId('tool:kognai:connectors/gmail#search'), 'tool:kognai:connectors/gmail');
  assert.equal(withOp('tool:kognai:connectors/gmail#x', 'message'), 'tool:kognai:connectors/gmail#message');
  assert.equal(formatToolId('mcp', 'io.github.Acme/Weather Server', 'Get Forecast'), 'tool:mcp:io.github.acme/weather-server#get_forecast');
});

test('slugSegment folds accents and unsafe characters', () => {
  assert.equal(slugSegment('Météo France!'), 'meteo-france');
  assert.equal(slugSegment('../etc'), 'etc');
  assert.equal(slugSegment(''), 'x');
  assert.ok(TOOL_ID_RE.test(formatToolId('x402', 'api.exa.ai/search')));
  assert.throws(() => formatToolId('kognai', 'single'));
});
