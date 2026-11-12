/** Shared test helpers (not a test file). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProvenanceIn } from '../src/adapters/raw';

export const fixture = (name: string): any => JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'));
export const fixtureText = (name: string): string => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

export const P: ProvenanceIn = {
  source: 'fixture',
  retrieved_at: '2026-10-12T00:00:00.000Z',
  licence: 'MIT',
  snapshot_sha256: '0'.repeat(64),
};
