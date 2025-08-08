export interface Transaction {
  id: string;
  date: string; // ISO date string
  description: string;
  amount: number; // positive for credits, negative for debits
  balance: number;
  category: 'wages' | 'bills' | 'misc';
  type: 'credit' | 'debit';
}

export async function loadMockTransactionsA(): Promise<Transaction[]> {
  const { default: raw } = await import('@/data/mockBoiA.json');
  return normalizeTransactions(raw);
}

export async function loadMockTransactionsB(): Promise<Transaction[]> {
  const { default: raw } = await import('@/data/mockBoiB.json');
  return normalizeTransactions(raw);
}

function normalizeTransactions(raw: any): Transaction[] {
  const items: any[] = Array.isArray(raw) ? raw : raw?.transactions ?? [];
  return items.map((it: any, idx: number) => {
    // FairSplit fixtures shape
    if (it && (it.transactionId || it.internalTransactionId)) {
      const amountStr = it.transactionAmount?.amount ?? it.amount ?? '0';
      const amount = typeof amountStr === 'number' ? amountStr : parseFloat(String(amountStr));
      const description: string = it.remittanceInformationUnstructured ?? it.description ?? '';
      const date: string = it.bookingDate ?? it.date ?? new Date().toISOString().slice(0, 10);
      const id: string = String(it.transactionId || it.internalTransactionId || `tx_${idx}`);
      const category = detectCategory(description, amount);
      return {
        id,
        date,
        description,
        amount,
        balance: 0,
        category,
        type: amount >= 0 ? 'credit' : 'debit',
      } as Transaction;
    }

    // Already in our internal shape
    const amount = typeof it.amount === 'string' ? parseFloat(it.amount) : it.amount;
    const desc = it.description ?? '';
    const category = detectCategory(desc, amount);
    return {
      id: String(it.id ?? `tx_${idx}`),
      date: it.date,
      description: desc,
      amount,
      balance: typeof it.balance === 'number' ? it.balance : 0,
      category: it.category ?? category,
      type: amount >= 0 ? 'credit' : 'debit',
    } as Transaction;
  });
}

function detectCategory(description: string, amount: number): 'wages' | 'bills' | 'misc' {
  const desc = (description || '').toUpperCase();
  const isCredit = amount >= 0;

  const wageKeywords = [
    'SALARY', 'PAYROLL', 'PAYMENT', 'WAGES', 'WAGE', 'PAYE', 'HR', 'ACME', 'BONUS'
  ];
  const billKeywords = [
    'ESB', 'ELECTRIC', 'BORD GAIS', 'GAS', 'IRISH WATER', 'WATER', 'EIR', 'VODAFONE', 'THREE',
    'NETFLIX', 'SPOTIFY', 'INSURANCE', 'MORTGAGE', 'RENT', 'LOAN', 'DD', 'DIRECT DEBIT',
    'EFLOW', 'TOLL', 'CRECHE', 'SSE', 'ENERGY', 'WASTE', 'BIN'
  ];

  if (isCredit && wageKeywords.some(k => desc.includes(k))) return 'wages';
  if (!isCredit && billKeywords.some(k => desc.includes(k))) return 'bills';
  return 'misc';
}

export function categorizeBankTransactions(transactions: Transaction[]): {
  wages: Transaction[];
  bills: Transaction[];
  misc: Transaction[];
} {
  return {
    wages: transactions.filter(tx => tx.category === 'wages'),
    bills: transactions.filter(tx => tx.category === 'bills'),
    misc: transactions.filter(tx => tx.category === 'misc'),
  };
}

export function extractPayScheduleFromWages(wages: Transaction[]): {
  frequency: 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY' | 'BIWEEKLY' | 'FOUR_WEEKLY';
  anchorDate: string;
  averageAmount: number;
} | null {
  if (wages.length < 2) return null;

  // Sort by date
  const sortedWages = [...wages].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  
  // Calculate average interval between pay dates
  const intervals: number[] = [];
  for (let i = 1; i < sortedWages.length; i++) {
    const prev = new Date(sortedWages[i - 1].date);
    const curr = new Date(sortedWages[i].date);
    intervals.push((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
  }

  const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const averageAmount = wages.reduce((sum, w) => sum + w.amount, 0) / wages.length;

  // Determine frequency based on average interval
  let frequency: 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY' | 'BIWEEKLY' | 'FOUR_WEEKLY';
  if (avgInterval <= 9) frequency = 'WEEKLY';
  else if (avgInterval <= 16) frequency = 'FORTNIGHTLY';
  else if (avgInterval <= 23) frequency = 'BIWEEKLY';
  else if (avgInterval <= 32) frequency = 'FOUR_WEEKLY';
  else frequency = 'MONTHLY';

  return {
    frequency,
    anchorDate: sortedWages[sortedWages.length - 1].date, // Last pay date as anchor
    averageAmount
  };
}