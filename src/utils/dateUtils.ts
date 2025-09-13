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

  // Helpers for monthly deposits anchored to the 1st business day
  const firstBizOfMonth = (y: number, m1: number): string => {
    const raw = `${y}-${String(m1).padStart(2, '0')}-01`;
    return nextBusinessDay(raw);
  };

  if (frequency === 'MONTHLY') {
    // Monthly deposits occur on the 1st business day of each month.
    // If the anchor is already the 1st business day of its month, use it as the first deposit.
    // Otherwise, start from the next month’s 1st business day.
    const [ay, am] = anchorISO.split('-').map(Number);
    const anchorMonthFirstBiz = firstBizOfMonth(ay, am);
    let startOffset = (anchorISO === anchorMonthFirstBiz) ? 0 : 1;
    // If today is the first business day and equals anchor, defer to following month
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    if (anchorISO === todayStr && anchorISO === anchorMonthFirstBiz) {
      startOffset = 1;
    }

    for (let i = 0; i < count; i++) {
      const d = new Date(Date.UTC(ay, (am - 1) + startOffset + i, 1));
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth() + 1; // 1..12
      out.push(firstBizOfMonth(y, m));
    }
    return out;
  }

  // Other frequencies: step forward from the anchor (unchanged)
  let cur = anchorISO;
  for (let i = 0; i < count; i++) {
    out.push(cur);
    if (frequency === 'FOUR_WEEKLY') {
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

// Locale-aware date formatting: dd MMM yyyy
export function formatDate(iso: ISODate, locale?: string): string {
  try {
    let d: Date;
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      const [y, m, day] = iso.split('-').map(Number);
      d = new Date(Date.UTC(y, (m - 1), day));
    } else {
      // Fallback: let Date parse it
      d = new Date(iso);
    }
    return new Intl.DateTimeFormat(locale || undefined, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(d);
  } catch {
    return iso;
  }
}
