import { ISODate } from './dateUtils';
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
  const { 
    startDate, 
    initialBalance, 
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
  
  // Add bills (split by fairness ratio)
  bills.forEach(bill => {
    const amountA = bill.amount * fairnessRatioA;
    const amountB = bill.amount * (1 - fairnessRatioA);
    
    events.push({
      date: bill.dueDate,
      amount: -(amountA + amountB), // Total bill amount
      description: `${bill.name} (A: €${amountA.toFixed(2)}, B: €${amountB.toFixed(2)})`
    });
  });
  
  // Sort events by date
  events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  
  // Calculate running balance (only from startDate onward)
  const timeline: Array<{ date: ISODate; balance: number; event?: string }> = [];
  let currentBalance = initialBalance;
  let minBalance = currentBalance;
  
  // Add starting point
  timeline.push({ date: startDate, balance: currentBalance });
  
  const startTs = new Date(startDate).getTime();
  const futureEvents = events.filter(e => new Date(e.date).getTime() >= startTs);
  
  futureEvents.forEach(event => {
    currentBalance += event.amount;
    timeline.push({
      date: event.date,
      balance: currentBalance,
      event: event.description
    });
    
    if (currentBalance < minBalance) {
      minBalance = currentBalance;
    }
  });
  
  return {
    minBalance: minBalance - buffer,
    endBalance: currentBalance,
    timeline
  };
}
