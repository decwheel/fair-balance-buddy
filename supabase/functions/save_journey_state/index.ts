// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json"
    }
  });
}
serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: cors
  });
  if (req.method !== "POST") return json({
    error: "Method not allowed"
  }, 405);
  const { journey_id, journey_secret, patch } = await req.json().catch(()=>({}));
  if (!journey_id || !journey_secret || typeof patch !== "object") {
    return json({
      error: "missing_params"
    }, 400);
  }
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false
    }
  });
  // Verify secret
  const { data: j, error: jErr } = await sb.from("journeys").select("id, secret, state, upgraded").eq("id", journey_id).single();
  if (jErr || !j) return json({
    error: "journey_not_found"
  }, 404);
  if (j.secret !== journey_secret) return json({
    error: "unauthorized"
  }, 401);
  if (j.upgraded) return json({
    error: "already_upgraded"
  }, 400);
  // Merge patch into state (shallow by top-level keys)
  const newState = {
    ...j.state || {},
    ...patch
  };
  const { error } = await sb.from("journeys").update({
    state: newState
  }).eq("id", journey_id);
  if (error) return json({
    error: "update_failed",
    detail: error.message
  }, 500);
  return json({
    ok: true
  });
});
