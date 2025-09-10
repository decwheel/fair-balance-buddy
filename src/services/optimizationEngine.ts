// Optimization engine inspired by fair-split's approach
import { addDays, parseISO, formatISO } from "date-fns";
import type { PlanInputs, SimResult, Bill, PaySpec, PayFrequency } from "../types";
import { payDates } from "../lib/dateUtils";
import { runSingle as runSingleAcc, runJoint as runJointAcc, findDepositSingle as findDepositSingleAcc, findDepositJoint as findDepositJointAcc } from "./forecastAdapters";

interface OptimizationResult {
  bestStartDate: string;
  optimizedDeposits: {
    monthlyA: number;
    monthlyB?: number;
  };
  scenarios: Array<{
    startDate: string;
    deposits: { monthlyA: number; monthlyB?: number };
    minBalance: number;
    totalDeposits: number;
    score: number;
  }>;
  billSuggestions: Array<{
    billId: string;
    name?: string;
    amount?: number;
    currentDate: string;
    suggestedDate: string;
    savingsAmount: number;
    reason: string;
  }>;
}

// Helper to convert PayFrequency to the format expected by forecast adapters
function mapFrequency(freq: PayFrequency): "WEEKLY" | "FORTNIGHTLY" | "MONTHLY" | "BIWEEKLY" | "FOUR_WEEKLY" {
  switch (freq) {
    case "weekly": return "WEEKLY";
    case "fortnightly": return "FORTNIGHTLY";
    case "four_weekly": return "FOUR_WEEKLY";
    case "monthly":
    default: return "MONTHLY";
  }
}

// Number of pay cycles in an average month for a given frequency
function cyclesPerMonth(freq: "WEEKLY" | "FORTNIGHTLY" | "MONTHLY" | "BIWEEKLY" | "FOUR_WEEKLY"): number {
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
}

/**
 * Generate bill movement suggestions by testing different due dates
 */
export function generateBillSuggestions(
  inputs: PlanInputs,
  currentOptimizedDeposits: { monthlyA: number; monthlyB?: number },
  _currentMinBalance: number
): OptimizationResult['billSuggestions'] {
  // Fair-split–inspired approach adapted to FBB’s data model
  const startISO = inputs.startISO;
  const freqA = mapFrequency(inputs.a.freq);
  const payA: PaySchedule = { frequency: freqA, anchorDate: inputs.a.firstPayISO } as any;
  const hasB = !!inputs.b;
  const freqB = hasB ? mapFrequency(inputs.b!.freq) : undefined;
  const payB: PaySchedule | undefined = hasB ? { frequency: freqB!, anchorDate: inputs.b!.firstPayISO } as any : undefined;
  const fairness = inputs.fairnessRatio ? (inputs.fairnessRatio.a / (inputs.fairnessRatio.a + inputs.fairnessRatio.b)) : 0.5;
  const AWKWARD = /mortgage|rent|loan|car\s*finance|hp\b|tax|insurance/i;

  // Build working bill list for the 12‑month horizon
  type FB = ForecastBill;
  const toWorkBill = (b: Bill): FB => ({
    id: b.id,
    name: b.name,
    amount: b.amount,
    issueDate: (b as any).dueDateISO || (b as any).dueDate || b.issueDate || startISO,
    dueDate: (b as any).dueDateISO || (b as any).dueDate || b.issueDate || startISO,
    source: (b as any).source,
    movable: (b as any).movable
  });
  const allBills: FB[] = [...(inputs.bills || []), ...(inputs.elecPredicted || [])]
    .map(toWorkBill)
    .filter(b => !b.dueDate || b.dueDate >= startISO);

  // Compute required monthly total for a bills override
  function scoreMonthlyTotal(billsOverride: FB[]): { monthlyTotal: number; minBalance: number } {
    if (!hasB) {
      const dep = findDepositSingleAcc(startISO, payA as any, billsOverride, inputs.minBalance);
      const sim = runSingleAcc(dep, startISO, payA as any, billsOverride as any, { months: 12, buffer: 0 });
      const monthlyA = dep * cyclesPerMonth(payA.frequency);
      return { monthlyTotal: monthlyA, minBalance: sim.minBalance };
    }
    const { depositA, depositB } = findDepositJointAcc(startISO, payA as any, payB as any, billsOverride as any, fairness, inputs.minBalance);
    const sim = runJointAcc(
      depositA,
      depositB,
      startISO,
      payA as any,
      payB as any,
      billsOverride as any,
      { months: 12, fairnessRatioA: fairness, weeklyAllowanceA: inputs.weeklyAllowanceA, weeklyAllowanceB: inputs.weeklyAllowanceB }
    );
    const monthlyA = depositA * cyclesPerMonth(payA.frequency);
    const monthlyB = depositB * cyclesPerMonth((payB as any).frequency);
    return { monthlyTotal: monthlyA + monthlyB, minBalance: sim.minBalance };
  }

  const base = scoreMonthlyTotal(allBills);

  // Build baseline timeline with current deposits (accurate sim) to locate the trough and for gating
  const baselineSim = !hasB
    ? runSingleAcc(currentOptimizedDeposits.monthlyA || 0, startISO, payA as any, allBills as any, { months: 12, buffer: 0 })
    : runJointAcc(currentOptimizedDeposits.monthlyA || 0, (currentOptimizedDeposits.monthlyB || 0), startISO, payA as any, payB as any, allBills as any, { months: 12, fairnessRatioA: fairness, weeklyAllowanceA: inputs.weeklyAllowanceA, weeklyAllowanceB: inputs.weeklyAllowanceB });
  let minIdx = 0; let minVal = Infinity;
  baselineSim.timeline.forEach((pt, i) => { if (pt.balance < minVal) { minVal = pt.balance; minIdx = i; } });
  const troughISO = baselineSim.timeline[Math.max(0, minIdx)]?.date || startISO;

  // Gating: only propose suggestions when materially above ideal or clearly overfunded
  function monthlyCost(bills: FB[]): number {
    if (!bills.length) return 0;
    const dues = bills.map(b => b.dueDate).filter(Boolean).sort();
    const first = dues[0] || startISO;
    const last = dues[dues.length - 1] || startISO;
    const total = bills.reduce((s, b) => s + (Number(b.amount) || 0), 0);
    const a = new Date(first); const z = new Date(last);
    const months = (z.getUTCFullYear() - a.getUTCFullYear()) * 12 + (z.getUTCMonth() - a.getUTCMonth()) + 1;
    return months > 0 ? total / months : total;
  }
  const idealMonthly = monthlyCost(allBills);
  const currentMonthly = (() => {
    const a = (currentOptimizedDeposits.monthlyA || 0) * cyclesPerMonth(payA.frequency);
    const b = (currentOptimizedDeposits.monthlyB || 0) * (hasB ? cyclesPerMonth((payB as any).frequency) : 0);
    return a + b;
  })();
  const factor = idealMonthly > 0 ? currentMonthly / idealMonthly : 1;
  const trigger = hasB ? 1.03 : 1.05;
  const overfunded = (baselineSim.endBalance > Math.max(500, 0.75 * idealMonthly)) || (baselineSim.endBalance > currentMonthly);
  console.log('[opt] gating', {
    mode: hasB ? 'joint' : 'single',
    idealMonthly: Math.round(idealMonthly),
    currentMonthly: Math.round(currentMonthly),
    factor: +factor.toFixed(4),
    trigger,
    endBalance: Math.round(baselineSim.endBalance),
    overfunded
  });
  if (!(factor > trigger) && !overfunded) {
    console.log('[opt] no suggestions: already close to ideal and not overfunded');
    return [];
  }

  // Top offenders by summed amount up to trough (movable, non-awkward, non-electricity)
  const offendersMap = new Map<string, { total: number; name?: string }>();
  for (const b of allBills) {
    if (b.source === 'predicted-electricity') continue;
    if (b.movable === false) continue;
    if (b.name && AWKWARD.test(b.name)) continue;
    if (!b.dueDate || b.dueDate > troughISO) continue;
    const key = String(b.id || b.name || `${b.amount}-${b.dueDate}`);
    const cur = offendersMap.get(key) || { total: 0, name: b.name };
    cur.total += Math.abs(b.amount);
    offendersMap.set(key, cur);
  }
  let offenders = Array.from(offendersMap.entries())
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 6)
    .map(([id]) => id);
  if (!offenders.length) {
    // Fallback: look over the first ~6 months from start to seed offenders
    const limitISO = formatISO(addDays(parseISO(startISO), 180), { representation: 'date' });
    for (const b of allBills) {
      if (b.source === 'predicted-electricity') continue;
      if (b.movable === false) continue;
      if (b.name && AWKWARD.test(b.name)) continue;
      if (!b.dueDate || b.dueDate < startISO || b.dueDate > limitISO) continue;
      const key = String(b.id || b.name || `${b.amount}-${b.dueDate}`);
      const cur = offendersMap.get(key) || { total: 0, name: b.name };
      cur.total += Math.abs(b.amount);
      offendersMap.set(key, cur);
    }
    offenders = Array.from(offendersMap.entries())
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 6)
      .map(([id]) => id);
    // If still empty, force-pick the first 3 upcoming bills as offenders
    if (!offenders.length) {
      const upcoming = allBills
        .filter(b => b.dueDate >= startISO && b.source !== 'predicted-electricity' && b.movable !== false && !(b.name && AWKWARD.test(b.name)))
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
        .slice(0, 3)
        .map(b => String(b.id || b.name));
      offenders = Array.from(new Set(upcoming));
    }
  }

  // Anchor DOMs + nearest payday DOM helper
  const ANCHORS = [2, 4, 5, 8, 10, 12, 15, 17, 19, 22, 24, 26, 28, 29];
  const nearestPayDom = (fromISO: string): number | null => {
    const cands: string[] = [];
    const months = 12;
    cands.push(...payDates(inputs.a.firstPayISO, inputs.a.freq, months));
    if (inputs.b) cands.push(...payDates(inputs.b.firstPayISO, inputs.b.freq, months));
    const fromTs = new Date(fromISO).getTime();
    const next = cands.map(d => ({ d, t: new Date(d).getTime() }))
      .filter(x => x.t >= fromTs)
      .sort((x, y) => x.t - y.t)[0]?.d;
    return next ? new Date(next).getDate() : null;
  };
  const toMonthISO = (inISO: string, dom: number): string => {
    const d = new Date(inISO);
    const y = d.getUTCFullYear(); const m = d.getUTCMonth();
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const clamped = Math.max(1, Math.min(dom, last));
    return new Date(Date.UTC(y, m, clamped)).toISOString().slice(0, 10);
  };

  const maxMoves = hasB ? 12 : 8;
  const minGain = 0.00005; // 0.005% — be more eager so users see ideas
  let bestMonthly = base.monthlyTotal;
  const chosen: { billId: string; fromISO: string; toISO: string; deltaMonthly: number }[] = [];
  const moved = new Set<string>();

  for (let step = 0; step < maxMoves; step++) {
    let stepBest: { billId?: string; fromISO?: string; toISO?: string; newMonthly?: number; delta?: number } = {};

    for (const name of offenders) {
      const occs = allBills
        .filter(b => String(b.id || b.name) === name)
        .filter(b => b.dueDate >= startISO)
        .filter(b => b.movable !== false && !(b.name && AWKWARD.test(b.name)))
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      for (const occ of occs) {
        const key = `${occ.id || occ.name}-${occ.dueDate}`;
        if (moved.has(key)) continue;
        const domSet = new Set<number>(hasB ? ANCHORS : [5, 12, 19, 26]);
        const pd = nearestPayDom(occ.dueDate);
        if (pd) domSet.add(pd);
        for (const dom of domSet) {
          const target = toMonthISO(occ.dueDate, dom);
          if (target === occ.dueDate) continue;
          const override = allBills.map(b => (b === occ ? { ...b, dueDate: target } : b));
          const score = scoreMonthlyTotal(override);
          if (score.minBalance < 0) continue;
          if (!stepBest.newMonthly || score.monthlyTotal < stepBest.newMonthly) {
            stepBest = { billId: occ.id || `${occ.name}-${occ.dueDate}`, fromISO: occ.dueDate, toISO: target, newMonthly: score.monthlyTotal, delta: bestMonthly - score.monthlyTotal };
          }
        }
        break; // one occurrence per offender per step
      }
    }

    if (!stepBest.newMonthly) break;
    const gain = (stepBest.delta || 0) / bestMonthly;
    if (gain < 0.0005) break;
    bestMonthly = stepBest.newMonthly!;
    moved.add(stepBest.billId! + '-' + stepBest.fromISO);
    chosen.push({ billId: stepBest.billId!, fromISO: stepBest.fromISO!, toISO: stepBest.toISO!, deltaMonthly: stepBest.delta || 0 });
  }

  // Minimum meaningful monthly saving before we bother the user
  // Convert current per-pay deposits to monthly for a fair comparison
  const baseMonthly = (() => {
    const a = (currentOptimizedDeposits.monthlyA || 0) * cyclesPerMonth(payA.frequency);
    const b = (currentOptimizedDeposits.monthlyB || 0) * (hasB ? cyclesPerMonth((payB as any).frequency) : 0);
    return a + b;
  })();
  const minAbsSave = 5;                // €5/month
  const minRelSave = 0.005;            // 0.5%

  const primary = chosen
    .sort((a, b) => b.deltaMonthly - a.deltaMonthly)
    .slice(0, 6)
    .map(ch => {
      const days = Math.round((new Date(ch.toISO).getTime() - new Date(ch.fromISO).getTime()) / (24*60*60*1000));
      const dir = days > 0 ? 'later' : 'earlier';
      const occ = allBills.find(b => (b.id && (ch.billId.startsWith(String(b.id)) || ch.billId === b.id)) || (b.name && b.name === ch.billId.split('-')[0]));
      return {
        billId: ch.billId,
        name: occ?.name,
        amount: occ?.amount,
        currentDate: ch.fromISO,
        suggestedDate: ch.toISO,
        savingsAmount: Math.max(0, Math.round(ch.deltaMonthly)),
        reason: `Moving ${Math.abs(days)} days ${dir} lowers monthly deposits by about €${Math.max(0, Math.round(ch.deltaMonthly))}`
      };
    })
    // filter out non-meaningful improvements
    .filter(s => s.savingsAmount >= minAbsSave && (baseMonthly > 0 ? (s.savingsAmount / baseMonthly) >= minRelSave : s.savingsAmount >= minAbsSave));

  const totalMonthlySaved = chosen.reduce((s, ch) => s + (ch.deltaMonthly || 0), 0);
  console.log('[opt] suggestions result', {
    chosen: chosen.length,
    savedPerMonth: Math.round(totalMonthlySaved),
    beforeMonthly: Math.round(baseMonthly),
    afterMonthly: Math.round(Math.max(0, baseMonthly - totalMonthlySaved))
  });
  return primary;
}

interface PaySchedule {
  frequency: "WEEKLY" | "FORTNIGHTLY" | "MONTHLY" | "BIWEEKLY" | "FOUR_WEEKLY";
  anchorDate: string;
}

interface ForecastBill {
  id?: string;
  name: string;
  amount: number;
  issueDate: string;
  dueDate: string;
  source?: "manual" | "predicted-electricity" | "imported";
  movable?: boolean;
}

// Simple forecast functions for optimization
function runSingleSimple(
  depositPerCycle: number,
  startDate: string,
  pay: PaySchedule,
  bills: ForecastBill[],
  opts: { baseline: number }
): { minBalance: number; endBalance: number; timeline: Array<{ date: string; balance: number }> } {
  const timeline: Array<{ date: string; balance: number; event?: string }> = [];
  let balance = opts.baseline;
  let minBalance = balance;
  
  // Generate pay dates for 12 months
  const frequency = pay.frequency.toLowerCase() as PayFrequency;
  const payDatesArr = payDates(pay.anchorDate, frequency, 12);
  const firstDeposit = payDatesArr.find(d => d >= startDate) || payDatesArr[0];
  const simStart = firstDeposit;
  
  // Create events
  const events: Array<{ date: string; amount: number; description: string }> = [];
  
  // Add deposits
  payDatesArr.forEach(date => {
    events.push({ date, amount: depositPerCycle, description: `Deposit €${depositPerCycle}` });
  });
  
  // Add bills
  bills.forEach(bill => {
    events.push({ date: bill.dueDate, amount: -bill.amount, description: bill.name });
  });
  
  // Sort and process events
  events.sort((a, b) => a.date.localeCompare(b.date));
  
  timeline.push({ date: simStart, balance });

  events.forEach(event => {
    if (event.date >= simStart) {
      balance += event.amount;
      timeline.push({ date: event.date, balance, event: event.description });
      if (balance < minBalance) minBalance = balance;
    }
  });
  
  return { minBalance, endBalance: balance, timeline };
}

function runJointSimple(
  depositA: number,
  depositB: number,
  startDate: string,
  payA: PaySchedule,
  payB: PaySchedule,
  bills: ForecastBill[],
  opts: { baseline: number }
): { minBalance: number; endBalance: number; timeline: Array<{ date: string; balance: number }> } {
  const timeline: Array<{ date: string; balance: number; event?: string }> = [];
  let balance = opts.baseline;
  let minBalance = balance;
  
  // Generate pay dates
  const freqA = payA.frequency.toLowerCase() as PayFrequency;
  const freqB = payB.frequency.toLowerCase() as PayFrequency;
  const payDatesA = payDates(payA.anchorDate, freqA, 12);
  const payDatesB = payDates(payB.anchorDate, freqB, 12);
  const firstA = payDatesA.find(d => d >= startDate) || payDatesA[0];
  const firstB = payDatesB.find(d => d >= startDate) || payDatesB[0];
  const simStart = firstA < firstB ? firstA : firstB;
  
  // Create events
  const events: Array<{ date: string; amount: number; description: string }> = [];
  
  // Add A's deposits
  payDatesA.forEach(date => {
    events.push({ date, amount: depositA, description: `A Deposit €${depositA}` });
  });
  
  // Add B's deposits  
  payDatesB.forEach(date => {
    events.push({ date, amount: depositB, description: `B Deposit €${depositB}` });
  });
  
  // Add bills
  bills.forEach(bill => {
    events.push({ date: bill.dueDate, amount: -bill.amount, description: bill.name });
  });
  
  // Sort and process events
  events.sort((a, b) => a.date.localeCompare(b.date));
  
  timeline.push({ date: simStart, balance });

  events.forEach(event => {
    if (event.date >= simStart) {
      balance += event.amount;
      timeline.push({ date: event.date, balance, event: event.description });
      if (balance < minBalance) minBalance = balance;
    }
  });
  
  return { minBalance, endBalance: balance, timeline };
}

/**
 * Find optimal start date by testing multiple scenarios
 */
export function findOptimalStartDate(inputs: PlanInputs): OptimizationResult {
  const startISO = inputs.startISO;
  const testDates: string[] = [];
  
  // Test start dates: next 8 weeks
  const baseDate = parseISO(startISO);
  for (let i = 0; i < 56; i += 7) { // Weekly increments for 8 weeks
    testDates.push(formatISO(addDays(baseDate, i), { representation: "date" }));
  }
  
  const scenarios: OptimizationResult['scenarios'] = [];
  
  for (const testDate of testDates) {
    try {
      if (inputs.mode === "single") {
        const payScheduleA: PaySchedule = {
          frequency: mapFrequency(inputs.a.freq),
          anchorDate: inputs.a.firstPayISO
        };
        
        const bills: ForecastBill[] = [...inputs.bills, ...inputs.elecPredicted].map(bill => ({
          id: bill.id,
          name: bill.name,
          amount: bill.amount,
          issueDate: bill.dueDateISO || testDate,
          dueDate: bill.dueDateISO || testDate,
          source: "manual" as const,
          movable: true
        }));
        
        const payDatesA = payDates(payScheduleA.anchorDate, inputs.a.freq, 12);
        const alignedStart = payDatesA.find(d => d >= testDate) || payDatesA[0];

        const optimalDeposit = findDepositSingleSimple(alignedStart, payScheduleA, bills, inputs.minBalance);
        const result = runSingleSimple(optimalDeposit, alignedStart, payScheduleA, bills, { baseline: inputs.minBalance });

        const monthlyDeposit = optimalDeposit * cyclesPerMonth(payScheduleA.frequency);

        scenarios.push({
          startDate: alignedStart,
          deposits: { monthlyA: optimalDeposit }, // per-pay deposit
          minBalance: result.minBalance,
          totalDeposits: monthlyDeposit,
          score: calculateScore(monthlyDeposit, result.minBalance, result.endBalance)
        });
        
      } else if (inputs.mode === "joint" && inputs.b) {
        const payScheduleA: PaySchedule = {
          frequency: mapFrequency(inputs.a.freq),
          anchorDate: inputs.a.firstPayISO
        };
        
        const payScheduleB: PaySchedule = {
          frequency: mapFrequency(inputs.b.freq),
          anchorDate: inputs.b.firstPayISO
        };
        
        const bills: ForecastBill[] = [...inputs.bills, ...inputs.elecPredicted].map(bill => ({
          id: bill.id,
          name: bill.name,
          amount: bill.amount,
          issueDate: bill.dueDateISO || testDate,
          dueDate: bill.dueDateISO || testDate,
          source: "manual" as const,
          movable: true
        }));
        
        const fairness = inputs.fairnessRatio
          ? inputs.fairnessRatio.a / (inputs.fairnessRatio.a + inputs.fairnessRatio.b)
          : 0.5;
          
        const payDatesA = payDates(payScheduleA.anchorDate, inputs.a.freq, 12);
        const payDatesB = payDates(payScheduleB.anchorDate, inputs.b.freq, 12);
        const firstA = payDatesA.find(d => d >= testDate) || payDatesA[0];
        const firstB = payDatesB.find(d => d >= testDate) || payDatesB[0];
        const alignedStart = firstA < firstB ? firstA : firstB;

        const { depositA, depositB } = findDepositJointSimple(
          alignedStart,
          payScheduleA,
          payScheduleB,
          bills,
          fairness,
          inputs.minBalance
        );

        const result = runJointSimple(
          depositA,
          depositB,
          alignedStart,
          payScheduleA,
          payScheduleB,
          bills,
          { baseline: inputs.minBalance }
        );

        const monthlyA = depositA * cyclesPerMonth(payScheduleA.frequency);
        const monthlyB = depositB * cyclesPerMonth(payScheduleB.frequency);

        scenarios.push({
          startDate: alignedStart,
          deposits: { monthlyA: depositA, monthlyB: depositB }, // per-pay deposits
          minBalance: result.minBalance,
          totalDeposits: monthlyA + monthlyB,
          score: calculateScore(monthlyA + monthlyB, result.minBalance, result.endBalance)
        });
      }
    } catch (error) {
      // Skip failed scenarios
      console.warn(`Failed to calculate scenario for ${testDate}:`, error);
    }
  }
  
  // Find best scenario (lowest total deposits while maintaining positive balance)
  const validScenarios = scenarios.filter(s => s.minBalance >= 0);
  const bestScenario = validScenarios.length > 0 ? 
    validScenarios.reduce((best, current) => current.score > best.score ? current : best, validScenarios[0]) :
    scenarios[0]; // Fallback if no valid scenarios
  
  // Generate bill movement suggestions
  const billSuggestions = bestScenario ? 
    generateBillSuggestions(inputs, bestScenario.deposits, bestScenario.minBalance) : 
    [];

  return {
    bestStartDate: bestScenario?.startDate || startISO,
    optimizedDeposits: bestScenario?.deposits || { monthlyA: inputs.a.netMonthly },
    scenarios: scenarios.sort((a, b) => b.score - a.score),
    billSuggestions
  };
}

function findDepositSingleSimple(
  startDate: string,
  paySchedule: PaySchedule, 
  bills: ForecastBill[],
  baseline: number
): number {
  let low = 0;
  let high = 20000;
  let bestDeposit = high;
  
  // Check if zero deposit works
  const testZero = runSingleSimple(0, startDate, paySchedule, bills, { baseline });
  if (testZero.minBalance >= 0) return 0;
  
  // Binary search
  for (let iterations = 0; iterations < 50 && high - low > 0.01; iterations++) {
    const mid = (low + high) / 2;
    const result = runSingleSimple(mid, startDate, paySchedule, bills, { baseline });
    
    if (result.minBalance >= 0) {
      bestDeposit = mid;
      high = mid;
    } else {
      low = mid;
    }
  }
  
  return Math.ceil(bestDeposit * 1.02); // Add 2% buffer
}

function findDepositJointSimple(
  startDate: string,
  payA: PaySchedule,
  payB: PaySchedule,
  bills: ForecastBill[],
  fairnessRatio: number,
  baseline: number
): { depositA: number; depositB: number } {
  const cyclesA = cyclesPerMonth(payA.frequency);
  const cyclesB = cyclesPerMonth(payB.frequency);

  let monthlyLow = 0;
  let monthlyHigh = 30000;
  let bestResult = { depositA: monthlyHigh, depositB: monthlyHigh };

  // Check if zero deposits work
  const testZero = runJointSimple(0, 0, startDate, payA, payB, bills, { baseline });
  if (testZero.minBalance >= 0) return { depositA: 0, depositB: 0 };

  // Binary search on total monthly deposits
  for (let iterations = 0; iterations < 50 && monthlyHigh - monthlyLow > 0.01; iterations++) {
    const monthlyMid = (monthlyLow + monthlyHigh) / 2;
    const perPayA = (monthlyMid * fairnessRatio) / cyclesA;
    const perPayB = (monthlyMid * (1 - fairnessRatio)) / cyclesB;

    const result = runJointSimple(perPayA, perPayB, startDate, payA, payB, bills, { baseline });

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

/**
 * Calculate optimization score (higher = better)
 * Prioritizes: 1) Positive balance, 2) Lower deposits, 3) Reasonable end balance
 */
function calculateScore(totalDeposits: number, minBalance: number, endBalance: number): number {
  if (minBalance < 0) return -1000; // Penalize negative balances heavily
  
  // Prefer lower deposits
  const depositScore = Math.max(0, 2000 - totalDeposits) / 2000;
  
  // Prefer reasonable end balance (not too high surplus)
  const endBalanceScore = endBalance > 5000 
    ? Math.max(0, 1 - (endBalance - 5000) / 10000) // Penalize high surpluses
    : 1;
  
  // Prefer higher minimum balance (safety buffer)
  const minBalanceScore = Math.min(1, minBalance / 1000);
  
  return (depositScore * 0.5) + (endBalanceScore * 0.3) + (minBalanceScore * 0.2);
}
