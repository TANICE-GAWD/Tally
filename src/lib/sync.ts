import NetInfo from '@react-native-community/netinfo';
import { AppState, AppStateStatus } from 'react-native';
import { listUnsyncedEvents, markSynced } from './db';
import { supabase } from './supabase';

const SYNC_INTERVAL_MS = 15_000;

let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;
let listenersBound = false;
let netUnsub: (() => void) | null = null;
let appStateSub: { remove: () => void } | null = null;

export async function syncOnce(): Promise<{ pushed: number; failed: number }> {
  if (inFlight) return { pushed: 0, failed: 0 };
  inFlight = true;
  try {
    const pending = await listUnsyncedEvents();
    if (pending.length === 0) return { pushed: 0, failed: 0 };

    const { error } = await supabase
      .from('clock_events')
      .upsert(pending, { onConflict: 'id', ignoreDuplicates: true });

    if (error) {
      console.warn('[sync] upsert failed:', error.message);
      return { pushed: 0, failed: pending.length };
    }

    const ids = pending.map((p) => p.id);
    await markSynced(ids);
    return { pushed: ids.length, failed: 0 };
  } finally {
    inFlight = false;
  }
}

function onAppStateChange(state: AppStateStatus) {
  if (state === 'active') {
    void syncOnce();
  }
}

export function startSyncLoop(): void {
  if (timer !== null) return;
  timer = setInterval(() => {
    void syncOnce();
  }, SYNC_INTERVAL_MS);

  if (!listenersBound) {
    netUnsub = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) {
        void syncOnce();
      }
    });
    appStateSub = AppState.addEventListener('change', onAppStateChange);
    listenersBound = true;
  }

  void syncOnce();
}

export function stopSyncLoop(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  if (netUnsub) {
    netUnsub();
    netUnsub = null;
  }
  if (appStateSub) {
    appStateSub.remove();
    appStateSub = null;
  }
  listenersBound = false;
}
