/// <reference lib="webworker" />

import * as Comlink from "comlink";
import type {
  PlanInputs,
  SimResult,
  TimelineEntry,
  Transaction,
  SalaryCandidate,
  RecurringItem,
  PayFrequency,
} from "../types";
import { payDates } from "../lib/dateUtils";
import { detectSalaryCandidates, detectRecurringBillsFromTx } from "../lib/recurring";

function perPayFromMonthly(monthly: number, freq: PayFrequency): number {
  switch (freq) {
    case "weekly":       return monthly * (12 / 52);
    case "fortnightly":  return monthly * (12 / 26);
    case "four_weekly":  return monthly * (12 / 13);
    case "monthly":
    default:             return monthly;
  }
}

// Minimal non-blocking skeleton.
function simulate(inputs: PlanInputs): SimResult {
  const months = 12;
  const entries: TimelineEntry[] = [];

  // Inflows: A
  const aPays = payDates(inputs.a.firstPayISO, inputs.a.freq, months).map((d) => ({
    dateISO: d,
    delta: perPayFromMonthly(inputs.a.netMonthly, inputs.a.freq),
    label: "Pay A",
    who: "A" as const,
  }));
  entries.push(...aPays);

  // Optional B
  if (inputs.b) {
    const bPays = payDates(inputs.b.firstPayISO, inputs.b.freq, months).map((d) => ({
      dateISO: d,
      delta: perPayFromMonthly(inputs.b!.netMonthly, inputs.b!.freq),
      label: "Pay B",
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
  for (const p of inputs.pots ?? []) {
    // naive: charge on start day; refined later
    entries.push({ dateISO: inputs.startISO, delta: -p.monthly, label: `Pot: ${p.name}`, who: p.owner });
  }

  entries.sort((a, b) => a.dateISO.localeCompare(b.dateISO));

  let bal = 0;
  let minBal = Infinity;
  for (const it of entries) {
    bal += it.delta;
    if (bal < minBal) minBal = bal;
  }

  return {
    minBalance: Number.isFinite(minBal) ? minBal : 0,
    endBalance: bal,
    requiredMonthlyA: 0,
    requiredMonthlyB: undefined,
    entries,
  };
}

function analyzeTransactions(tx: Transaction[]): { salaries: SalaryCandidate[]; recurring: RecurringItem[] } {
  const salaries = detectSalaryCandidates(tx);
  const recurring = detectRecurringBillsFromTx(tx);
  // @ts-ignore (worker console appears under the "Worker" target in DevTools)
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
