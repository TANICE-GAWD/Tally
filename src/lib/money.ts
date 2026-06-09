import Dinero from 'dinero.js';

export function formatCents(amount: number): string {
  const rounded = Math.round(amount);
  const abs = Math.abs(rounded);
  const formatted = Dinero({ amount: abs, currency: 'USD' }).toFormat('$0,0.00');
  return rounded < 0 ? `-${formatted}` : formatted;
}

export function formatCentsPlain(amount: number): string {
  const rounded = Math.round(amount);
  const abs = Math.abs(rounded);
  const formatted = Dinero({ amount: abs, currency: 'USD' }).toFormat('$0.00');
  return rounded < 0 ? `-${formatted}` : formatted;
}

export function formatPct(pct: number, digits = 1): string {
  return `${pct.toFixed(digits)}%`;
}
