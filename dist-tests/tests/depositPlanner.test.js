// NOTE: import compiled JS targets by extension-friendly specifiers
import { planJointDeposits } from "../src/services/depositPlanner.js";
// Tiny helper to build a monthly series over 12 months starting from startISO (day preserved)
const addMonthsISO = (iso, n) => {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCMonth(dt.getUTCMonth() + n);
    return dt.toISOString().slice(0, 10);
};
function buildMonthlyBills(startMonthISO, day, monthlyAmount) {
    const first = new Date(startMonthISO);
    const y = first.getUTCFullYear();
    const m = first.getUTCMonth();
    const start = new Date(Date.UTC(y, m, day));
    const startISO = start.toISOString().slice(0, 10);
    const out = [];
    for (let i = 0; i < 12; i++) {
        const due = addMonthsISO(startISO, i);
        out.push({ id: `m-${i}`, name: `Monthly Bill ${i + 1}`, amount: monthlyAmount, account: 'JOINT', issueDate: due, dueDate: due, source: 'manual', movable: false });
    }
    return out;
}
// Numeric example from the brief:
// - A: 4500 monthly
// - B: 1210 fortnightly => 1210 * 26 / 12 = 2621.67 monthly
// - Ratio ~ 63.2 : 36.8
// - Monthly deposits by that ratio for a base of 1746.24 → A 1103.62, B 642.62; B per-fortnight ≈ 296.59
async function testJointExample() {
    const startISO = "2025-09-01";
    const inputs = {
        a: { netMonthly: 4500, freq: "monthly", firstPayISO: startISO },
        b: { netMonthly: 1210 * 26 / 12, freq: "fortnightly", firstPayISO: startISO },
        bills: [],
        elecPredicted: [],
        pots: [],
        startISO,
        minBalance: 0,
        mode: "joint",
        weeklyAllowanceA: 0,
        weeklyAllowanceB: 0,
    };
    const payA = { frequency: 'MONTHLY', anchorDate: startISO };
    const payB = { frequency: 'BIWEEKLY', anchorDate: startISO };
    // Build 12 monthly bills totalling 1746.24 per month
    const monthlyBase = 1746.24;
    const billsNonElectric = buildMonthlyBills(startISO, 15, monthlyBase);
    const elecPredicted = [];
    const allBills = [...billsNonElectric, ...elecPredicted];
    const res = planJointDeposits({
        inputs,
        startISO,
        payA,
        payB,
        billsNonElectric: billsNonElectric,
        elecPredicted: elecPredicted,
        allBillsForTimeline: allBills,
        minBalance: 0,
    });
    // Check fairness ratio ≈ 0.632
    const ratioA = res.fairnessRatioA;
    if (Math.abs(ratioA - 0.632) > 0.005) {
        throw new Error(`Expected fairnessRatioA ≈ 0.632, got ${ratioA.toFixed(4)}`);
    }
    // Convert per-pay back to monthly for assertions
    const cyclesA = 1; // monthly
    const cyclesB = 26 / 12; // fortnightly
    const monthlyA = res.depositPerPayA * cyclesA;
    const monthlyB = res.depositPerPayB * cyclesB;
    if (Math.abs(monthlyA - 1103.62) > 0.75) {
        throw new Error(`Expected A monthly ≈ 1103.62, got ${monthlyA.toFixed(2)}`);
    }
    if (Math.abs(monthlyB - 642.62) > 0.75) {
        throw new Error(`Expected B monthly ≈ 642.62, got ${monthlyB.toFixed(2)}`);
    }
    // B per-fortnight ≈ 296.59
    if (Math.abs(res.depositPerPayB - 296.59) > 0.75) {
        throw new Error(`Expected B per-fortnight ≈ 296.59, got ${res.depositPerPayB.toFixed(2)}`);
    }
    // Should keep min balance >= 0
    if (res.minBalance < -0.01) {
        throw new Error(`Expected minBalance >= 0, got ${res.minBalance.toFixed(2)}`);
    }
}
// Tiny runner
(async () => {
    await testJointExample();
    // eslint-disable-next-line no-console
    console.log("depositPlanner tests passed.");
})();
