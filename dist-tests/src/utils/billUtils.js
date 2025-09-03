import { generateOccurrences } from './recurrence';
/**
 * Rolls imported bills forward to their next occurrence if their due date is
 * before a given reference date. Defaults to today's date.
 */
export function rollForwardPastBills(bills, referenceDate) {
    const ref = referenceDate ?? new Date().toISOString().split('T')[0];
    return bills.map(bill => {
        // If the bill is not before the reference date, return as is
        if (bill.dueDate >= ref) {
            return bill;
        }
        // Assume past-due bills recur monthly and roll them forward
        const nextOccurrences = generateOccurrences(bill.dueDate, 'monthly', 24);
        const nextDueDate = nextOccurrences.find(date => date >= ref);
        if (nextDueDate) {
            return {
                ...bill,
                dueDate: nextDueDate
            };
        }
        return bill;
    });
}
