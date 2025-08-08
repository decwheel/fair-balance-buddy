import { EsbReading } from '@/services/esbCsv';
import { TariffRates } from '@/services/billPdf';
import { BillEstimate } from '@/services/tariffEngine';
import { resolveBand, TimeBandRules, STANDARD_IRISH_BANDS } from '@/utils/timeBands';
import { deriveMonthlyWeightsFromReadings, firstOfNextMonth, lastOfMonth } from '@/utils/seasonalWeights';

export type ElectricityMode = 'csv' | 'bills6' | 'billsSome';

// FairSplit-style predictor: calendar-month cycles + seasonal weights
export function predictBills(params: {
  mode: ElectricityMode;
  readings: EsbReading[];
  tariff: TariffRates;
  months?: number;
}): BillEstimate[] {
  const { readings, tariff, months = 12 } = params;
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

  // Generate calendar-month periods starting next month
  const startMonth = firstOfNextMonth(new Date(lastTs));
  const bills: BillEstimate[] = [];

  for (let i = 0; i < months; i++) {
    const periodStart = new Date(startMonth.getFullYear(), startMonth.getMonth() + i, 1);
    const periodEnd = lastOfMonth(periodStart);
    const days = periodEnd.getDate(); // since periodStart is day 1

    const monthIdx = periodStart.getMonth(); // 0..11 (Jan..Dec)
    const periodKwh = annualKwh * (monthWeights[monthIdx] ?? 0);

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

    bills.push({
      totalInclVat: round2(totalInclVat),
      totalExclVat: round2(totalExclVat),
      vatAmount: round2(vatAmount),
      standingChargeTotal: round2(standingChargeTotal),
      usageChargeTotal: round2(usageChargeTotal),
      bandBreakdown,
      period: {
        start: periodStart.toISOString().split('T')[0],
        end: periodEnd.toISOString().split('T')[0],
        days
      },
      totalKwh: round2(periodKwh)
    });
  }

  return bills;
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
