/**
 * Text normalisation shared by the classifier and the tokeniser: lower case, Latin accents folded, Arabic letter
 * variants unified and diacritics dropped, typographic apostrophes and quotes unified. Tunisian derja in Latin
 * letters keeps its digits (3 = ain, 7 = ha, 9 = qaf), as route-request.ts does.
 */
export function normalise(s: string): string {
  return String(s ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[ً-ْٰـ]/g, '') // Arabic diacritics and tatweel
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[‘’ʼ`´]/g, "'").replace(/[“”«»]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export const ARABIC = /[؀-ۿ]/;

/** Very small language guess: Arabic script or Latin derja markers = derja; French vs English by stop words. */
export function detectLanguage(text: string): 'en' | 'fr' | 'derja' | 'other' {
  const t = normalise(text);
  if (!t) return 'other';
  if (ARABIC.test(t)) return 'derja';
  if (/\b[a-z]*[379][a-z]+\b/.test(t) && /\b(a3mel|a3mil|n7eb|nheb|chnowa|chnoua|kifech|kifach|9adeh|9adech|qaddech|mte3i|mta3i|barcha|lawej|ta9s|net3allem|e7seb|ab3ath|ba3d|wa9t|fi|el|w)\b/.test(t)) return 'derja';
  if (/\b(chnowa|kifech|barcha|mte3i|mta3i|n7eb|nheb|lawej|a3mel|a3melli|3lech|ghodwa|lyoum)\b/.test(t)) return 'derja';
  const fr = (t.match(/\b(le|la|les|des|du|un|une|est|et|pour|avec|dans|sur|mes|mon|ma|je|tu|vous|quel|quelle|quoi|fais|moi|ce|cette|qui|pas|il|elle|demain|au|aux|svp|merci|fera|sont|ou|nous|notre|mes)\b/g) || []).length;
  const en = (t.match(/\b(the|an|is|are|and|for|with|in|on|my|me|i|you|what|which|make|this|that|of|to|do|not|please|will|it)\b/g) || []).length;
  if (fr === 0 && en === 0) return /^[\x00-\x7F]+$/.test(t) ? 'en' : 'other';
  return fr > en ? 'fr' : 'en';
}
