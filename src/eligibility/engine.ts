/**
 * Applies the eligibility rules to retrieved candidates and counts exclusions per rule. Counts, never the excluded
 * tools' text, go back to the caller, so it can say "2 tools exist but need a payment approval".
 */
import type { Retrieved } from '../retrieve/hybrid';
import { firstFailure, type EligibilityInput, type RuleId } from './rules';

/** `relevant` limits the counts to candidates that would have been worth showing (fit above the floor). */
export function filter(cands: Retrieved[], base: Omit<EligibilityInput, 'rec' | 'op'>, relevant: (c: Retrieved) => boolean = () => true): { eligible: Retrieved[]; excluded: Partial<Record<RuleId, number>> } {
  const eligible: Retrieved[] = [];
  const excluded: Partial<Record<RuleId, number>> = {};
  for (const c of cands) {
    const f = firstFailure({ ...base, rec: c.item.rec, op: c.item.op });
    if (f) { if (relevant(c)) excluded[f] = (excluded[f] || 0) + 1; }
    else eligible.push(c);
  }
  return { eligible, excluded };
}
