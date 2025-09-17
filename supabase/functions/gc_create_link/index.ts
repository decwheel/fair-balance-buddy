// supabase/functions/gc_create_link/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
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
    const { institutionId, partner = 'A', journey_id = null, journey_secret = null } = payload || {};
    if (!institutionId) {
      return new Response(JSON.stringify({
        error: 'institutionId required'
      }), {
        status: 400,
        headers: corsHeaders
      });
    }
    // Determine caller context: authenticated user (household) or guest (journey)
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const ANON = Deno.env.get('SUPABASE_ANON_KEY');
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const authHeader = req.headers.get('Authorization') || '';
    const authed = !!authHeader;
    const userClient = authed ? createClient(SUPABASE_URL, ANON, {
      global: {
        headers: {
          Authorization: authHeader
        }
      }
    }) : null;
    const admin = createClient(SUPABASE_URL, SERVICE, {
      auth: {
        persistSession: false
      }
    });
    let resolvedHousehold = null;
    let resolvedJourney = null;
    if (authed) {
      const { data: hm } = await userClient.from('household_members').select('household_id').limit(1).maybeSingle();
      resolvedHousehold = hm?.household_id || null;
      if (!resolvedHousehold) {
        return new Response(JSON.stringify({
          error: 'no_household_membership'
        }), {
          status: 403,
          headers: corsHeaders
        });
      }
    } else {
      // Guest: require journey_id + journey_secret and validate
      if (!journey_id || !journey_secret) {
        return new Response(JSON.stringify({
          error: 'journey_credentials_required'
        }), {
          status: 401,
          headers: corsHeaders
        });
      }
      const { data: ok } = await admin.rpc('is_journey_secret_valid', {
        journey_id,
        secret: journey_secret
      });
      if (!ok) return new Response(JSON.stringify({
        error: 'unauthorized_or_expired'
      }), {
        status: 401,
        headers: corsHeaders
      });
      resolvedJourney = journey_id;
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
      await admin.from('gc_links').upsert({
        requisition_id: data.id,
        reference,
        partner,
        journey_id: resolvedJourney,
        household_id: resolvedHousehold
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
