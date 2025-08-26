import { format, addDays, addMonths, isWeekend } from 'date-fns';
import { isHoliday } from '@/lib/dateUtils';

export type ISODate = string;

export function calculatePayDates(
  frequency: 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY' | 'BIWEEKLY' | 'FOUR_WEEKLY',
  anchorDate: ISODate,
  months: number
): ISODate[] {
  const today = new Date();
  const dates: ISODate[] = [];

  // Monthly standing orders: first business day of the NEXT month after today
  if (frequency === 'MONTHLY') {
    const firstOfNext = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    for (let i = 0; i < months; i++) {
      const raw = new Date(firstOfNext.getFullYear(), firstOfNext.getMonth() + i, 1);
      const iso = format(raw, 'yyyy-MM-dd');
      dates.push(nextBusinessDay(iso));
    }
    return dates;
  }

  // Weekly-style schedules: step forward from the last known payday
  const step =
    frequency === 'WEEKLY'
      ? 7
      : frequency === 'FORTNIGHTLY' || frequency === 'BIWEEKLY'
        ? 14
        : 28; // FOUR_WEEKLY

  let current = new Date(anchorDate);
  // Advance to the first date on or after today
  while (current < today) {
    current = addDays(current, step);
  }

  const count = Math.ceil((months * 30) / step);
  for (let i = 0; i < count; i++) {
    const iso = format(current, 'yyyy-MM-dd');
    dates.push(nextBusinessDay(iso));
    current = addDays(current, step);
  }

  return dates;
}

export function nextBusinessDay(date: ISODate): ISODate {
  let d = new Date(date);

  // Advance while date falls on weekend or Irish bank holiday
  while (isWeekend(d) || isHoliday(d)) {
    d = addDays(d, 1);
  }

  return format(d, 'yyyy-MM-dd');
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