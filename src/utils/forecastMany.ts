import { ISODate, nextBusinessDay } from './dateUtils';
import { Bill, ForecastResult } from './forecast';

export interface ForecastManyInput {
  startDate: ISODate;
  months: number;
  initialBalance: number;
  payDatesA: ISODate[];
  payDatesB: ISODate[];
  depositA: number;
  depositB: number;
  bills: Bill[];
  fairnessRatioA: number;
  weeklyAllowanceA?: number;
  weeklyAllowanceB?: number;
  savingsRules?: unknown;
  buffer: number;
}

// Mock implementation of your existing calculateForecastFromMany function
// Replace this with import from your actual utils/forecast-many.js
export function calculateForecastFromMany(input: ForecastManyInput): ForecastResult {
  const { startDate, months, initialBalance, 
    payDatesA, 
    payDatesB, 
    depositA, 
    depositB, 
    bills, 
    fairnessRatioA,
    weeklyAllowanceA = 0,
    weeklyAllowanceB = 0,
    buffer 
  } = input;
  
  // Create timeline of events
  const events: Array<{ date: ISODate; amount: number; description: string }> = [];
  
  // Add Person A deposits
  payDatesA.forEach(date => {
    events.push({
      date,
      amount: depositA,
      description: `Person A Deposit (€${depositA.toFixed(2)})`
    });
  });
  
  // Add Person B deposits  
  payDatesB.forEach(date => {
    events.push({
      date,
      amount: depositB,
      description: `Person B Deposit (€${depositB.toFixed(2)})`
    });
  });
  
  // Note: Weekly allowances are NOT transacted through the joint account timeline in fair-split.
  // They reduce each partner's available monthly budget, and are accounted for in the optimizer,
  // not as debits on the joint timeline.
  
  // Add bills (split by fairness ratio) and roll to next business day
  bills.forEach(bill => {
    const amountA = bill.amount * fairnessRatioA;
    const amountB = bill.amount * (1 - fairnessRatioA);
    const due = nextBusinessDay(bill.dueDate);
    
    events.push({
      date: due,
      amount: -(amountA + amountB), // Total bill amount
      description: `${bill.name} (A: €${amountA.toFixed(2)}, B: €${amountB.toFixed(2)})`
    });
  });
  
  // Sort events by date
  events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Calculate running balance; minBalance window begins at first deposit date
  const timeline: Array<{ date: ISODate; balance: number; event?: string }> = [];
  let currentBalance = initialBalance;

  // Add starting point for display
  timeline.push({ date: startDate, balance: currentBalance });

  const endDate = (() => { const d = new Date(startDate + 'T00:00:00'); d.setMonth(d.getMonth() + (months || 12)); return d.toISOString().slice(0,10); })();
  const startTs = new Date(startDate + 'T00:00:00').getTime();
  const endTs = new Date(endDate + 'T00:00:00').getTime();
  const futureEvents = events.filter(e => { const ts = new Date(e.date + 'T00:00:00').getTime(); return ts >= startTs && ts <= endTs; });

  // First deposit date across A and B
  const firstDepA = payDatesA.find(d => new Date(d + 'T00:00:00').getTime() >= startTs);
  const firstDepB = payDatesB.find(d => new Date(d + 'T00:00:00').getTime() >= startTs);
  const firstDeposit = [firstDepA, firstDepB].filter(Boolean).sort()[0] || startDate;
  const firstDepositTs = new Date(firstDeposit + 'T00:00:00').getTime();

  let minBalance = Number.POSITIVE_INFINITY;
  futureEvents.forEach(event => {
    const ts = new Date(event.date + 'T00:00:00').getTime();
    currentBalance += event.amount;
    timeline.push({ date: event.date, balance: currentBalance, event: event.description });
    if (ts >= firstDepositTs && currentBalance < minBalance) minBalance = currentBalance;
  });
  if (!isFinite(minBalance)) minBalance = currentBalance;
  
  return {
    minBalance: minBalance - buffer,
    endBalance: currentBalance,
    timeline
  };
}





