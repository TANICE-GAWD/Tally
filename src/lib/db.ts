import * as SQLite from 'expo-sqlite';
import type {
  ClockEvent,
  ClockEventSource,
  ClockEventType,
  LocalClockEvent
} from '@/types/db';

let dbInstance: SQLite.SQLiteDatabase | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (dbInstance) return dbInstance;
  dbInstance = await SQLite.openDatabaseAsync('jobsite_pulse.db');
  await dbInstance.execAsync(`
    pragma journal_mode = WAL;
    create table if not exists clock_events_local (
      id text primary key,
      user_id text not null,
      project_id text not null,
      cost_code_id text,
      event_type text not null,
      event_at text not null,
      lat real not null,
      lon real not null,
      source text not null,
      synced integer not null default 0
    );
    create index if not exists clock_events_local_unsynced
      on clock_events_local (synced) where synced = 0;
    create index if not exists clock_events_local_user_event_at
      on clock_events_local (user_id, event_at desc);
  `);
  return dbInstance;
}

export interface InsertClockEventInput {
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

export async function insertLocalEvent(e: InsertClockEventInput): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `insert into clock_events_local
       (id, user_id, project_id, cost_code_id, event_type, event_at, lat, lon, source, synced)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      e.id,
      e.user_id,
      e.project_id,
      e.cost_code_id,
      e.event_type,
      e.event_at,
      e.lat,
      e.lon,
      e.source
    ]
  );
}

export async function listUnsyncedEvents(): Promise<ClockEvent[]> {
  const db = await getDb();
  return db.getAllAsync<ClockEvent>(
    `select id, user_id, project_id, cost_code_id, event_type, event_at, lat, lon, source
     from clock_events_local
     where synced = 0
     order by event_at asc`
  );
}

export async function markSynced(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDb();
  const placeholders = ids.map(() => '?').join(',');
  await db.runAsync(
    `update clock_events_local set synced = 1 where id in (${placeholders})`,
    ids
  );
}

export async function listEventsForUser(
  userId: string,
  limit = 50
): Promise<LocalClockEvent[]> {
  const db = await getDb();
  return db.getAllAsync<LocalClockEvent>(
    `select id, user_id, project_id, cost_code_id, event_type, event_at, lat, lon, source, synced
     from clock_events_local
     where user_id = ?
     order by event_at desc
     limit ?`,
    [userId, limit]
  );
}

export async function countUnsynced(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>(
    `select count(*) as c from clock_events_local where synced = 0`
  );
  return row?.c ?? 0;
}
