// Call Supabase Edge Function to parse bill content with OpenAI (server-side)
// The function accepts either raw text, or a base64 data URL image
import { supabase } from "@/integrations/supabase/client";

export interface AiParseRequest {
  text?: string;
  imageBase64?: string; // data URL preferred (e.g., data:image/png;base64,....)
  filename?: string;
}

export async function parseBillWithAI(req: AiParseRequest) {
  const { data, error } = await supabase.functions.invoke('extract-tariff', { body: req });
  if (error) {
    throw new Error(`AI parse failed: ${error.message ?? String(error)}`);
  }
  return data;
}

export async function checkAiStatus() {
  // Prefer a simple GET to avoid CORS preflight differences across environments
  const baseUrl = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined;
  const url = `${baseUrl || ''}/functions/v1/extract-tariff?status=1`;
  const resp = await fetch(url, { method: 'GET' });
  if (!resp.ok) throw new Error(`AI status failed: ${resp.status}`);
  return await resp.json();
}
