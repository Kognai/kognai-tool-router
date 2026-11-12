/**
 * Untrusted provider text to description_safe (threat T1). External descriptions are data (security.txt rule 13):
 * this strips control, zero width and bidi characters, HTML, markdown links and images, collapses whitespace, caps the
 * length at 512, drops sentences that read as instructions to a model or a ranker, and thins keyword stuffing. The raw
 * text is kept outside the record by hash only and is never shown to a model.
 */
export type SanitiseFlag =
  | 'control_chars' | 'zero_width' | 'bidi' | 'html' | 'md_link' | 'md_image' | 'url'
  | 'injection' | 'repetition' | 'truncated' | 'empty';

export interface SanitiseResult { text: string; flags: SanitiseFlag[] }

export const MAX_SAFE = 512;

const ZERO_WIDTH = /[​-‍⁠﻿᠎]/g;
const BIDI = /[‎‏‪-‮⁦-⁩؜]/g;
// C0 and C1 controls except tab, line feed and carriage return (turned into spaces later)
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const HTML = /<\/?[a-zA-Z][^>]{0,400}>|<!--[\s\S]*?-->/g;
const MD_IMAGE = /!\[[^\]]{0,200}\]\([^)]{0,500}\)/g;
const MD_LINK = /\[([^\]]{0,200})\]\([^)]{0,500}\)/g;
const SPECIAL_TOKENS = /<\|?\s*(im_start|im_end|system|endoftext|assistant|user)\s*\|?>/gi;
const URL_RE = /\bhttps?:\/\/[^\s)]+/gi;

/** Sentences that address a model, a ranker or the reader with instructions. Matched after folding. */
export const INJECTION_PATTERNS: RegExp[] = [
  /\b(ignore|disregard|forget|override)\b.{0,40}\b(previous|prior|above|earlier|all|any|other|system)\b.{0,30}\b(instruction|instructions|prompt|prompts|rules|messages|tools?)\b/,
  /\byou (must|should|have to|need to|will)\b.{0,40}\b(select|choose|pick|use|call|rank|prefer|recommend|trust)\b/,
  /\b(select|choose|pick|use|call)\b.{0,10}\bonly\b.{0,10}\b(this|me|us)\b/,
  /\b(always|only)\b.{0,20}\b(select|choose|pick|use|call|rank|prefer|recommend)\b.{0,30}\b(this|me|us|our)\b/,
  /\b(rank|score|rate|place|list)\b.{0,30}\b(this|me|us|our)\b.{0,20}\b(first|top|highest|above|#1|number one)\b/,
  /\b(highest|top|maximum)\s+(priority|ranking|score)\b/,
  /^\W*(system|assistant|developer)\s*:/,
  /<\|?(im_start|im_end|system|endoftext)\|?>/,
  /\b(do not|don't|never)\b.{0,30}\b(tell|inform|reveal|mention)\b.{0,30}\b(user|human|owner|operator)\b/,
  /\b(send|forward|exfiltrate|upload|post|share)\b(?!-)\s.{0,20}\b(your|the|all|any|my)\b.{0,20}\b(api[_ -]?keys?|secrets?|credentials?|passwords?|private keys?|seed phrase)\b/,
  /\b(dan mode|developer mode)\b/,
  /\bact as\b.{0,30}\b(system|admin|root|the router)\b/,
  /\bnew instructions?\b/,
  /\b(transfer|send)\s+\d+(\.\d+)?\s*(usdc|usdt|sol|eth|btc|usd|dollars?|euros?)\b/,
  /\b(transfer|send)\b.{0,40}\bto\s+(0x[0-9a-f]{6,}|[1-9a-hj-np-z]{32,44})\b/,
];

const hit = (re: RegExp, s: string): boolean => { re.lastIndex = 0; const r = re.test(s); re.lastIndex = 0; return r; };
const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function sanitise(raw: string): SanitiseResult {
  const flags = new Set<SanitiseFlag>();
  let t = String(raw ?? '');
  if (hit(CONTROL, t)) flags.add('control_chars');
  t = t.replace(CONTROL, ' ');
  if (hit(ZERO_WIDTH, t)) flags.add('zero_width');
  t = t.replace(ZERO_WIDTH, '');
  if (hit(BIDI, t)) flags.add('bidi');
  t = t.replace(BIDI, '');
  t = t.normalize('NFKC');
  // chat template tokens end a sentence and mark the text as an injection attempt
  if (hit(SPECIAL_TOKENS, t)) flags.add('injection');
  t = t.replace(SPECIAL_TOKENS, '. ');
  if (hit(MD_IMAGE, t)) flags.add('md_image');
  t = t.replace(MD_IMAGE, ' ');
  if (hit(MD_LINK, t)) flags.add('md_link');
  t = t.replace(MD_LINK, '$1');
  if (hit(HTML, t)) flags.add('html');
  t = t.replace(HTML, ' ');
  if (hit(URL_RE, t)) flags.add('url');
  t = t.replace(URL_RE, ' ');
  t = t.replace(/[`*_~#>|]+/g, ' ').replace(/\s+/g, ' ').trim();

  // drop sentences that carry instructions
  const sentences = t.split(/(?<=[.!?;])\s+|\s+[-–—]\s+/);
  const kept: string[] = [];
  for (const s of sentences) {
    const f = fold(s);
    if (INJECTION_PATTERNS.some((re) => re.test(f))) { flags.add('injection'); continue; }
    kept.push(s);
  }
  t = kept.join(' ');

  // thin keyword stuffing: a word may appear at most 3 times
  const counts = new Map<string, number>();
  const words = t.split(' ');
  const thinned: string[] = [];
  for (const w of words) {
    const k = fold(w).replace(/[^\p{L}\p{N}]+/gu, '');
    if (!k) { thinned.push(w); continue; }
    const n = (counts.get(k) || 0) + 1;
    counts.set(k, n);
    if (n > 3) { flags.add('repetition'); continue; }
    thinned.push(w);
  }
  t = thinned.join(' ').replace(/\s+/g, ' ').trim();

  if ([...t].length > MAX_SAFE) { flags.add('truncated'); t = [...t].slice(0, MAX_SAFE - 1).join('').trimEnd() + '…'; }
  if (!t) flags.add('empty');
  return { text: t, flags: [...flags].sort() };
}

/** Short form for summaries (200 chars), same rules. */
export function sanitiseShort(raw: string, max = 200): string {
  const { text } = sanitise(raw);
  return [...text].length > max ? [...text].slice(0, max - 1).join('').trimEnd() + '…' : text;
}
