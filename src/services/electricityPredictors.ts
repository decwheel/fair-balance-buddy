import { EsbReading } from '@/services/esbCsv';
import { TariffRates } from '@/services/billPdf';
import { BillEstimate } from '@/services/tariffEngine';
import { resolveBand, TimeBandRules, STANDARD_IRISH_BANDS } from '@/utils/timeBands';
import { deriveMonthlyWeightsFromReadings, firstOfNextMonth, lastOfMonth } from '@/utils/seasonalWeights';

export type ElectricityMode = 'csv' | 'bills6' | 'billsSome';

// FairSplit-style predictor: infer billing cycle length and due dates
export function predictBills(params: {
  mode: ElectricityMode;
  readings: EsbReading[];
  tariff: TariffRates;
  months?: number; // horizon window (approx)
}): BillEstimate[] {
  const { readings, tariff, months = 12, mode } = params;
  if (!readings?.length) return [];

  // Sort & window last 365 days
  const sorted = [...readings].sort((a, b) => new Date(a.tsISO).getTime() - new Date(b.tsISO).getTime());
  const lastTs = new Date(sorted[sorted.length - 1].tsISO).getTime();
  const cutoff = lastTs - 365 * 24 * 60 * 60 * 1000;

  let firstKept = Infinity;
  let totalKwh = 0;
  for (const r of sorted) {
    const t = new Date(r.tsISO).getTime();
    if (t < cutoff) continue;
    totalKwh += r.kwh;
    if (t < firstKept) firstKept = t;
  }
  if (!isFinite(firstKept)) firstKept = new Date(sorted[0].tsISO).getTime();
  const daysCovered = Math.max(1, Math.floor((lastTs - firstKept) / 86400000) + 1);
  const annualKwh = totalKwh * (365 / daysCovered);

  // Seasonal weights (derived from CSV when possible)
  const monthWeights = deriveMonthlyWeightsFromReadings(readings);

  // Band distribution from recent 30 days; fallback heuristics per meter type
  const bandPercentages = getBandPercentages(sorted, tariff);

  // Infer billing cycle
  const explicitDays = Number(tariff.billingPeriodDays || 0) || undefined;
  const cycleDays = explicitDays ?? (mode === 'bills6' ? 61 : mode === 'billsSome' ? 61 : undefined);
  const hasCycle = Boolean(cycleDays);
  const anchorDue = tariff.nextDueDate ? new Date(tariff.nextDueDate) : null;

  // If we can't infer a cycle length, fallback to calendar-month prediction
  if (!hasCycle) {
    const startMonth = firstOfNextMonth(new Date(lastTs));
    const bills: BillEstimate[] = [];
    for (let i = 0; i < months; i++) {
      const periodStart = new Date(startMonth.getFullYear(), startMonth.getMonth() + i, 1);
      const periodEnd = lastOfMonth(periodStart);
      const periodKwh = estimateKwhForPeriod(periodStart, periodEnd, annualKwh, monthWeights);
      bills.push(buildBill(periodStart, periodEnd, periodKwh, bandPercentages, tariff));
    }
    return bills;
  }

  // Cycle-based prediction (FairSplit-style)
  const horizonDays = Math.round(months * 30.4);
  const N = Math.max(1, Math.ceil(horizonDays / (cycleDays as number)));

  // Determine first period end (due date) and start
  let firstEnd: Date;
  if (anchorDue) {
    firstEnd = anchorDue;
  } else {
    // Anchor at the end of next month to approximate real-world cycles
    firstEnd = lastOfMonth(firstOfNextMonth(new Date(lastTs)));
  }
  const bills: BillEstimate[] = [];
  for (let i = 0; i < N; i++) {
    const end = new Date(firstEnd);
    end.setDate(end.getDate() + i * (cycleDays as number));
    const start = new Date(end);
    start.setDate(end.getDate() - (cycleDays as number) + 1);

    const periodKwh = estimateKwhForPeriod(start, end, annualKwh, monthWeights);
    bills.push(buildBill(start, end, periodKwh, bandPercentages, tariff));
  }

  return bills;
}

// Estimate kWh for an arbitrary date range using monthly seasonal weights
function estimateKwhForPeriod(start: Date, end: Date, annualKwh: number, monthWeights: number[]): number {
  // Ensure start <= end
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const e = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  if (e < s) return 0;

  let share = 0;
  let cursor = new Date(s);
  while (cursor <= e) {
    const m = cursor.getMonth();
    const ms = new Date(cursor.getFullYear(), m, 1);
    const me = lastOfMonth(ms);
    const rangeStart = cursor > ms ? cursor : ms;
    const rangeEnd = e < me ? e : me;
    const daysInMonth = me.getDate();
    const overlapDays = Math.max(0, (rangeEnd.getTime() - rangeStart.getTime()) / 86400000 + 1);
    share += (monthWeights[m] ?? 0) * (overlapDays / daysInMonth);
    // Move cursor to first day of next month
    cursor = new Date(me.getFullYear(), me.getMonth() + 1, 1);
  }
  return annualKwh * share;
}

function buildBill(periodStart: Date, periodEnd: Date, periodKwh: number, bandPercentages: Record<string, number>, tariff: TariffRates): BillEstimate {
  const days = Math.max(1, Math.floor((periodEnd.getTime() - periodStart.getTime()) / 86400000) + 1);
  // Distribute across bands and price
  const bandBreakdown: BillEstimate['bandBreakdown'] = {};
  let usageChargeTotal = 0;
  for (const [band, pct] of Object.entries(bandPercentages)) {
    const kwh = periodKwh * pct;
    const rate = tariff.rates[band] || tariff.rates.standard || 0.25;
    const cost = kwh * rate;
    bandBreakdown[band] = { kwh, rate, cost };
    usageChargeTotal += cost;
  }
  const standingChargeTotal = days * tariff.standingChargeDaily;
  const totalExclVat = usageChargeTotal + standingChargeTotal;
  const vatAmount = totalExclVat * tariff.vatRate;
  const totalInclVat = totalExclVat + vatAmount;

  return {
    totalInclVat: round2(totalInclVat),
    totalExclVat: round2(totalExclVat),
    vatAmount: round2(vatAmount),
    standingChargeTotal: round2(standingChargeTotal),
    usageChargeTotal: round2(usageChargeTotal),
    bandBreakdown,
    period: {
      start: periodStart.toISOString().split('T')[0],
      end: periodEnd.toISOString().split('T')[0],
      days,
    },
    totalKwh: round2(periodKwh),
  };
}

function getBandPercentages(sorted: EsbReading[], tariff: TariffRates): Record<string, number> {
  const bandRules: TimeBandRules = {
    meterType: tariff.meterType,
    bands: tariff.meterType === 'SMART_TOU' ? STANDARD_IRISH_BANDS.bands : {}
  };

  const lastDate = new Date(sorted[sorted.length - 1].tsISO);
  const recentCutoff = new Date(lastDate.getTime() - 30 * 86400000);
  const recent = sorted.filter(r => new Date(r.tsISO) >= recentCutoff);

  const totals: Record<string, number> = {};
  let S = 0;
  for (const r of recent) {
    const band = resolveBand(r.tsISO, bandRules);
    totals[band] = (totals[band] || 0) + r.kwh;
    S += r.kwh;
  }

  if (S > 0) {
    const pct: Record<string, number> = {};
    for (const [b, k] of Object.entries(totals)) pct[b] = k / S;
    return pct;
  }

  // Heuristic fallback
  if (tariff.meterType === 'DAY_NIGHT') return { day: 0.7, night: 0.3 };
  if (tariff.meterType === 'SMART_TOU') return { day: 0.6, night: 0.35, peak: 0.05 };
  return { standard: 1 };
}

function round2(n: number) { return Math.round(n * 100) / 100; }
