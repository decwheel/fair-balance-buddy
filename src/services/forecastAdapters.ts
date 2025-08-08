import { calculatePayDates, nextBusinessDay, roundCurrency } from "@/utils/dateUtils";
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
const tol = 0.50; // euros
const maxIter = 40;
const loFactor = 0.5;
const hiFactor = 3.0;

export function findDepositSingle(
  startDate: ISODate,
  pay: PaySchedule,
  bills: Bill[],
  baseline: number
): number {
  let f_lo = loFactor;
  let f_hi = hiFactor;
  
  // Expand upper bound if needed
  for (let i = 0; i < 5; i++) {
    const dep = baseline * f_hi;
    const res = runSingle(dep, startDate, pay, bills, { months: 12, buffer: 0 });
    if (res.minBalance >= 0) break;
    f_hi *= 2;
  }
  
  let best = { deposit: baseline * f_hi, minBalance: Infinity };
  
  // Binary search
  for (let it = 0; it < maxIter; it++) {
    const f_mid = 0.5 * (f_lo + f_hi);
    const dep = baseline * f_mid;
    const res = runSingle(dep, startDate, pay, bills, { months: 12, buffer: 0 });
    
    if (res.minBalance >= 0) {
      best = { deposit: dep, minBalance: res.minBalance };
      f_hi = f_mid;
    } else {
      f_lo = f_mid;
    }
    
    if ((f_hi - f_lo) * baseline < tol) break;
  }
  
  return roundCurrency(best.deposit);
}

export function findDepositJoint(
  startDate: ISODate,
  payA: PaySchedule,
  payB: PaySchedule,
  bills: Bill[],
  fairnessRatioA: number,
  baseline: number
): { depositA: number; depositB: number } {
  let f_lo = loFactor;
  let f_hi = hiFactor;
  
  // Expand upper bound if needed
  for (let i = 0; i < 5; i++) {
    const jointDep = baseline * f_hi;
    const depA = jointDep * fairnessRatioA;
    const depB = jointDep * (1 - fairnessRatioA);
    const res = runJoint(depA, depB, startDate, payA, payB, bills, { 
      months: 12, 
      fairnessRatioA 
    });
    if (res.minBalance >= 0) break;
    f_hi *= 2;
  }
  
  let best = { jointDeposit: baseline * f_hi, minBalance: Infinity };
  
  // Binary search
  for (let it = 0; it < maxIter; it++) {
    const f_mid = 0.5 * (f_lo + f_hi);
    const jointDep = baseline * f_mid;
    const depA = jointDep * fairnessRatioA;
    const depB = jointDep * (1 - fairnessRatioA);
    const res = runJoint(depA, depB, startDate, payA, payB, bills, { 
      months: 12, 
      fairnessRatioA 
    });
    
    if (res.minBalance >= 0) {
      best = { jointDeposit: jointDep, minBalance: res.minBalance };
      f_hi = f_mid;
    } else {
      f_lo = f_mid;
    }
    
    if ((f_hi - f_lo) * baseline < tol) break;
  }
  
  return {
    depositA: roundCurrency(best.jointDeposit * fairnessRatioA),
    depositB: roundCurrency(best.jointDeposit * (1 - fairnessRatioA))
  };
}