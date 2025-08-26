// Optimization engine inspired by fair-split's approach
import { addDays, parseISO, formatISO } from "date-fns";
import type { PlanInputs, SimResult, Bill, PaySpec, PayFrequency } from "../types";
import { payDates } from "../lib/dateUtils";

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
  currentMinBalance: number
): OptimizationResult['billSuggestions'] {
  const suggestions: OptimizationResult['billSuggestions'] = [];
  
  // Only suggest moving bills that are movable and variable
  const movableBills = inputs.bills.filter(bill => bill.movable && bill.dueDateISO);
  
  for (const bill of movableBills) {
    const originalDate = bill.dueDateISO!;
    const testDates: string[] = [];
    
    // Generate test dates: 7 days before to 21 days after current due date
    const baseDate = new Date(originalDate);
    for (let offset = -7; offset <= 21; offset += 7) {
      const testDate = new Date(baseDate);
      testDate.setDate(testDate.getDate() + offset);
      const testDateISO = testDate.toISOString().split('T')[0];
      if (testDateISO !== originalDate) {
        testDates.push(testDateISO);
      }
    }
    
    for (const testDate of testDates) {
      try {
        // Create modified inputs with the bill moved to test date
        const modifiedBills = inputs.bills.map(b => 
          b.id === bill.id ? { ...b, dueDateISO: testDate } : b
        );
        const modifiedInputs = { ...inputs, bills: modifiedBills };
        
        // Calculate optimization with modified bill date
        const testOptimization = findOptimalStartDate(modifiedInputs);
        const testDeposits = testOptimization.optimizedDeposits;
        const testMinBalance = testOptimization.scenarios[0]?.minBalance || 0;
        
        // Calculate potential savings (convert per-pay deposits to monthly totals)
        const cyclesA = cyclesPerMonth(mapFrequency(inputs.a.freq));
        const cyclesB = inputs.b ? cyclesPerMonth(mapFrequency(inputs.b.freq)) : 0;
        const currentTotal =
          currentOptimizedDeposits.monthlyA * cyclesA +
          (currentOptimizedDeposits.monthlyB || 0) * cyclesB;
        const testTotal =
          testDeposits.monthlyA * cyclesA +
          (testDeposits.monthlyB || 0) * cyclesB;
        const savingsAmount = currentTotal - testTotal;
        
        // Suggest if it provides meaningful savings (>€10/month) and maintains positive balance
        if (savingsAmount > 10 && testMinBalance >= 0) {
          const daysDiff = Math.floor((new Date(testDate).getTime() - new Date(originalDate).getTime()) / (1000 * 60 * 60 * 24));
          const direction = daysDiff > 0 ? 'later' : 'earlier';
          const reason = `Moving ${Math.abs(daysDiff)} days ${direction} reduces monthly deposits by €${savingsAmount.toFixed(0)}`;
          
          suggestions.push({
            billId: bill.id!,
            currentDate: originalDate,
            suggestedDate: testDate,
            savingsAmount: Math.round(savingsAmount),
            reason
          });
        }
      } catch (error) {
        // Skip failed suggestions
        continue;
      }
    }
  }
  
  // Sort by savings amount (highest first) and return top 3
  return suggestions
    .sort((a, b) => b.savingsAmount - a.savingsAmount)
    .slice(0, 3);
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
        
        const payDatesA = payDates(payScheduleA.anchorDate, mapFrequency(inputs.a.freq), 12);
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
          
        const payDatesA = payDates(payScheduleA.anchorDate, mapFrequency(inputs.a.freq), 12);
        const payDatesB = payDates(payScheduleB.anchorDate, mapFrequency(inputs.b.freq), 12);
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