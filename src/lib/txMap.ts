import type { Transaction } from "../types";

function toNumber(x: any): number {
  if (typeof x === "number") return x;
  if (typeof x === "string") {
    const cleaned = x.replace(/[€,]/g, "").trim();
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function pick<T extends object>(o: any, keys: string[]): any {
  for (const k of keys) if (o && o[k] != null) return o[k];
  return undefined;
}

function unwrapArray(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.transactions)) return raw.transactions;
  // Nordigen/GoCardless style: { transactions: { booked:[], pending:[] } }
  if (raw?.transactions?.booked || raw?.transactions?.pending) {
    return [
      ...(raw.transactions.booked ?? []),
      ...(raw.transactions.pending ?? []),
    ];
  }
  // Sometimes booked/pending are top-level
  if (raw?.booked || raw?.pending) {
    return [ ...(raw.booked ?? []), ...(raw.pending ?? []) ];
  }
  if (raw?.data?.transactions) return raw.data.transactions;
  if (raw?.items) return raw.items;
  if (raw?.records) return raw.records;
  if (raw?.statement?.transactions) return raw.statement.transactions;
  // Fallback: first array value found in the object
  if (raw && typeof raw === "object") {
    const v = Object.values(raw).find(Array.isArray);
    if (Array.isArray(v)) return v;
  }
  return [];
}

// Accepts many common export shapes and returns our Transaction[]
export function mapBoiToTransactions(raw: any): Transaction[] {
  const arr = unwrapArray(raw);
  return arr.map((r: any, i: number) => {
    const date =
      // common date fields
      pick(r, ["date","Date","bookingDate","BookingDate","book_date","postedDate","postingDate","valueDate","valutaDate","valuedate"]) ??
      // sometimes datetime variants
      pick(r, ["valueDateTime","bookingDateTime"]) ??
      // fallback to today so we never crash
      new Date().toISOString().slice(0, 10);

    let descRaw: any =
      pick(r, [
        "remittanceInformationUnstructured",
        "remittanceInformationUnstructuredArray",
        "narrative","Narrative",
        "Details","detail",
        "description","Description",
        "creditorName","debtorName","counterpartyName"
      ]) ?? "unknown";
    if (Array.isArray(descRaw)) descRaw = descRaw.join(" ").trim();

    // Amount can be:
    // - transactionAmount.amount (+ creditDebitIndicator)
    // - signed "amount"
    // - credit/debit pair
    let amount: number | undefined = undefined;
    const ta = r.transactionAmount?.amount ?? r.transaction_amount?.amount;
    if (ta != null) {
      amount = toNumber(String(ta));
      const ind = (r.creditDebitIndicator ?? r.credit_debit_indicator ?? "").toString().toUpperCase();
      if (ind === "DBIT" || ind === "DEBIT") amount = -Math.abs(amount);
      if (ind === "CRDT" || ind === "CREDIT") amount =  Math.abs(amount);
    }
    if (amount == null) {
      amount = toNumber(pick(r, ["amount","Amount","amt"]));
    }
    if (amount == null || amount === 0) {
      const cr = toNumber(pick(r, ["credit","Credit","creditAmount"]));
      const dr = toNumber(pick(r, ["debit","Debit","debitAmount"]));
      if (cr !== 0 || dr !== 0) amount = cr - dr;
    }
    if (typeof amount !== "number" || !Number.isFinite(amount)) amount = 0;

    // Ensure ISO date (yyyy-mm-dd)
    const dateISO = typeof date === "string" && /^\d{4}-\d{2}-\d{2}/.test(date)
      ? date.slice(0, 10)
      : new Date(date).toISOString().slice(0, 10);

    return {
      id: String(r.id ?? i),
      dateISO,
      description: String(descRaw),
      amount,
      bookingDate: (pick(r, ["bookingDate","BookingDate","date","Date","valueDate","postingDate"]) ?? dateISO),
      rawDesc: String(descRaw),
      bankCode: pick(r, ["proprietaryBankTransactionCode","BankTransactionCode","bankCode","proprietary_code"]) ?? undefined,
    };
  });
}
