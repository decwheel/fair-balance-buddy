// supabase/functions/gc_pull/index.ts
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
async function waitForAccount(requisitionId, bearer, timeoutMs = 15000) {
  const start = Date.now();
  while(Date.now() - start < timeoutMs){
    const rsp = await fetch(`${Deno.env.get('GC_API_BASE_URL')}/requisitions/${requisitionId}/`, {
      headers: {
        Authorization: `Bearer ${bearer}`
      }
    });
    const text = await rsp.text();
    if ([
      404,
      429,
      502
    ].includes(rsp.status)) {
      await new Promise((r)=>setTimeout(r, 1000));
      continue;
    }
    if (!rsp.ok) break;
    let json;
    try {
      json = JSON.parse(text);
    } catch  {
      json = {};
    }
    const acc = json.accounts?.[0];
    if (acc) return acc;
    await new Promise((r)=>setTimeout(r, 1000));
  }
  return null;
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
    const body = await req.json();
    const requisitionId = body?.requisitionId;
    const partner = (body?.partner || 'A').toUpperCase();
    const journey_id = body?.journey_id || null;
    const journey_secret = body?.journey_secret || null;
    if (!requisitionId) {
      return new Response(JSON.stringify({
        error: 'missing_requisitionId'
      }), {
        status: 400,
        headers: corsHeaders
      });
    }
    if (Deno.env.get('USE_MOCK_GC') === 'true') {
      // TODO: Replace with your mock arrays
      const transactions = []; // mock-a or mock-b content
      return new Response(JSON.stringify({
        transactions
      }), {
        status: 200,
        headers: corsHeaders
      });
    }
    // Authorize by mapping in gc_links
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const ANON = Deno.env.get('SUPABASE_ANON_KEY');
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const admin = createClient(SUPABASE_URL, SERVICE, {
      auth: {
        persistSession: false
      }
    });
    const authHeader = req.headers.get('Authorization') || '';
    const authed = !!authHeader;
    const userClient = authed ? createClient(SUPABASE_URL, ANON, {
      global: {
        headers: {
          Authorization: authHeader
        }
      }
    }) : null;
    // Lookup the stored mapping for this requisition
    const { data: link, error: linkErr } = await admin.from('gc_links').select('household_id, journey_id, partner').eq('requisition_id', requisitionId).maybeSingle();
    if (linkErr || !link) {
      return new Response(JSON.stringify({
        error: 'unknown_requisition'
      }), {
        status: 404,
        headers: corsHeaders
      });
    }
    if (link.household_id) {
      if (!authed) return new Response(JSON.stringify({
        error: 'unauthorized'
      }), {
        status: 401,
        headers: corsHeaders
      });
      const { data: hm } = await userClient.from('household_members').select('household_id').limit(1).maybeSingle();
      if (!hm?.household_id || hm.household_id !== link.household_id) {
        return new Response(JSON.stringify({
          error: 'forbidden'
        }), {
          status: 403,
          headers: corsHeaders
        });
      }
    } else if (link.journey_id) {
      // Guest path: require valid secret matching stored journey_id
      if (!journey_id || !journey_secret || journey_id !== link.journey_id) {
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
    } else {
      // No ownership info stored — reject
      return new Response(JSON.stringify({
        error: 'ownership_missing'
      }), {
        status: 403,
        headers: corsHeaders
      });
    }
    const bearer = await getBearer();
    const accountId = await waitForAccount(requisitionId, bearer);
    if (!accountId) {
      return new Response(JSON.stringify({
        error: 'no_linked_account'
      }), {
        status: 502,
        headers: corsHeaders
      });
    }
    // Try to compute a sensible date range (optional)
    let from = '', to = '';
    try {
      const metaRes = await fetch(`${Deno.env.get('GC_API_BASE_URL')}/accounts/${accountId}/`, {
        headers: {
          Authorization: `Bearer ${bearer}`
        }
      });
      const meta = metaRes.ok ? await metaRes.json() : {};
      const instId = meta?.institution_id;
      if (instId && instId !== 'SANDBOXFINANCE_SFIN0000') {
        const inst = await fetch(`${Deno.env.get('GC_API_BASE_URL')}/institutions/${instId}/`, {
          headers: {
            Authorization: `Bearer ${bearer}`
          }
        }).then((r)=>r.ok ? r.json() : {});
        const days = Number(inst.transaction_total_days) || 90;
        const today = new Date();
        to = today.toISOString().slice(0, 10);
        const past = new Date(Date.now() - days * 86400000);
        from = past.toISOString().slice(0, 10);
      }
    } catch  {}
    const txUrl = from && to ? `${Deno.env.get('GC_API_BASE_URL')}/accounts/${accountId}/transactions/?date_from=${from}&date_to=${to}` : `${Deno.env.get('GC_API_BASE_URL')}/accounts/${accountId}/transactions/`;
    let all = [];
    for(let i = 0; i < 6; i++){
      const res = await fetch(txUrl, {
        headers: {
          Authorization: `Bearer ${bearer}`
        }
      });
      if ([
        202,
        404,
        502
      ].includes(res.status)) {
        await new Promise((r)=>setTimeout(r, 3000));
        continue;
      }
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('ratelimit-reset')) || Number(res.headers.get('retry-after')) || 60;
        return new Response(JSON.stringify({
          error: 'rate_limited',
          retry_after: retryAfter
        }), {
          status: 429,
          headers: corsHeaders
        });
      }
      const text = await res.text();
      if (!res.ok) {
        return new Response(JSON.stringify({
          error: 'transactions_fetch_failed',
          status: res.status,
          body: text
        }), {
          status: 502,
          headers: corsHeaders
        });
      }
      let json;
      try {
        json = JSON.parse(text);
      } catch  {
        json = {};
      }
      const booked = json.transactions?.booked || [];
      const pending = json.transactions?.pending || [];
      all = [
        ...booked,
        ...pending
      ];
      if (all.length) break;
      await new Promise((r)=>setTimeout(r, 3000));
    }
    if (!all.length) {
      return new Response(JSON.stringify({
        error: 'no_transactions'
      }), {
        status: 502,
        headers: corsHeaders
      });
    }
    return new Response(JSON.stringify({
      transactions: all
    }), {
      status: 200,
      headers: corsHeaders
    });
  } catch (err) {
    return new Response(JSON.stringify({
      error: err.message || 'pull_failed'
    }), {
      status: 500,
      headers: corsHeaders
    });
  }
});
