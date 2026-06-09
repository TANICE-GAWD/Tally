import type { ClockEvent } from '@/types/db';
import { formatCentsPlain } from './money';

export interface Session {
  user_id: string;
  cost_code_id: string;
  started_at: string;
  ended_at: string;
  hours: number;
}

export function pairSessions(events: ClockEvent[]): Session[] {
  const byUser = new Map<string, ClockEvent[]>();
  for (const e of events) {
    const bucket = byUser.get(e.user_id);
    if (bucket) bucket.push(e);
    else byUser.set(e.user_id, [e]);
  }

  const sessions: Session[] = [];
  for (const [userId, list] of byUser) {
    const sorted = [...list].sort((a, b) =>
      a.event_at < b.event_at ? -1 : a.event_at > b.event_at ? 1 : 0
    );
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      const prevOpens =
        prev.event_type === 'clock_in' || prev.event_type === 'trade_switch_in';
      const curCloses =
        cur.event_type === 'clock_out' || cur.event_type === 'trade_switch_out';
      if (!prevOpens || !curCloses || prev.cost_code_id == null) continue;

      const prevMs = Date.parse(prev.event_at);
      const curMs = Date.parse(cur.event_at);
      const hours = Math.max(0, (curMs - prevMs) / 3_600_000);
      sessions.push({
        user_id: userId,
        cost_code_id: prev.cost_code_id,
        started_at: prev.event_at,
        ended_at: cur.event_at,
        hours
      });
    }
  }
  return sessions;
}

export interface CostCodeRef {
  id: string;
  label: string;
  rate_cents_per_hour: number;
}

export interface SessionSummaryRow {
  user_id: string;
  cost_code_id: string;
  cost_code_label: string;
  hours: number;
  rate_cents_per_hour: number;
  wages_cents: number;
}

export function summarizeSessions(
  sessions: Session[],
  costCodes: CostCodeRef[]
): SessionSummaryRow[] {
  const codeIndex = new Map(costCodes.map((c) => [c.id, c]));
  const grouped = new Map<string, { hours: number; code: CostCodeRef; user_id: string }>();

  for (const s of sessions) {
    const code = codeIndex.get(s.cost_code_id);
    if (!code) continue;
    const key = `${s.user_id}|${s.cost_code_id}`;
    const existing = grouped.get(key);
    if (existing) existing.hours += s.hours;
    else grouped.set(key, { hours: s.hours, code, user_id: s.user_id });
  }

  return [...grouped.values()].map((g) => ({
    user_id: g.user_id,
    cost_code_id: g.code.id,
    cost_code_label: g.code.label,
    hours: g.hours,
    rate_cents_per_hour: g.code.rate_cents_per_hour,
    wages_cents: Math.round(g.hours * g.code.rate_cents_per_hour)
  }));
}

export function toCsv(
  rows: SessionSummaryRow[],
  userLabel: (userId: string) => string
): string {
  const header = ['worker', 'cost_code', 'hours', 'rate_per_hour', 'wages'].join(',');
  const lines = rows
    .slice()
    .sort((a, b) => {
      const wa = userLabel(a.user_id);
      const wb = userLabel(b.user_id);
      if (wa !== wb) return wa < wb ? -1 : 1;
      return a.cost_code_label < b.cost_code_label ? -1 : 1;
    })
    .map((r) =>
      [
        csvEscape(userLabel(r.user_id)),
        csvEscape(r.cost_code_label),
        r.hours.toFixed(2),
        formatCentsPlain(r.rate_cents_per_hour),
        formatCentsPlain(r.wages_cents)
      ].join(',')
    );
  return [header, ...lines].join('\n');
}

function csvEscape(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
