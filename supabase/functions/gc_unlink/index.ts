// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const corsHeaders = {
'Access-Control-Allow-Origin': '*',
'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
'Access-Control-Allow-Methods': 'POST, OPTIONS',
'Content-Type': 'application/json'
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
    const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE) throw new Error('missing_env');
    const auth = req.headers.get('Authorization') || '';
    if (!auth) return new Response(JSON.stringify({
      error: 'unauthorized'
    }), {
      status: 401,
      headers: corsHeaders
    });
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: auth
        }
      }
    });
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: {
        persistSession: false
      }
    });
    const body = await req.json().catch(()=>({}));
    const partner = String(body?.partner || '').toUpperCase();
    const requisitionId = body?.requisitionId ? String(body.requisitionId) : null;
    if (!partner && !requisitionId) {
      return new Response(JSON.stringify({
        error: 'missing_params'
      }), {
        status: 400,
        headers: corsHeaders
      });
    }
    // Resolve household from membership
    const { data: hm, error: hmErr } = await userClient.from('household_members').select('household_id').limit(1).maybeSingle();
    if (hmErr || !hm?.household_id) return new Response(JSON.stringify({
      error: 'no_household'
    }), {
      status: 400,
      headers: corsHeaders
    });
    const household_id = hm.household_id;
    // Delete link mapping for this household by partner or requisition
    let q = admin.from('gc_links').delete().eq('household_id', household_id);
    if (requisitionId) q = q.eq('requisition_id', requisitionId);
    if (partner) q = q.eq('partner', partner);
    const { error: delErr } = await q;
    if (delErr) return new Response(JSON.stringify({
      error: 'unlink_failed',
      detail: delErr.message
    }), {
      status: 500,
      headers: corsHeaders
    });
    return new Response(JSON.stringify({
      ok: true
    }), {
      status: 200,
      headers: corsHeaders
    });
  } catch (e) {
    console.error('[gc_unlink] error', e);
    return new Response(JSON.stringify({
      error: 'server_error'
    }), {
      status: 500,
      headers: corsHeaders
    });
  }
});
