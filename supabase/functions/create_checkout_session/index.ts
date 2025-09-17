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
    const PRICE_ID = Deno.env.get('STRIPE_PRICE_ID');
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('missing_supabase_env');
    if (!STRIPE_SECRET_KEY || !PRICE_ID) throw new Error('missing_stripe_env');
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
    // Resolve household of current user
    const { data: hm, error: hmErr } = await sb.from('household_members').select('household_id').limit(1).maybeSingle();
    if (hmErr) throw new Error('household_lookup_failed');
    const household_id = hm?.household_id;
    if (!household_id) return new Response(JSON.stringify({
      error: 'no_household'
    }), {
      status: 400,
      headers: corsHeaders
    });
    // Load household stripe fields (needs service role to update later)
    const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: {
        persistSession: false
      }
    });
    const { data: hh, error: hhErr } = await admin.from('households').select('id, stripe_customer_id').eq('id', household_id).maybeSingle();
    if (hhErr || !hh) throw new Error('household_fetch_failed');
    const stripe = new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: '2024-06-20'
    });
    let customerId = hh.stripe_customer_id;
    if (!customerId) {
      // Create a new customer and persist id
      const { data: prof } = await sb.auth.getUser();
      const email = prof?.user?.email || undefined;
      const customer = await stripe.customers.create({
        email,
        metadata: {
          household_id
        }
      });
      customerId = customer.id;
      await admin.from('households').update({
        stripe_customer_id: customerId
      }).eq('id', household_id);
    }
    const origin = req.headers.get('origin') || 'http://localhost:8080';
    const success_url = `${origin}/upgrade-success`;
    const cancel_url = origin;
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [
        {
          price: PRICE_ID,
          quantity: 1
        }
      ],
      success_url,
      cancel_url,
      metadata: {
        household_id
      }
    });
    return new Response(JSON.stringify({
      url: session.url
    }), {
      status: 200,
      headers: corsHeaders
    });
  } catch (e) {
    console.error('[create_checkout_session] error', e);
    return new Response(JSON.stringify({
      error: 'server_error',
      detail: String(e?.message || e)
    }), {
      status: 500,
      headers: corsHeaders
    });
  }
});
