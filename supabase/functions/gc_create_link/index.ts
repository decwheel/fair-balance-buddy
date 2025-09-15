// supabase/functions/gc_create_link/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json'
};
let cachedToken = null;
let tokenExpiry = 0;
async function getBearer() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const res = await fetch(`${Deno.env.get('GC_API_BASE_URL')}/token/new/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      secret_id: Deno.env.get('GC_SECRET_ID'),
      secret_key: Deno.env.get('GC_SECRET_KEY')
    })
  });
  if (!res.ok) throw new Error(`bearer_failed:${res.status}`);
  const data = await res.json();
  cachedToken = data.access;
  tokenExpiry = Date.now() + (data.access_expires ?? 900) * 1000 - 60_000;
  return cachedToken;
}
serve(async (req)=>{
  if (req.method === 'OPTIONS') return new Response('ok', {
    headers: corsHeaders
  });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({
      error: 'Method not allowed'
    }), {
      status: 405,
      headers: corsHeaders
    });
  }
  try {
    const payload = await req.json().catch(()=>({}));
    const { institutionId, partner = 'A', journey_id = null, household_id = null } = payload || {};
    if (!institutionId) {
      return new Response(JSON.stringify({
        error: 'institutionId required'
      }), {
        status: 400,
        headers: corsHeaders
      });
    }
    const reference = `${partner}-${Date.now()}`;
    const base = Deno.env.get('NEXT_PUBLIC_BASE_URL') || Deno.env.get('APP_BASE_URL') || 'http://localhost:8080';
    const redirect = `${base}/bank-callback?reference=${encodeURIComponent(reference)}`;
    const bearer = await getBearer();
    const call = await fetch(`${Deno.env.get('GC_API_BASE_URL')}/requisitions/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        institution_id: institutionId,
        reference,
        redirect
      })
    });
    const text = await call.text();
    if (!call.ok) {
      return new Response(JSON.stringify({
        error: 'create_link_failed',
        status: call.status,
        body: text
      }), {
        status: 502,
        headers: corsHeaders
      });
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch  {
      data = {
        link: null,
        id: null,
        raw: text
      };
    }
    if (!data?.link || !data?.id) {
      return new Response(JSON.stringify({
        error: 'missing_link_or_id',
        body: data
      }), {
        status: 502,
        headers: corsHeaders
      });
    }
    // Record this requisition against the current journey or household
    try {
      const url = Deno.env.get('SUPABASE_URL');
      const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
      const sb = createClient(url, key, {
        auth: {
          persistSession: false
        }
      });
      await sb.from('gc_links').upsert({
        requisition_id: data.id,
        reference,
        partner,
        journey_id,
        household_id
      }, {
        onConflict: 'requisition_id'
      });
    } catch (_e) {
    // swallow; link creation still succeeds even if logging fails
    }
    return new Response(JSON.stringify({
      requisitionId: data.id,
      link: data.link
    }), {
      status: 200,
      headers: corsHeaders
    });
  } catch (err) {
    return new Response(JSON.stringify({
      error: err?.message || 'server_error'
    }), {
      status: 500,
      headers: corsHeaders
    });
  }
});
