// supabase/functions/get_institutions/index.ts
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
  const base = Deno.env.get('GC_API_BASE_URL') || '';
  const res = await fetch(`${base}/token/new/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      secret_id: Deno.env.get('GC_SECRET_ID'),
      secret_key: Deno.env.get('GC_SECRET_KEY')
    })
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`token_new_failed:${res.status}:${body}`);
  const data = JSON.parse(body);
  cachedToken = data.access;
  tokenExpiry = Date.now() + (data.access_expires ?? 900) * 1000 - 60_000;
  return cachedToken;
}
serve(async (req)=>{
  // CORS preflight
  if (req.method === 'OPTIONS') return new Response('ok', {
    headers: corsHeaders
  });
  // Accept both GET and POST (supabase-js invoke uses POST)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response(JSON.stringify({
      error: 'Method not allowed'
    }), {
      status: 405,
      headers: corsHeaders
    });
  }
  try {
    const url = new URL(req.url);
    let country = url.searchParams.get('country') || 'IE';
    if (req.method === 'POST') {
      try {
        const j = await req.json().catch(()=>({}));
        if (j?.country) country = String(j.country);
      } catch  {}
    }
    const bearer = await getBearer();
    const rsp = await fetch(`${Deno.env.get('GC_API_BASE_URL')}/institutions/?country=${country}`, {
      headers: {
        Authorization: `Bearer ${bearer}`
      }
    });
    const text = await rsp.text();
    if (!rsp.ok) {
      return new Response(JSON.stringify({
        error: 'institutions_failed',
        status: rsp.status,
        body: text
      }), {
        status: 502,
        headers: corsHeaders
      });
    }
    return new Response(text, {
      status: 200,
      headers: corsHeaders
    });
  } catch (err) {
    return new Response(JSON.stringify({
      error: 'server_error',
      detail: String(err.message || err)
    }), {
      status: 500,
      headers: corsHeaders
    });
  }
});
