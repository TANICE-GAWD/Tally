import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  pairSessions,
  summarizeSessions,
  toCsv,
  type CostCodeRef
} from '@/lib/sessions';
import type { ClockEvent, ClockEventType } from '@/types/db';

const USER_A = 'user-a';
const USER_B = 'user-b';
const FRAMING: CostCodeRef = { id: 'cc-framing', label: 'Framing', rate_cents_per_hour: 6500 };
const CONCRETE: CostCodeRef = { id: 'cc-concrete', label: 'Concrete', rate_cents_per_hour: 7200 };
const ELECTRICAL: CostCodeRef = { id: 'cc-electrical', label: 'Electrical', rate_cents_per_hour: 8800 };
const CODES = [FRAMING, CONCRETE, ELECTRICAL];

function evt(
  i: number,
  user: string,
  type: ClockEventType,
  ccId: string | null,
  hour: number
): ClockEvent {
  const base = Date.parse('2026-06-01T08:00:00Z');
  return {
    id: `e-${i}-${user}`,
    user_id: user,
    project_id: 'project-1',
    cost_code_id: ccId,
    event_type: type,
    event_at: new Date(base + hour * 3_600_000).toISOString(),
    lat: 40.7128,
    lon: -74.0134,
    source: 'manual'
  };
}

describe('pairSessions', () => {
  it('returns no sessions for an empty list', () => {
    expect(pairSessions([])).toEqual([]);
  });

  it('pairs a simple clock_in → clock_out', () => {
    const sessions = pairSessions([
      evt(1, USER_A, 'clock_in', FRAMING.id, 0),
      evt(2, USER_A, 'clock_out', null, 8)
    ]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].hours).toBeCloseTo(8, 5);
    expect(sessions[0].cost_code_id).toBe(FRAMING.id);
  });

  it('mid-shift trade switch produces two sessions at different rates', () => {
    const sessions = pairSessions([
      evt(1, USER_A, 'clock_in', FRAMING.id, 0),
      evt(2, USER_A, 'trade_switch_out', null, 4),
      evt(3, USER_A, 'trade_switch_in', ELECTRICAL.id, 4),
      evt(4, USER_A, 'clock_out', null, 8)
    ]);
    expect(sessions).toHaveLength(2);
    expect(sessions[0].cost_code_id).toBe(FRAMING.id);
    expect(sessions[0].hours).toBeCloseTo(4, 5);
    expect(sessions[1].cost_code_id).toBe(ELECTRICAL.id);
    expect(sessions[1].hours).toBeCloseTo(4, 5);
  });

  it('an unclosed clock_in contributes no session', () => {
    const sessions = pairSessions([evt(1, USER_A, 'clock_in', FRAMING.id, 0)]);
    expect(sessions).toEqual([]);
  });

  it('shuffled input is normalized by event_at before pairing', () => {
    const ordered = pairSessions([
      evt(1, USER_A, 'clock_in', FRAMING.id, 0),
      evt(2, USER_A, 'clock_out', null, 5)
    ]);
    const shuffled = pairSessions([
      evt(2, USER_A, 'clock_out', null, 5),
      evt(1, USER_A, 'clock_in', FRAMING.id, 0)
    ]);
    expect(shuffled).toEqual(ordered);
  });

  it('events for different users do not cross-contaminate', () => {
    const sessions = pairSessions([
      evt(1, USER_A, 'clock_in', FRAMING.id, 0),
      evt(2, USER_B, 'clock_out', null, 2),
      evt(3, USER_A, 'clock_out', null, 8)
    ]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].user_id).toBe(USER_A);
    expect(sessions[0].hours).toBeCloseTo(8, 5);
  });

  it('property: hours is never negative', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.constantFrom<ClockEventType>(
              'clock_in',
              'clock_out',
              'trade_switch_out',
              'trade_switch_in'
            ),
            fc.integer({ min: 0, max: 200 })
          ),
          { maxLength: 30 }
        ),
        (pairs) => {
          const events = pairs.map(([t, hour], i) =>
            evt(
              i,
              USER_A,
              t,
              t === 'clock_in' || t === 'trade_switch_in' ? FRAMING.id : null,
              hour
            )
          );
          const sessions = pairSessions(events);
          for (const s of sessions) expect(s.hours).toBeGreaterThanOrEqual(0);
        }
      )
    );
  });
});

describe('summarizeSessions', () => {
  it('groups by (user, cost_code) and multiplies hours by rate', () => {
    const summary = summarizeSessions(
      [
        { user_id: USER_A, cost_code_id: FRAMING.id, started_at: '', ended_at: '', hours: 4 },
        { user_id: USER_A, cost_code_id: FRAMING.id, started_at: '', ended_at: '', hours: 2 },
        { user_id: USER_A, cost_code_id: ELECTRICAL.id, started_at: '', ended_at: '', hours: 4 }
      ],
      CODES
    );
    const framing = summary.find(
      (r) => r.user_id === USER_A && r.cost_code_id === FRAMING.id
    );
    const electrical = summary.find(
      (r) => r.user_id === USER_A && r.cost_code_id === ELECTRICAL.id
    );
    expect(framing?.hours).toBeCloseTo(6, 5);
    expect(framing?.wages_cents).toBe(6 * FRAMING.rate_cents_per_hour);
    expect(electrical?.hours).toBeCloseTo(4, 5);
    expect(electrical?.wages_cents).toBe(4 * ELECTRICAL.rate_cents_per_hour);
  });

  it('multi-rate day with uneven split: wages = sum(hours_i × rate_i), not total_hours × avg_rate', () => {
    const events = [
      evt(1, USER_A, 'clock_in', FRAMING.id, 0),
      evt(2, USER_A, 'trade_switch_out', null, 6),
      evt(3, USER_A, 'trade_switch_in', ELECTRICAL.id, 6),
      evt(4, USER_A, 'clock_out', null, 8)
    ];
    const summary = summarizeSessions(pairSessions(events), CODES);
    const totalWages = summary.reduce((acc, r) => acc + r.wages_cents, 0);

    const expectedRight = 6 * FRAMING.rate_cents_per_hour + 2 * ELECTRICAL.rate_cents_per_hour;
    const blendedWrong = 8 * Math.round((FRAMING.rate_cents_per_hour + ELECTRICAL.rate_cents_per_hour) / 2);

    expect(totalWages).toBe(expectedRight);
    expect(totalWages).not.toBe(blendedWrong);
    expect(Math.abs(totalWages - blendedWrong)).toBeGreaterThan(0);
  });

  it('wages are always >= 0 and integer cents', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.constantFrom(FRAMING.id, CONCRETE.id, ELECTRICAL.id),
            fc.double({ min: 0, max: 80, noNaN: true })
          ),
          { maxLength: 20 }
        ),
        (entries) => {
          const sessions = entries.map(([ccId, hours], i) => ({
            user_id: USER_A,
            cost_code_id: ccId,
            started_at: `${i}`,
            ended_at: `${i + 1}`,
            hours
          }));
          const summary = summarizeSessions(sessions, CODES);
          for (const r of summary) {
            expect(r.wages_cents).toBeGreaterThanOrEqual(0);
            expect(Number.isInteger(r.wages_cents)).toBe(true);
          }
        }
      )
    );
  });
});

describe('toCsv', () => {
  it('emits header + rows sorted by worker then cost code', () => {
    const rows = [
      {
        user_id: USER_B,
        cost_code_id: CONCRETE.id,
        cost_code_label: 'Concrete',
        hours: 6,
        rate_cents_per_hour: 7200,
        wages_cents: 43200
      },
      {
        user_id: USER_A,
        cost_code_id: FRAMING.id,
        cost_code_label: 'Framing',
        hours: 8,
        rate_cents_per_hour: 6500,
        wages_cents: 52000
      }
    ];
    const labels = new Map([
      [USER_A, 'Wesley Okafor'],
      [USER_B, 'Maria Delgado']
    ]);
    const csv = toCsv(rows, (id) => labels.get(id) ?? id);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('worker,cost_code,hours,rate_per_hour,wages');
    expect(lines[1]).toContain('Maria Delgado');
    expect(lines[1]).toContain('Concrete');
    expect(lines[2]).toContain('Wesley Okafor');
    expect(lines[2]).toContain('Framing');
  });

  it('escapes worker names that contain commas or quotes', () => {
    const rows = [
      {
        user_id: 'x',
        cost_code_id: 'cc',
        cost_code_label: 'A "tricky" trade, with stuff',
        hours: 1,
        rate_cents_per_hour: 100,
        wages_cents: 100
      }
    ];
    const csv = toCsv(rows, () => 'Smith, John "Doe"');
    expect(csv).toContain('"Smith, John ""Doe"""');
    expect(csv).toContain('"A ""tricky"" trade, with stuff"');
  });
});
