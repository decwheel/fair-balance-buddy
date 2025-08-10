export type BillFrequency =
  | "one-off"
  | "weekly"
  | "fortnightly"
  | "four-weekly"
  | "monthly"
  | "quarterly"
  | "yearly";

function toISO(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  // handle month rollover (e.g., adding 1 month to Jan 31)
  if (d.getDate() < day) d.setDate(0);
  return d;
}

export function generateOccurrences(firstISO: string, frequency: BillFrequency, monthsForward = 12): string[] {
  const start = new Date(firstISO + "T00:00:00");
  const end = addMonths(start, monthsForward);
  const dates: string[] = [];

  switch (frequency) {
    case "one-off":
      return [firstISO];
    case "weekly": {
      let d = start;
      while (d <= end) { dates.push(toISO(d)); d = addDays(d, 7); }
      break;
    }
    case "fortnightly": {
      let d = start;
      while (d <= end) { dates.push(toISO(d)); d = addDays(d, 14); }
      break;
    }
    case "four-weekly": {
      let d = start;
      while (d <= end) { dates.push(toISO(d)); d = addDays(d, 28); }
      break;
    }
    case "monthly": {
      let d = start;
      while (d <= end) { dates.push(toISO(d)); d = addMonths(d, 1); }
      break;
    }
    case "quarterly": {
      let d = start;
      while (d <= end) { dates.push(toISO(d)); d = addMonths(d, 3); }
      break;
    }
    case "yearly": {
      let d = start;
      while (d <= end) { dates.push(toISO(d)); d = addMonths(d, 12); }
      break;
    }
  }
  return dates;
}
