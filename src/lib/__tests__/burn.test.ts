import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { applyWhatIf, BurnSummary, formatCents } from '@/lib/burn';

const baseBurn: BurnSummary = {
  total_labor_cents: 1_000_000,
  total_hours: 120,
  budget_cents: 25_000_000,
  pct_burned: 4,
  days_elapsed: 10,
  days_planned: 90,
  burn_rate_cents_per_day: 100_000,
  projected_total_cents: 9_000_000,
  projected_overrun_cents: -16_000_000
};

describe('applyWhatIf', () => {
  it('zero added workers or days produces zero added cost', () => {
    const r = applyWhatIf(baseBurn, {
      added_workers: 0,
      added_days: 7,
      hours_per_day: 8,
      rate_cents_per_hour: 6500
    });
    expect(r.added_cost_cents).toBe(0);
    expect(r.new_projected_total_cents).toBe(baseBurn.projected_total_cents);
  });

  it('adds workers × days × hours × rate', () => {
    const r = applyWhatIf(baseBurn, {
      added_workers: 3,
      added_days: 5,
      hours_per_day: 8,
      rate_cents_per_hour: 7200
    });
    expect(r.added_cost_cents).toBe(3 * 5 * 8 * 7200);
  });

  it('clamps negative inputs to zero', () => {
    const r = applyWhatIf(baseBurn, {
      added_workers: -5,
      added_days: -2,
      hours_per_day: -1,
      rate_cents_per_hour: -100
    });
    expect(r.added_cost_cents).toBe(0);
  });

  it('overrun grows when projection exceeds budget', () => {
    const r = applyWhatIf(baseBurn, {
      added_workers: 100,
      added_days: 90,
      hours_per_day: 8,
      rate_cents_per_hour: 10000
    });
    expect(r.new_projected_overrun_cents).toBeGreaterThan(0);
  });

  it('property: added_cost is always >= 0 and monotonic in workers', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50 }),
        fc.integer({ min: 0, max: 50 }),
        fc.integer({ min: 0, max: 120 }),
        fc.integer({ min: 0, max: 50000 }),
        (w1, wDelta, days, rate) => {
          const base = applyWhatIf(baseBurn, {
            added_workers: w1,
            added_days: days,
            hours_per_day: 8,
            rate_cents_per_hour: rate
          });
          const more = applyWhatIf(baseBurn, {
            added_workers: w1 + wDelta,
            added_days: days,
            hours_per_day: 8,
            rate_cents_per_hour: rate
          });
          expect(base.added_cost_cents).toBeGreaterThanOrEqual(0);
          expect(more.added_cost_cents).toBeGreaterThanOrEqual(base.added_cost_cents);
        }
      )
    );
  });

  it('property: integer arithmetic — no fractional cents ever', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 0, max: 100000 }),
        (w, d, rate) => {
          const r = applyWhatIf(baseBurn, {
            added_workers: w,
            added_days: d,
            hours_per_day: 8,
            rate_cents_per_hour: rate
          });
          expect(Number.isInteger(r.added_cost_cents)).toBe(true);
          expect(Number.isInteger(r.new_projected_total_cents)).toBe(true);
          expect(Number.isInteger(r.new_projected_overrun_cents)).toBe(true);
        }
      )
    );
  });
});

describe('formatCents', () => {
  it('formats positive values with commas', () => {
    expect(formatCents(1234567)).toBe('$12,345.67');
  });
  it('formats negative values with leading sign', () => {
    expect(formatCents(-1234567)).toBe('-$12,345.67');
  });
  it('formats zero', () => {
    expect(formatCents(0)).toBe('$0.00');
  });
  it('handles small change', () => {
    expect(formatCents(7)).toBe('$0.07');
    expect(formatCents(99)).toBe('$0.99');
  });
});
