import type { RecurringItem } from "@/types";

// Merge occurrences within N days into a single item, counting merges
export function mergeNearby<T extends { dateISO: string }>(items: T[], days = 3): { items: T[]; merged: number } {
  if (!Array.isArray(items) || items.length === 0) return { items, merged: 0 };
  const byDay = items.slice().sort((a,b) => a.dateISO.localeCompare(b.dateISO));
  const out: T[] = [];
  let merged = 0;
  for (let i = 0; i < byDay.length; i++) {
    const cur = byDay[i];
    if (out.length === 0) { out.push(cur); continue; }
    const prev = out[out.length - 1];
    const diff = Math.abs(new Date(cur.dateISO).getTime() - new Date(prev.dateISO).getTime());
    const diffDays = diff / (1000*60*60*24);
    if (diffDays <= days) {
      // coalesce by keeping the latest date; increment merged count
      merged++;
      out[out.length - 1] = cur;
    } else {
      out.push(cur);
    }
  }
  return { items: out, merged };
}

