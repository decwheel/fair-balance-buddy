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
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace("Bearer ", "");
  if (!jwt) return json({
    error: "auth_required"
  }, 401);
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${jwt}`
      }
    }
  });
  const { journey_id, journey_secret } = await req.json().catch(()=>({}));
  if (!journey_id || !journey_secret) return json({
    error: "missing_params"
  }, 400);
  // Get authed user id
  // Robustly fetch the authed user (edge runtimes sometimes require explicit token)
  let user_id: string | undefined;
  try {
    const u1 = await sb.auth.getUser();
    user_id = u1?.data?.user?.id;
  } catch {}
  if (!user_id) {
    try {
      const u2 = await sb.auth.getUser(jwt as string);
      user_id = u2?.data?.user?.id;
    } catch {}
  }
  if (!user_id) return json({
    error: "invalid_user"
  }, 401);
  // Fetch journey
  const { data: j, error: jErr } = await sb
    .from("journeys")
    .select("id, secret, state, upgraded, upgraded_household")
    .eq("id", journey_id)
    .single();
  if (jErr || !j) return json({
    error: "journey_not_found"
  }, 404);
  if (j.secret !== journey_secret) return json({
    error: "unauthorized"
  }, 401);
  if (j.upgraded) {
    if (!j.upgraded_household) {
      return json({
        error: "already_upgraded_but_missing_household"
      }, 500);
    }
    return json({
      error: "already_upgraded",
      household_id: j.upgraded_household
    }, 200);
  }
  // Create household + membership
  const { data: hh, error: hhErr } = await sb
    .from("households")
    .insert({ name: "Household" })
    .select("id")
    .single();
  if (hhErr) return json({
    error: "household_create_failed",
    detail: hhErr.message
  }, 500);
  const household_id = hh.id;
  const { error: hmErr } = await sb.from("household_members").insert({
    household_id,
    user_id,
    role: "owner"
  });
  if (hmErr) return json({ error: "household_members_insert_failed", detail: hmErr.message }, 500);
  // Create persons A/B
  const persons = j.state?.persons ?? [
    {
      label: "A"
    },
    {
      label: "B"
    }
  ];
  const personsRows = persons.map((p)=>({
      household_id,
      label: p.label,
      display_name: p.display_name || p.label
    }));
  const { data: pRows, error: pErr } = await sb.from("persons").insert(personsRows).select("id,label");
  if (pErr) return json({ error: "persons_insert_failed", detail: pErr.message }, 500);
  // Insert wages
  const wages = j.state?.wages ?? []; // [{label:'A', frequency:'MONTHLY', amount_per_month:4500, last_seen_date:'2025-03-28', next_date:'2025-10-01', confirmed:true}]
  if (wages.length && pRows?.length) {
    const map = new Map(pRows.map((x)=>[
        x.label,
        x.id
      ]));
    const { error: wErr } = await sb.from("wages_detected").insert(wages.map((w)=>({
        person_id: map.get(w.label),
        frequency: w.frequency,
        amount_per_month: w.amount_per_month,
        last_seen_date: w.last_seen_date,
        next_date: w.next_date,
        confirmed: !!w.confirmed
      })));
    if (wErr) return json({ error: "wages_insert_failed", detail: wErr.message }, 500);
  }
  // Insert recurring bills
  const bills = j.state?.bills ?? []; // [{name, owner:'A'|'B'|'joint', frequency, day_rule, category, amount, confidence}]
  if (bills.length) {
    const { error: rbErr } = await sb.from("recurring_bills").insert(bills.map((b)=>({
        household_id,
        ...b
      })));
    if (rbErr) return json({ error: "recurring_bills_insert_failed", detail: rbErr.message }, 500);
  }
  // Electricity readings + bills (optional)
  const readings = j.state?.electricity_readings ?? []; // [{start_at, end_at, kwh}]
  if (readings.length) {
    const { error: erErr } = await sb.from("electricity_readings").insert(readings.map((r)=>({
        household_id,
        ...r
      })));
    if (erErr) return json({ error: "electricity_readings_insert_failed", detail: erErr.message }, 500);
  }
  const ebills = j.state?.electricity_bills ?? []; // [{bill_date, amount, tariff:{...}}]
  if (ebills.length) {
    const { error: ebErr } = await sb.from("electricity_bills").insert(ebills.map((b)=>({
        household_id,
        bill_date: b.bill_date,
        amount: b.amount,
        tariff: b.tariff || null
      })));
    if (ebErr) return json({ error: "electricity_bills_insert_failed", detail: ebErr.message }, 500);
  }
  // Optional: snapshot last forecast (if you computed one client-side)
  if (j.state?.forecast_items?.length) {
    const { data: f, error: fErr } = await sb.from("forecasts").insert({
      household_id,
      starts_on: j.state?.forecast_starts_on || null,
      months: j.state?.forecast_months || 12
    }).select("id").single();
    if (fErr) return json({ error: "forecasts_insert_failed", detail: fErr.message }, 500);
    if (f?.id) {
      const { error: fiErr } = await sb.from("forecast_items").insert(j.state.forecast_items.map((it)=>({
          forecast_id: f.id,
          ...it
        })));
      if (fiErr) return json({ error: "forecast_items_insert_failed", detail: fiErr.message }, 500);
    }
  }
  // Mark journey upgraded
  const { error: upErr } = await sb.from("journeys").update({
    upgraded: true,
    upgraded_user: user_id,
    upgraded_household: household_id
  }).eq("id", journey_id);
  if (upErr) return json({ error: "journey_update_failed", detail: upErr.message }, 500);
  return json({
    ok: true,
    household_id
  });
});
