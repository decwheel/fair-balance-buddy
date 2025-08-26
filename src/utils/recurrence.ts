import { addDaysISO, addMonthsClampISO } from "./dateUtils";

export type BillFrequency =
  | "one-off"
  | "weekly"
  | "fortnightly"
  | "four-weekly"
  | "monthly"
  | "quarterly"
  | "yearly";

export function generateOccurrences(firstISO: string, frequency: BillFrequency, monthsForward = 12): string[] {
  const end = addMonthsClampISO(firstISO, monthsForward);
  const dates: string[] = [];

  switch (frequency) {
    case "one-off":
      return [firstISO];
    case "weekly": {
      let d = firstISO;
      while (d <= end) { dates.push(d); d = addDaysISO(d, 7); }
      break;
    }
    case "fortnightly": {
      let d = firstISO;
      while (d <= end) { dates.push(d); d = addDaysISO(d, 14); }
      break;
    }
    case "four-weekly": {
      let d = firstISO;
      while (d <= end) { dates.push(d); d = addDaysISO(d, 28); }
      break;
    }
    case "monthly": {
      let d = firstISO;
      while (d <= end) { dates.push(d); d = addMonthsClampISO(d, 1); }
      break;
    }
    case "quarterly": {
      let d = firstISO;
      while (d <= end) { dates.push(d); d = addMonthsClampISO(d, 3); }
      break;
    }
    case "yearly": {
      let d = firstISO;
      while (d <= end) { dates.push(d); d = addMonthsClampISO(d, 12); }
      break;
    }
  }
  return dates;
}
