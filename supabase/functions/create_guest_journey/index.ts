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
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false
    }
  });
  const secret = crypto.randomUUID() + "-" + crypto.randomUUID();
  const { data, error } = await sb.from("journeys").insert({
    secret,
    state: {}
  }).select("id").single();
  if (error) return json({
    error: "db_insert_failed",
    detail: error.message
  }, 500);
  return json({
    journey_id: data.id,
    journey_secret: secret
  });
});
