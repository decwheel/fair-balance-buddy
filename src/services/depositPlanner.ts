import type { PlanInputs, PayFrequency } from "../types.js";
import type { PaySchedule, Bill as AdapterBill, ISODate } from "./forecastAdapters.js";
import { runJoint, runSingle } from "./forecastAdapters.js";

// Helpers
const cyclesPerMonth = (freq: PayFrequency | PaySchedule["frequency"]): number => {
  const f = String(freq).toUpperCase();
  switch (f) {
    case "WEEKLY":
      return 52 / 12;
    case "FORTNIGHTLY":
    case "BIWEEKLY":
      return 26 / 12;
    case "FOUR_WEEKLY":
      return 13 / 12;
    case "MONTHLY":
    default:
      return 1;
  }
};

const monthsBetween = (startISO: ISODate, endISO: ISODate): number => {
  const s = new Date(startISO);
  const e = new Date(endISO);
  return (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1;
};

const firstDueDate = (bills: AdapterBill[], fallback: ISODate): ISODate => {
  if (!bills.length) return fallback;
  let min = bills[0].dueDate ?? fallback;
  for (const b of bills) {
    const d = b.dueDate ?? fallback;
    if (d < min) min = d;
  }
  return min;
};

const lastDueDate = (bills: AdapterBill[], fallback: ISODate): ISODate => {
  if (!bills.length) return fallback;
  let max = bills[0].dueDate ?? fallback;
  for (const b of bills) {
    const d = b.dueDate ?? fallback;
    if (d > max) max = d;
  }
  return max;
};

const sumAmounts = (bills: AdapterBill[]): number => bills.reduce((s, b) => s + (b.amount || 0), 0);

/**
 * Compute the average monthly spend from a set of bill occurrences.
 * These should be NON-electricity recurring bills. If you pass expanded weekly/fortnightly items,
 * the monthsBetween divisor naturally yields 4.333× / 2.167× factors respectively.
 */
export function averageMonthlyFromBills(bills: AdapterBill[], startISO: ISODate): number {
  if (!bills.length) return 0;
  const first = firstDueDate(bills, startISO);
  const last = lastDueDate(bills, startISO);
  const span = Math.max(1, monthsBetween(first, last));
  return sumAmounts(bills) / span;
}

/**
 * Compute monthly average for electricity predictions as annual/12.
 * We treat the provided predicted items over the horizon as the year’s worth of bills.
 */
export function monthlyElectricityAverage(predicted: AdapterBill[]): number {
  if (!predicted?.length) return 0;
  const total = sumAmounts(predicted);
  // If we have fewer than ~12 months of samples, still use a simple per-year normalisation.
  return total / 12;
}

/**
 * Fair-split joint deposits planner.
 * - Computes fairness ratio from monthly wages only (no allowances/pots adjustments)
 * - Builds base monthly requirement = recurringMonthly + electricityAnnual/12
 * - Splits by ratio to get monthly deposits
 * - Converts to per-pay deposits and scales equally (preserving ratio) until min balance >= target
 */
export function planJointDeposits(params: {
  inputs: PlanInputs;
  startISO: ISODate;
  payA: PaySchedule;
  payB: PaySchedule;
  billsNonElectric: AdapterBill[];
  elecPredicted: AdapterBill[];
  allBillsForTimeline: AdapterBill[]; // all bills (recurring + predicted electricity) to simulate
  minBalance?: number; // default 0
}): {
  depositPerPayA: number;
  depositPerPayB: number;
  fairnessRatioA: number;
  factor: number;
  minBalance: number;
  endBalance: number;
  timeline: Array<{ date: ISODate; balance: number; event?: string }>;
} {
  const { inputs, startISO, payA, payB, billsNonElectric, elecPredicted, allBillsForTimeline } = params;
  const minTarget = params.minBalance ?? 0;

  const monthlyA = Math.max(0, Number(inputs.a?.netMonthly ?? 0));
  const monthlyB = Math.max(0, Number(inputs.b?.netMonthly ?? 0));
  const incomeSum = monthlyA + monthlyB;
  const fairnessRatioA = incomeSum > 0 ? (monthlyA / incomeSum) : 0.5;

  // Base monthly: recurring + electricity average
  const recurringMonthly = averageMonthlyFromBills(billsNonElectric, startISO);
  const elecMonthly = monthlyElectricityAverage(elecPredicted);
  const baseMonthly = recurringMonthly + elecMonthly;

  // Ideal monthly split
  const idealMonthlyA = baseMonthly * fairnessRatioA;
  const idealMonthlyB = baseMonthly - idealMonthlyA;

  // Convert to per-pay deposits
  const cyclesA = cyclesPerMonth(payA.frequency);
  const cyclesB = cyclesPerMonth(payB.frequency);
  let depA = idealMonthlyA / cyclesA;
  let depB = idealMonthlyB / cyclesB;

  // Helper: evaluate min balance with given deposits
  const evalPlan = (dA: number, dB: number) =>
    runJoint(dA, dB, startISO, payA, payB, allBillsForTimeline, { months: 12, fairnessRatioA }).minBalance;

  // If already feasible, we’re done
  let minBal = evalPlan(depA, depB);
  if (minBal >= minTarget) {
    const result = runJoint(depA, depB, startISO, payA, payB, allBillsForTimeline, { months: 12, fairnessRatioA });
    return { depositPerPayA: Math.round(depA * 100) / 100, depositPerPayB: Math.round(depB * 100) / 100, fairnessRatioA, factor: 1, minBalance: result.minBalance, endBalance: result.endBalance, timeline: result.timeline };
  }

  // Otherwise, scale both equally by factor >= 1 to hit the edge (minimal increase)
  let low = 1.0, high = 1.5;
  // Grow high until feasible or cap
  while (evalPlan(depA * high, depB * high) < minTarget && high < 20) high *= 1.5;
  // Binary search
  let bestF = high;
  for (let i = 0; i < 40 && (high - low) > 1e-3; i++) {
    const mid = (low + high) / 2;
    const ok = evalPlan(depA * mid, depB * mid) >= minTarget;
    if (ok) { bestF = mid; high = mid; } else { low = mid; }
  }
  depA *= bestF; depB *= bestF;
  const final = runJoint(depA, depB, startISO, payA, payB, allBillsForTimeline, { months: 12, fairnessRatioA });
  return {
    depositPerPayA: Math.round(depA * 100) / 100,
    depositPerPayB: Math.round(depB * 100) / 100,
    fairnessRatioA,
    factor: bestF,
    minBalance: final.minBalance,
    endBalance: final.endBalance,
    timeline: final.timeline,
  };
}

/** Single-partner variant (no ratio). */
export function planSingleDeposit(params: {
  startISO: ISODate;
  pay: PaySchedule;
  billsNonElectric: AdapterBill[];
  elecPredicted: AdapterBill[];
  allBillsForTimeline: AdapterBill[];
  minBalance?: number; // default 0
}): {
  depositPerPay: number;
  factor: number;
  minBalance: number;
  endBalance: number;
  timeline: Array<{ date: ISODate; balance: number; event?: string }>;
} {
  const { startISO, pay, billsNonElectric, elecPredicted, allBillsForTimeline } = params;
  const minTarget = params.minBalance ?? 0;

  const recurringMonthly = averageMonthlyFromBills(billsNonElectric, startISO);
  const elecMonthly = monthlyElectricityAverage(elecPredicted);
  const baseMonthly = recurringMonthly + elecMonthly;

  const cycles = cyclesPerMonth(pay.frequency);
  let dep = baseMonthly / cycles;

  const evalPlan = (d: number) => runSingle(d, startISO, pay, allBillsForTimeline, { months: 12, buffer: 0 }).minBalance;
  let minBal = evalPlan(dep);
  if (minBal >= minTarget) {
    const result = runSingle(dep, startISO, pay, allBillsForTimeline, { months: 12, buffer: 0 });
    return { depositPerPay: Math.round(dep * 100) / 100, factor: 1, minBalance: result.minBalance, endBalance: result.endBalance, timeline: result.timeline };
  }
  // Scale equally until feasible
  let low = 1.0, high = 1.5, bestF = 1.0;
  while (evalPlan(dep * high) < minTarget && high < 20) high *= 1.5;
  for (let i = 0; i < 40 && (high - low) > 1e-3; i++) {
    const mid = (low + high) / 2;
    const ok = evalPlan(dep * mid) >= minTarget;
    if (ok) { bestF = mid; high = mid; } else { low = mid; }
  }
  dep *= bestF;
  const final = runSingle(dep, startISO, pay, allBillsForTimeline, { months: 12, buffer: 0 });
  return { depositPerPay: Math.round(dep * 100) / 100, factor: bestF, minBalance: final.minBalance, endBalance: final.endBalance, timeline: final.timeline };
}
