import { ISODate, nextBusinessDay } from './dateUtils';

export interface Bill {
  id?: string;
  name: string;
  amount: number;          // euros positive
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
  const { startDate, months, initialBalance, payDates, depositPerCycle, bills, buffer } = input;

  // Create timeline of events
  const events: Array<{ date: ISODate; amount: number; description: string }> = [];
  // Inclusive end date for horizon
  const endDate = (() => {
    const d = new Date(startDate + 'T00:00:00');
    d.setMonth(d.getMonth() + (months || 12));
    return d.toISOString().slice(0, 10);
  })();
  const startTs = new Date(startDate + 'T00:00:00').getTime();
  const endTs = new Date(endDate + 'T00:00:00').getTime();

  // Add pay deposits within horizon
  for (const date of payDates) {
    const ts = new Date(date + 'T00:00:00').getTime();
    if (ts >= startTs && ts <= endTs) {
      events.push({
        date,
        amount: depositPerCycle,
        description: `Deposit (€${depositPerCycle.toFixed(2)})`
      });
    }
  }

  // Add bills (roll forward to next business day) within horizon
  for (const bill of bills) {
    const due = nextBusinessDay(bill.dueDate);
    const ts = new Date(due + 'T00:00:00').getTime();
    if (ts >= startTs && ts <= endTs) {
      events.push({ date: due, amount: -bill.amount, description: bill.name });
    }
  }

  // Sort events by date
  events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Calculate running balance (only within horizon)
  const timeline: Array<{ date: ISODate; balance: number; event?: string }> = [];
  let currentBalance = initialBalance;
  let minBalance = currentBalance;

  // Add starting point
  timeline.push({ date: startDate, balance: currentBalance });

  for (const event of events) {
    const ts = new Date(event.date + 'T00:00:00').getTime();
    if (ts < startTs || ts > endTs) continue;
    currentBalance += event.amount;
    timeline.push({ date: event.date, balance: currentBalance, event: event.description });
    if (currentBalance < minBalance) minBalance = currentBalance;
  }

  return {
    minBalance: minBalance - buffer,
    endBalance: currentBalance,
    timeline
  };
}
