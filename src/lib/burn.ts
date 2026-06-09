export interface BurnSummary {
  total_labor_cents: number;
  total_hours: number;
  budget_cents: number;
  pct_burned: number;
  days_elapsed: number;
  days_planned: number;
  burn_rate_cents_per_day: number;
  projected_total_cents: number;
  projected_overrun_cents: number;
}

export interface WhatIfInput {
  added_workers: number;
  added_days: number;
  hours_per_day: number;
  rate_cents_per_hour: number;
}

export interface WhatIfResult {
  added_cost_cents: number;
  new_projected_total_cents: number;
  new_projected_overrun_cents: number;
  new_pct_of_budget: number;
}

export function applyWhatIf(
  burn: BurnSummary,
  whatIf: WhatIfInput
): WhatIfResult {
  const workers = Math.max(0, Math.floor(whatIf.added_workers));
  const days = Math.max(0, Math.floor(whatIf.added_days));
  const hours = Math.max(0, whatIf.hours_per_day);
  const rate = Math.max(0, Math.floor(whatIf.rate_cents_per_hour));

  const added = workers * days * hours * rate;
  const newProjected = Math.round(burn.projected_total_cents + added);
  const newOverrun = newProjected - burn.budget_cents;
  const newPct =
    burn.budget_cents > 0 ? (newProjected / burn.budget_cents) * 100 : 0;

  return {
    added_cost_cents: Math.round(added),
    new_projected_total_cents: newProjected,
    new_projected_overrun_cents: newOverrun,
    new_pct_of_budget: newPct
  };
}

export { formatCents, formatPct } from './money';
