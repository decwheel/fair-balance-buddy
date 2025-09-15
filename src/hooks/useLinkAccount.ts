import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getJourney, getHouseholdId } from '@/lib/journey.ts';

// Helper function to detect transaction category
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

// If your "boi" fixtures need mapping, keep normalizeMock.
// Otherwise you can swap to your own mapBoiToTransactions helper.
const normalizeMock = (raw: any[]) =>
  raw.map((x: any) => {
    // Handle different data formats - mock B uses transactionAmount.amount
    const amount = Number(x.transactionAmount?.amount ?? x.amount ?? 0);
    const description = x.remittanceInformationUnstructured ?? x.remittanceInformation ?? x.description ?? '';
    const date = x.bookingDate ?? x.date;
    const id = x.transactionId ?? x.id ?? crypto.randomUUID();
    
    return {
      id,
      dateISO: date,
      date,
      amount,
      description,
      currency: x.transactionAmount?.currency ?? x.currency ?? 'EUR',
      type: amount < 0 ? 'debit' : 'credit',
      category: detectCategory(description, amount),
      balance: 0, // Mock data doesn't have balance
    };
  });

// 👇 import from src/fixtures (no fetch)
import mockA from '@/fixtures/mock-a-boi-transactions.json';
import mockB from '@/fixtures/mock-b-boi-transactions.json';

type Partner = 'A' | 'B';

export function useLinkAccount() {
  const [busy, setBusy] = useState<Partner | null>(null);
  const useMock = (import.meta.env.VITE_USE_MOCK_GC ?? 'true') === 'true';

  const link = useCallback(
    async (partner: Partner, selectedInstitutionId?: string) => {
      if (busy) return;
      setBusy(partner);
      try {
        if (useMock) {
          const raw = partner === 'A' ? (mockA as any) : (mockB as any);
          const arr = Array.isArray(raw) ? raw : (raw?.transactions ?? raw);
          const transactions = normalizeMock(arr);
          console.log(`[useLinkAccount] Normalized ${partner} transactions:`, {
            total: transactions.length,
            wages: transactions.filter(t => t.category === 'wages').length,
            bills: transactions.filter(t => t.category === 'bills').length,
            sampleWages: transactions.filter(t => t.category === 'wages').slice(0, 3),
            sampleBills: transactions.filter(t => t.category === 'bills').slice(0, 3)
          });
          window.dispatchEvent(new CustomEvent('gc:transactions', { detail: { partner, transactions } }) as any);
          // keep if you use this prompt somewhere
          window.dispatchEvent(new CustomEvent('gc:salaryPrompt', { detail: { partner } }) as any);
          return;
        }

        // LIVE: create requisition via Edge Function
        if (!selectedInstitutionId) throw new Error('No institution selected');
        const keys = getJourney();
        const household_id = getHouseholdId();
        const { data, error } = await supabase.functions.invoke('gc_create_link', {
          body: { institutionId: selectedInstitutionId, partner, journey_id: keys?.journey_id, household_id: household_id || undefined },
        });
        if (error) {
          const more = (error as any)?.context || (error as any)?.hint || JSON.stringify(error);
          throw new Error(more || 'gc_create_link failed');
        }
        const url: string | undefined =
          data?.url || data?.link || data?.redirect || data?.auth_url;
        if (!url) throw new Error('No authorization link from gc_create_link');
        window.open(url, '_blank', 'noopener,noreferrer');
      } catch (e: any) {
        console.error(e);
        alert(`Bank linking failed: ${e?.message ?? e}`);
      } finally {
        setBusy(null);
      }
    },
    [busy, useMock]
  );

  return { link, busy };
}
