import { calculatePayDates } from "@/utils/dateUtils";
import { calculateForecast } from "@/utils/forecast";
import { calculateForecastFromMany } from "@/utils/forecastMany";
function monthsBetween(start, end) {
    const s = new Date(start);
    const e = new Date(end);
    return (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1;
}
export function runSingle(depositPerCycle, startDate, pay, bills, opts = {}) {
    const months = opts.months ?? 12;
    const buffer = opts.buffer ?? 0;
    // Generate pay dates using existing util
    const payDates = calculatePayDates(pay.frequency, pay.anchorDate, months);
    // Adapter: call existing calculateForecast with the shapes it expects.
    const result = calculateForecast({
        startDate,
        months,
        initialBalance: opts.initialBalance ?? 0,
        payDates,
        depositPerCycle, // fixed deposit each payday
        bills: bills,
        buffer
    });
    // Standardise the return shape
    return {
        minBalance: result.minBalance ?? 0,
        endBalance: result.endBalance ?? 0,
        timeline: result.timeline ?? []
    };
}
export function runJoint(depositA, depositB, startDate, payA, payB, bills, opts) {
    const months = opts.months ?? 12;
    const payDatesA = calculatePayDates(payA.frequency, payA.anchorDate, months);
    const payDatesB = calculatePayDates(payB.frequency, payB.anchorDate, months);
    const result = calculateForecastFromMany({
        startDate,
        months,
        initialBalance: opts.initialBalance ?? 0,
        payDatesA,
        payDatesB,
        depositA, // fixed deposit for A on A's paydates
        depositB, // fixed deposit for B on B's paydates
        bills: bills,
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
export function findDepositSingle(startDate, pay, bills, _baseline) {
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
    const cycles = pay.frequency === "WEEKLY" ? 52 / 12 :
        pay.frequency === "FORTNIGHTLY" || pay.frequency === "BIWEEKLY" ? 26 / 12 :
            pay.frequency === "FOUR_WEEKLY" ? 13 / 12 : 1;
    let deposit = monthlyBills / cycles;
    // Step 7: ensure timeline never dips below zero
    let result = runSingle(deposit, startDate, pay, bills, { months: 12, buffer: 0 });
    let iterations = 0;
    while (result.minBalance < 0 && iterations < 20) {
        const shortfallPerMonth = -result.minBalance / 12;
        deposit += shortfallPerMonth / cycles;
        result = runSingle(deposit, startDate, pay, bills, { months: 12, buffer: 0 });
        iterations++;
    }
    return Math.round(deposit);
}
export function findDepositJoint(startDate, payA, payB, bills, fairnessRatioA, _baseline) {
    const cycles = (freq) => {
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
    const cyclesA = cycles(payA.frequency);
    const cyclesB = cycles(payB.frequency);
    // Step 4: total bill amount across the window and derive a monthly average
    const total = bills.reduce((sum, bill) => sum + bill.amount, 0);
    const firstDue = bills.reduce((min, b) => (b.dueDate < min ? b.dueDate : min), bills[0]?.dueDate ?? startDate);
    const lastDue = bills.reduce((max, b) => (b.dueDate > max ? b.dueDate : max), bills[0]?.dueDate ?? startDate);
    const monthsSpan = monthsBetween(firstDue, lastDue);
    const monthlyBills = monthsSpan > 0 ? total / monthsSpan : total;
    // Step 5/6: split by wage ratio then convert to per-pay deposits
    let depA = (monthlyBills * fairnessRatioA) / cyclesA;
    let depB = (monthlyBills * (1 - fairnessRatioA)) / cyclesB;
    // Step 7: ensure positive balance over the year
    let result = runJoint(depA, depB, startDate, payA, payB, bills, { months: 12, fairnessRatioA });
    let iterations = 0;
    while (result.minBalance < 0 && iterations < 20) {
        const shortfallPerMonth = -result.minBalance / 12;
        depA += (shortfallPerMonth * fairnessRatioA) / cyclesA;
        depB += (shortfallPerMonth * (1 - fairnessRatioA)) / cyclesB;
        result = runJoint(depA, depB, startDate, payA, payB, bills, { months: 12, fairnessRatioA });
        iterations++;
    }
    return {
        depositA: Math.round(depA),
        depositB: Math.round(depB)
    };
}
