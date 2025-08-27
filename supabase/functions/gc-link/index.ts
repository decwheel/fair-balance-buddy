import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function json(body: unknown, init?: ResponseInit) {
  const base: ResponseInit = { headers: { ...corsHeaders, "Content-Type": "application/json" } };
  return new Response(JSON.stringify(body), { ...base, ...init, headers: { ...base.headers, ...(init?.headers || {}) } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });

  const { institutionId, redirect } = await req.json();

  const id = Deno.env.get("GC_SECRET_ID");
  const key = Deno.env.get("GC_SECRET_KEY");
  const base = Deno.env.get("GC_API_BASE_URL") || "https://bankaccountdata.gocardless.com";
  if (!id || !key) return json({ error: "Missing GoCardless credentials" }, { status: 500 });

  // get access token
  const tokenResp = await fetch(`${base}/api/v2/token/new/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret_id: id, secret_key: key }),
  });
  if (!tokenResp.ok) return json({ error: "token fetch failed", detail: await tokenResp.text() }, { status: 500 });
  const { access } = await tokenResp.json();

  const reference = crypto.randomUUID();

  const reqResp = await fetch(`${base}/api/v2/requisitions/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${access}` },
    body: JSON.stringify({
      institution_id: institutionId,
      redirect,
      reference,
    }),
  });
  if (!reqResp.ok) return json({ error: "requisition failed", detail: await reqResp.text() }, { status: 500 });
  const data = await reqResp.json();

  return json({ link: data.link, requisition_id: data.id });
});
