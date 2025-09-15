// Call Supabase Edge Function to parse bill content with OpenAI (server-side)
// The function accepts either raw text, or a base64 data URL image
import { supabase } from "@/integrations/supabase/client";

export interface AiParseRequest {
  text?: string;
  imageBase64?: string; // data URL preferred (e.g., data:image/png;base64,....)
  filename?: string;
}

export async function parseBillWithAI(req: AiParseRequest) {
  const baseUrl = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined;
  const url = `${baseUrl || ''}/functions/v1/extract-tariff`;

  // Abort if function stalls (network/CORS hiccups). Continue with local fallback.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 40_000);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`AI parse failed: ${resp.status} ${text}`);
    }
    return await resp.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkAiStatus() {
  // Prefer a simple GET to avoid CORS preflight differences across environments
  const baseUrl = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined;
  const url = `${baseUrl || ''}/functions/v1/extract-tariff?status=1`;
  const resp = await fetch(url, { method: 'GET' });
  if (!resp.ok) throw new Error(`AI status failed: ${resp.status}`);
  return await resp.json();
}
