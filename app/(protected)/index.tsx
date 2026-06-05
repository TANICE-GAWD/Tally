import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, Polygon as MapPolygon, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useAuth } from '@/lib/auth';
import { PROJECT_ID, supabase } from '@/lib/supabase';
import { newUuid } from '@/lib/uuid';
import { parseGeoJsonPolygon, ParsedPolygon } from '@/lib/geo';
import { useGeofence } from '@/lib/geofence';
import { insertLocalEvent, listEventsForUser, countUnsynced } from '@/lib/db';
import { syncOnce } from '@/lib/sync';
import { deriveClockState } from '@/lib/clock-state';
import type { CostCode, LocalClockEvent, Project } from '@/types/db';

export default function Jobsite() {
  const router = useRouter();
  const { user, profile, signOut } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [polygon, setPolygon] = useState<ParsedPolygon | null>(null);
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const [events, setEvents] = useState<LocalClockEvent[]>([]);
  const [unsynced, setUnsynced] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<'clock_in' | 'trade_switch'>('clock_in');
  const [banner, setBanner] = useState<
    | { kind: 'enter'; dismissed: boolean }
    | { kind: 'leave'; dismissed: boolean }
    | null
  >(null);

  const clockState = useMemo(() => deriveClockState(events), [events]);
  const currentCostCode = useMemo(
    () => costCodes.find((c) => c.id === clockState.costCodeId),
    [costCodes, clockState.costCodeId]
  );
  const isClockedIn = clockState.status === 'clocked_in';
  const canSeeDashboard = profile?.role === 'foreman' || profile?.role === 'pm';

  const refreshLocal = useCallback(async () => {
    if (!user) return;
    const [localEvents, pending] = await Promise.all([
      listEventsForUser(user.id),
      countUnsynced()
    ]);
    setEvents(localEvents);
    setUnsynced(pending);
  }, [user]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data: projects, error: projErr } = await supabase
          .rpc('get_my_projects');
        if (projErr) throw projErr;
        const proj = (projects ?? []).find((p: Project) => p.id === PROJECT_ID)
          ?? (projects ?? [])[0];
        if (!proj) {
          if (active) setLoading(false);
          return;
        }
        const parsed = parseGeoJsonPolygon(proj.polygon_geojson);

        const { data: codes, error: codeErr } = await supabase
          .from('cost_codes')
          .select('id, project_id, label, rate_cents_per_hour')
          .eq('project_id', proj.id)
          .order('label');
        if (codeErr) throw codeErr;

        if (!active) return;
        setProject(proj);
        setPolygon(parsed);
        setCostCodes(codes ?? []);
        await refreshLocal();
      } catch (e) {
        Alert.alert('Failed to load project', String(e));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshLocal]);

  useGeofence({
    polygon,
    enabled: !!polygon,
    onEnter: () => {
      if (!isClockedIn) setBanner({ kind: 'enter', dismissed: false });
    },
    onLeave: () => {
      if (isClockedIn) setBanner({ kind: 'leave', dismissed: false });
    }
  });

  const ensureLocation = async (): Promise<{ lat: number; lon: number } | null> => {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Location permission needed', 'Required to confirm jobsite presence.');
      return null;
    }
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced
    });
    return { lat: pos.coords.latitude, lon: pos.coords.longitude };
  };

  const writeEvent = async (
    eventType: LocalClockEvent['event_type'],
    costCodeId: string | null,
    source: 'manual' | 'geofence_auto' = 'manual'
  ) => {
    if (!user || !project) return;
    setBusy(true);
    try {
      const loc = await ensureLocation();
      if (!loc) return;
      await insertLocalEvent({
        id: newUuid(),
        user_id: user.id,
        project_id: project.id,
        cost_code_id: costCodeId,
        event_type: eventType,
        event_at: new Date().toISOString(),
        lat: loc.lat,
        lon: loc.lon,
        source
      });
      await refreshLocal();
      void syncOnce().then(refreshLocal);
    } catch (e) {
      Alert.alert('Could not record event', String(e));
    } finally {
      setBusy(false);
    }
  };

  const onClockIn = () => {
    setPickerMode('clock_in');
    setPickerOpen(true);
  };

  const onSwitchTrade = () => {
    setPickerMode('trade_switch');
    setPickerOpen(true);
  };

  const onPickCode = async (codeId: string) => {
    setPickerOpen(false);
    const source = banner?.kind === 'enter' ? 'geofence_auto' : 'manual';
    if (pickerMode === 'clock_in') {
      await writeEvent('clock_in', codeId, source);
      setBanner(null);
    } else {
      await writeEvent('trade_switch_out', null);
      await writeEvent('trade_switch_in', codeId);
    }
  };

  const onClockOut = async (source: 'manual' | 'geofence_auto' = 'manual') => {
    await writeEvent('clock_out', null, source);
    if (source === 'geofence_auto') setBanner(null);
  };

  const onForceSync = async () => {
    await syncOnce();
    await refreshLocal();
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  if (!project || !polygon) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.empty}>No projects assigned to this user.</Text>
        <TouchableOpacity onPress={signOut} style={[styles.button, styles.buttonGhost]}>
          <Text style={styles.buttonGhostText}>Sign out</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const showBanner = banner && !banner.dismissed;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{project.name}</Text>
          <Text style={styles.headerSubtitle}>
            {unsynced > 0 ? `${unsynced} pending sync` : 'all synced'}
            {profile ? ` · ${profile.role}` : ''}
          </Text>
        </View>
        {canSeeDashboard && (
          <TouchableOpacity
            onPress={() => router.push('/(protected)/dashboard')}
            style={styles.headerLink}
          >
            <Text style={styles.headerLinkText}>Dashboard</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={signOut} style={styles.headerLink}>
          <Text style={styles.signOut}>Sign out</Text>
        </TouchableOpacity>
      </View>

      {showBanner && banner.kind === 'enter' && (
        <View style={[styles.banner, styles.bannerEnter]}>
          <Text style={styles.bannerText}>You're inside the jobsite. Clock in?</Text>
          <View style={styles.bannerActions}>
            <TouchableOpacity onPress={onClockIn} style={styles.bannerPrimary}>
              <Text style={styles.bannerPrimaryText}>Clock in</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setBanner({ ...banner, dismissed: true })}
              style={styles.bannerDismiss}
            >
              <Text style={styles.bannerDismissText}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {showBanner && banner.kind === 'leave' && (
        <View style={[styles.banner, styles.bannerLeave]}>
          <Text style={styles.bannerText}>You left the jobsite. Clock out?</Text>
          <View style={styles.bannerActions}>
            <TouchableOpacity
              onPress={() => onClockOut('geofence_auto')}
              style={styles.bannerPrimary}
            >
              <Text style={styles.bannerPrimaryText}>Clock out</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setBanner({ ...banner, dismissed: true })}
              style={styles.bannerDismiss}
            >
              <Text style={styles.bannerDismissText}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={styles.mapWrap}>
        <MapView
          style={styles.map}
          provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
          initialRegion={{
            latitude: polygon.centroid.latitude,
            longitude: polygon.centroid.longitude,
            latitudeDelta: 0.003,
            longitudeDelta: 0.003
          }}
        >
          <MapPolygon
            coordinates={polygon.coordinates}
            strokeColor="#0a7"
            fillColor="rgba(0,170,119,0.15)"
            strokeWidth={2}
          />
          <Marker
            coordinate={polygon.centroid}
            title={project.name}
            description="Jobsite center"
          />
        </MapView>
      </View>

      <View style={styles.statusBar}>
        <Text style={styles.statusLabel}>Status</Text>
        <Text style={[styles.statusValue, isClockedIn && styles.statusOn]}>
          {isClockedIn
            ? `On the clock${currentCostCode ? ` · ${currentCostCode.label}` : ''}`
            : 'Off the clock'}
        </Text>
      </View>

      <View style={styles.actions}>
        {!isClockedIn && (
          <TouchableOpacity
            style={[styles.button, busy && styles.buttonDisabled]}
            onPress={onClockIn}
            disabled={busy}
          >
            <Text style={styles.buttonText}>Clock in</Text>
          </TouchableOpacity>
        )}
        {isClockedIn && (
          <>
            <TouchableOpacity
              style={[styles.button, styles.buttonSecondary, busy && styles.buttonDisabled]}
              onPress={onSwitchTrade}
              disabled={busy}
            >
              <Text style={styles.buttonText}>Switch trade</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.buttonDanger, busy && styles.buttonDisabled]}
              onPress={() => onClockOut('manual')}
              disabled={busy}
            >
              <Text style={styles.buttonText}>Clock out</Text>
            </TouchableOpacity>
          </>
        )}
        <TouchableOpacity
          style={[styles.button, styles.buttonGhost]}
          onPress={onForceSync}
        >
          <Text style={styles.buttonGhostText}>Sync now</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.eventsHeader}>
        <Text style={styles.eventsTitle}>Recent events</Text>
      </View>
      <FlatList
        data={events.slice(0, 10)}
        keyExtractor={(e) => e.id}
        renderItem={({ item }) => (
          <View style={styles.eventRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.eventType}>{item.event_type}</Text>
              <Text style={styles.eventMeta}>
                {new Date(item.event_at).toLocaleTimeString()} · {item.synced ? 'synced' : 'pending'} · {item.source}
              </Text>
            </View>
            <View
              style={[styles.dot, item.synced ? styles.dotSynced : styles.dotPending]}
            />
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>No events yet. Clock in to start.</Text>
        }
      />

      <Modal visible={pickerOpen} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setPickerOpen(false)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {pickerMode === 'clock_in' ? 'Pick a cost code' : 'Switch to'}
            </Text>
            {costCodes.map((c) => (
              <TouchableOpacity
                key={c.id}
                style={styles.codeRow}
                onPress={() => onPickCode(c.id)}
                disabled={c.id === clockState.costCodeId && pickerMode === 'trade_switch'}
              >
                <Text style={styles.codeLabel}>{c.label}</Text>
                <Text style={styles.codeRate}>
                  ${(c.rate_cents_per_hour / 100).toFixed(2)}/hr
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fafafa' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12
  },
  headerLink: { marginLeft: 12 },
  headerLinkText: { color: '#0a7', fontWeight: '600' },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  headerSubtitle: { fontSize: 12, color: '#666' },
  signOut: { color: '#c44', fontWeight: '600' },
  banner: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1
  },
  bannerEnter: { backgroundColor: '#e9faf4', borderColor: '#0a7' },
  bannerLeave: { backgroundColor: '#fef0e8', borderColor: '#f80' },
  bannerText: { fontWeight: '600', color: '#222' },
  bannerActions: { flexDirection: 'row', marginTop: 10, gap: 8 },
  bannerPrimary: {
    backgroundColor: '#0a7',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8
  },
  bannerPrimaryText: { color: '#fff', fontWeight: '600' },
  bannerDismiss: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ccc'
  },
  bannerDismissText: { color: '#333' },
  mapWrap: { height: 220, marginHorizontal: 16, borderRadius: 12, overflow: 'hidden' },
  map: { ...StyleSheet.absoluteFillObject },
  statusBar: {
    marginTop: 16,
    marginHorizontal: 16,
    padding: 12,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderColor: '#eee',
    borderWidth: 1
  },
  statusLabel: { fontSize: 12, color: '#888' },
  statusValue: { fontSize: 18, fontWeight: '600', marginTop: 2 },
  statusOn: { color: '#0a7' },
  actions: { padding: 16, gap: 8 },
  button: {
    backgroundColor: '#0a7',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center'
  },
  buttonSecondary: { backgroundColor: '#346' },
  buttonDanger: { backgroundColor: '#c44' },
  buttonGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#ccc' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  buttonGhostText: { color: '#333', fontWeight: '600', fontSize: 16 },
  eventsHeader: { paddingHorizontal: 16, paddingTop: 8 },
  eventsTitle: { fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: 1 },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomColor: '#eee',
    borderBottomWidth: 1
  },
  eventType: { fontWeight: '600', fontSize: 14 },
  eventMeta: { fontSize: 12, color: '#888', marginTop: 2 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotSynced: { backgroundColor: '#0a7' },
  dotPending: { backgroundColor: '#f80' },
  empty: { textAlign: 'center', color: '#888', marginTop: 24 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end'
  },
  modalCard: {
    backgroundColor: '#fff',
    padding: 24,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16
  },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 12 },
  codeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomColor: '#eee',
    borderBottomWidth: 1
  },
  codeLabel: { fontSize: 16, fontWeight: '500' },
  codeRate: { fontSize: 14, color: '#666' }
});
