// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@12.18.0?target=deno";
const corsHeaders = {
"Access-Control-Allow-Origin": "*",
"Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
"Access-Control-Allow-Methods": "POST, OPTIONS",
"Content-Type": "application/json"
};
serve(async (req)=>{
  if (req.method === 'OPTIONS') return new Response('ok', {
    headers: corsHeaders
  });
  if (req.method !== 'POST') return new Response(JSON.stringify({
    error: 'method_not_allowed'
  }), {
    status: 405,
    headers: corsHeaders
  });
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
    const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY');
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !STRIPE_SECRET_KEY) throw new Error('missing_env');
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader) return new Response(JSON.stringify({
      error: 'unauthorized'
    }), {
      status: 401,
      headers: corsHeaders
    });
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: authHeader
        }
      }
    });
    const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: {
        persistSession: false
      }
    });
    // Resolve household
    const { data: hm, error: hmErr } = await sb.from('household_members').select('household_id').limit(1).maybeSingle();
    if (hmErr || !hm?.household_id) return new Response(JSON.stringify({
      error: 'no_household'
    }), {
      status: 400,
      headers: corsHeaders
    });
    const hid = hm.household_id;
    // Load stripe_customer_id
    const { data: hh, error: hhErr } = await admin.from('households').select('stripe_customer_id').eq('id', hid).maybeSingle();
    if (hhErr || !hh?.stripe_customer_id) return new Response(JSON.stringify({
      error: 'no_stripe_customer'
    }), {
      status: 400,
      headers: corsHeaders
    });
    const stripe = new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: '2024-06-20'
    });
    const origin = req.headers.get('origin') || 'http://localhost:8080';
    const session = await stripe.billingPortal.sessions.create({
      customer: hh.stripe_customer_id,
      return_url: origin
    });
    return new Response(JSON.stringify({
      url: session.url
    }), {
      status: 200,
      headers: corsHeaders
    });
  } catch (e) {
    console.error('[create_billing_portal_session] error', e);
    return new Response(JSON.stringify({
      error: 'server_error'
    }), {
      status: 500,
      headers: corsHeaders
    });
  }
});
