import { format, addDays, addMonths, isWeekend } from 'date-fns';
import { isHoliday } from '@/lib/dateUtils';

export type ISODate = string;

// --- UTC-safe ISO helpers (avoid local tz drift) ---
const toISO = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return toISO(dt);
}

export function addMonthsClampISO(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  // jump to first of month, then clamp to last day after adding months
  const first = new Date(Date.UTC(y, m - 1, 1));
  first.setUTCMonth(first.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function calculatePayDates(
  frequency: 'WEEKLY' | 'FORTNIGHTLY' | 'BIWEEKLY' | 'FOUR_WEEKLY' | 'MONTHLY',
  anchorISO: string,
  count: number
): string[] {
  const out: string[] = [];
  let cur = anchorISO;
  for (let i = 0; i < count; i++) {
    out.push(cur);
    if (frequency === 'MONTHLY') {
      cur = addMonthsClampISO(cur, 1);
    } else if (frequency === 'FOUR_WEEKLY') {
      cur = addDaysISO(cur, 28);
    } else {
      const step = frequency === 'WEEKLY' ? 7 : 14; // FORTNIGHTLY/BIWEEKLY
      cur = addDaysISO(cur, step);
    }
  }
  return out;
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