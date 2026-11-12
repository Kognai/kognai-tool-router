/**
 * The deterministic classifier (plan.md S2). From the request text alone: capabilities with confidence, task
 * complexity, risk classes, requirement, language and the arguments the text already supplies.
 *
 * Risk classes are computed from the capabilities found and from cue words in the request itself; quoted material
 * (an email body, a pasted page) is data and is masked before any cue is read, so text inside it can never raise or
 * lower a class (threat T5). A cue preceded by a negation ("do not send") is ignored.
 */
import type { RiskClass } from '../types/tool';
import type { CallerContext, CapabilityHit, Lang, Requirement, TaskComplexity } from '../types/route';
import { ARABIC, detectLanguage, normalise } from './text';
import { CAPABILITIES, REASONING_CUES, capabilityById, type ArgName, type CapabilityDef } from './taxonomy';

export interface RulesResult {
  capabilities: CapabilityHit[];
  task_complexity: TaskComplexity;
  risk_classes: RiskClass[];
  requirement: Requirement;
  confidence: number;
  language: Lang;
  args_known: ArgName[];
  reasoning_cues: string[];
  data_spans: number;
}

/* ── data spans (T5) ───────────────────────────────────────────────────────── */
const QUOTED = [
  /"[^"\n]{15,}"/g, /'[^'\n]{25,}'/g, /“[^”]{15,}”/g, /«[^»]{15,}»/g, /```[\s\S]*?```/g,
];
/** Replaces quoted material and '>' quoted lines with spaces of the same length (positions stay valid). */
export function maskData(text: string): { masked: string; spans: number } {
  let spans = 0;
  let t = text.replace(/^>.*$/gm, (m) => { spans++; return ' '.repeat(m.length); });
  for (const re of QUOTED) t = t.replace(re, (m) => { spans++; return ' '.repeat(m.length); });
  // "the email says: ..." to the end of the line is the email's text, not the request
  t = t.replace(/\b(says|said|reads|writes|wrote|dit|ecrit|يقول)\s*:\s*[^\n]{10,}/gi, (m) => { spans++; return ' '.repeat(m.length); });
  return { masked: t, spans };
}

/* ── cue matching ──────────────────────────────────────────────────────────── */
interface Compiled { def: CapabilityDef; latin: RegExp | null; arabic: RegExp | null; tool: RegExp | null }
const isArabicCue = (c: string) => ARABIC.test(c);
const boundary = (frags: string[]) => frags.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${frags.join('|')})(?![\\p{L}\\p{N}])`, 'gu') : null;

const COMPILED: Compiled[] = CAPABILITIES.map((def) => {
  const all = [...def.cues.en, ...def.cues.fr, ...def.cues.derja];
  const latin = all.filter((c) => !isArabicCue(c)).map((c) => normaliseCue(c));
  const arabic = all.filter(isArabicCue).map((c) => normalise(c));
  return {
    def,
    latin: boundary(latin),
    arabic: arabic.length ? new RegExp(`(?:${arabic.join('|')})`, 'gu') : null,
    tool: def.tool_cues && def.tool_cues.length ? boundary(def.tool_cues) : null,
  };
});
function normaliseCue(c: string): string { return c.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, ''); }

const NEGATION = /(?:^|[^\p{L}])(not|don'?t|do not|never|without|no|stop|avoid|ne|n'|sans|jamais|matab3athch|ماتبعثش|ما|لا|بلاش|blech|bla)\s+(?:\S+\s+){0,2}$/u;

export interface CueHit { id: string; at: number; text: string; negated: boolean; kind: 'request' | 'tool' }

export function findCues(normText: string, compiled = COMPILED, withTool = false): CueHit[] {
  const hits: CueHit[] = [];
  for (const c of compiled) {
    for (const [re, kind] of [[c.latin, 'request'], [c.arabic, 'request'], [withTool ? c.tool : null, 'tool']] as Array<[RegExp | null, 'request' | 'tool']>) {
      if (!re) continue;
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(normText))) {
        if (m[0].length === 0) { re.lastIndex++; continue; }
        const before = normText.slice(Math.max(0, m.index - 30), m.index);
        hits.push({ id: c.def.id, at: m.index, text: m[0], negated: NEGATION.test(before), kind });
      }
    }
  }
  return hits.sort((a, b) => a.at - b.at);
}

/* ── arguments the text supplies ───────────────────────────────────────────── */
const KNOWN_PLACES = /\b(paris|tunis|sfax|sousse|bizerte|nabeul|hammamet|monastir|kairouan|gabes|djerba|london|new york|berlin|madrid|rome|dubai|cairo|casablanca|algiers|alger|marseille|lyon|tokyo|montreal|brussels|bruxelles|geneva|geneve)\b|تونس|صفاقس|سوسه|باريس|نابل/;
export function argsOf(raw: string, norm: string): ArgName[] {
  const a = new Set<ArgName>(['query']);
  if (KNOWN_PLACES.test(norm) || /\b(in|at|for|near|to)\s+(?:the\s+)?[A-Z][\p{L}'-]{2,}/u.test(raw) || /\b(a|à|au|en|pres de)\s+[A-Z][\p{L}'-]{2,}/u.test(raw) || /\bfi\s+[a-z]{3,}/.test(norm) || /في\s+\S{3,}/.test(norm)) a.add('location');
  if (/https?:\/\/\S+/i.test(raw)) a.add('url');
  if (/\b0x[0-9a-fA-F]{40}\b|\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/.test(raw)) { a.add('address'); a.add('token'); }
  if (/\$[A-Za-z]{2,10}\b|\b(bitcoin|btc|ethereum|eth|solana|sol|bonk|usdc|pepe|doge)\b/i.test(raw)) a.add('token');
  if (/\b\d+(?:[.,]\d+)?\s?(usdc|usdt|sol|eth|btc|kgc|dollars?|euros?|dinars?|tnd|usd|eur)\b|[$€]\s?\d+/i.test(raw)) a.add('amount');
  if (/\b(this|the|my|attached|ce|cette|mon|ma|le|la)\s+(file|fichier|pdf|excel|spreadsheet|sheet|document|doc|photo|image|picture|screenshot|receipt|ticket|video|vidéo|audio|recording|vocal|voice note|csv|xlsx|deck)\b/i.test(raw) || /\.(pdf|xlsx?|csv|docx?|pptx|png|jpe?g|mp4|mp3|wav|m4a)\b/i.test(raw)) a.add('file_ref');
  if (/\b(to|a|à)\s+[A-Z][\p{L}]+\b|@\w+|\b[\w.+-]+@[\w-]+\.[\w.]+\b/u.test(raw) || /\b(my|mon|ma)\s+(mother|mom|father|dad|brother|sister|boss|wife|husband|friend|team|mere|pere|frere|soeur|chef)\b/i.test(raw)) a.add('recipient');
  if (/\b(today|tomorrow|tonight|this (week|weekend|month)|next (week|monday|tuesday|wednesday|thursday|friday)|aujourd'?hui|demain|cette semaine|lyoum|ghodwa|\d{4}-\d{2}-\d{2})\b|اليوم|غدوه/i.test(raw)) a.add('date');
  return [...a];
}

/* ── conflict rules between capabilities ───────────────────────────────────── */
const MAKE = /(?<![\p{L}])(make|create|generate|draw|design|produce|render|build|fais|fait|cree|creer|genere|generer|dessine|produis|realise|a3mel|a3melli|a3mli|اعمل|اعمللي|عمللي|اصنع|ارسم)(?![\p{L}])/u;
function resolveConflicts(ids: Set<string>, norm: string, args: ArgName[]): void {
  const make = MAKE.test(norm);
  const has = (x: string) => ids.has(x);
  if (has('image.generate') && (has('image.understand') || has('image.edit') || has('ocr.extract')) && !make) ids.delete('image.generate');
  if (has('image.generate') && args.includes('file_ref') && !make && (has('doc.read') || has('sheet.analyse'))) ids.delete('image.generate');
  if (has('video.generate') && has('video.edit') && !make && args.includes('file_ref')) ids.delete('video.generate');
  if (has('sheet.analyse') && has('sheet.edit')) ids.delete('sheet.analyse');
  if (has('mail.search')) ids.delete('mail.read');
  if (has('wallet.transfer') && has('payment.pay')) ids.delete('payment.pay');
  if (has('audio.transcribe') && has('voice.speak') && !/\b(voice.?over|text.to.speech|tts|narrat\w*|read (it|this) aloud)\b/.test(norm)) ids.delete('voice.speak');
  if (has('token.trade') && has('token.price') && !/\b(price|prix|soum)\b/.test(norm)) ids.delete('token.price');
  if (has('token.analyse') && has('token.price') && !/\b(price|prix|soum)\b/.test(norm)) ids.delete('token.price');
  if (has('market.signals') && has('news.search')) ids.delete('news.search');
  if (has('social.post') && has('social.content') && !/\b(write|draft|ecris|redige|ekteb)\b/.test(norm)) ids.delete('social.content');
  if (has('learning.program') && has('video.generate') && /\b(educational|educative|lesson|cours)\b/.test(norm)) ids.delete('learning.program');
  if (has('text.write') && (has('mail.send') || has('social.content'))) ids.delete('text.write');
  if (has('deck.make') && has('sheet.analyse') && !/\b(excel|spreadsheet|csv|xlsx|tableur)\b/.test(norm)) ids.delete('sheet.analyse');
  if (has('literature.search') && has('news.search') && !/\bnews\b/.test(norm)) ids.delete('news.search');
  if (has('character.design') && !has('video.generate') && !has('image.generate') && !make) ids.delete('character.design');
  if (has('voice.speak') && !has('video.generate') && /\btalking\b/.test(norm) && !/\b(voice|tts|narrat)/.test(norm)) ids.delete('voice.speak');
  if (has('web.search') && ids.size > 1 && !/\b(search|google|lawej|cherche|recherche)\b/.test(norm)) ids.delete('web.search');
  if (has('code.repo') && has('infra.deploy') && /\bdeploy\b/.test(norm) && !/\b(github|gitlab|repo|pull request)\b/.test(norm)) ids.delete('code.repo');
}

/** A risky verb with no capability for it becomes its own step, so it is planned and then refused, never ignored. */
function addRiskySteps(ids: Set<string>, norm: string, live: CueHit[]): void {
  const neg = (re: RegExp) => { const m = re.exec(norm); return !m || NEGATION.test(norm.slice(Math.max(0, m.index - 30), m.index)) ? null : m; };
  const hasRisk = (cls: RiskClass) => [...ids].some((i) => capabilityById(i)!.default_risk.includes(cls));
  if (!hasRisk('payment')) {
    if (neg(/(?<![\p{L}])(buy|sell|swap|trade|achete|vends|echange)(?![\p{L}])/u)) ids.add('token.trade');
    else if (neg(/(?<![\p{L}])(pay|paye[rz]?|khalles|خلص)(?![\p{L}]).{0,30}(bill|invoice|facture|subscription|rent|loyer|فاتوره)/u)) ids.add('payment.pay');
    else if (neg(/(?<![\p{L}])(wire|transfer|transfere|virement|send|envoie|ab3ath)(?![\p{L}]).{0,25}(\d|money|funds|usdc|usdt|sol|eth|btc|euros?|dinars?|dollars?|flous|فلوس)/u)) ids.add('wallet.transfer');
  }
  if (!hasRisk('destructive') && neg(/(?<![\p{L}])(delete|wipe|erase|destroy|supprime[rz]?|efface[rz]?|fasa5|فسخ|امسح)(?![\p{L}])/u)) ids.add('file.delete');
  if (!hasRisk('publish_or_message') && !hasRisk('payment')) {
    if (neg(/(?<![\p{L}])(post|publish|publie[rz]?|tweet|ensher|انشر)(?![\p{L}])/u) && !/\b(posts?|publications?) (on|sur|from)\b/.test(norm.replace(/\bmy (last|latest|recent) /, ''))) ids.add('social.post');
    else if (neg(/(?<![\p{L}])(send|forward|envoie|ab3ath)(?![\p{L}]).{0,20}(to|a|à|l) /u)) ids.add(ids.has('mail.read') || ids.has('mail.search') || /e.?mail|mail/.test(norm) ? 'mail.send' : 'message.send');
  }
  void live;
}

/* ── risk cue words in the request itself ──────────────────────────────────── */
const RISK_WORDS: Array<[RiskClass, RegExp]> = [
  ['payment', /(?<![\p{L}])(pay|paye[rz]?|payment|transfer|transfere|virement|wire|send \d|envoie \d|buy|sell|swap|trade|achete|vends|ab3ath flous|اشري|خلص)(?![\p{L}])/u],
  ['destructive', /(?<![\p{L}])(delete|wipe|erase|destroy|supprime[rz]?|efface[rz]?|fasa5|فسخ|امسح)(?![\p{L}])/u],
  ['publish_or_message', /(?<![\p{L}])(send (an? )?(e.?mail|message|sms|text|dm)|send (it|this|that|them|the [\p{L}]+) to|forward (it|this|them|the [\p{L}]+)|post (it|this|on|to)|publish|publie[rz]?|tweet (it|this)|reply to|ensher|انشر)(?![\p{L}])/u],
  ['sensitive_data', /(?<![\p{L}])(my (e.?mails?|inbox|mails?|calendar|agenda|drive|files|messages|wallet|balance|bank|passwords?|contacts|dms)|mes (mails|courriels|fichiers|messages)|mon (agenda|solde)|متاعي)(?![\p{L}])/u],
];

const GREETING = /^(hi|hello|hey|bonjour|bonsoir|salut|merci|thanks?|thank you|ok thanks|aslema|ahla|عسلامه|اهلا|مرحبا|شكرا)\b/;
const CAPABILITY_Q = /^(can you|could you|do you|tu peux|tu sais|est.ce que tu (peux|sais)|vous pouvez|tnajem|tnajjem|تنجم)\b/;
const CLARIFY = /^(do it|fix (it|this|that)|help( me)?|again|the same|continue|go|ok(ay)?|yes|no|that one|this|it|fais.le|aide.moi|a3melha|زيد)[\s.!?]*$/;

export function classifyRules(text: string, _ctx?: Partial<CallerContext>): RulesResult {
  const raw = String(text ?? '');
  const { masked, spans } = maskData(raw);
  const norm = normalise(masked);
  const language = detectLanguage(raw);
  const args = argsOf(masked, norm);
  const hits = findCues(norm);
  const live = hits.filter((h) => !h.negated);
  const ids = new Set(live.map((h) => h.id));
  resolveConflicts(ids, norm, args);
  addRiskySteps(ids, norm, live);
  // model work on an attached file needs the file read first
  if (args.includes('file_ref') && ids.size && [...ids].every((i) => !capabilityById(i)!.needs_tool)) ids.add('doc.read');

  const firstAt = new Map<string, number>();
  const count = new Map<string, number>();
  for (const h of live) if (ids.has(h.id)) { if (!firstAt.has(h.id)) firstAt.set(h.id, h.at); count.set(h.id, (count.get(h.id) || 0) + 1); }
  const capabilities: CapabilityHit[] = [...ids]
    .sort((a, b) => ((firstAt.get(a) ?? norm.length) - (firstAt.get(b) ?? norm.length)))
    .map((id) => { const h = live.find((x) => x.id === id); return { id, confidence: h ? Math.min(0.95, 0.75 + 0.1 * ((count.get(id) || 1) - 1)) : 0.6, span: h ? h.text : '(implied by a risky verb or an attached file)' }; });

  const reasoning_cues = REASONING_CUES.filter((c) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${normaliseCue(c)})(?![\\p{L}\\p{N}])`, 'u').test(norm) || (ARABIC.test(c) && norm.includes(normalise(c))));

  // risk: capability defaults plus cue words, never from quoted data, never removed
  const risk = new Set<RiskClass>();
  const defs = capabilities.map((c) => capabilityById(c.id)!);
  for (const d of defs) for (const r of d.default_risk) risk.add(r);
  for (const [cls, re] of RISK_WORDS) {
    const m = re.exec(norm);
    if (m && !NEGATION.test(norm.slice(Math.max(0, m.index - 30), m.index))) risk.add(cls);
  }
  const toolDefs = defs.filter((d) => d.needs_tool);
  if (toolDefs.some((d) => d.default_risk.includes('network'))) risk.add('network');
  const strict: RiskClass[] = ['data_modification', 'publish_or_message', 'payment', 'destructive', 'privileged_infra'];
  if (strict.some((c) => risk.has(c))) risk.delete('read_only');

  // requirement
  const words = norm.split(/\s+/).filter(Boolean);
  let requirement: Requirement;
  let confidence: number;
  const capabilityQuestion = CAPABILITY_Q.test(norm) && /\?\s*$/.test(raw.trim()) && words.length <= 6;
  if (capabilityQuestion) {
    requirement = 'no_tool'; confidence = 0.7;
  } else if (toolDefs.length) {
    requirement = 'tool';
    confidence = Math.min(...capabilities.filter((c) => capabilityById(c.id)!.needs_tool).map((c) => c.confidence));
  } else if (capabilities.length) {
    requirement = 'no_tool'; confidence = 0.8;
  } else if (GREETING.test(norm)) {
    requirement = 'no_tool'; confidence = 0.8;
  } else if (CLARIFY.test(norm) || words.length < 2) {
    requirement = 'clarify'; confidence = 0.4;
  } else {
    requirement = 'no_tool'; confidence = /\?|^(what|who|when|where|why|how|is|are|can|c.est|qu|quoi|comment|pourquoi|chnowa|kifech|3lech|شنوه|كيفاش|علاش)/.test(norm) ? 0.6 : 0.5;
  }

  // complexity
  const missing = toolDefs.some((d) => (d.args || []).some((a) => !args.includes(a)));
  let task_complexity: TaskComplexity;
  if (reasoning_cues.length) task_complexity = 'REASONING';
  else if (capabilities.length >= 3 || (toolDefs.length >= 1 && CHAIN_HINT.test(norm) && capabilities.length >= 2)) task_complexity = 'COMPLEX';
  else if (capabilities.length === 2 || (requirement === 'tool' && missing)) task_complexity = 'MEDIUM';
  else task_complexity = 'SIMPLE';

  const order: RiskClass[] = ['read_only', 'network', 'data_modification', 'publish_or_message', 'payment', 'destructive', 'sensitive_data', 'privileged_infra'];
  return {
    capabilities, task_complexity, risk_classes: order.filter((c) => risk.has(c)), requirement,
    confidence: Number(confidence.toFixed(2)), language, args_known: args, reasoning_cues, data_spans: spans,
  };
}

/** Words that chain steps: "then", "and send it", "with the result". */
export const CHAIN_HINT = /(?<![\p{L}])(then|and then|after that|afterwards|with (it|the result|that)|using (it|the result)|and (send|post|share|publish|email) it|puis|ensuite|apres ca|et (l.envoie|le publie)|ba3d|w ba3d|بعد|ومن بعد)(?![\p{L}])/u;
