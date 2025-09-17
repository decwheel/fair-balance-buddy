// deno-lint-ignore-file no-explicit-any
// Supabase Edge Function: extract-tariff
// Parses electricity bill text or image using OpenAI and returns structured tariff data
// Runtime: Deno on Supabase Edge
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// CORS helpers: allow multiple origins and echo back the request origin when allowed
function getCorsHeaders(req) {
  const envList = Deno.env.get("ALLOWED_ORIGINS") || Deno.env.get("ALLOWED_ORIGIN") || "*";
  const allowlist = envList.split(",").map((s)=>s.trim()).filter(Boolean);
  const reqOrigin = req.headers.get("origin") || "";
  const allowAll = allowlist.includes("*");
  // Default allowlist for local dev if nothing configured (keeps old behaviour working locally)
  const defaults = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:8080",
    "http://127.0.0.1:8080"
  ];
  // Even when an allowlist is configured, include localhost defaults to keep local dev working
  const effectiveList = allowlist.length === 0 ? defaults : Array.from(new Set([
    ...allowlist,
    ...defaults
  ]));
  const originToAllow = allowAll ? reqOrigin || "*" : effectiveList.includes(reqOrigin) ? reqOrigin : effectiveList[0] || "*";
  // Echo requested headers for preflight if present (covers library-specific headers)
  const reqHeaders = req.headers.get("access-control-request-headers");
  const allowHeaders = reqHeaders && reqHeaders.length > 0 ? reqHeaders : "authorization, x-client-info, apikey, content-type";
  return {
    "Access-Control-Allow-Origin": originToAllow,
    "Access-Control-Allow-Headers": allowHeaders,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    // Help caches vary on Origin to avoid leaking CORS across sites
    "Vary": "Origin"
  };
}
function json(req, body, init) {
  const cors = getCorsHeaders(req);
  const base = {
    headers: {
      ...cors,
      "Content-Type": "application/json"
    }
  };
  return new Response(JSON.stringify(body), {
    ...base,
    ...init,
    headers: {
      ...base.headers,
      ...init?.headers || {}
    }
  });
}
Deno.serve(async (req)=>{
  // Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: getCorsHeaders(req)
    });
  }
  // Cope with environments that pass a relative URL; fall back to string search
  let url = null;
  try {
    url = new URL(req.url, "http://edge");
  } catch (_) {
    url = null;
  }
  // Lightweight GET health check: /functions/v1/extract-tariff?status=1
  const isStatusCheck = req.method === "GET" && (url?.searchParams.get("status") !== null || req.url.includes("status="));
  if (isStatusCheck) {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    return json(req, {
      ok: true,
      function: "extract-tariff",
      hasOpenAIKey: Boolean(OPENAI_API_KEY)
    });
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: getCorsHeaders(req)
    });
  }
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  let body = {};
  try {
    body = await req.json();
  } catch (_) {
    return json(req, {
      error: "Invalid JSON body"
    }, {
      status: 400
    });
  }
  const { text, imageBase64, filename } = body;
  if (!text && !imageBase64) {
    return json(req, {
      error: "Provide either `text` or `imageBase64`"
    }, {
      status: 400
    });
  }
  // Guards to prevent abuse
  const MAX_TEXT_CHARS = 200_000; // ~200 KB
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
  if (typeof text === 'string' && text.length > MAX_TEXT_CHARS) {
    return json(req, {
      error: "payload_too_large",
      message: "Text exceeds limit"
    }, {
      status: 413
    });
  }
  if (typeof imageBase64 === 'string') {
    if (!imageBase64.startsWith('data:')) {
      return json(req, {
        error: "invalid_image",
        message: "Expected data URL"
      }, {
        status: 400
      });
    }
    const comma = imageBase64.indexOf(',');
    const b64 = comma >= 0 ? imageBase64.slice(comma + 1) : imageBase64;
    const estimatedBytes = Math.floor(b64.length * 3 / 4);
    if (estimatedBytes > MAX_IMAGE_BYTES) {
      return json(req, {
        error: "payload_too_large",
        message: "Image exceeds limit"
      }, {
        status: 413
      });
    }
  }
  const system = `You are an expert at extracting structured electricity tariff data from Irish energy bills (PDF text or image OCR).\nReturn STRICT JSON only with keys: {\n  "tariff": {\n    "supplier": string,\n    "plan": string,\n    "meterType": "24HR"|"DAY_NIGHT"|"SMART_TOU",\n    "standingChargeDaily": number,\n    "vatRate": number,\n    "rates": object, // keys among: peak, day, night, standard (€/kWh)\n    "billingPeriodDays": number|null,\n    "nextDueDate": string|null, // ISO yyyy-mm-dd\n    "confidence": number // 0-1\n  },\n  "billTotal": number|null,\n  "billingPeriod": {"start": string, "end": string, "days": number}|null,\n  "errors": string[]\n}\nRules:\n- Use euros as numbers (e.g., 0.285).\n- If a field is unknown, set it to null or omit it.\n- Infer meterType from context (Smart TOU, Day/Night, or single 24HR).\n- Derive billingPeriodDays from period if present.\n- nextDueDate should be ISO (yyyy-mm-dd) if given.`;
  const userText = text ? `Bill content (text):\n---\n${text}\n---` : undefined;
  // Build OpenAI payload (chat completions for broad compatibility, using gpt-4o-mini for vision)
  const messages = [
    {
      role: "system",
      content: system
    }
  ];
  if (userText && !imageBase64) {
    messages.push({
      role: "user",
      content: userText
    });
  } else if (imageBase64) {
    messages.push({
      role: "user",
      content: [
        {
          type: "text",
          text: `Please extract tariff data from this bill image. ${filename ? `Filename: ${filename}` : ""}`
        },
        {
          type: "image_url",
          image_url: {
            url: imageBase64
          }
        },
        ...userText ? [
          {
            type: "text",
            text: userText
          }
        ] : []
      ]
    });
  }
  // Status check without calling OpenAI
  if (text === "STATUS_CHECK") {
    return json(req, {
      ok: true,
      function: "extract-tariff",
      hasOpenAIKey: Boolean(OPENAI_API_KEY)
    });
  }
  if (!OPENAI_API_KEY) {
    return json(req, {
      error: "Missing OPENAI_API_KEY secret"
    }, {
      status: 500
    });
  }
  try {
    // Timebox the OpenAI call to avoid hanging the client if upstream stalls
    const ac = new AbortController();
    const timer = setTimeout(()=>ac.abort(), 45_000);
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages,
        temperature: 0.2,
        response_format: {
          type: "json_object"
        }
      }),
      signal: ac.signal
    });
    clearTimeout(timer);
    if (!resp.ok) {
      const t = await resp.text();
      return json(req, {
        error: "OpenAI error",
        detail: t
      }, {
        status: 500
      });
    }
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content ?? "{}";
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      return json(req, {
        error: "Failed to parse model JSON",
        raw: content
      }, {
        status: 500
      });
    }
    // Basic normalization
    const errors = Array.isArray(parsed.errors) ? parsed.errors : [];
    const tariff = parsed.tariff ?? null;
    if (tariff) {
      // Ensure numeric types
      tariff.standingChargeDaily = Number(tariff.standingChargeDaily ?? 0);
      tariff.vatRate = Number(tariff.vatRate ?? 0.135);
      tariff.confidence = Number(tariff.confidence ?? 0.6);
      if (tariff.rates) {
        for (const k of Object.keys(tariff.rates)){
          tariff.rates[k] = Number(tariff.rates[k]);
        }
      }
      // If billingPeriod.days was extracted, surface it on tariff for clients
      const bp = parsed.billingPeriod;
      if (bp && typeof bp.days === "number" && !tariff.billingPeriodDays) {
        tariff.billingPeriodDays = Number(bp.days);
      }
    }
    const result = {
      tariff,
      billTotal: parsed.billTotal ?? undefined,
      billingPeriod: parsed.billingPeriod ?? undefined,
      errors
    };
    return json(req, result);
  } catch (err) {
    return json(req, {
      error: "Unexpected error",
      detail: String(err)
    }, {
      status: 500
    });
  }
});
