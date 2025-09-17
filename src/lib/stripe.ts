import { supabase } from "@/integrations/supabase/client";

export async function createCheckoutSession(): Promise<string | null> {
  const { data: session } = await supabase.auth.getSession();
  if (!session?.session) return null;
  const { data, error } = await supabase.functions.invoke('create_checkout_session', {
    body: {},
  });
  if (error) {
    console.error('[stripe] create_checkout_session failed', error);
    return null;
  }
  const url: string | undefined = (data as any)?.url;
  return url || null;
}

export async function createBillingPortalSession(): Promise<string | null> {
  const { data: session } = await supabase.auth.getSession();
  if (!session?.session) return null;
  const { data, error } = await supabase.functions.invoke('create_billing_portal_session', {
    body: {},
  });
  if (error) {
    console.error('[stripe] create_billing_portal_session failed', error);
    return null;
  }
  const url: string | undefined = (data as any)?.url;
  return url || null;
}

