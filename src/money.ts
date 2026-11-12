/**
 * Integer micro units (1 USDC = 1_000_000). Decimal strings in, bigint inside, decimal strings on disk. There is no
 * floating point path: "0.17" is parsed digit by digit.
 */
import type { Money } from './types/tool';

const DEC_RE = /^(\d+)(?:\.(\d+))?$/;

export function toMicro(decimal: string, decimals = 6): bigint {
  const s = String(decimal).trim();
  if (s.startsWith('-')) throw new Error('negative amounts are refused');
  const m = DEC_RE.exec(s);
  if (!m) throw new Error(`not a decimal amount: "${decimal}"`);
  const frac = m[2] || '';
  if (frac.length > decimals && /[1-9]/.test(frac.slice(decimals))) throw new Error(`more than ${decimals} decimals: "${decimal}"`);
  const padded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(m[1]) * 10n ** BigInt(decimals) + BigInt(padded || '0');
}

export function fromMicro(b: bigint, decimals = 6): string {
  if (b < 0n) throw new Error('negative amounts are refused');
  const base = 10n ** BigInt(decimals);
  const whole = b / base;
  const frac = (b % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** Parses a micro unit string from disk. */
export function microOf(s: string | undefined | null): bigint | null {
  if (s === undefined || s === null || !/^\d{1,30}$/.test(String(s))) return null;
  return BigInt(s);
}

export function fmt(m: Money): string {
  const b = microOf(m.amount_micro);
  if (b === null) return `? ${m.currency}`;
  const dec = m.currency === 'KGC' ? 0 : 6;
  return `${dec ? fromMicro(b) : b.toString()} ${m.currency}${m.network ? ` on ${m.network}` : ''}`;
}
