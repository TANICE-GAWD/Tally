import type { LocalClockEvent } from '@/types/db';

export interface ClockState {
  status: 'clocked_in' | 'clocked_out';
  costCodeId: string | null;
  sinceIso: string | null;
}

export function deriveClockState(events: LocalClockEvent[]): ClockState {
  const ordered = [...events].sort((a, b) =>
    a.event_at < b.event_at ? -1 : a.event_at > b.event_at ? 1 : 0
  );

  let status: ClockState['status'] = 'clocked_out';
  let costCodeId: string | null = null;
  let sinceIso: string | null = null;

  for (const e of ordered) {
    switch (e.event_type) {
      case 'clock_in':
      case 'trade_switch_in':
        status = 'clocked_in';
        costCodeId = e.cost_code_id;
        sinceIso = e.event_at;
        break;
      case 'clock_out':
        status = 'clocked_out';
        costCodeId = null;
        sinceIso = null;
        break;
      case 'trade_switch_out':
        break;
    }
  }

  return { status, costCodeId, sinceIso };
}
