/**
 * Cosine over precomputed vectors (one per operation), stamped with model and dimension (ADR-003 rule 2): a query
 * vector from another model or of another dimension is refused, never silently compared.
 */
export interface VectorSet { model: string; dims: number; ids: string[]; data: Float32Array }

export function normaliseRows(data: Float32Array, dims: number): Float32Array {
  const out = new Float32Array(data.length);
  for (let r = 0; r < data.length / dims; r++) {
    let n = 0;
    for (let j = 0; j < dims; j++) n += data[r * dims + j] ** 2;
    n = Math.sqrt(n) || 1;
    for (let j = 0; j < dims; j++) out[r * dims + j] = data[r * dims + j] / n;
  }
  return out;
}

export function checkQuery(set: Pick<VectorSet, 'model' | 'dims'>, model: string, q: Float32Array): void {
  if (model !== set.model) throw new Error(`query vector from ${model}, catalog vectors from ${set.model}: refused`);
  if (q.length !== set.dims) throw new Error(`query has ${q.length} dimensions, catalog vectors ${set.dims}: refused`);
}

/** Cosine of a normalised query against every row (rows must be normalised). */
export function cosineAll(q: Float32Array, data: Float32Array, dims: number): Float32Array {
  let n = 0;
  for (let j = 0; j < dims; j++) n += q[j] * q[j];
  n = Math.sqrt(n) || 1;
  const rows = data.length / dims;
  const out = new Float32Array(rows);
  for (let r = 0; r < rows; r++) {
    let s = 0;
    const o = r * dims;
    for (let j = 0; j < dims; j++) s += q[j] * data[o + j];
    out[r] = s / n;
  }
  return out;
}

export function topK(q: Float32Array, data: Float32Array, dims: number, k: number): Array<{ row: number; score: number }> {
  const sims = cosineAll(q, data, dims);
  const idx = Array.from(sims.keys());
  idx.sort((a, b) => sims[b] - sims[a] || a - b);
  return idx.slice(0, k).map((row) => ({ row, score: sims[row] }));
}
