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
function simulate(inputs: PlanInputs): SimResult {
  const allBillsRaw = [...(inputs.bills ?? []), ...(inputs.elecPredicted ?? [])];
  const allBills = allBillsRaw.filter(b => !b.dueDateISO || b.dueDateISO >= inputs.startISO).map(b => ({
    ...b,
    issueDate: b.dueDateISO || b.dueDate || inputs.startISO,
    dueDate: b.dueDateISO || b.dueDate || inputs.startISO,
    source: b.source === 'electricity' ? 'predicted-electricity' as const : b.source
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

    const result = runJoint(
      pick.depositA,
      pick.depositB || 0,
      pick.startISO,
      payScheduleA,
      payScheduleB,
      allBills,
      { months: 12, fairnessRatioA: 0.5 }
    );

    let billSuggestions: SimResult['billSuggestions'] = [];
    try {
      billSuggestions = generateBillSuggestions(
        inputs,
        { monthlyA: pick.depositA, monthlyB: pick.depositB || 0 },
        result.minBalance
      );
    } catch (e) {
      // suggestions optional
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
    const result = runSingle(pick.depositA, pick.startISO, payScheduleA, allBills, { months: 12, buffer: 0 });

    let billSuggestions: SimResult['billSuggestions'] = [];
    try {
      billSuggestions = generateBillSuggestions(
        inputs,
        { monthlyA: pick.depositA },
        result.minBalance
      );
    } catch (e) {
      // ignore
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

Comlink.expose({ simulate, analyzeTransactions, ping });
