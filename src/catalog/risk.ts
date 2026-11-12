/**
 * Risk classes of an operation, derived at ingestion (plan.md S1 rule 3). Evidence only ever adds classes: unknown
 * side effects add network and data_modification; cue words in the text add the stricter class; nothing in provider
 * text can remove one. read_only is given only when every known side effect is a read and no stricter class applies.
 */
import type { JSONSchema, Origin, RiskClass, SideEffect } from '../types/tool';

const fold = (s: string) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const RISK_CUES: Array<[RiskClass, RegExp]> = [
  ['payment', /\b(transfer (funds|money|usdc|sol|eth|btc|tokens?|crypto)|send (funds|money|usdc|sol|eth|btc|crypto|tokens?|payments?)|withdraw|make (a )?payments?|pay (an? )?(invoice|bill|merchant)|(buy|sell|swap|trade) (tokens?|crypto|coins?|shares|stocks?|nfts?|usdc|sol|eth|btc)|execute (a )?(trade|swap|order|payment)|place (an? )?(trade|order)|token swaps?|trading bot)\b/],
  ['destructive', /\b(delete|deletes|deleting|remove (files?|records?|rows?|users?|repos?)|erase|wipe|destroy|drop (table|database|schema)|purge|truncate|rm -rf)\b/],
  ['publish_or_message', /\b(send (an? )?(emails?|messages?|sms|texts?|dms?|tweets?|notifications?)|post (to|on) |publish(es|ing)? (to|on|a|posts?)|tweet(s|ing)? |reply to (emails?|messages?|comments?|tweets?)|send(s|ing)? emails|outbound (email|sms|calls?))/],
  ['privileged_infra', /\b(deploy(s|ing|ment)?|ssh|shell commands?|execute (code|commands?|scripts?)|run (code|commands?|scripts?|shell)|kubernetes|kubectl|terraform|docker|root access|sudo|dns records?|firewall rules?|provision (servers?|vms?|infrastructure)|cloud infrastructure)\b/],
  ['sensitive_data', /\b(emails?|inbox|gmail|outlook|mailbox|calendar|google drive|onedrive|contacts|passwords?|credentials?|medical records?|health records?|patient data|bank accounts?|iban|passport|social security|private keys?|seed phrase|direct messages?)\b/],
];

/** Input property names that mean "a URL the caller supplies" (no fetch from chat). */
const URL_PROP = /^(url|uri|link|href|page_url|target_url|website|site|source_url|image_url|endpoint|webhook|callback_url)$/i;
/** Input property names that mean "where money goes" (security.txt rule 1). */
const DEST_PROP = /^(to|recipient|recipient_address|destination|destination_address|to_address|address|payto|pay_to|receiver|wallet_address|beneficiary)$/i;

const props = (s: JSONSchema | null | undefined): Record<string, any> => {
  const p = s && typeof s === 'object' ? (s as any).properties : null;
  return p && typeof p === 'object' ? p : {};
};

export function urlFromUser(input: JSONSchema | null | undefined): boolean {
  for (const [k, v] of Object.entries(props(input))) {
    if (URL_PROP.test(k)) return true;
    if (v && typeof v === 'object' && (v.format === 'uri' || v.format === 'url')) return true;
    if (k === 'body' && urlFromUser(v)) return true;
  }
  return false;
}

export function takesDestination(input: JSONSchema | null | undefined): boolean {
  for (const [k, v] of Object.entries(props(input))) {
    if (DEST_PROP.test(k)) return true;
    if (k === 'body' && takesDestination(v)) return true;
  }
  return false;
}

const SIDE_RISK: Record<SideEffect, RiskClass[]> = {
  none: [], read: [], write: ['data_modification'], publish: ['publish_or_message'], message: ['publish_or_message'],
  payment: ['payment'], delete: ['destructive', 'data_modification'], infra: ['privileged_infra'],
};

export interface RiskInput {
  origin: Origin;
  side_effects: SideEffect[] | null | undefined;
  scopes?: string[];
  text: string;              // for native rows: the operation summary only; for outside rows: name + description + summary
  input_schema?: JSONSchema | null;
  external_network: boolean; // the call leaves Kognai's machines
}

export function deriveRisk(r: RiskInput): { risk: RiskClass[]; side_effects: SideEffect[]; url_from_user: boolean } {
  const out = new Set<RiskClass>();
  const known = Array.isArray(r.side_effects) && r.side_effects.length > 0;
  const side: SideEffect[] = known ? [...new Set(r.side_effects!)] : [];
  if (!known) { out.add('network'); out.add('data_modification'); }
  for (const s of side) for (const c of SIDE_RISK[s] || []) out.add(c);
  const t = fold(r.text);
  for (const [cls, re] of RISK_CUES) if (re.test(t)) out.add(cls);
  for (const sc of r.scopes || []) if (/mail|gmail|calendar|drive|contacts|message|inbox/i.test(sc)) out.add('sensitive_data');
  const url = urlFromUser(r.input_schema);
  if (url || r.external_network) out.add('network');
  const strict: RiskClass[] = ['data_modification', 'publish_or_message', 'payment', 'destructive', 'privileged_infra'];
  if (known && side.every((s) => s === 'read' || s === 'none') && !strict.some((c) => out.has(c))) out.add('read_only');
  const order: RiskClass[] = ['read_only', 'network', 'data_modification', 'publish_or_message', 'payment', 'destructive', 'sensitive_data', 'privileged_infra'];
  return { risk: order.filter((c) => out.has(c)), side_effects: side, url_from_user: url };
}
