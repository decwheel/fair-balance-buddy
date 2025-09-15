import { supabase } from '@/integrations/supabase/client';

type Severity = 'info'|'low'|'medium'|'high'|'critical';

export async function logSecurityEvent(eventType: string, detail?: Record<string, any>, severity: Severity = 'info') {
  try {
    const { data: user } = await supabase.auth.getUser();
    const user_id = user?.user?.id || null;
    if (!user_id) return; // only log for authenticated users
    await supabase.from('security_events').insert({
      user_id,
      event_type: eventType,
      severity,
      detail: detail || null,
    });
  } catch {
    // ignore client-side logging errors
  }
}

let timeoutHandle: any;

export function setupInactivityTimeout(minutes = 15, onTimeout?: () => void) {
  const ms = Math.max(1, minutes) * 60_000;
  const reset = () => {
    try { clearTimeout(timeoutHandle); } catch {}
    timeoutHandle = setTimeout(async () => {
      try { await supabase.auth.signOut(); } catch {}
      try { onTimeout?.(); } catch {}
    }, ms);
  };
  const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart', 'visibilitychange'];
  events.forEach((e) => window.addEventListener(e, reset, { passive: true } as any));
  reset();
  return () => {
    try { clearTimeout(timeoutHandle); } catch {}
    events.forEach((e) => window.removeEventListener(e, reset));
  };
}

export function startSessionValidation(intervalSeconds = 60) {
  const iv = setInterval(async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const sess = data?.session;
      if (!sess) return; // not signed-in
      // If token is near expiry, let supabase auto-refresh. If expired and refresh failed, sign out.
      const exp = (sess as any).expires_at ? new Date((sess as any).expires_at * 1000).getTime() : 0;
      if (exp && Date.now() > exp + 60_000) {
        try { await supabase.auth.refreshSession(); } catch { await supabase.auth.signOut(); }
      }
    } catch {}
  }, Math.max(10, intervalSeconds) * 1000);
  return () => clearInterval(iv);
}

