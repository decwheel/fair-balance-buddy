import { EsbReading } from '@/services/esbCsv';
import { TariffRates } from '@/services/billPdf';
import { BillEstimate, generatePredictedBills } from '@/services/tariffEngine';

export type ElectricityMode = 'csv' | 'bills6' | 'billsSome';

// Wrapper to mimic FairSplit's three prediction paths.
// For now, we reuse our engine under the hood and adjust minor params per mode.
export function predictBills(params: {
  mode: ElectricityMode;
  readings: EsbReading[];
  tariff: TariffRates;
  months?: number;
}): BillEstimate[] {
  const { mode, readings, tariff, months = 12 } = params;

  // Pick a period length heuristic per mode (FS infers cycle; we approximate)
  const periodLengthDays =
    mode === 'csv' ? (tariff.billingPeriodDays ?? 60)
    : mode === 'bills6' ? 61 // typical bi-monthly
    : 60; // default

  const periodsCount = months;
  return generatePredictedBills({ readings, tariff, periodsCount, periodLengthDays });
}
