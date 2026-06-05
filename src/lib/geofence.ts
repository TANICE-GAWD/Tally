import { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { isInsidePolygon, LatLon, ParsedPolygon } from './geo';

export type GeofenceState = 'unknown' | 'inside' | 'outside';

export interface UseGeofenceOptions {
  polygon: ParsedPolygon | null;
  enabled: boolean;
  onEnter?: (pos: LatLon) => void;
  onLeave?: (pos: LatLon) => void;
}

export function useGeofence({
  polygon,
  enabled,
  onEnter,
  onLeave
}: UseGeofenceOptions): { state: GeofenceState; lastPosition: LatLon | null } {
  const [state, setState] = useState<GeofenceState>('unknown');
  const [lastPosition, setLastPosition] = useState<LatLon | null>(null);
  const stateRef = useRef<GeofenceState>('unknown');
  const enterCbRef = useRef(onEnter);
  const leaveCbRef = useRef(onLeave);

  useEffect(() => {
    enterCbRef.current = onEnter;
    leaveCbRef.current = onLeave;
  }, [onEnter, onLeave]);

  useEffect(() => {
    if (!enabled || !polygon) {
      setState('unknown');
      stateRef.current = 'unknown';
      return;
    }

    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;

    (async () => {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted' || cancelled) return;
      sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: 5,
          timeInterval: 5000
        },
        (loc) => {
          const here: LatLon = {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude
          };
          setLastPosition(here);
          const inside = isInsidePolygon(here, polygon);
          const next: GeofenceState = inside ? 'inside' : 'outside';
          if (next !== stateRef.current) {
            const prev = stateRef.current;
            stateRef.current = next;
            setState(next);
            if (next === 'inside' && prev !== 'unknown') {
              enterCbRef.current?.(here);
            } else if (next === 'outside' && prev !== 'unknown') {
              leaveCbRef.current?.(here);
            }
          }
        }
      );
    })();

    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [polygon, enabled]);

  return { state, lastPosition };
}
