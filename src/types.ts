export type PayFrequency = "weekly" | "fortnightly" | "four_weekly" | "monthly";

export type Bill = {
  id: string;
  name: string;
  amount: number;            // euros
  dueDay?: number;           // 1..31 for monthly DDs
  dueDateISO?: string;       // for one-offs (e.g., predicted electricity)
  isVariable?: boolean;      // electricity etc.
  account: "A" | "B" | "JOINT";
  movable?: boolean;         // whether the bill can be moved to optimize deposits
};

export type Transaction = {
  id: string;
  dateISO: string;        // yyyy-mm-dd (posted/booking date)
  description: string;
  amount: number;         // + = inflow, - = outflow
  /** optional raw bits that help the detectors (when available) */
  bookingDate?: string;   // original booking date (yyyy-mm-dd)
  rawDesc?: string;       // creditor/debtor/narrative
  bankCode?: string;      // e.g. proprietaryBankTransactionCode
};

export type SavingsPot = { id: string; name: string; monthly: number; owner: "A"|"B"|"JOINT" };

export type PaySpec = {
  netMonthly: number;     // normalized to “per month” (e.g. 4-weekly => *13/12*)
  freq: PayFrequency;
  firstPayISO: string;    // any date in the pay month is fine
};

export type PlanInputs = {
  a: PaySpec;
  b?: PaySpec;
  bills: Bill[];
  elecPredicted: Bill[];     // one-offs for electricity periods
  pots: SavingsPot[];
  startISO: string;
  minBalance: number;        // usually 0
  mode: "single"|"joint"|"holdback";
  fairnessRatio?: { a: number; b: number }; // income-based
};

export type TimelineEntry = {
  dateISO: string;
  delta: number;
  label: string;
  who?: "A"|"B"|"JOINT";
};

export type SimResult = {
  minBalance: number;
  endBalance: number;
  requiredMonthlyA: number;
  requiredMonthlyB?: number;
  entries: TimelineEntry[];
  billSuggestions?: Array<{
    billId: string;
    currentDate: string;
    suggestedDate: string;
    savingsAmount: number;
    reason: string;
  }>;
};

export type RecurringItem = {
  description: string;
  amount: number;                 // absolute value, euros
  freq: PayFrequency;
  dueDay?: number;                // for monthly, common day-of-month
  dayOfWeek?: number;             // optional, for weekly/fortnightly (0..6, Sun..Sat)
  sampleDates: string[];          // a few example occurrences
};

export type SalaryCandidate = {
  amount: number;                 // per-occur inflow, euros
  freq: PayFrequency;
  description: string;
  firstSeen: string;              // ISO date
};
