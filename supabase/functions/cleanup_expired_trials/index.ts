// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = {
"Access-Control-Allow-Origin": "*",
"Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
"Access-Control-Allow-Methods": "POST, OPTIONS",
"Content-Type": "application/json"
};
serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: cors
  });
  if (req.method !== "POST") return new Response(JSON.stringify({
    error: "method_not_allowed"
  }), {
    status: 405,
    headers: cors
  });
  try {
    const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
    const hdr = req.headers.get("x-cron-secret") || req.headers.get("x-cron-key") || "";
    if (!CRON_SECRET || hdr !== CRON_SECRET) {
      return new Response(JSON.stringify({
        error: "unauthorized"
      }), {
        status: 401,
        headers: cors
      });
    }
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: {
        persistSession: false
      }
    });
    const body = await req.json().catch(()=>({}));
    const graceDays = Number(body?.graceDays ?? Deno.env.get("CLEANUP_GRACE_DAYS") ?? 30);
    const dryRun = Boolean(body?.dryRun ?? Deno.env.get("CLEANUP_DRY_RUN") === "true");
    const cutoff = new Date(Date.now() - graceDays * 86400000).toISOString();
    const { data: hh, error: hhErr } = await admin.from("households").select("id").eq("is_subscribed", false).lt("trial_ends_at", cutoff);
    if (hhErr) throw hhErr;
    const households = (hh || []).map((r)=>r.id);
    const summary = {
      households: households.length,
      items: []
    };
    for (const hid of households){
      const item = {
        household_id: hid,
        deleted: {}
      };
      if (dryRun) {
        summary.items.push(item);
        continue;
      }
      // Delete wages_detected (by persons)
      const { data: persons } = await admin.from("persons").select("id").eq("household_id", hid);
      const personIds = (persons || []).map((p)=>p.id);
      if (personIds.length) {
        await admin.from("wages_detected").delete().in("person_id", personIds);
        item.deleted.wages_detected = personIds.length; // approx
      }
      await admin.from("persons").delete().eq("household_id", hid);
      item.deleted.persons = personIds.length;
      // Forecasts / items
      const { data: forecasts } = await admin.from("forecasts").select("id").eq("household_id", hid);
      const fids = (forecasts || []).map((f)=>f.id);
      if (fids.length) {
        await admin.from("forecast_items").delete().in("forecast_id", fids);
        item.deleted.forecast_items = fids.length; // approx
      }
      await admin.from("forecasts").delete().eq("household_id", hid);
      item.deleted.forecasts = fids.length;
      // Bills/energy/gc_links/recurring
      await admin.from("recurring_bills").delete().eq("household_id", hid);
      await admin.from("electricity_readings").delete().eq("household_id", hid);
      await admin.from("electricity_bills").delete().eq("household_id", hid);
      await admin.from("gc_links").delete().eq("household_id", hid);
      // Memberships then household
      await admin.from("household_members").delete().eq("household_id", hid);
      await admin.from("journeys").delete().eq("upgraded_household", hid);
      await admin.from("households").delete().eq("id", hid);
      summary.items.push(item);
    }
    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: cors
    });
  } catch (e) {
    console.error("[cleanup_expired_trials] error", e);
    return new Response(JSON.stringify({
      error: "server_error",
      detail: String(e?.message || e)
    }), {
      status: 500,
      headers: cors
    });
  }
});
