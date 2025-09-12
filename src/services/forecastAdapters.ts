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
  averageAmount?: number;  // optional, per-occur wage amount
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

function monthsBetween(start: ISODate, end: ISODate): number {
  const s = new Date(start);
  const e = new Date(end);
  return (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1;
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
  const cyclesPerMonth = (fq: PaySchedule['frequency']) => fq==='WEEKLY'? (52/12) : (fq==='FORTNIGHTLY'||fq==='BIWEEKLY'? (26/12) : (fq==='FOUR_WEEKLY'? (13/12) : 1));
  const steps = pay.frequency === 'MONTHLY' ? (months + 2) : Math.ceil(months * cyclesPerMonth(pay.frequency)) + 2;
  const payDates: ISODate[] = calculatePayDates(pay.frequency, pay.anchorDate, steps);
  
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
  const cyclesPerMonth = (fq: PaySchedule['frequency']) => fq==='WEEKLY'? (52/12) : (fq==='FORTNIGHTLY'||fq==='BIWEEKLY'? (26/12) : (fq==='FOUR_WEEKLY'? (13/12) : 1));
  const stepsA = payA.frequency === 'MONTHLY' ? (months + 2) : Math.ceil(months * cyclesPerMonth(payA.frequency)) + 2;
  const stepsB = payB.frequency === 'MONTHLY' ? (months + 2) : Math.ceil(months * cyclesPerMonth(payB.frequency)) + 2;
  const payDatesA: ISODate[] = calculatePayDates(payA.frequency, payA.anchorDate, stepsA);
  const payDatesB: ISODate[] = calculatePayDates(payB.frequency, payB.anchorDate, stepsB);

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
  // Step 4: total bill amount across the forecast window
  const total = bills.reduce((sum, bill) => sum + bill.amount, 0);

  // Derive a monthly average from the span of bill due dates. This guards
  // against passing a full year of expanded occurrences (which would otherwise
  // over-count by 12x).
  const firstDue = bills.reduce((min, b) => (b.dueDate < min ? b.dueDate : min), bills[0]?.dueDate ?? startDate);
  const lastDue = bills.reduce((max, b) => (b.dueDate > max ? b.dueDate : max), bills[0]?.dueDate ?? startDate);
  const monthsSpan = monthsBetween(firstDue, lastDue);
  const monthlyBills = monthsSpan > 0 ? total / monthsSpan : total;

  // Step 6: convert monthly share to per-pay deposit
  const cycles =
    pay.frequency === "WEEKLY" ? 52 / 12 :
    pay.frequency === "FORTNIGHTLY" || pay.frequency === "BIWEEKLY" ? 26 / 12 :
    pay.frequency === "FOUR_WEEKLY" ? 13 / 12 : 1;
  let deposit = monthlyBills / cycles;

  // Step 7: ensure timeline never dips below zero
  let result = runSingle(deposit, startDate, pay, bills, { months: 12, buffer: 0 });
  let iterations = 0;
  while (result.minBalance < 0 && iterations < 24) {
    const shortfallPerMonth = -result.minBalance / 12;
    deposit += shortfallPerMonth / cycles;
    result = runSingle(deposit, startDate, pay, bills, { months: 12, buffer: 0 });
    iterations++;
  }

  // Safety margin: ceil to avoid rounding back into negative
  deposit = Math.ceil(deposit);
  result = runSingle(deposit, startDate, pay, bills, { months: 12, buffer: 0 });
  if (result.minBalance < 0) {
    // Incrementally bump until >= 0 (rare after ceil)
    let guard = 0;
    while (result.minBalance < 0 && guard++ < 5) {
      deposit += 1;
      result = runSingle(deposit, startDate, pay, bills, { months: 12, buffer: 0 });
    }
  }

  // Gentle edge ride: shave in small steps while staying >= 0 to reduce snowballing
  let lowered = true; let stepGuard = 0;
  while (lowered && stepGuard++ < 6) {
    const trial = Math.max(0, deposit - 1); // 1€ per-pay nudge
    const r = runSingle(trial, startDate, pay, bills, { months: 12, buffer: 0 });
    if (r.minBalance >= 0) { deposit = trial; result = r; } else { lowered = false; }
  }

  return deposit;
}

export function findDepositJoint(
  startDate: ISODate,
  payA: PaySchedule,
  payB: PaySchedule,
  bills: Bill[],
  fairnessRatioA: number,
  _baseline: number
): { depositA: number; depositB: number } {
  const cycles = (freq: PaySchedule["frequency"]): number => {
    switch (freq) {
      case "WEEKLY": return 52 / 12;
      case "FORTNIGHTLY":
      case "BIWEEKLY": return 26 / 12;
      case "FOUR_WEEKLY": return 13 / 12;
      default: return 1;
    }
  };
  const cyA = cycles(payA.frequency);
  const cyB = cycles(payB.frequency);

  // Horizon window (12 months)
  const endISO = (() => { const d = new Date(startDate + 'T00:00:00'); d.setMonth(d.getMonth()+12); return d.toISOString().slice(0,10); })();

  // Relevant pay dates within [startDate, endISO]
  const payDatesA = calculatePayDates(payA.frequency, payA.anchorDate, 12).filter(d => d >= startDate && d <= endISO);
  const payDatesB = calculatePayDates(payB.frequency, payB.anchorDate, 12).filter(d => d >= startDate && d <= endISO);

  // Relevant bills within [startDate, endISO]
  const billEvents = bills
    .map(b => ({ date: nextBusinessDay(b.dueDate), amount: b.amount }))
    .filter(b => b.date >= startDate && b.date <= endISO);

  // Pre-sum bills by date to avoid repeated scans
  const billsByDate = new Map<string, number>();
  for (const b of billEvents) billsByDate.set(b.date, (billsByDate.get(b.date) || 0) + b.amount);

  // Scan over unique sorted dates; deposits occur before bills on the same date
  const datesSet = new Set<string>([...payDatesA, ...payDatesB, ...billEvents.map(b => b.date)]);
  const dates = Array.from(datesSet).sort();

  let idxA = 0, idxB = 0; // indices into payDates arrays
  let cntA = 0, cntB = 0; // deposits counts up to current date
  let cumBills = 0;       // cumulative bills
  let maxM = 0;           // minimal monthly required

  for (const d of dates) {
    // count deposits on this date (deposits first on tie)
    while (idxA < payDatesA.length && payDatesA[idxA] === d) { cntA++; idxA++; }
    while (idxB < payDatesB.length && payDatesB[idxB] === d) { cntB++; idxB++; }
    const W = (fairnessRatioA * (cntA / cyA)) + ((1 - fairnessRatioA) * (cntB / cyB));

    // add bills on this date
    const add = billsByDate.get(d) || 0;
    cumBills += add;

    if (W > 0 && cumBills > 0) {
      const need = Math.ceil(cumBills / W);
      if (need > maxM) maxM = need;
    }
  }

  let depA = Math.ceil((fairnessRatioA * maxM) / cyA);
  let depB = Math.ceil(((1 - fairnessRatioA) * maxM) / cyB);

  // Verify once; if rounding underfunded, single-shot bump from shortfall
  let check = runJoint(depA, depB, startDate, payA, payB, bills, { months: 12, fairnessRatioA });
  if (check.minBalance < 0) {
    const shortPerMonth = -check.minBalance / 12;
    depA += Math.max(1, Math.ceil((shortPerMonth * fairnessRatioA) / cyA));
    depB += Math.max(0, Math.ceil((shortPerMonth * (1 - fairnessRatioA)) / cyB));
  }

  {
    // Trim monthly to reduce end balance while keeping minBalance >= 0
    const baseMonthlyA = depA * cyA;
    const baseMonthlyB = depB * cyB;
    let lo = 0.8, hi = 1.0;
    let bestA = depA, bestB = depB;
    for (let i = 0; i < 8; i++) {
      const f = (lo + hi) / 2;
      const testA = Math.max(0, Math.floor((baseMonthlyA * f) / cyA));
      const testB = Math.max(0, Math.floor((baseMonthlyB * f) / cyB));
      const r = runJoint(testA, testB, startDate, payA, payB, bills, { months: 12, fairnessRatioA });
      if (r.minBalance >= 0) { hi = f; bestA = testA; bestB = testB; } else { lo = f; }
    }
    depA = bestA; depB = bestB;
  }

  return { depositA: depA, depositB: depB };
}




