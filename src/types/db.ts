export type UserRole = 'worker' | 'foreman' | 'pm';

export type ClockEventType =
  | 'clock_in'
  | 'clock_out'
  | 'trade_switch_out'
  | 'trade_switch_in';

export type ClockEventSource = 'geofence_auto' | 'manual';

export interface Profile {
  id: string;
  full_name: string;
  role: UserRole;
}

export interface Project {
  id: string;
  name: string;
  budget_cents: number;
  planned_start_date: string;
  planned_end_date: string;
  polygon_geojson: string;
}

export interface CostCode {
  id: string;
  project_id: string;
  label: string;
  rate_cents_per_hour: number;
}

export interface ClockEvent {
  id: string;
  user_id: string;
  project_id: string;
  cost_code_id: string | null;
  event_type: ClockEventType;
  event_at: string;
  lat: number;
  lon: number;
  source: ClockEventSource;
}

export interface LocalClockEvent extends ClockEvent {
  synced: 0 | 1;
}
