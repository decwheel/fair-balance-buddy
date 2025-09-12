/// <reference lib="webworker" />

import * as Comlink from "comlink";
import type {
  PlanInputs,
  SimResult,
  Transaction,
  SalaryCandidate,
  RecurringItem,
} from "../types";
import { detectSalaryCandidates, detectRecurringBillsFromTx } from "../lib/recurring";
import { runSingle, runJoint } from "../services/forecastAdapters";
import { optimizeDeposits } from "../services/fairSplitEngine";
import { generateBillSuggestions } from "../services/optimizationEngine";

// Minimal non-blocking skeleton.
function simulate(inputs: PlanInputs, opts?: { includeSuggestions?: boolean }): SimResult {
  const includeSuggestions = !!(opts?.includeSuggestions);
  const allBillsRaw = [...(inputs.bills ?? []), ...(inputs.elecPredicted ?? [])];
  const allBills = allBillsRaw
    .filter(b => {
      const due = (b as any).dueDateISO || (b as any).dueDate || (b as any).issueDate;
      return !due || due >= inputs.startISO;
    })
    .map(b => ({
      ...b,
      issueDate: (b as any).issueDate || (b as any).dueDateISO || (b as any).dueDate || inputs.startISO,
      dueDate: (b as any).dueDateISO || (b as any).dueDate || (b as any).issueDate || inputs.startISO,
      source: (b as any).source === 'electricity' ? 'predicted-electricity' as const : (b as any).source
    }));
  const payScheduleA = { 
    frequency: inputs.a.freq.toUpperCase().replace('FORTNIGHTLY', 'BIWEEKLY') as 'WEEKLY' | 'BIWEEKLY' | 'FOUR_WEEKLY' | 'MONTHLY', 
    anchorDate: inputs.a.firstPayISO 
  };

  if (inputs.b) {
    const payScheduleB = { 
      frequency: inputs.b.freq.toUpperCase().replace('FORTNIGHTLY', 'BIWEEKLY') as 'WEEKLY' | 'BIWEEKLY' | 'FOUR_WEEKLY' | 'MONTHLY', 
      anchorDate: inputs.b.firstPayISO 
    };

    // Use fair-split–style optimizer to choose start date and per-pay deposits
    const pick = optimizeDeposits(inputs);

    // Compute fairness ratio based on detected net monthly incomes (match optimizer)
    const monthlyA = inputs.a.netMonthly;
    const monthlyB = inputs.b?.netMonthly || 0;
    const fairnessA = (monthlyA + monthlyB) > 0 ? (monthlyA / (monthlyA + monthlyB)) : 0.5;

    const result = runJoint(
      pick.depositA,
      pick.depositB || 0,
      pick.startISO,
      payScheduleA,
      payScheduleB,
      allBills,
      { months: 12, fairnessRatioA: fairnessA, initialBalance: inputs.initialBalance ?? 0 }
    );

    let billSuggestions: SimResult['billSuggestions'] = [];
    if (includeSuggestions) {
      try {
        billSuggestions = generateBillSuggestions(
          inputs,
          { monthlyA: pick.depositA, monthlyB: pick.depositB || 0 },
          result.minBalance
        );
        // Debug: surface count to main console via postMessage
        try { console.log('[simWorker] suggestions (joint):', billSuggestions?.length ?? 0); } catch {}
      } catch (e) {
        // suggestions optional
      }
    }

    return {
      minBalance: result.minBalance,
      endBalance: result.endBalance,
      requiredDepositA: pick.depositA,
      requiredDepositB: pick.depositB || 0,
      startISO: pick.startISO,
      entries: result.timeline.map(t => ({ dateISO: t.date, delta: 0, label: t.event || '', who: 'JOINT' as const })),
      billSuggestions,
    };
  } else {
    const pick = optimizeDeposits(inputs);
    const result = runSingle(pick.depositA, pick.startISO, payScheduleA, allBills, { months: 12, buffer: 0, initialBalance: inputs.initialBalance ?? 0 });

    let billSuggestions: SimResult['billSuggestions'] = [];
    if (includeSuggestions) {
      try {
        billSuggestions = generateBillSuggestions(
          inputs,
          { monthlyA: pick.depositA },
          result.minBalance
        );
        try { console.log('[simWorker] suggestions (single):', billSuggestions?.length ?? 0); } catch {}
      } catch (e) {
        // ignore
      }
    }

    return {
      minBalance: result.minBalance,
      endBalance: result.endBalance,
      requiredDepositA: pick.depositA,
      startISO: pick.startISO,
      entries: result.timeline.map(t => ({ dateISO: t.date, delta: 0, label: t.event || '', who: 'A' as const })),
      billSuggestions,
    };
  }
}

function analyzeTransactions(tx: Transaction[]): { salaries: SalaryCandidate[]; recurring: RecurringItem[] } {
  const salaries = detectSalaryCandidates(tx);
    const recurring = detectRecurringBillsFromTx(tx);
    console.log("[simWorker] analyze:", {
    salaries: salaries.slice(0, 3),
    recurring: recurring.slice(0, 8),
  });
  return { salaries, recurring };
}

function ping(): string {
  return "ok";
}

// Run gating/suggestions in the worker using caller-provided per-pay deposits (so logs
// reflect trimmed deposits seen in the UI). Returns number of suggestions (optional).
function explainGating(
  inputs: PlanInputs,
  deposits: { a: number; b?: number },
  currentMin = 0
): number {
  try {
    const res = generateBillSuggestions(
      inputs,
      { monthlyA: deposits.a, monthlyB: deposits.b },
      currentMin
    );
    return Array.isArray(res) ? res.length : 0;
  } catch {
    return 0;
  }
}

Comlink.expose({ simulate, analyzeTransactions, explainGating, ping });
