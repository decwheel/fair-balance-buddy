import { addDays, parseISO, formatISO, isWeekend, isSameDay } from "date-fns";
// --- Irish public holidays (extend yearly) ---
const IRISH_HOLIDAYS = [
    "2025-01-01", "2025-02-03", "2025-03-17", "2025-04-21", "2025-05-05",
    "2025-06-02", "2025-08-04", "2025-10-27", "2025-12-25", "2025-12-26",
    "2026-01-01", "2026-02-02", "2026-03-17", "2026-04-06", "2026-05-04",
    "2026-06-01", "2026-08-03", "2026-10-26", "2026-12-25", "2026-12-28",
];
export function isHoliday(d) {
    return IRISH_HOLIDAYS.some((h) => isSameDay(parseISO(h), d));
}
export function nextBusinessDay(d) {
    let cur = new Date(d);
    while (isWeekend(cur) || isHoliday(cur))
        cur = addDays(cur, 1);
    return cur;
}
export function nextBusinessDayISO(d) {
    return formatISO(nextBusinessDay(d), { representation: "date" });
}
/**
 * Generate pay dates.
 * - weekly/fortnightly/four_weekly: step forward from start date
 * - monthly: advance one month at a time from the provided start date
 */
export function payDates(startISO, freq, months = 12) {
    const today = new Date();
    const start = parseISO(startISO);
    const out = [];
    if (freq === "weekly" || freq === "fortnightly" || freq === "four_weekly") {
        const step = freq === "weekly" ? 7 : freq === "fortnightly" ? 14 : 28;
        let d = start;
        // advance to the first pay date after today
        while (d < today)
            d = addDays(d, step);
        const count = Math.ceil((months * 30) / step);
        for (let i = 0; i < count; i++) {
            out.push(formatISO(nextBusinessDay(d), { representation: "date" }));
            d = addDays(d, step);
        }
        return out;
    }
    // Monthly: step forward one month at a time from the anchor date
    let d = start;
    while (d < today)
        d = new Date(d.getFullYear(), d.getMonth() + 1, d.getDate());
    for (let i = 0; i < months; i++) {
        const raw = new Date(d.getFullYear(), d.getMonth() + i, d.getDate());
        out.push(formatISO(nextBusinessDay(raw), { representation: "date" }));
    }
    return out;
}
