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
  const { default: data } = await import('@/data/mockBoiA.json');
  return data as Transaction[];
}

export async function loadMockTransactionsB(): Promise<Transaction[]> {
  const { default: data } = await import('@/data/mockBoiB.json');
  return data as Transaction[];
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
  const intervals = [];
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