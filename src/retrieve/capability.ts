/** Capability match: the classifier's capability on the operation = 1, a sibling in the same family = 0.5, else 0. */
import { familyOf } from '../classify/taxonomy';

export function capabilityScore(nodeCap: string, opCaps: string[]): number {
  if (opCaps.includes(nodeCap)) return 1;
  const fam = familyOf(nodeCap);
  if (fam && opCaps.some((c) => familyOf(c) === fam)) return 0.5;
  return 0;
}
