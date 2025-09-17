import { supabase } from "@/integrations/supabase/client";

export type AccountStatus = {
  isTrialing: boolean;
  trialEndsAt: string | null;
  isSubscribed: boolean;
};

async function fetchViaRpc(): Promise<AccountStatus | null> {
  try {
    const { data, error } = await (supabase as any).rpc('get_account_status');
    if (error) return null;
    if (!data) return null;
    return {
      isTrialing: Boolean((data as any).isTrialing),
      trialEndsAt: (data as any).trialEndsAt || null,
      isSubscribed: Boolean((data as any).isSubscribed),
    };
  } catch {
    return null;
  }
}

async function fetchViaHousehold(): Promise<AccountStatus | null> {
  try {
    const { data: hm } = await supabase
      .from('household_members')
      .select('household_id')
      .limit(1)
      .maybeSingle();
    const household_id = hm?.household_id;
    if (!household_id) return null;
    const { data: hh } = await supabase
      .from('households')
      .select('trial_ends_at, is_subscribed')
      .eq('id', household_id)
      .maybeSingle();
    const now = new Date();
    const trialEndsAt = hh?.trial_ends_at || null;
    const isSubscribed = Boolean(hh?.is_subscribed);
    const isTrialing = !isSubscribed && !!trialEndsAt && new Date(trialEndsAt) > now;
    return { isTrialing, trialEndsAt, isSubscribed };
  } catch {
    return null;
  }
}

export async function getAccountStatus(): Promise<AccountStatus | null> {
  try {
    const { data: session } = await supabase.auth.getSession();
    if (!session?.session) return null;
  } catch {
    return null;
  }
  // Prefer RPC if present; fallback to direct table reads
  const viaRpc = await fetchViaRpc();
  if (viaRpc) return viaRpc;
  return await fetchViaHousehold();
}

