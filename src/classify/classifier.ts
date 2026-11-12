/**
 * classify(): rules first; the ClassifierPort (ClawRouter, local rung, $0) only when all of these hold: the rules'
 * confidence is under 0.5, TOOL_ROUTER_MODEL_FALLBACK is on, a port is wired, and the rules did not already decide
 * no_tool. Only the request text is sent, never tool text (T1). The answer is validated against the taxonomy: unknown
 * capability ids and unknown labels are dropped, malformed answers ignored. Risk classes stay the rules' classes plus
 * the default risk of any capability the model added: a model answer can add risk, never remove it.
 */
import type { KtrFlags } from '../flags';
import type { ClassifierPort } from '../types/ports';
import type { CallerContext, Classification, Requirement, TaskComplexity } from '../types/route';
import { REQUIREMENTS, TASK_COMPLEXITIES } from '../types/route';
import type { RiskClass } from '../types/tool';
import { classifyRules } from './rules';
import { CAPABILITY_IDS, capabilityById } from './taxonomy';

export const FALLBACK_THRESHOLD = 0.5;

export async function classify(text: string, ctx: Partial<CallerContext>, flags: Pick<KtrFlags, 'modelFallback' | 'stopped'>, port?: ClassifierPort | null): Promise<Classification> {
  const r = classifyRules(text, ctx);
  const base: Classification = {
    task_complexity: r.task_complexity, risk_classes: r.risk_classes, requirement: r.requirement,
    capabilities: r.capabilities.map((c) => c.id), hits: r.capabilities, confidence: r.confidence, method: 'rules',
    language: r.language, args_known: r.args_known, reasoning_cues: r.reasoning_cues, data_spans: r.data_spans,
  };
  const eligible = r.confidence < FALLBACK_THRESHOLD && flags.modelFallback && !flags.stopped && !!port && r.requirement !== 'no_tool';
  if (!eligible) return base;
  let answer: Awaited<ReturnType<ClassifierPort['classify']>> = null;
  try {
    answer = await port!.classify(String(text).slice(0, 600), { capabilities: CAPABILITY_IDS, requirements: REQUIREMENTS, complexities: TASK_COMPLEXITIES });
  } catch { answer = null; }
  if (!answer || !Array.isArray(answer.capabilities)) return base;
  const caps = [...new Set(answer.capabilities.map(String).filter((c) => CAPABILITY_IDS.includes(c)))];
  const requirement = REQUIREMENTS.includes(answer.requirement as Requirement) ? (answer.requirement as Requirement) : null;
  const complexity = TASK_COMPLEXITIES.includes(answer.task_complexity as TaskComplexity) ? (answer.task_complexity as TaskComplexity) : null;
  if (!caps.length && !requirement) return base;
  const merged = [...new Set([...base.capabilities, ...caps])];
  const risk = new Set<RiskClass>(base.risk_classes);
  for (const c of caps) for (const x of capabilityById(c)!.default_risk) risk.add(x);
  const needsTool = merged.some((c) => capabilityById(c)!.needs_tool);
  const finalReq: Requirement = requirement === 'no_eligible_tool' ? 'tool' : requirement ?? (needsTool ? 'tool' : merged.length ? 'no_tool' : base.requirement);
  const order: RiskClass[] = ['read_only', 'network', 'data_modification', 'publish_or_message', 'payment', 'destructive', 'sensitive_data', 'privileged_infra'];
  const conf = typeof answer.confidence === 'number' && answer.confidence >= 0 && answer.confidence <= 1 ? answer.confidence : 0.5;
  return {
    ...base,
    capabilities: merged,
    hits: [...base.hits, ...caps.filter((c) => !base.capabilities.includes(c)).map((id) => ({ id, confidence: conf, span: '(model)' }))],
    requirement: finalReq === 'tool' && !needsTool ? 'no_tool' : finalReq,
    task_complexity: base.task_complexity === 'REASONING' ? 'REASONING' : complexity ?? base.task_complexity,
    risk_classes: order.filter((c) => risk.has(c)),
    confidence: Number(Math.max(base.confidence, Math.min(conf, 0.7)).toFixed(2)),
    method: 'model',
  };
}
