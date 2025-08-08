import { EsbReading } from './esbCsv';
import { TariffRates } from './billPdf';
import { resolveBand, TimeBandRules, STANDARD_IRISH_BANDS } from '@/utils/timeBands';
import { differenceInDays, parseISO } from 'date-fns';

export interface BillEstimate {
  totalInclVat: number;
  totalExclVat: number;
  vatAmount: number;
  standingChargeTotal: number;
  usageChargeTotal: number;
  bandBreakdown: {
    [bandName: string]: {
      kwh: number;
      rate: number;
      cost: number;
    };
  };
  period: {
    start: string;
    end: string;
    days: number;
  };
  totalKwh: number;
}

export function estimateBill(params: {
  readings: EsbReading[];
  tariff: TariffRates;
  periodStart?: string;
  periodEnd?: string;
}): BillEstimate {
  const { readings, tariff, periodStart, periodEnd } = params;

  // Filter readings to period if specified
  let filteredReadings = readings;
  if (periodStart && periodEnd) {
    const start = new Date(periodStart);
    const end = new Date(periodEnd);
    filteredReadings = readings.filter(r => {
      const date = new Date(r.tsISO);
      return date >= start && date <= end;
    });
  }

  if (filteredReadings.length === 0) {
    throw new Error('No readings found for the specified period');
  }

  // Determine period
  const sortedReadings = [...filteredReadings].sort((a, b) => 
    new Date(a.tsISO).getTime() - new Date(b.tsISO).getTime()
  );
  
  const actualStart = periodStart || sortedReadings[0].tsISO.split('T')[0];
  const actualEnd = periodEnd || sortedReadings[sortedReadings.length - 1].tsISO.split('T')[0];
  const days = differenceInDays(parseISO(actualEnd), parseISO(actualStart)) + 1;

  // Create time band rules from tariff
  const bandRules: TimeBandRules = {
    meterType: tariff.meterType,
    bands: tariff.meterType === 'SMART_TOU' ? STANDARD_IRISH_BANDS.bands : {}
  };

  // Group readings by band
  const bandUsage: { [bandName: string]: number } = {};
  let totalKwh = 0;

  for (const reading of filteredReadings) {
    const band = resolveBand(reading.tsISO, bandRules);
    bandUsage[band] = (bandUsage[band] || 0) + reading.kwh;
    totalKwh += reading.kwh;
  }

  // Calculate costs by band
  const bandBreakdown: BillEstimate['bandBreakdown'] = {};
  let usageChargeTotal = 0;

  for (const [band, kwh] of Object.entries(bandUsage)) {
    const rate = tariff.rates[band] || tariff.rates.standard || 0.25; // fallback rate
    const cost = kwh * rate;
    
    bandBreakdown[band] = {
      kwh,
      rate,
      cost
    };
    
    usageChargeTotal += cost;
  }

  // Calculate standing charge
  const standingChargeTotal = days * tariff.standingChargeDaily;

  // Calculate totals
  const totalExclVat = usageChargeTotal + standingChargeTotal;
  const vatAmount = totalExclVat * tariff.vatRate;
  const totalInclVat = totalExclVat + vatAmount;

  return {
    totalInclVat: Math.round(totalInclVat * 100) / 100,
    totalExclVat: Math.round(totalExclVat * 100) / 100,
    vatAmount: Math.round(vatAmount * 100) / 100,
    standingChargeTotal: Math.round(standingChargeTotal * 100) / 100,
    usageChargeTotal: Math.round(usageChargeTotal * 100) / 100,
    bandBreakdown,
    period: {
      start: actualStart,
      end: actualEnd,
      days
    },
    totalKwh: Math.round(totalKwh * 100) / 100
  };
}

export function generatePredictedBills(params: {
  readings: EsbReading[];
  tariff: TariffRates;
  periodsCount: number;
  periodLengthDays?: number;
}): BillEstimate[] {
  const { readings, tariff, periodsCount, periodLengthDays = 60 } = params;

  if (readings.length === 0) {
    return [];
  }

  // Sort readings by date
  const sortedReadings = [...readings].sort((a, b) => 
    new Date(a.tsISO).getTime() - new Date(b.tsISO).getTime()
  );

  // Calculate average daily usage from historical data
  const firstDate = new Date(sortedReadings[0].tsISO);
  const lastDate = new Date(sortedReadings[sortedReadings.length - 1].tsISO);
  const historicalDays = differenceInDays(lastDate, firstDate) + 1;
  
  const totalHistoricalKwh = sortedReadings.reduce((sum, r) => sum + r.kwh, 0);
  const avgDailyKwh = totalHistoricalKwh / historicalDays;

  // Calculate band distribution from historical data
  const bandRules: TimeBandRules = {
    meterType: tariff.meterType,
    bands: tariff.meterType === 'SMART_TOU' ? STANDARD_IRISH_BANDS.bands : {}
  };

  const bandDistribution: { [band: string]: number } = {};
  let totalSampleKwh = 0;

  // Use last 30 days for pattern analysis
  const recentCutoff = new Date(lastDate);
  recentCutoff.setDate(recentCutoff.getDate() - 30);
  
  const recentReadings = sortedReadings.filter(r => new Date(r.tsISO) >= recentCutoff);
  
  for (const reading of recentReadings) {
    const band = resolveBand(reading.tsISO, bandRules);
    bandDistribution[band] = (bandDistribution[band] || 0) + reading.kwh;
    totalSampleKwh += reading.kwh;
  }

  // Normalize to percentages
  const bandPercentages: { [band: string]: number } = {};
  for (const [band, kwh] of Object.entries(bandDistribution)) {
    bandPercentages[band] = kwh / totalSampleKwh;
  }

  // Generate predicted bills
  const bills: BillEstimate[] = [];
  const startDate = new Date(lastDate);
  startDate.setDate(startDate.getDate() + 1); // Start from next day

  for (let i = 0; i < periodsCount; i++) {
    const periodStart = new Date(startDate);
    periodStart.setDate(startDate.getDate() + (i * periodLengthDays));
    
    const periodEnd = new Date(periodStart);
    periodEnd.setDate(periodStart.getDate() + periodLengthDays - 1);

    // Generate predicted usage for this period
    const periodKwh = avgDailyKwh * periodLengthDays;
    
    // Distribute across bands based on historical pattern
    const bandBreakdown: BillEstimate['bandBreakdown'] = {};
    let usageChargeTotal = 0;

    for (const [band, percentage] of Object.entries(bandPercentages)) {
      const kwh = periodKwh * percentage;
      const rate = tariff.rates[band] || tariff.rates.standard || 0.25;
      const cost = kwh * rate;

      bandBreakdown[band] = { kwh, rate, cost };
      usageChargeTotal += cost;
    }

    // Calculate totals
    const standingChargeTotal = periodLengthDays * tariff.standingChargeDaily;
    const totalExclVat = usageChargeTotal + standingChargeTotal;
    const vatAmount = totalExclVat * tariff.vatRate;
    const totalInclVat = totalExclVat + vatAmount;

    bills.push({
      totalInclVat: Math.round(totalInclVat * 100) / 100,
      totalExclVat: Math.round(totalExclVat * 100) / 100,
      vatAmount: Math.round(vatAmount * 100) / 100,
      standingChargeTotal: Math.round(standingChargeTotal * 100) / 100,
      usageChargeTotal: Math.round(usageChargeTotal * 100) / 100,
      bandBreakdown,
      period: {
        start: periodStart.toISOString().split('T')[0],
        end: periodEnd.toISOString().split('T')[0],
        days: periodLengthDays
      },
      totalKwh: Math.round(periodKwh * 100) / 100
    });
  }

  return bills;
}