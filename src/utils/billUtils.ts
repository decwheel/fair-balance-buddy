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
    // Only roll forward imported bills that are past due
    if (bill.source !== 'imported' || bill.dueDate >= today) {
      return bill;
    }

    // For imported bills, we'll assume they are monthly recurring bills
    // and find the next monthly occurrence
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