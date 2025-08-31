import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';

// If your “boi” fixtures need mapping, keep normalizeMock.
// Otherwise you can swap to your own mapBoiToTransactions helper.
const normalizeMock = (raw: any[]) =>
  raw.map((x: any) => ({
    id: x.id ?? crypto.randomUUID(),
    date: x.bookingDate ?? x.date,
    amount: Number(x.amount),
    description: x.remittanceInformation ?? x.description ?? '',
    currency: x.currency ?? 'EUR',
    type: Number(x.amount) < 0 ? 'debit' : 'credit',
  }));

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
          window.dispatchEvent(new CustomEvent('gc:transactions', { detail: { partner, transactions } }) as any);
          // keep if you use this prompt somewhere
          window.dispatchEvent(new CustomEvent('gc:salaryPrompt', { detail: { partner } }) as any);
          return;
        }

        // LIVE: create requisition via Edge Function
        if (!selectedInstitutionId) throw new Error('No institution selected');
        const { data, error } = await supabase.functions.invoke('gc_create_link', {
          body: { institutionId: selectedInstitutionId, partner },
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
