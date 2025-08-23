import { parseISO, differenceInDays } from "date-fns";
import { nextBusinessDay } from "./dateUtils";
import type { PayFrequency, Transaction, RecurringItem, SalaryCandidate } from "../types";

/* ---------------- description normaliser (fair-split style) ------------ */
const normDesc = (txt = "") =>
  txt
    .toLowerCase()
    .replace(/^pos\d{2}[a-z]{3}\s*/i, "")
    .replace(/\d{6,}/g, "")
    .replace(/\b[a-z0-9]{1,4}\b$/i, "")
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

const within = (a: number, b: number, d = 2) => Math.abs(a - b) <= d;
function mode(arr: number[] = []) {
  const m = new Map<number, number>();
  arr.forEach(v => m.set(v, (m.get(v) || 0) + 1));
  let best: number | null = null, bestCount = -1;
  for (const [v,c] of m) if (c > bestCount) { best = v; bestCount = c; }
  return best ?? 0;
}

function inferMonthlyAnchorDom(observedYmd: string[] = []) {
  if (!observedYmd || observedYmd.length < 2) return undefined;
  // “next business day for each DOM” intersection trick
  const perMonth = observedYmd.map(ymd => {
    const d = parseISO(ymd);
    const y = d.getFullYear(), m0 = d.getMonth();
    const max = new Date(y, m0 + 1, 0).getDate();
    const set = new Set<number>();
    for (let dom = 1; dom <= max; dom++) {
      const rolled = nextBusinessDay(new Date(y, m0, dom));
      if (rolled.toISOString().slice(0,10) === ymd) set.add(dom);
    }
    return set;
  });
  let inter = [...perMonth[0]];
  for (let i=1;i<perMonth.length;i++) {
    const s = perMonth[i];
    inter = inter.filter(dom => s.has(dom));
  }
  if (inter.length === 1) return inter[0];
  if (inter.length > 1) return Math.min(...inter);
  // fallback: most supported DOM
  const counts = new Map<number, number>();
  perMonth.forEach(s => s.forEach(dom => counts.set(dom,(counts.get(dom)||0)+1)));
  let best: number | undefined, bestC = -1;
  for (const [dom,c] of counts) if (c>bestC) { best = dom; bestC = c; }
  return best;
}

function inferDayOfWeek(observedYmd: string[] = []) {
  const dows = observedYmd.map(ymd => parseISO(ymd).getDay());
  const m = mode(dows);
  return m ?? parseISO(observedYmd[0]).getDay();
}

function analyseDatePattern(dateStrings: string[] = []) {
  if (dateStrings.length < 2) return { frequency: "" as const };
  const dates = dateStrings.map(dateStr => parseISO(dateStr)).sort((a,b) => a.getTime()-b.getTime());
  const gaps  = dates.slice(1).map((d,i) => differenceInDays(d, dates[i]));
  const total = gaps.length;
  const cnt = (lo:number,hi:number) => gaps.filter(g => g>=lo && g<=hi).length;
  
  // Debug logging for salary detection
  if (dateStrings.some(d => d.includes('2025')) && (gaps.some(g => g >= 10 && g <= 18) || gaps.some(g => g === 14))) {
    console.log('[analyseDatePattern] Debug for salary pattern:', {
      dateStrings: dateStrings.slice(0, 8),
      gaps: gaps.slice(0, 8),
      weekly: cnt(5,9),
      fortnightly: cnt(12,18),
      monthly: cnt(26,35),
      exact14days: gaps.filter(g => g === 14).length,
      total: gaps.length,
      description: dateStrings[0] ? 'teaching payroll check' : 'unknown'
    });
  }
  
  // **HIGHEST PRIORITY**: Exact 14-day patterns (fortnightly salaries)
  const exact14Count = gaps.filter(g => g === 14).length;
  if (exact14Count >= 3 && exact14Count / total >= 0.6) {
    console.log('[analyseDatePattern] Detected exact fortnightly salary pattern (priority):', { exact14Count, total, ratio: exact14Count/total });
    return { frequency: "fortnightly" as const, due: dates[dates.length-1] };
  }
  
  const buckets = [
    { n: "weekly",      c: cnt(5,9)   },
    { n: "fortnightly", c: cnt(12,18) }, // Broader range for fortnightly detection
    { n: "monthly",     c: cnt(26,35) },
    { n: "yearly",      c: cnt(350,380) },
  ];
  
  // Secondary exact 14-day check with lower threshold 
  if (exact14Count >= 2 && exact14Count / total >= 0.4) {
    console.log('[analyseDatePattern] Detected fortnightly pattern (secondary):', { exact14Count, total, ratio: exact14Count/total });
    return { frequency: "fortnightly" as const, due: dates[dates.length-1] };
  }

  // First try: majority (50%) in one bucket
  let frequency = (buckets.find(b => b.c/total >= 0.5)?.n ?? "") as
                  "" | "weekly" | "fortnightly" | "monthly" | "yearly";
  
  // Second try: highest count with at least 40% (lowered threshold for fortnightly)
  if (!frequency) {
    const dom = [...buckets].sort((a,b)=>b.c-a.c)[0];
    if (dom.c >= 2 && dom.c/total >= 0.4) frequency = dom.n as any;
  }
  
  // Third try: median gap fallback
  if (!frequency) {
    const med = [...gaps].sort((a,b)=>a-b)[Math.floor(total/2)];
    if      (med>=5  && med<=9)   frequency="weekly";
    else if (med>=10 && med<=18)  frequency="fortnightly";
    else if (med>=26 && med<=35)  frequency="monthly";
    else if (med>=350&& med<=380) frequency="yearly";
  }
  
  // Fourth try: two-item special case
  if (!frequency && dates.length === 2) {
    const gap = gaps[0];
    if (within(gap,30,5) && within(dates[0].getDate(), dates[1].getDate(), 3)) frequency="monthly";
    else if (within(gap,14,4) && dates[0].getDay() === dates[1].getDay())       frequency="fortnightly";
  }
  
  return { frequency, due: dates[dates.length-1] };
}

/* ------------------------ Recurring (bills) ------------------------------ */
export function detectRecurringBillsFromTx(tx: Transaction[]): RecurringItem[] {
  const TOLERANCE = 0.25;
  const MIN_HITS_STRICT = 3;
  const MIN_HITS_MONTHLY = 2;

  const strict: Record<string, { date: string; amount: number; raw: string }[]> = {};
  const byDesc: Record<string, { dates: string[]; amounts: number[]; raw: string[]; codes: (string|undefined)[] }> = {};

  for (const t of tx) {
    if (!t.dateISO) continue;
    if ((t.amount ?? 0) >= 0) continue;        // outflows only
    const raw = t.rawDesc ?? t.description ?? "unknown";
    const dAdj = nextBusinessDay(parseISO(t.dateISO)).toISOString().slice(0,10);
    const absAmt = Math.abs(t.amount);
    const key = `${normDesc(raw)}|${Math.round(absAmt)}`; // €78.67 -> 79
    (strict[key] ||= []).push({ date: dAdj, amount: absAmt, raw });
    const nd = normDesc(raw);
    (byDesc[nd] ||= { dates:[], amounts:[], raw:[], codes:[] });
    byDesc[nd].dates.push(dAdj);
    byDesc[nd].amounts.push(absAmt);
    byDesc[nd].raw.push(raw);
    byDesc[nd].codes.push(t.bankCode);
  }

  const bills: RecurringItem[] = [];
  const emit = (desc: string, amt: number, freq: RecurringItem["freq"], meta: any) => {
    const bill: RecurringItem = {
      description: desc.trim() || "bill",
      amount: Math.round(amt * 100) / 100,
      freq,
      sampleDates: meta?.dates?.slice?.(-3) ?? [],
    };
    if (freq === "monthly" && meta?.dom) bill.dueDay = meta.dom;
    if ((freq === "weekly" || freq === "fortnightly") && meta?.dow != null) bill.dayOfWeek = meta.dow;
    bills.push(bill);
  };

  // pass 1 – strict identical amount + description
  for (const list of Object.values(strict)) {
    const observed = list.map(x => x.date);
    const { frequency } = analyseDatePattern(observed);
    if (!frequency) continue;
    const minHits = (frequency === "monthly" || frequency === "fortnightly") ? MIN_HITS_MONTHLY : MIN_HITS_STRICT;
    if (list.length < minHits) continue;
    const recent = list[list.length - 1];
    if (frequency === "monthly") {
      const dom = inferMonthlyAnchorDom(observed);
      if (!dom) continue;
      emit(recent.raw, recent.amount, "monthly", { dom, dates: observed });
    } else if (frequency === "weekly" || frequency === "fortnightly") {
      const dow = inferDayOfWeek(observed);
      emit(recent.raw, recent.amount, frequency, { dow, dates: observed });
    }
  }

  // pass 2 – variable amount, majority within ±25% around median + hint
  for (const [nd, data] of Object.entries(byDesc)) {
    if (bills.some(b => normDesc(b.description) === nd)) continue;
    if (data.dates.length < MIN_HITS_MONTHLY) continue;
    const { frequency } = analyseDatePattern(data.dates);
    if (!frequency) continue;
    const median = [...data.amounts].sort((a,b)=>a-b)[Math.floor(data.amounts.length/2)];
    const inBand = data.amounts.filter(a => Math.abs(a - median)/median <= TOLERANCE).length;
    const majority = inBand / data.amounts.length >= 0.6;
    if (!majority) continue;
    const narrativeHint = data.raw.some(n => /(dd|direct ?debit|standing ?order|sepa)/i.test(n || ""));
    if (!narrativeHint) continue;
    const lastIdx = data.dates.length - 1;
    const raw = data.raw[lastIdx] || data.raw[0];
    const amt = data.amounts[lastIdx] || data.amounts[0];
    if (frequency === "monthly") {
      const dom = inferMonthlyAnchorDom(data.dates);
      if (!dom) continue;
      emit(raw, amt, "monthly", { dom, dates: data.dates });
    } else if (frequency === "weekly" || frequency === "fortnightly") {
      const dow = inferDayOfWeek(data.dates);
      emit(raw, amt, frequency, { dow, dates: data.dates });
    }
  }

  // —— final pass: merge near-duplicates (e.g. “Barna Recycli…” variants)
  const key = (b: RecurringItem) =>
    [(b.freq || "").toLowerCase(), b.dueDay ?? 0, normDesc(b.description)].join("|");
  const merged: Record<string, RecurringItem> = {};
  for (const b of bills) {
    const k = key(b);
    const ex = merged[k];
    if (!ex) { merged[k] = b; continue; }
    // prefer the one with more evidence; otherwise average amount if ~equal
    const exN = ex.sampleDates?.length ?? 0;
    const bN  = b.sampleDates?.length ?? 0;
    if (bN > exN) { merged[k] = b; continue; }
    if (Math.abs((b.amount ?? 0) - (ex.amount ?? 0)) <= 1.0) {
      merged[k].amount = Math.round(((ex.amount + b.amount) / 2) * 100) / 100;
    }
  }
  return Object.values(merged).sort((a,b)=>a.description.localeCompare(b.description));
}

/* ------------------------ Salaries (inflows) ----------------------------- */
const SALARY_KEYWORDS = ["payroll","salary","wages","wage","paye","remittance","net pay","hr"];

export function detectSalaryCandidates(tx: Transaction[]): SalaryCandidate[] {
  const inflows = tx.filter(t => (t.amount ?? 0) > 0);
  if (!inflows.length) return [];

  // group by normalized description (allow varying amounts)
  const byDesc = new Map<string, { desc: string; dates: string[]; amounts: number[] }>();
  for (const t of inflows) {
    const d = normDesc(t.rawDesc ?? t.description);
    const g = byDesc.get(d) ?? { desc: d, dates: [], amounts: [] };
    g.dates.push((t.bookingDate ?? t.dateISO));
    g.amounts.push(Math.abs(t.amount));
    byDesc.set(d, g);
  }

  const out: SalaryCandidate[] = [];
  for (const g of byDesc.values()) {
    const ds = g.dates.sort();
    if (ds.length < 2) continue;
    const { frequency } = analyseDatePattern(ds);
    if (!frequency) continue;

    // Treat 4-weekly as monthly for display/normalisation purposes.
    // We keep whatever analyseDatePattern said, without converting to four_weekly.
    const freq: PayFrequency = (frequency as PayFrequency);

    const avg = g.amounts.reduce((a,b)=>a+b,0)/g.amounts.length;
    const likely = avg >= 700 || SALARY_KEYWORDS.some(k => g.desc.includes(k));
    if (!likely) continue;

    out.push({
      amount: Math.round(avg * 100) / 100,
      freq,
      description: g.desc || "salary",
      firstSeen: ds[0],
    });
  }

  // amount-cluster fallback (bucket €25)
  if (!out.length) {
    const byBucket = new Map<number, { dates: string[]; amounts: number[] }>();
    const bucket = (amt:number) => Math.round(amt/25)*25;
    for (const t of inflows) {
      const b = bucket(Math.abs(t.amount));
      const g = byBucket.get(b) ?? { dates: [], amounts: [] };
      g.dates.push(t.dateISO);
      g.amounts.push(Math.abs(t.amount));
      byBucket.set(b, g);
    }
    for (const [, g] of byBucket) {
      if (g.dates.length < 2) continue;
      const { frequency } = analyseDatePattern(g.dates.sort());
      if (!frequency) continue;
      const avg = g.amounts.reduce((a,c)=>a+c,0)/g.amounts.length;
      if (avg < 700) continue;
      // Same rule: don’t emit four_weekly; keep monthly.
      const freq: PayFrequency = (frequency as PayFrequency);
      out.push({ amount: Math.round(avg*100)/100, freq, description: "inflow cluster", firstSeen: g.dates[0] });
    }
  }

  // de-dupe by (freq, rounded amount)
  const seen = new Set<string>(); const uniq: SalaryCandidate[] = [];
  for (const c of out.sort((a,b)=>b.amount-a.amount)) {
    const k = `${c.freq}:${Math.round(c.amount/10)*10}`;
    if (seen.has(k)) continue; seen.add(k); uniq.push(c);
  }
  return uniq;
}
