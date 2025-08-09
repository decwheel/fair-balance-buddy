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
  const { data, error } = await supabase.functions.invoke('extract-tariff', { body: { text: 'STATUS_CHECK' } });
  if (error) {
    throw new Error(`AI status failed: ${error.message ?? String(error)}`);
  }
  return data;
}
