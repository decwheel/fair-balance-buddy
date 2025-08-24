import { calculatePayDates, nextBusinessDay } from "@/utils/dateUtils";
import { calculateForecast, Bill as ForecastBill } from "@/utils/forecast";
import { calculateForecastFromMany } from "@/utils/forecastMany";

export type ISODate = string;

export interface Bill {
  id?: string;
  name: string;
  amount: number;          // € positive
  issueDate: ISODate;      // ISO yyyy-mm-dd
  dueDate: ISODate;        // ISO
  source?: "manual"|"predicted-electricity"|"imported";
  movable?: boolean;       // eligible for nudge engine
}

export interface PaySchedule {
  frequency: "WEEKLY"|"FORTNIGHTLY"|"MONTHLY"|"BIWEEKLY"|"FOUR_WEEKLY";
  anchorDate: ISODate;     // first known payday or next payday
}

export interface RunSingleOptions {
  months?: number;               // default 12
  initialBalance?: number;       // default 0
  buffer?: number;               // default 0
}

export interface RunJointOptions extends RunSingleOptions {
  fairnessRatioA: number;        // 0..1
  weeklyAllowanceA?: number;     // optional, €/week
  weeklyAllowanceB?: number;
  savingsRules?: unknown;        // pass-through to existing logic if present
}

export interface ForecastResult {
  minBalance: number;
  endBalance: number;
  timeline: Array<{ date: ISODate; balance: number; event?: string }>;
}

export function runSingle(
  depositPerCycle: number,
  startDate: ISODate,
  pay: PaySchedule,
  bills: Bill[],
  opts: RunSingleOptions = {}
): ForecastResult {
  const months = opts.months ?? 12;
  const buffer = opts.buffer ?? 0;
  
  // Generate pay dates using existing util
  const payDates: ISODate[] = calculatePayDates(pay.frequency, pay.anchorDate, months);
  
  // Adapter: call existing calculateForecast with the shapes it expects.
  const result = calculateForecast({
    startDate,
    months,
    initialBalance: opts.initialBalance ?? 0,
    payDates,
    depositPerCycle,         // fixed deposit each payday
    bills: bills as ForecastBill[],
    buffer
  });
  
  // Standardise the return shape
  return {
    minBalance: result.minBalance ?? 0,
    endBalance: result.endBalance ?? 0,
    timeline: result.timeline ?? []
  };
}

export function runJoint(
  depositA: number,
  depositB: number,
  startDate: ISODate,
  payA: PaySchedule,
  payB: PaySchedule,
  bills: Bill[],
  opts: RunJointOptions
): ForecastResult {
  const months = opts.months ?? 12;
  const payDatesA: ISODate[] = calculatePayDates(payA.frequency, payA.anchorDate, months);
  const payDatesB: ISODate[] = calculatePayDates(payB.frequency, payB.anchorDate, months);

  const result = calculateForecastFromMany({
    startDate,
    months,
    initialBalance: opts.initialBalance ?? 0,
    payDatesA,
    payDatesB,
    depositA,               // fixed deposit for A on A's paydates
    depositB,               // fixed deposit for B on B's paydates
    bills: bills as ForecastBill[],
    fairnessRatioA: opts.fairnessRatioA,
    weeklyAllowanceA: opts.weeklyAllowanceA,
    weeklyAllowanceB: opts.weeklyAllowanceB,
    savingsRules: opts.savingsRules,
    buffer: opts.buffer ?? 0
  });

  return {
    minBalance: result.minBalance ?? 0,
    endBalance: result.endBalance ?? 0,
    timeline: result.timeline ?? []
  };
}

// NEVER-BELOW-ZERO DEPOSIT SEARCH
// Copied from decwheel/fair-split project

export function findDepositSingle(
  startDate: ISODate,
  pay: PaySchedule,
  bills: Bill[],
  _baseline: number
): number {
  let low = 0;
  let high = 20000;
  let bestDeposit = high;

  // Check if zero deposit works
  const testZero = runSingle(0, startDate, pay, bills, { months: 12, buffer: 0 });
  if (testZero.minBalance >= 0) return 0;

  // Binary search
  for (let iterations = 0; iterations < 50 && high - low > 0.01; iterations++) {
    const mid = (low + high) / 2;
    const result = runSingle(mid, startDate, pay, bills, { months: 12, buffer: 0 });

    if (result.minBalance >= 0) {
      bestDeposit = mid;
      high = mid;
    } else {
      low = mid;
    }
  }

  return Math.ceil(bestDeposit * 1.02);
}

export function findDepositJoint(
  startDate: ISODate,
  payA: PaySchedule,
  payB: PaySchedule,
  bills: Bill[],
  fairnessRatioA: number,
  _baseline: number
): { depositA: number; depositB: number } {
  // Convert pay frequency to number of pay cycles per month
  const cyclesPerMonth = (freq: PaySchedule["frequency"]): number => {
    switch (freq) {
      case "WEEKLY":
        return 52 / 12;
      case "FORTNIGHTLY":
      case "BIWEEKLY":
        return 26 / 12;
      case "FOUR_WEEKLY":
        return 13 / 12;
      default:
        return 1;
    }
  };

  const cyclesA = cyclesPerMonth(payA.frequency);
  const cyclesB = cyclesPerMonth(payB.frequency);

  let monthlyLow = 0;
  let monthlyHigh = 30000;
  let bestResult = { depositA: monthlyHigh, depositB: monthlyHigh };

  // Check if zero deposits work
  const testZero = runJoint(0, 0, startDate, payA, payB, bills, {
    months: 12,
    fairnessRatioA
  });
  if (testZero.minBalance >= 0) return { depositA: 0, depositB: 0 };

  // Binary search on total monthly deposits
  for (let iterations = 0; iterations < 50 && monthlyHigh - monthlyLow > 0.01; iterations++) {
    const monthlyMid = (monthlyLow + monthlyHigh) / 2;
    const perPayA = (monthlyMid * fairnessRatioA) / cyclesA;
    const perPayB = (monthlyMid * (1 - fairnessRatioA)) / cyclesB;

    const result = runJoint(perPayA, perPayB, startDate, payA, payB, bills, {
      months: 12,
      fairnessRatioA
    });

    if (result.minBalance >= 0) {
      bestResult = { depositA: perPayA, depositB: perPayB };
      monthlyHigh = monthlyMid;
    } else {
      monthlyLow = monthlyMid;
    }
  }

  return {
    depositA: Math.ceil(bestResult.depositA * 1.02),
    depositB: Math.ceil(bestResult.depositB * 1.02)
  };
}