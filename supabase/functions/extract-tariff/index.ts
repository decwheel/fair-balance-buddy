// deno-lint-ignore-file no-explicit-any
// Supabase Edge Function: extract-tariff
// Parses electricity bill text or image using OpenAI and returns structured tariff data
// Runtime: Deno on Supabase Edge

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

interface TariffRates {
  supplier: string;
  plan: string;
  meterType: '24HR' | 'DAY_NIGHT' | 'SMART_TOU';
  standingChargeDaily: number;
  vatRate: number;
  rates: Record<string, number>;
  billingPeriodDays?: number;
  nextDueDate?: string;
  confidence: number;
  discounts?: Record<string, unknown>;
  fitRate?: number;
}

interface BillPdfParseResult {
  tariff: TariffRates | null;
  billTotal?: number;
  billingPeriod?: { start: string; end: string; days: number };
  errors: string[];
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
  if (!OPENAI_API_KEY) {
    return Response.json({ error: 'Missing OPENAI_API_KEY secret' }, { status: 500 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch (_) {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { text, imageBase64, filename } = body as { text?: string; imageBase64?: string; filename?: string };
  if (!text && !imageBase64) {
    return Response.json({ error: 'Provide either `text` or `imageBase64`' }, { status: 400 });
  }

  const system = `You are an expert at extracting structured electricity tariff data from Irish energy bills (PDF text or image OCR).\nReturn STRICT JSON only with keys: {\n  "tariff": {\n    "supplier": string,\n    "plan": string,\n    "meterType": "24HR"|"DAY_NIGHT"|"SMART_TOU",\n    "standingChargeDaily": number,\n    "vatRate": number,\n    "rates": object, // keys among: peak, day, night, standard (€/kWh)\n    "billingPeriodDays": number|null,\n    "nextDueDate": string|null, // ISO yyyy-mm-dd\n    "confidence": number // 0-1\n  },\n  "billTotal": number|null,\n  "billingPeriod": {"start": string, "end": string, "days": number}|null,\n  "errors": string[]\n}\nRules:\n- Use euros as numbers (e.g., 0.285).\n- If a field is unknown, set it to null or omit it.\n- Infer meterType from context (Smart TOU, Day/Night, or single 24HR).\n- Derive billingPeriodDays from period if present.\n- nextDueDate should be ISO (yyyy-mm-dd) if given.`;

  const userText = text ? `Bill content (text):\n---\n${text}\n---` : undefined;

  // Build OpenAI payload (chat completions for broad compatibility, using gpt-4o-mini for vision)
  const messages: any[] = [{ role: 'system', content: system }];
  if (userText && !imageBase64) {
    messages.push({ role: 'user', content: userText });
  } else if (imageBase64) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: `Please extract tariff data from this bill image. ${filename ? `Filename: ${filename}` : ''}` },
        { type: 'image_url', image_url: { url: imageBase64 } },
        ...(userText ? [{ type: 'text', text: userText }] : []),
      ],
    });
  }

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      return Response.json({ error: 'OpenAI error', detail: t }, { status: 500 });
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content ?? '{}';

    let parsed: BillPdfParseResult;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      return Response.json({ error: 'Failed to parse model JSON', raw: content }, { status: 500 });
    }

    // Basic normalization
    const errors: string[] = Array.isArray(parsed.errors) ? parsed.errors : [];
    const tariff = parsed.tariff ?? null;
    if (tariff) {
      // Ensure numeric types
      tariff.standingChargeDaily = Number(tariff.standingChargeDaily ?? 0);
      tariff.vatRate = Number(tariff.vatRate ?? 0.135);
      tariff.confidence = Number(tariff.confidence ?? 0.6);
      if (tariff.rates) {
        for (const k of Object.keys(tariff.rates)) {
          tariff.rates[k] = Number(tariff.rates[k]);
        }
      }
    }

    const result: BillPdfParseResult = {
      tariff,
      billTotal: parsed.billTotal ?? undefined,
      billingPeriod: parsed.billingPeriod ?? undefined,
      errors,
    };

    return Response.json(result);
  } catch (err) {
    return Response.json({ error: 'Unexpected error', detail: String(err) }, { status: 500 });
  }
});
