// Call Supabase Edge Function to parse bill content with OpenAI (server-side)
// The function accepts either raw text, or a base64 data URL image

export interface AiParseRequest {
  text?: string;
  imageBase64?: string; // data URL preferred (e.g., data:image/png;base64,....)
  filename?: string;
}

export async function parseBillWithAI(req: AiParseRequest) {
  const res = await fetch('/functions/v1/extract-tariff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`AI parse failed: ${res.status} ${detail}`);
  }

  return res.json();
}

export async function checkAiStatus() {
  // Try POST health-check first, then fallback to GET ?status=1
  try {
    const res = await fetch('/functions/v1/extract-tariff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'STATUS_CHECK' }),
    });
    if (!res.ok) {
      throw new Error(`${res.status} ${await res.text()}`);
    }
    return res.json();
  } catch (_) {
    const res2 = await fetch('/functions/v1/extract-tariff?status=1', { method: 'GET' });
    if (!res2.ok) {
      const t2 = await res2.text();
      throw new Error(`AI status failed: ${res2.status} ${t2}`);
    }
    return res2.json();
  }
}
