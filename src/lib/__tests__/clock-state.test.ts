import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { deriveClockState } from '@/lib/clock-state';
import type { LocalClockEvent, ClockEventType } from '@/types/db';

const USER = 'user-1';
const PROJECT = 'project-1';
const CC1 = 'cc-framing';
const CC2 = 'cc-concrete';

function evt(
  i: number,
  type: ClockEventType,
  costCodeId: string | null,
  hoursOffset: number
): LocalClockEvent {
  const base = new Date('2026-06-01T08:00:00Z').getTime();
  return {
    id: `e-${i}`,
    user_id: USER,
    project_id: PROJECT,
    cost_code_id: costCodeId,
    event_type: type,
    event_at: new Date(base + hoursOffset * 3600_000).toISOString(),
    lat: 40.7128,
    lon: -74.0134,
    source: 'manual',
    synced: 1
  };
}

describe('deriveClockState', () => {
  it('returns clocked_out when no events', () => {
    const s = deriveClockState([]);
    expect(s.status).toBe('clocked_out');
    expect(s.costCodeId).toBeNull();
    expect(s.sinceIso).toBeNull();
  });

  it('clock_in → clocked_in with that cost code', () => {
    const s = deriveClockState([evt(1, 'clock_in', CC1, 0)]);
    expect(s.status).toBe('clocked_in');
    expect(s.costCodeId).toBe(CC1);
    expect(s.sinceIso).not.toBeNull();
  });

  it('clock_in → clock_out → clocked_out', () => {
    const s = deriveClockState([
      evt(1, 'clock_in', CC1, 0),
      evt(2, 'clock_out', null, 4)
    ]);
    expect(s.status).toBe('clocked_out');
    expect(s.costCodeId).toBeNull();
  });

  it('trade switch updates cost code while staying clocked in', () => {
    const s = deriveClockState([
      evt(1, 'clock_in', CC1, 0),
      evt(2, 'trade_switch_out', null, 2),
      evt(3, 'trade_switch_in', CC2, 2)
    ]);
    expect(s.status).toBe('clocked_in');
    expect(s.costCodeId).toBe(CC2);
  });

  it('out-of-order input is sorted by event_at before deriving', () => {
    const ordered = deriveClockState([
      evt(1, 'clock_in', CC1, 0),
      evt(2, 'clock_out', null, 4)
    ]);
    const shuffled = deriveClockState([
      evt(2, 'clock_out', null, 4),
      evt(1, 'clock_in', CC1, 0)
    ]);
    expect(shuffled).toEqual(ordered);
  });

  it('property: a clock_in always raises status to clocked_in regardless of prior events', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.constantFrom<ClockEventType>(
            'clock_in',
            'clock_out',
            'trade_switch_out',
            'trade_switch_in'
          ),
          { maxLength: 20 }
        ),
        (types) => {
          const prior = types.map((t, i) =>
            evt(i, t, t === 'clock_in' || t === 'trade_switch_in' ? CC1 : null, i)
          );
          const withFinal = [...prior, evt(types.length, 'clock_in', CC2, types.length + 1)];
          const s = deriveClockState(withFinal);
          expect(s.status).toBe('clocked_in');
          expect(s.costCodeId).toBe(CC2);
        }
      )
    );
  });

  it('property: a clock_out at the end always yields clocked_out', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.constantFrom<ClockEventType>(
            'clock_in',
            'clock_out',
            'trade_switch_out',
            'trade_switch_in'
          ),
          { maxLength: 20 }
        ),
        (types) => {
          const prior = types.map((t, i) =>
            evt(i, t, t === 'clock_in' || t === 'trade_switch_in' ? CC1 : null, i)
          );
          const withFinal = [...prior, evt(types.length, 'clock_out', null, types.length + 1)];
          const s = deriveClockState(withFinal);
          expect(s.status).toBe('clocked_out');
          expect(s.costCodeId).toBeNull();
        }
      )
    );
  });
});
