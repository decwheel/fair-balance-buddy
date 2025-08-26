import type { Bill } from "../services/forecastAdapters";
import type { RecurringItem } from "../types";

/* Local helpers to avoid cross-file churn */
const toISO = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return toISO(d);
};
const addMonths = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00");
  d.setMonth(d.getMonth() + n);
  return toISO(d);
};

/** Next date on/after 'fromISO' that matches weekday (0=Sun..6=Sat). */
function nextDOWOnOrAfter(fromISO: string, dow: number): string {
  const d = new Date(fromISO + "T00:00:00");
  const delta = (dow - d.getDay() + 7) % 7;
  return addDays(fromISO, delta);
}

/** Next monthly due date (1..31) on/after 'fromISO' (clamps to month end). */
function nextMonthlyOnOrAfter(fromISO: string, dueDay: number): string {
  const base = new Date(fromISO + "T00:00:00");
  const year = base.getFullYear();
  const month = base.getMonth();
  const lastDayThisMonth = new Date(year, month + 1, 0).getDate();
  const inThisMonth = Math.min(dueDay, lastDayThisMonth);
  const candidateThis = new Date(year, month, inThisMonth);
  if (candidateThis >= base) return toISO(candidateThis);
  const next = new Date(year, month + 1, 1);
  const lastDayNext = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  const inNextMonth = Math.min(dueDay, lastDayNext);
  return toISO(new Date(next.getFullYear(), next.getMonth(), inNextMonth));
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

