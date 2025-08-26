/// <reference lib="webworker" />

import * as Comlink from "comlink";
import type {
  PlanInputs,
  SimResult,
  TimelineEntry,
  Transaction,
  SalaryCandidate,
  RecurringItem,
} from "../types";
import { payDates } from "../lib/dateUtils";
import { detectSalaryCandidates, detectRecurringBillsFromTx } from "../lib/recurring";
import { findDepositSingle, findDepositJoint } from "../services/forecastAdapters";
import { generateBillSuggestions } from "../services/optimizationEngine";

// Minimal non-blocking skeleton.
function simulate(inputs: PlanInputs): SimResult {
  const months = 12;
  const entries: TimelineEntry[] = [];

  // Calculate deposits using ratio-based method
  let optimizedDeposits: { monthlyA: number; monthlyB?: number };

  const allBills = [...(inputs.bills ?? []), ...(inputs.elecPredicted ?? [])];
  const payScheduleA = { frequency: inputs.a.freq.toUpperCase(), anchorDate: inputs.a.firstPayISO } as const;

  if (inputs.b) {
    const payScheduleB = { frequency: inputs.b.freq.toUpperCase(), anchorDate: inputs.b.firstPayISO } as const;
    const fairnessRatio = inputs.fairnessRatio ? inputs.fairnessRatio.a / (inputs.fairnessRatio.a + inputs.fairnessRatio.b) : 0.5;
    const { depositA, depositB } = findDepositJoint(inputs.startISO, payScheduleA, payScheduleB, allBills, fairnessRatio, 0);
    optimizedDeposits = { monthlyA: depositA, monthlyB: depositB };
  } else {
    const depositA = findDepositSingle(inputs.startISO, payScheduleA, allBills, 0);
    optimizedDeposits = { monthlyA: depositA };
  }

  // Inflows: A (using optimized deposits)
  const aPays = payDates(inputs.a.firstPayISO, inputs.a.freq, months).map((d) => ({
    dateISO: d,
    delta: optimizedDeposits.monthlyA,
    label: "Pay A (Optimized)",
    who: "A" as const,
  }));
  entries.push(...aPays);

  // Optional B (using optimized deposits)
  if (inputs.b && optimizedDeposits.monthlyB) {
    const bPays = payDates(inputs.b.firstPayISO, inputs.b.freq, months).map((d) => ({
      dateISO: d,
      delta: optimizedDeposits.monthlyB!,
      label: "Pay B (Optimized)",
      who: "B" as const,
    }));
    entries.push(...bPays);
  }

  // Outflows
  for (const b of inputs.bills ?? []) {
    if (b.dueDateISO) entries.push({ dateISO: b.dueDateISO, delta: -b.amount, label: b.name, who: b.account });
  }
  for (const e of inputs.elecPredicted ?? []) {
    if (e.dueDateISO) entries.push({ dateISO: e.dueDateISO, delta: -e.amount, label: e.name, who: "JOINT" });
  }
  // Pot contributions are handled in income adjustments before forecasting

  entries.sort((a, b) => a.dateISO.localeCompare(b.dateISO));

  let bal = 0;
  let minBal = Infinity;
  for (const it of entries) {
    bal += it.delta;
    if (bal < minBal) minBal = bal;
  }
  const minBalance = Number.isFinite(minBal) ? minBal : 0;

  let billSuggestions: SimResult['billSuggestions'] = [];
  try {
    billSuggestions = generateBillSuggestions(
      inputs,
      { monthlyA: optimizedDeposits.monthlyA, monthlyB: optimizedDeposits.monthlyB },
      minBalance
    );
  } catch (e) {
    // suggestions are optional; ignore failures
  }

  return {
    minBalance,
    endBalance: bal,
    requiredDepositA: optimizedDeposits.monthlyA,
    requiredDepositB: optimizedDeposits.monthlyB,
    entries,
    billSuggestions,
  };
}

function analyzeTransactions(tx: Transaction[]): { salaries: SalaryCandidate[]; recurring: RecurringItem[] } {
  const salaries = detectSalaryCandidates(tx);
    const recurring = detectRecurringBillsFromTx(tx);
    // @ts-expect-error Worker console appears under the "Worker" target in DevTools
    console.log("[simWorker] analyze:", {
    salaries: salaries.slice(0, 3),
    recurring: recurring.slice(0, 8),
  });
  return { salaries, recurring };
}

function ping(): string {
  return "ok";
}

Comlink.expose({ simulate, analyzeTransactions, ping });
