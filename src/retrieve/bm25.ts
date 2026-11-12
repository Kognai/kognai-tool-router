/** BM25 lexical index (k1 1.2, b 0.75) over tokenised documents, built in memory at load time (ADR-003 rule 4). */
import { tokenise } from './tokenise';

export class Bm25Index {
  private postings = new Map<string, Array<[number, number]>>();
  private lengths: Float64Array;
  private avgdl: number;
  readonly keys: string[];
  constructor(docs: Array<{ key: string; text: string }>, readonly k1 = 1.2, readonly b = 0.75) {
    this.keys = docs.map((d) => d.key);
    this.lengths = new Float64Array(docs.length);
    let total = 0;
    docs.forEach((d, i) => {
      const toks = tokenise(d.text);
      this.lengths[i] = toks.length;
      total += toks.length;
      const tf = new Map<string, number>();
      for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
      for (const [t, n] of tf) (this.postings.get(t) || this.postings.set(t, []).get(t)!).push([i, n]);
    });
    this.avgdl = docs.length ? total / docs.length : 1;
  }
  get size(): number { return this.keys.length; }
  idf(term: string): number {
    const df = this.postings.get(term)?.length || 0;
    return Math.log(1 + (this.keys.length - df + 0.5) / (df + 0.5));
  }
  /** Scores by document index, for the given query tokens (repeats weigh more). */
  scoreAll(queryTokens: string[]): Map<number, number> {
    const scores = new Map<number, number>();
    const qtf = new Map<string, number>();
    for (const t of queryTokens) qtf.set(t, (qtf.get(t) || 0) + 1);
    for (const [t, qn] of qtf) {
      const post = this.postings.get(t);
      if (!post) continue;
      const idf = this.idf(t);
      for (const [i, tf] of post) {
        const s = idf * (tf * (this.k1 + 1)) / (tf + this.k1 * (1 - this.b + this.b * this.lengths[i] / this.avgdl));
        scores.set(i, (scores.get(i) || 0) + s * qn);
      }
    }
    return scores;
  }
  search(q: string | string[], k: number): Array<{ key: string; index: number; score: number }> {
    const toks = Array.isArray(q) ? q : tokenise(q);
    return [...this.scoreAll(toks)].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, k).map(([i, s]) => ({ key: this.keys[i], index: i, score: s }));
  }
}
