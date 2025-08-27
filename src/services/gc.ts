import { supabase } from '@/integrations/supabase/client';
import { mapBoiToTransactions } from '@/lib/txMap';
import type { Transaction } from '@/types';

export async function startGcLink(redirect: string, institutionId: string) {
  const { data, error } = await supabase.functions.invoke('gc-link', {
    body: { redirect, institutionId },
  });
  if (error || !data) {
    const message = (data as any)?.error || error?.message || 'Unknown error';
    throw new Error(message);
  }
  return data as { link: string; requisition_id: string };
}

export async function fetchGcTransactions(requisitionId: string): Promise<Transaction[]> {
  const { data, error } = await supabase.functions.invoke('gc-pull', {
    body: { requisitionId },
  });
  if (error || !data) {
    const message = (data as any)?.error || error?.message || 'Unknown error';
    throw new Error(message);
  }
  return mapBoiToTransactions((data as any).transactions);
}
