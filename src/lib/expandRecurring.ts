import type { Bill } from "../services/forecastAdapters";
import type { RecurringItem } from "../types";

/* Local helpers to avoid cross-file churn */
const toISO = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => {
  const [y, m, d0] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, d0));
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
};
const addMonths = (iso: string, n: number) => {
  const [y, m, d0] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, d0));
  d.setUTCMonth(d.getUTCMonth() + n);
  return toISO(d);
};

/** Next date on/after 'fromISO' that matches weekday (0=Sun..6=Sat). */
function nextDOWOnOrAfter(fromISO: string, dow: number): string {
  const [y, m, d0] = fromISO.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, d0));
  const delta = (dow - d.getUTCDay() + 7) % 7;
  return addDays(fromISO, delta);
}

/** Next monthly due date (1..31) on/after 'fromISO' (clamps to month end). */
function nextMonthlyOnOrAfter(fromISO: string, dueDay: number): string {
  const [y, m, d0] = fromISO.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d0));
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth();
  const lastDayThisMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const inThisMonth = Math.min(dueDay, lastDayThisMonth);
  const candidateThis = new Date(Date.UTC(year, month, inThisMonth));
  if (candidateThis >= base) return toISO(candidateThis);
  const next = new Date(Date.UTC(year, month + 1, 1));
  const lastDayNext = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  const inNextMonth = Math.min(dueDay, lastDayNext);
  return toISO(new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), inNextMonth)));
}

/** Expand one recurring item into Bills between [startISO, startISO + months] inclusive. */
export function expandRecurringItem(r: RecurringItem, startISO: string, months: number, idPrefix: string): Bill[] {
  const endISO = addMonths(startISO, months);
  const out: Bill[] = [];
  let cursor: string;

  const push = (iso: string) =>
    out.push({
      id: `${idPrefix}-${iso}`,
      name: r.description,
      amount: r.amount,
      issueDate: iso,
      dueDate: iso,
      account: "JOINT",
      source: "imported",
      movable: false,
    });

  if (r.freq === "monthly" && typeof r.dueDay === "number") {
    cursor = nextMonthlyOnOrAfter(startISO, r.dueDay);
    while (cursor <= endISO) {
      push(cursor);
      cursor = addMonths(cursor, 1);
    }
  } else if (r.freq === "weekly" && typeof r.dayOfWeek === "number") {
    cursor = nextDOWOnOrAfter(startISO, r.dayOfWeek);
    while (cursor <= endISO) {
      push(cursor);
      cursor = addDays(cursor, 7);
    }
  } else if ((r.freq === "fortnightly" || r.freq === "biweekly") && typeof r.dayOfWeek === "number") {
    cursor = nextDOWOnOrAfter(startISO, r.dayOfWeek);
    while (cursor <= endISO) {
      push(cursor);
      cursor = addDays(cursor, 14);
    }
  } else if (r.freq === "four_weekly" && typeof r.dayOfWeek === "number") {
    cursor = nextDOWOnOrAfter(startISO, r.dayOfWeek);
    while (cursor <= endISO) {
      push(cursor);
      cursor = addDays(cursor, 28);
    }
  } else {
    // Fallback: single instance at last sample or start
    const last = r.sampleDates?.length ? [...r.sampleDates].sort().slice(-1)[0] : startISO;
    push(last);
  }

  return out;
}

/** Expand an array of recurring items for a 12-month window. */
export function expandRecurring(recurring: RecurringItem[], startISO: string, months: number, prefix: string): Bill[] {
  const out: Bill[] = [];
  recurring.forEach((r, i) => out.push(...expandRecurringItem(r, startISO, months, `${prefix}${i}`)));
  return out;
}

