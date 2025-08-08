import { format, addDays, addWeeks, addMonths, isWeekend, nextSaturday, nextSunday } from 'date-fns';

export type ISODate = string;

export function calculatePayDates(
  frequency: 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY' | 'BIWEEKLY' | 'FOUR_WEEKLY',
  anchorDate: ISODate,
  months: number
): ISODate[] {
  const dates: ISODate[] = [];
  const anchor = new Date(anchorDate);
  const endDate = addMonths(anchor, months);
  
  let current = anchor;
  
  while (current <= endDate) {
    dates.push(format(current, 'yyyy-MM-dd'));
    
    switch (frequency) {
      case 'WEEKLY':
        current = addWeeks(current, 1);
        break;
      case 'FORTNIGHTLY':
      case 'BIWEEKLY':
        current = addWeeks(current, 2);
        break;
      case 'FOUR_WEEKLY':
        current = addWeeks(current, 4);
        break;
      case 'MONTHLY':
        current = addMonths(current, 1);
        break;
    }
  }
  
  return dates;
}

export function nextBusinessDay(date: ISODate): ISODate {
  const d = new Date(date);
  
  if (isWeekend(d)) {
    // If weekend, move to next Monday
    const nextMonday = addDays(d, d.getDay() === 6 ? 2 : 1); // Saturday -> Monday, Sunday -> Monday
    return format(nextMonday, 'yyyy-MM-dd');
  }
  
  return date;
}

export function generateRefundDates(
  startDate: ISODate,
  endDate: ISODate,
  frequency: 'MONTHLY' | 'QUARTERLY'
): ISODate[] {
  const dates: ISODate[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  let current = start;
  
  while (current <= end) {
    dates.push(format(current, 'yyyy-MM-dd'));
    current = frequency === 'MONTHLY' ? addMonths(current, 1) : addMonths(current, 3);
  }
  
  return dates;
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  }).format(amount);
}

export function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}