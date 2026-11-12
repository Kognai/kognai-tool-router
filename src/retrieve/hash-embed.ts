/**
 * A deterministic stand in for an embedding model: hashed tokens and character trigrams into 256 dimensions. Used by
 * tests (the fake EmbeddingPort) and as the labelled offline fallback of the benchmark when the gateway's real model
 * is not reachable. It is not semantic: it is named 'ktr-hash-256' everywhere so it can never pass for bge-m3.
 */
import { createHash } from 'node:crypto';
import type { EmbeddingPort } from '../types/ports';
import { tokenise } from './tokenise';

export const HASH_MODEL = 'ktr-hash-256';
const DIMS = 256;

function bucket(s: string): [number, number] {
  const h = createHash('md5').update(s).digest();
  return [h.readUInt16LE(0) % DIMS, h[2] & 1 ? 1 : -1];
}

export function hashEmbed(text: string): Float32Array {
  const v = new Float32Array(DIMS);
  for (const t of tokenise(text)) {
    const [i, s] = bucket(`w:${t}`);
    v[i] += 2 * s;
    const p = `#${t}#`;
    for (let j = 0; j + 3 <= p.length; j++) { const [k, sk] = bucket(`c:${p.slice(j, j + 3)}`); v[k] += 0.5 * sk; }
  }
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let j = 0; j < DIMS; j++) v[j] /= n;
  return v;
}

export const hashEmbeddingPort: EmbeddingPort = {
  model: HASH_MODEL,
  dims: DIMS,
  async embed(texts: string[]) { return texts.map(hashEmbed); },
};
