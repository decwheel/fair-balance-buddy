// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" }
  });
}

// Simple in-memory rate limit per IP
const rl = new Map<string, { count: number; window: number }>();
const WINDOW_MS = 60_000; // 1m
const MAX_REQ = 10;

function allow(ip: string) {
  const now = Date.now();
  const r = rl.get(ip);
  if (!r || now - r.window > WINDOW_MS) {
    rl.set(ip, { count: 1, window: now });
    return true;
  }
  if (r.count < MAX_REQ) {
    r.count++;
    return true;
  }
  return false;
}

function getIP(req: Request) {
  const f = req.headers.get('x-forwarded-for');
  if (f) return f.split(',')[0].trim();
  const r = req.headers.get('x-real-ip');
  return r || 'unknown';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const ip = getIP(req);
  if (!allow(ip)) return json({ error: 'rate_limited' }, 429);

  const { journey_id, journey_secret, ttl_hours } = await req.json().catch(() => ({}));
  if (!journey_id || !journey_secret) return json({ error: 'missing_params' }, 400);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // Verify current secret is valid and not expired
  const { data: isValid, error: vErr } = await sb.rpc('is_journey_secret_valid', {
    journey_id,
    secret: journey_secret,
  });
  if (vErr) return json({ error: 'validation_failed', detail: vErr.message }, 500);
  if (!isValid) return json({ error: 'unauthorized_or_expired' }, 401);

  // Fetch journey
  const { data: j, error: jErr } = await sb
    .from('journeys')
    .select('id, secret, upgraded')
    .eq('id', journey_id)
    .single();
  if (jErr || !j) return json({ error: 'journey_not_found' }, 404);
  if (j.upgraded) return json({ error: 'already_upgraded' }, 400);
  if (j.secret !== journey_secret) return json({ error: 'unauthorized' }, 401);

  // Rotate secret and extend expiry
  const newSecret = crypto.randomUUID() + '-' + crypto.randomUUID();
  const hours = Math.max(1, Math.min(48, Number(ttl_hours) || 24));
  const expiresAt = new Date(Date.now() + hours * 3600_000).toISOString();

  const { error: upErr } = await sb
    .from('journeys')
    .update({ secret: newSecret, secret_expires_at: expiresAt })
    .eq('id', journey_id);
  if (upErr) return json({ error: 'rotate_failed', detail: upErr.message }, 500);

  return json({ ok: true, journey_id, journey_secret: newSecret, expires_at: expiresAt });
});

