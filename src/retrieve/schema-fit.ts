/**
 * Schema fit: the share of an operation's required inputs the request can supply (the node's known arguments), or,
 * for a chained node, whether the previous node's output can feed it. An unknown schema scores 0.3 and nothing that
 * is unknown ever scores 1.
 */
import type { JSONSchema } from '../types/tool';
import type { PlanNode } from '../types/route';

/** Input property names each argument the classifier finds can fill. */
const FILLS: Record<string, RegExp> = {
  query: /^(q|query|term|terms|search|text|prompt|brief|topic|keywords?|description|goal|task|idea|request|input|instruction|message|title|question|content|subject|from|name|shop|material|channel)$/i,
  location: /^(city|location|place|lat|latitude|lon|lng|longitude|address|country|region|near|q|query)$/i,
  url: /^(url|uri|link|href|page_url|website)$/i,
  address: /^(address|token|mint|contract|contract_address|wallet|token_address|ca)$/i,
  token: /^(token|mint|symbol|ticker|address|coin|chain|contract|token_address|ids|vs_currencies)$/i,
  amount: /^(amount|value|quantity|qty|sum)$/i,
  file_ref: /^(file|file_id|image|image_ref|image_url|audio|audio_ref|document|pdf|attachment|video|id)$/i,
  recipient: /^(to|recipient|email|phone|number|chat_id|user)$/i,
  date: /^(date|day|from|to|start|end|time|since|until|days)$/i,
};

export const UNKNOWN_SCHEMA = 0.3;

export function schemaFit(node: Pick<PlanNode, 'args_known' | 'depends_on'>, input: JSONSchema | null | undefined, prevOutput?: JSONSchema | null): number {
  const props = (input && typeof input === 'object' && (input as any).properties && typeof (input as any).properties === 'object') ? Object.keys((input as any).properties) : [];
  const required: string[] = Array.isArray((input as any)?.required) ? (input as any).required.map(String) : [];
  if (!props.length && !required.length) return UNKNOWN_SCHEMA;
  if (node.depends_on.length) {
    // chained: the previous node's output names, when known, should cover the required inputs
    const outProps = prevOutput && (prevOutput as any).properties ? Object.keys((prevOutput as any).properties) : [];
    if (!required.length) return 0.8;
    if (!outProps.length) return 0.6;
    const covered = required.filter((r) => outProps.includes(r)).length;
    return Math.min(0.95, 0.4 + 0.55 * covered / required.length);
  }
  if (!required.length) return 0.8;
  const fillable = (name: string) => node.args_known.some((a) => FILLS[a]?.test(name));
  const ok = required.filter(fillable).length;
  return Math.min(0.95, 0.15 + 0.8 * ok / required.length);
}
