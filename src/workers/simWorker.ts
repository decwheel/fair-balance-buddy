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
import { findDepositSingle, findDepositJoint, runSingle, runJoint } from "../services/forecastAdapters";
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

    const monthlyA = inputs.a.netMonthly;
    const monthlyB = inputs.b.netMonthly;
    const allowanceA = (inputs.weeklyAllowanceA ?? 0) * 52 / 12;
    const allowanceB = (inputs.weeklyAllowanceB ?? 0) * 52 / 12;
    const prelim = monthlyA + monthlyB > 0 ? monthlyA / (monthlyA + monthlyB) : 0.5;
    const sumA = (inputs.pots ?? []).filter(p => p.owner === 'A').reduce((s,p)=>s+p.monthly,0);
    const sumB = (inputs.pots ?? []).filter(p => p.owner === 'B').reduce((s,p)=>s+p.monthly,0);
    const sumJ = (inputs.pots ?? []).filter(p => p.owner === 'JOINT').reduce((s,p)=>s+p.monthly,0);
    const jointShareA = sumJ * prelim;
    const jointShareB = sumJ * (1 - prelim);
    const effA = monthlyA - allowanceA - sumA - jointShareA;
    const effB = monthlyB - allowanceB - sumB - jointShareB;
    const fairnessRatioA = effA + effB > 0 ? effA / (effA + effB) : 0.5;

    const { depositA, depositB } = findDepositJoint(
      inputs.startISO,
      payScheduleA,
      payScheduleB,
      allBills,
      fairnessRatioA,
      0
    );
    const result = runJoint(
      depositA,
      depositB,
      inputs.startISO,
      payScheduleA,
      payScheduleB,
      allBills,
      { months: 12, fairnessRatioA }
    );

    let billSuggestions: SimResult['billSuggestions'] = [];
    try {
      billSuggestions = generateBillSuggestions(
        inputs,
        { monthlyA: depositA, monthlyB: depositB },
        result.minBalance
      );
    } catch (e) {
      // suggestions optional
    }

    return {
      minBalance: result.minBalance,
      endBalance: result.endBalance,
      requiredDepositA: depositA,
      requiredDepositB: depositB,
      entries: result.timeline.map(t => ({ dateISO: t.date, delta: 0, label: t.event || '', who: 'JOINT' as const })),
      billSuggestions,
    };
  } else {
    const depositA = findDepositSingle(inputs.startISO, payScheduleA, allBills, 0);
    const result = runSingle(depositA, inputs.startISO, payScheduleA, allBills, { months: 12, buffer: 0 });

    let billSuggestions: SimResult['billSuggestions'] = [];
    try {
      billSuggestions = generateBillSuggestions(
        inputs,
        { monthlyA: depositA },
        result.minBalance
      );
    } catch (e) {
      // ignore
    }

    return {
      minBalance: result.minBalance,
      endBalance: result.endBalance,
      requiredDepositA: depositA,
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
