/**
 * Multilingual tokeniser (FR, EN, Tunisian derja in Latin and Arabic script): normalised text (classify/text.ts),
 * split on anything that is not a letter or a digit, stop words dropped per language, a light plural strip for Latin
 * words and the article "al" stripped from Arabic words. Derja digits inside words are kept (a3mel, ta9s).
 */
import { normalise } from '../classify/text';

export const STOP = new Set([
  // en
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'by', 'at', 'from', 'is', 'are', 'be', 'it', 'this',
  'that', 'these', 'those', 'my', 'me', 'i', 'you', 'your', 'we', 'our', 'can', 'could', 'please', 'what', 'which', 'how',
  'about', 'into', 'as', 'do', 'does', 'get', 'any', 'all', 'some', 'via', 'use', 'using', 'api', 'tool', 'tools', 'data',
  'will', 'would', 'should', 'want', 'need', 'make', 'give', 'show', 'tell', 'just', 'also', 'one', 'more', 'than', 'then',
  // fr
  'le', 'la', 'les', 'l', 'de', 'des', 'du', 'd', 'un', 'une', 'et', 'ou', 'en', 'au', 'aux', 'pour', 'avec', 'dans', 'sur',
  'par', 'mes', 'mon', 'ma', 'moi', 'je', 'tu', 'vous', 'nous', 'est', 'sont', 'ce', 'cette', 'ces', 'qui', 'que', 'qu',
  'quel', 'quelle', 'fais', 'faire', 's', 'il', 'elle', 'pas', 'ne', 'plus', 'svp',
  // derja (Latin) and Arabic function words
  'el', 'w', 'fi', 'f', 'l', 'mte3', 'mta3', 'mte3i', 'mta3i', 'chnowa', 'chnoua', 'kifech', 'n7eb', 'nheb', '3la', '3al', 'ya',
  'في', 'على', 'من', 'و', 'متاع', 'متاعي', 'شنوه', 'نحب', 'هذا', 'هذي', 'الي', 'ال',
]);

const LATIN = /^[a-z0-9]+$/;

function stem(t: string): string {
  if (LATIN.test(t)) {
    if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
    if (t.length > 3 && (t.endsWith('s') || t.endsWith('x')) && !t.endsWith('ss')) return t.slice(0, -1);
    return t;
  }
  if (t.length > 3 && t.startsWith('ال')) return t.slice(2);
  return t;
}

export function tokenise(text: string, keepStop = false): string[] {
  const out: string[] = [];
  for (const raw of normalise(text).split(/[^\p{L}\p{N}]+/u)) {
    if (!raw || raw.length < 2 && !/[؀-ۿ]/.test(raw)) continue;
    if (!keepStop && STOP.has(raw)) continue;
    const s = stem(raw);
    if (!keepStop && STOP.has(s)) continue;
    out.push(s);
  }
  return out;
}
