import { supabase } from "@/integrations/supabase/client";

export interface PersistableBillRow {
  name: string;
  amount: number;
  due_date: string; // ISO
  frequency?: string; // stored for reference
  recurrence_anchor?: string | null;
  recurrence_interval?: number;
  series_id?: string | null;
  movable?: boolean;
  source?: string;
}

export async function persistBills(rows: PersistableBillRow[]): Promise<{ persisted: boolean; count: number }>{
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) {
    console.warn("Not authenticated — skipping Supabase persistence for bills.");
    return { persisted: false, count: 0 };
  }

  const payload = rows.map(r => ({
    user_id: user.id,
    name: r.name,
    amount: r.amount,
    due_date: r.due_date,
    frequency: r.frequency ?? 'one-off',
    recurrence_anchor: r.recurrence_anchor ?? null,
    recurrence_interval: r.recurrence_interval ?? 1,
    series_id: r.series_id ?? null,
    movable: r.movable ?? true,
    source: r.source ?? 'manual',
  }));

  const { error, count } = await supabase
    .from('bills')
    .insert(payload, { count: 'exact' });

  if (error) {
    console.error('Failed to persist bills:', error);
    return { persisted: false, count: 0 };
  }
  return { persisted: true, count: count ?? payload.length };
}
