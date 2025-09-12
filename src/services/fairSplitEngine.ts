import { formatISO, parseISO, addMonths, addDays } from "date-fns";
import type { PlanInputs, PayFrequency } from "../types";
import { payDates } from "../lib/dateUtils";
import { runSingle, runJoint } from "./forecastAdapters";

type StartPick = { startISO: string; depositA: number; depositB?: number };

function cyclesPerMonth(freq: PayFrequency | "WEEKLY" | "FORTNIGHTLY" | "MONTHLY" | "BIWEEKLY" | "FOUR_WEEKLY"): number {
  switch (freq) {
    case "weekly":
    case "WEEKLY":
      return 52 / 12;
    case "fortnightly":
    case "FORTNIGHTLY":
    case "BIWEEKLY":
      return 26 / 12;
    case "four_weekly":
    case "FOUR_WEEKLY":
      return 13 / 12;
    case "monthly":
    case "MONTHLY":
    default:
      return 1;
  }
}

function toUpperFreq(freq: PayFrequency): "WEEKLY" | "FORTNIGHTLY" | "FOUR_WEEKLY" | "MONTHLY" | "BIWEEKLY" {
  if (freq === "weekly") return "WEEKLY";
  if (freq === "fortnightly") return "FORTNIGHTLY";
  if (freq === "four_weekly") return "FOUR_WEEKLY";
  return "MONTHLY";
}

function firstOnOrAfter(dates: string[], refISO: string): string | null {
  const ref = parseISO(refISO).getTime();
  const found = dates.find(d => parseISO(d).getTime() >= ref);
  return found || null;
}

function startCandidates(anchorISO: string, freq: PayFrequency, fromISO: string, months = 18): string[] {
  const dsAll = payDates(anchorISO, freq, months);
  const ds = dsAll.filter(d => d >= fromISO);
  if (!ds.length) return dsAll.slice(0, 2);

  switch (freq) {
    case 'weekly':
      {
        const out = ds.slice(0, 4); // next 4 Fridays-like
        console.log('[opt] weekly start candidates', out);
        return out;
      }
    case 'fortnightly':
      {
        const out = ds.slice(0, 3); // next 3 fortnights (gives 25th, 9th, 23rd style)
        console.log('[opt] fortnightly start candidates', out);
        return out;
      }
    case 'four_weekly':
      {
        const out = ds.slice(0, 2);
        console.log('[opt] four_weekly start candidates', out);
        return out;
      }
    case 'monthly':
    default: {
      // Include the very next monthly payday (e.g., 2025-10-01) and the following one
      const first = ds[0];
      const next = ds[1] || firstOnOrAfter(dsAll, formatISO(addMonths(parseISO(first), 1), { representation: 'date' })) || first;
      const out = Array.from(new Set([first, next])).filter(Boolean) as string[];
      // Optionally include one more month ahead to offer alternatives (e.g., bank holiday shifts)
      const afterNext = firstOnOrAfter(dsAll, formatISO(addMonths(parseISO(next), 1), { representation: 'date' }));
      if (afterNext) out.push(afterNext);
      console.log('[opt] monthly start candidates', out);
      return out;
    }
  }
}

function sumBillsMonthly(bills: { amount: number; issueDate?: string; dueDate?: string; dueDateISO?: string }[]): number {
  if (!bills.length) return 0;
  const due = (b: any) => b.dueDate || b.dueDateISO || b.issueDate;
  const valid = bills.filter(b => due(b));
  if (!valid.length) return 0;
  const total = valid.reduce((s, b) => s + (Number(b.amount) || 0), 0);
  const first = valid.map(due).sort()[0];
  const last = valid.map(due).sort().slice(-1)[0];
  const a = parseISO(first), b = parseISO(last);
  const months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1;
  return months > 0 ? total / months : total;
}

export function optimizeDeposits(inputs: PlanInputs): StartPick {
  const months = 12;
  const bills = [...(inputs.bills || []), ...(inputs.elecPredicted || [])].map((b) => ({
    id: b.id,
    name: b.name,
    amount: b.amount,
    issueDate: (b as any).issueDate || b.dueDateISO || b.dueDate || inputs.startISO,
    dueDate: b.dueDateISO || b.dueDate || inputs.startISO,
    source: b.source as any,
  }));

  const minBalance = inputs.minBalance ?? 0;

  // SINGLE MODE (A only)
  if (!inputs.b || inputs.mode === "single") {
    const freqA = inputs.a.freq;
    const scheduleA = { frequency: toUpperFreq(freqA), anchorDate: inputs.a.firstPayISO } as const;

    // Monthly budget available for Joint after allowance + named savings (A only)
    const monthlyA = inputs.a.netMonthly;
    const allowA = (inputs.weeklyAllowanceA || 0) * (52 / 12);
    const sumSavingsA = (inputs.pots || []).filter(p => p.owner === "A").reduce((s, p) => s + (p.monthly || 0), 0);
    const maxBudgetA = Math.max(monthlyA - allowA - sumSavingsA, 0);

    const candidates = startCandidates(scheduleA.anchorDate, freqA, inputs.startISO);

    let best: StartPick | null = null;
    for (const startISO of candidates) {
      // Binary search on monthly Joint contribution D ∈ [0, maxBudgetA]
      let lo = 0, hi = Math.max(maxBudgetA, 0);

      // If even full budget fails, expand upper bound conservatively to find a feasible D
      const cycles = cyclesPerMonth(scheduleA.frequency);
      function feasible(D: number): boolean {
        const perPay = D / cycles;
        const res = runSingle(perPay, startISO, scheduleA, bills, { months, buffer: 0 });
        return res.minBalance >= minBalance;
      }
      if (!feasible(hi)) {
        let grow = Math.max(hi, 1);
        let tries = 0;
        while (tries++ < 10 && !feasible(grow)) grow *= 1.5;
        hi = grow;
      }

      let bestD = hi;
      while (hi - lo > 0.1) {
        const mid = (lo + hi) / 2;
        if (feasible(mid)) { bestD = mid; hi = mid; } else { lo = mid; }
      }
      // Ride the zero edge: binary search already finds a feasible minimum.
      // Add a gentle scale-down thereafter to shave surplus while maintaining min >= 0.
      let perPay = bestD / cycles;
      let res = runSingle(perPay, startISO, scheduleA, bills, { months, buffer: 0 });
      for (let i = 0; i < 16; i++) {
        const trial = perPay * 0.98;
        const r = runSingle(trial, startISO, scheduleA, bills, { months, buffer: 0 });
        if (r.minBalance >= minBalance) { perPay = trial; res = r; } else { break; }
      }
      const pick = { startISO, depositA: +perPay.toFixed(2) };
      if (!best) best = pick;
      else {
        const bestMonthly = best.depositA * cyclesPerMonth(scheduleA.frequency);
        const curMonthly = pick.depositA * cyclesPerMonth(scheduleA.frequency);
        if (curMonthly < bestMonthly) best = pick;
      }
    }
    return best || { startISO: inputs.startISO, depositA: 0 };
  }

  // JOINT MODE (A + B)
  const freqA = inputs.a.freq;
  const freqB = inputs.b!.freq;
  const scheduleA = { frequency: toUpperFreq(freqA), anchorDate: inputs.a.firstPayISO } as const;
  const scheduleB = { frequency: toUpperFreq(freqB), anchorDate: inputs.b!.firstPayISO } as const;

  // Fairness ratio (match fair-split): split ideal by gross monthly incomes (pre-allowance)
  const monthlyA = inputs.a.netMonthly;
  const monthlyB = inputs.b!.netMonthly;
  const totalIncome = monthlyA + monthlyB;
  const fairnessA = totalIncome > 0 ? monthlyA / totalIncome : 0.5;

  // Estimate total monthly Joint need from one-off bills spread across months
  const monthlyBills = sumBillsMonthly(bills);
  const idealMonthlyA = monthlyBills * fairnessA;
  const idealMonthlyB = monthlyBills * (1 - fairnessA);

  // Helper simulators using runJoint
  function feasibleAB(monthlyA0: number, monthlyB0: number, startISO: string) {
    const perPayA = monthlyA0 / cyclesPerMonth(scheduleA.frequency);
    const perPayB = monthlyB0 / cyclesPerMonth(scheduleB.frequency);
    const res = runJoint(perPayA, perPayB, startISO, scheduleA, scheduleB, bills, { months, fairnessRatioA: fairnessA });
    return { ok: res.minBalance >= minBalance, min: res.minBalance, perPayA, perPayB };
  }

  function scaleDown(startISO: string, mA: number, mB: number) {
    let lo = 0.5, hi = 1.0;
    let best = { f: 1, perPayA: mA, perPayB: mB, min: Number.POSITIVE_INFINITY };
    while (hi - lo > 0.001) {
      const f = (lo + hi) / 2;
      const test = feasibleAB(mA * f, mB * f, startISO);
      if (test.ok) { best = { f, perPayA: test.perPayA, perPayB: test.perPayB, min: test.min }; hi = f; } else { lo = f; }
    }
    return best;
  }

  function scaleUp(startISO: string, mA: number, mB: number) {
    let lo = 1.0, hi = 2.0;
    // expand until feasible
    while (!feasibleAB(mA * hi, mB * hi, startISO).ok && hi < 10) hi *= 1.5;
    let best = { f: hi, perPayA: 0, perPayB: 0, min: Number.NEGATIVE_INFINITY };
    while (hi - lo > 0.001) {
      const mid = (lo + hi) / 2;
      const test = feasibleAB(mA * mid, mB * mid, startISO);
      if (test.ok) { best = { f: mid, perPayA: test.perPayA, perPayB: test.perPayB, min: test.min }; hi = mid; } else { lo = mid; }
    }
    return best;
  }

  // Candidate starts: earliest next A and earliest next B
  const candA = startCandidates(scheduleA.anchorDate, freqA, inputs.startISO);
  const candB = startCandidates(scheduleB.anchorDate, freqB, inputs.startISO);
  const tryStarts = Array.from(new Set([...candA, ...candB]))
    .sort((a, b) => parseISO(a).getTime() - parseISO(b).getTime())
    .slice(0, 6);
  console.log('[opt] tryStarts (merged)', tryStarts);

  let best: (StartPick & { _monthlyTotal: number; _endDist: number }) | null = null;
  for (const s of tryStarts) {
    const pure = feasibleAB(idealMonthlyA, idealMonthlyB, s);
    const scaled = pure.ok ? scaleDown(s, idealMonthlyA, idealMonthlyB) : scaleUp(s, idealMonthlyA, idealMonthlyB);
    const pick = { startISO: s, depositA: +scaled.perPayA.toFixed(2), depositB: +scaled.perPayB.toFixed(2) };
    // Evaluate end balance for tie-breaker vs opening balance
    const sim = runJoint(pick.depositA, pick.depositB || 0, s, scheduleA, scheduleB, bills, { months, fairnessRatioA: fairnessA });
    const monthlyTotal = pick.depositA * cyclesPerMonth(scheduleA.frequency) + (pick.depositB || 0) * cyclesPerMonth(scheduleB.frequency);
    const endDist = Math.abs((sim.endBalance || 0) - (inputs.initialBalance ?? 0));
    const cur = { ...pick, _monthlyTotal: monthlyTotal, _endDist: endDist };
    if (!best) best = cur;
    else {
      const betterMonthly = cur._monthlyTotal + 1e-6 < best._monthlyTotal; // prefer lower monthly
      const nearMonthly = Math.abs(cur._monthlyTotal - best._monthlyTotal) <= 15 || (best._monthlyTotal > 0 && Math.abs(cur._monthlyTotal - best._monthlyTotal) / best._monthlyTotal <= 0.01);
      if (betterMonthly) best = cur;
      else if (nearMonthly && cur._endDist < best._endDist) best = cur; // tie-break toward end closer to opening
    }
  }

  // Final guarantee: ensure minBalance >= minBalance by small top-up if rounding shaved too much
  if (best) {
    const fairnessA = totalIncome > 0 ? monthlyA / totalIncome : 0.5;
    const cyclesA = cyclesPerMonth(scheduleA.frequency);
    const cyclesB = cyclesPerMonth(scheduleB.frequency);
    let depA = Math.max(0, Math.floor(best.depositA)); // integers for stability
    let depB = Math.max(0, Math.floor(best.depositB || 0));
    let check = runJoint(depA, depB, best.startISO, scheduleA, scheduleB, bills, { months, fairnessRatioA: fairnessA });
    let guards = 0;
    while (check.minBalance < minBalance && guards++ < 12) {
      const shortPerMonth = Math.max(1, Math.ceil((minBalance - check.minBalance) / 12));
      const bumpA = Math.max(1, Math.ceil((shortPerMonth * fairnessA) / cyclesA));
      const bumpB = Math.max(0, Math.ceil((shortPerMonth * (1 - fairnessA)) / cyclesB));
      depA += bumpA; depB += bumpB;
      check = runJoint(depA, depB, best.startISO, scheduleA, scheduleB, bills, { months, fairnessRatioA: fairnessA });
    }
    best = { startISO: best.startISO, depositA: depA, depositB: depB, _monthlyTotal: best._monthlyTotal, _endDist: best._endDist } as any;
  }

  console.log('[opt] chosen start & deposits', best);
  return best ? { startISO: best.startISO, depositA: best.depositA, depositB: best.depositB } : { startISO: inputs.startISO, depositA: +(idealMonthlyA / cyclesPerMonth(scheduleA.frequency)).toFixed(2), depositB: +(idealMonthlyB / cyclesPerMonth(scheduleB.frequency)).toFixed(2) };
}
