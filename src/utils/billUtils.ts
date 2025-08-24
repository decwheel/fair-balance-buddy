import { generateOccurrences, BillFrequency } from './recurrence';

export interface Bill {
  id?: string;
  name: string;
  amount: number;
  issueDate: string;
  dueDate: string;
  source?: "manual" | "predicted-electricity" | "imported";
  movable?: boolean;
}

/**
 * Rolls imported bills forward to their next occurrence if their due date is in the past
 */
export function rollForwardPastBills(bills: Bill[]): Bill[] {
  const today = new Date().toISOString().split('T')[0];

  return bills.map(bill => {
    // If the bill is not past due, return as is
    if (bill.dueDate >= today) {
      return bill;
    }

    // Assume past-due bills recur monthly and roll them forward
    const nextOccurrences = generateOccurrences(bill.dueDate, 'monthly', 24);
    const nextDueDate = nextOccurrences.find(date => date >= today);

    if (nextDueDate) {
      return {
        ...bill,
        dueDate: nextDueDate
      };
    }

    return bill;
  });
}