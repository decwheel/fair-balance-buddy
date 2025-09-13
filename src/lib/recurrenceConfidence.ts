import type { RecurringItem } from "@/types";

export type Confidence = 'High' | 'Medium' | 'Low';

export function recurrenceConfidence(r: RecurringItem): Confidence {
  const samples = r.sampleDates?.length || 0;
  if (samples >= 6) return 'High';
  if (samples >= 3) return 'Medium';
  return 'Low';
}

