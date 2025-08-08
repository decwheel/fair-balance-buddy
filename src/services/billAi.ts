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
  const res = await fetch('/functions/v1/extract-tariff?status=1', { method: 'GET' });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`AI status failed: ${res.status} ${t}`);
  }
  return res.json();
}
