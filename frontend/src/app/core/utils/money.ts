/**
 * Integer-cents arithmetic for the few places the UI has to derive a figure
 * (e.g. "what's left for the SME after the financier's cut"). Parsing is
 * done on the string itself rather than via parseFloat, so currency values
 * never touch a float at any point — same discipline the backend applies,
 * one layer up.
 */

function toCents(amount: string): number {
  const [whole, fraction = ''] = amount.trim().split('.');
  const paddedFraction = (fraction + '00').slice(0, 2);
  const sign = whole.startsWith('-') ? -1 : 1;
  const wholeDigits = whole.replace('-', '') || '0';
  return sign * (Number(wholeDigits) * 100 + Number(paddedFraction));
}

function fromCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

export function addMoney(a: string, b: string): string {
  return fromCents(toCents(a) + toCents(b));
}

export function subtractMoney(a: string, b: string): string {
  return fromCents(toCents(a) - toCents(b));
}

/** Percentage of `part` relative to `whole`, for display only (e.g. "4.5%"). */
export function percentOf(part: string, whole: string): string {
  const wholeCents = toCents(whole);
  if (wholeCents === 0) return '0.0';
  return ((toCents(part) / wholeCents) * 100).toFixed(1);
}
