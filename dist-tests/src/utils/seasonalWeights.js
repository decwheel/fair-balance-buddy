// Base seasonal distribution (fractions summing to 1) inspired by FairSplit BASE
// Jan..Dec: higher in winter, lower in summer
export const BASE_SEASON_WEIGHTS = [
    0.12, 0.10, 0.09, 0.07, 0.06, 0.05, 0.05, 0.06, 0.07, 0.08, 0.10, 0.15
];
// Derive weights from the last 365 days of readings
export function deriveMonthlyWeightsFromReadings(readings) {
    if (!readings?.length)
        return BASE_SEASON_WEIGHTS.slice();
    // Trim to last 365 days from the last timestamp
    const sorted = [...readings].sort((a, b) => new Date(a.tsISO).getTime() - new Date(b.tsISO).getTime());
    const lastTs = new Date(sorted[sorted.length - 1].tsISO).getTime();
    const cutoff = lastTs - 365 * 24 * 60 * 60 * 1000;
    const monthTotals = new Array(12).fill(0);
    let firstKept = Infinity;
    let lastKept = -Infinity;
    for (const r of sorted) {
        const t = new Date(r.tsISO).getTime();
        if (t < cutoff)
            continue;
        const d = new Date(t);
        monthTotals[d.getMonth()] += r.kwh;
        if (t < firstKept)
            firstKept = t;
        if (t > lastKept)
            lastKept = t;
    }
    const spanDays = Math.max(1, Math.round((lastKept - firstKept) / 86400000) + 1);
    // If we don't have close to a year of data, fallback to BASE to avoid skew
    const haveYear = spanDays >= 330; // ~11 months
    const S = monthTotals.reduce((a, b) => a + b, 0);
    if (!haveYear || S <= 0)
        return BASE_SEASON_WEIGHTS.slice();
    const weights = monthTotals.map(m => m / S);
    // Ensure numeric stability (sum to 1)
    const sum = weights.reduce((a, b) => a + b, 0) || 1;
    return weights.map(w => w / sum);
}
export function firstOfNextMonth(d) {
    return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}
export function lastOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
