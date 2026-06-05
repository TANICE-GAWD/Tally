import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PROJECT_ID, supabase } from '@/lib/supabase';
import { applyWhatIf, BurnSummary, formatCents, formatPct } from '@/lib/burn';
import type { CostCode } from '@/types/db';

const HOURS_PER_DAY = 8;

export default function Dashboard() {
  const [burn, setBurn] = useState<BurnSummary | null>(null);
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [addedWorkers, setAddedWorkers] = useState(1);
  const [addedDays, setAddedDays] = useState(5);
  const [selectedCodeId, setSelectedCodeId] = useState<string | null>(null);

  const fetchBurn = useCallback(async () => {
    const { data, error } = await supabase
      .rpc('get_project_burn', { p_project_id: PROJECT_ID });
    if (error) {
      console.warn('[dashboard] burn fetch failed:', error.message);
      return;
    }
    const row = (data ?? [])[0];
    if (row) {
      setBurn({
        total_labor_cents: Number(row.total_labor_cents ?? 0),
        total_hours: Number(row.total_hours ?? 0),
        budget_cents: Number(row.budget_cents ?? 0),
        pct_burned: Number(row.pct_burned ?? 0),
        days_elapsed: Number(row.days_elapsed ?? 0),
        days_planned: Number(row.days_planned ?? 0),
        burn_rate_cents_per_day: Number(row.burn_rate_cents_per_day ?? 0),
        projected_total_cents: Number(row.projected_total_cents ?? 0),
        projected_overrun_cents: Number(row.projected_overrun_cents ?? 0)
      });
    }
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchBurn();
    } finally {
      setRefreshing(false);
    }
  }, [fetchBurn]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [{ data: codes }] = await Promise.all([
          supabase
            .from('cost_codes')
            .select('id, project_id, label, rate_cents_per_hour')
            .eq('project_id', PROJECT_ID)
            .order('label'),
          fetchBurn()
        ]);
        if (!active) return;
        const list = codes ?? [];
        setCostCodes(list);
        if (list.length > 0) setSelectedCodeId(list[0].id);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [fetchBurn]);

  useEffect(() => {
    const channel = supabase
      .channel('clock_events_dashboard')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'clock_events',
          filter: `project_id=eq.${PROJECT_ID}`
        },
        () => {
          void fetchBurn();
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [fetchBurn]);

  const selectedCode = useMemo(
    () => costCodes.find((c) => c.id === selectedCodeId) ?? null,
    [costCodes, selectedCodeId]
  );

  const whatIf = useMemo(() => {
    if (!burn || !selectedCode) return null;
    return applyWhatIf(burn, {
      added_workers: addedWorkers,
      added_days: addedDays,
      hours_per_day: HOURS_PER_DAY,
      rate_cents_per_hour: selectedCode.rate_cents_per_hour
    });
  }, [burn, selectedCode, addedWorkers, addedDays]);

  if (loading || !burn) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  const burnedPct = Math.min(100, burn.pct_burned);
  const projectedPct = burn.budget_cents > 0
    ? Math.min(200, (burn.projected_total_cents / burn.budget_cents) * 100)
    : 0;
  const overBudget = burn.projected_overrun_cents > 0;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <Text style={styles.h1}>Live burn</Text>
          <TouchableOpacity onPress={refresh} disabled={refreshing}>
            <Text style={styles.refresh}>{refreshing ? 'refreshing…' : 'refresh'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Spent to date</Text>
          <Text style={styles.bigNum}>{formatCents(burn.total_labor_cents)}</Text>
          <Text style={styles.sub}>
            {burn.total_hours.toFixed(1)} hours · {formatPct(burn.pct_burned)} of budget
          </Text>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${burnedPct}%` }]} />
          </View>
          <Text style={styles.faint}>Budget: {formatCents(burn.budget_cents)}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Burn rate</Text>
          <Text style={styles.bigNum}>
            {formatCents(burn.burn_rate_cents_per_day)} <Text style={styles.unit}>/ day</Text>
          </Text>
          <Text style={styles.sub}>
            Day {Math.round(burn.days_elapsed)} of {Math.round(burn.days_planned)}
          </Text>
        </View>

        <View style={[styles.card, overBudget && styles.cardWarn]}>
          <Text style={styles.label}>Projected at completion</Text>
          <Text style={styles.bigNum}>{formatCents(burn.projected_total_cents)}</Text>
          <Text style={[styles.sub, overBudget && styles.warnText]}>
            {overBudget
              ? `${formatCents(burn.projected_overrun_cents)} over budget`
              : `${formatCents(-burn.projected_overrun_cents)} under budget`}
          </Text>
          <View style={styles.barTrack}>
            <View
              style={[
                styles.barFill,
                overBudget ? styles.barFillWarn : null,
                { width: `${Math.min(100, projectedPct)}%` }
              ]}
            />
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.h2}>What if…</Text>
          <Text style={styles.faint}>
            Add workers to a trade and see how it shifts the projection.
          </Text>

          <View style={styles.controls}>
            <Stepper
              label="Workers"
              value={addedWorkers}
              onChange={setAddedWorkers}
              min={0}
              max={50}
            />
            <Stepper
              label="Days"
              value={addedDays}
              onChange={setAddedDays}
              min={0}
              max={120}
            />
          </View>

          <Text style={styles.label}>Trade</Text>
          <View style={styles.codeChips}>
            {costCodes.map((c) => {
              const selected = c.id === selectedCodeId;
              return (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => setSelectedCodeId(c.id)}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                    {c.label}
                  </Text>
                  <Text style={[styles.chipRate, selected && styles.chipTextSelected]}>
                    {formatCents(c.rate_cents_per_hour)}/hr
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {whatIf && (
            <View style={styles.whatIfBox}>
              <Row label="Added cost" value={formatCents(whatIf.added_cost_cents)} />
              <Row
                label="New projected total"
                value={formatCents(whatIf.new_projected_total_cents)}
              />
              <Row
                label="New overrun"
                value={
                  whatIf.new_projected_overrun_cents > 0
                    ? `+${formatCents(whatIf.new_projected_overrun_cents)}`
                    : formatCents(whatIf.new_projected_overrun_cents)
                }
                warn={whatIf.new_projected_overrun_cents > 0}
              />
              <Row label="% of budget" value={formatPct(whatIf.new_pct_of_budget)} />
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Stepper({
  label,
  value,
  onChange,
  min,
  max
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
}) {
  return (
    <View style={styles.stepper}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepperRow}>
        <TouchableOpacity
          style={styles.stepperBtn}
          onPress={() => onChange(Math.max(min, value - 1))}
        >
          <Text style={styles.stepperBtnText}>−</Text>
        </TouchableOpacity>
        <Text style={styles.stepperValue}>{value}</Text>
        <TouchableOpacity
          style={styles.stepperBtn}
          onPress={() => onChange(Math.min(max, value + 1))}
        >
          <Text style={styles.stepperBtnText}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, warn && styles.warnText]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fafafa' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, gap: 12 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4
  },
  h1: { fontSize: 22, fontWeight: '700' },
  h2: { fontSize: 18, fontWeight: '700', marginBottom: 4 },
  refresh: { color: '#0a7', fontWeight: '600' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderColor: '#eee',
    borderWidth: 1
  },
  cardWarn: { borderColor: '#f80', backgroundColor: '#fff7f0' },
  label: { fontSize: 12, textTransform: 'uppercase', color: '#888', letterSpacing: 1 },
  bigNum: { fontSize: 28, fontWeight: '700', marginTop: 4 },
  unit: { fontSize: 14, fontWeight: '500', color: '#666' },
  sub: { fontSize: 13, color: '#666', marginTop: 2 },
  faint: { fontSize: 12, color: '#888', marginTop: 6 },
  warnText: { color: '#c44' },
  barTrack: {
    height: 8,
    backgroundColor: '#eee',
    borderRadius: 4,
    marginTop: 10,
    overflow: 'hidden'
  },
  barFill: { height: '100%', backgroundColor: '#0a7' },
  barFillWarn: { backgroundColor: '#c44' },
  controls: { flexDirection: 'row', gap: 12, marginTop: 12, marginBottom: 12 },
  stepper: { flex: 1 },
  stepperLabel: { fontSize: 12, color: '#888' },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    borderColor: '#ddd',
    borderWidth: 1,
    borderRadius: 8,
    padding: 4
  },
  stepperBtn: {
    paddingHorizontal: 16,
    paddingVertical: 6
  },
  stepperBtnText: { fontSize: 22, fontWeight: '700', color: '#0a7' },
  stepperValue: { fontSize: 18, fontWeight: '600' },
  codeChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fff'
  },
  chipSelected: { backgroundColor: '#0a7', borderColor: '#0a7' },
  chipText: { fontWeight: '600', color: '#333' },
  chipRate: { fontSize: 11, color: '#666', marginTop: 2 },
  chipTextSelected: { color: '#fff' },
  whatIfBox: {
    marginTop: 14,
    padding: 12,
    backgroundColor: '#f5f8ff',
    borderRadius: 10,
    gap: 6
  },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  rowLabel: { color: '#555' },
  rowValue: { fontWeight: '600' }
});
