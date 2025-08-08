import { ISODate } from './dateUtils';

export interface Bill {
  id?: string;
  name: string;
  amount: number;          // € positive
  issueDate: ISODate;      // ISO yyyy-mm-dd
  dueDate: ISODate;        // ISO
  source?: "manual"|"predicted-electricity"|"imported";
  movable?: boolean;       // eligible for nudge engine
}

export interface ForecastInput {
  startDate: ISODate;
  months: number;
  initialBalance: number;
  payDates: ISODate[];
  depositPerCycle: number;
  bills: Bill[];
  buffer: number;
}

export interface ForecastResult {
  minBalance: number;
  endBalance: number;
  timeline: Array<{ date: ISODate; balance: number; event?: string }>;
}

// Mock implementation of your existing calculateForecast function
// Replace this with import from your actual utils/forecast.js
export function calculateForecast(input: ForecastInput): ForecastResult {
  const { startDate, initialBalance, payDates, depositPerCycle, bills, buffer } = input;
  
  // Create timeline of events
  const events: Array<{ date: ISODate; amount: number; description: string }> = [];
  
  // Add pay deposits
  payDates.forEach(date => {
    events.push({
      date,
      amount: depositPerCycle,
      description: `Deposit (€${depositPerCycle.toFixed(2)})`
    });
  });
  
  // Add bills
  bills.forEach(bill => {
    events.push({
      date: bill.dueDate,
      amount: -bill.amount,
      description: bill.name
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