// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@12.18.0?target=deno";
const corsHeaders = {
"Access-Control-Allow-Origin": "*",
"Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
"Access-Control-Allow-Methods": "POST, OPTIONS",
"Content-Type": "application/json"
};
serve(async (req)=>{
  if (req.method === 'OPTIONS') return new Response('ok', {
    headers: corsHeaders
  });
  if (req.method !== 'POST') return new Response(JSON.stringify({
    ok: true
  }), {
    status: 200,
    headers: corsHeaders
  });
  const STRIPE_SECRET = Deno.env.get('STRIPE_SECRET_KEY');
  const SIGNING_SECRET = Deno.env.get('STRIPE_SIGNING_SECRET');
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!STRIPE_SECRET || !SIGNING_SECRET || !SUPABASE_URL || !SERVICE_ROLE) {
    console.error('[stripe_webhook] missing env');
    return new Response(JSON.stringify({
      error: 'missing_env'
    }), {
      status: 500,
      headers: corsHeaders
    });
  }
  const stripe = new Stripe(STRIPE_SECRET, {
    apiVersion: '2024-06-20'
  });
  const sig = req.headers.get('stripe-signature') || '';
  const raw = await req.text();
  let evt;
  try {
    evt = stripe.webhooks.constructEvent(raw, sig, SIGNING_SECRET);
  } catch (err) {
    console.error('[stripe_webhook] signature verify failed', err);
    return new Response(JSON.stringify({
      error: 'invalid_signature'
    }), {
      status: 400,
      headers: corsHeaders
    });
  }
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: {
      persistSession: false
    }
  });
  async function setSubscribedByHousehold(household_id, is_subscribed, customer_id, subscription_id) {
    const patch = {
      is_subscribed
    };
    if (customer_id) patch.stripe_customer_id = customer_id;
    if (subscription_id) patch.stripe_subscription_id = subscription_id;
    // Optional: end trial immediately upon activation
    if (is_subscribed) patch.trial_ends_at = patch.trial_ends_at || new Date().toISOString();
    const { error } = await admin.from('households').update(patch).eq('id', household_id);
    if (error) console.error('[stripe_webhook] update households error', error);
  }
  async function setSubscribedByCustomer(customer_id, is_subscribed, subscription_id) {
    // Lookup household by stripe_customer_id
    const { data, error } = await admin.from('households').select('id').eq('stripe_customer_id', customer_id).maybeSingle();
    if (error) {
      console.error('[stripe_webhook] lookup household by customer failed', error);
      return;
    }
    if (!data?.id) {
      console.warn('[stripe_webhook] no household found for customer', customer_id);
      return;
    }
    await setSubscribedByHousehold(data.id, is_subscribed, customer_id, subscription_id || null);
  }
  try {
    switch(evt.type){
      case 'checkout.session.completed':
        {
          const session = evt.data.object; // Stripe.Checkout.Session
          const customer_id = session.customer;
          const subscription_id = session.subscription;
          const household_id = session.metadata?.household_id;
          if (household_id) {
            await setSubscribedByHousehold(household_id, true, customer_id, subscription_id);
          } else if (customer_id) {
            await setSubscribedByCustomer(customer_id, true, subscription_id);
          }
          break;
        }
      case 'customer.subscription.updated':
        {
          const sub = evt.data.object; // Stripe.Subscription
          const status = String(sub.status || '').toLowerCase();
          const isActive = [
            'active',
            'trialing',
            'past_due'
          ].includes(status);
          const customer_id = sub.customer;
          await setSubscribedByCustomer(customer_id, isActive, sub.id);
          break;
        }
      case 'customer.subscription.deleted':
        {
          const sub = evt.data.object; // Stripe.Subscription
          const customer_id = sub.customer;
          await setSubscribedByCustomer(customer_id, false, sub.id);
          break;
        }
      default:
        break;
    }
  } catch (err) {
    console.error('[stripe_webhook] handler error', err);
  // Still acknowledge to avoid retries storm; logs will show details
  }
  return new Response(JSON.stringify({
    received: true
  }), {
    status: 200,
    headers: corsHeaders
  });
});
