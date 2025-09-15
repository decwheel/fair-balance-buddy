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

function getClientIP(req: Request): string {
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }
  
  const realIP = req.headers.get('x-real-ip');
  if (realIP) {
    return realIP;
  }
  
  return 'unknown';
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: cors
  });
  
  if (req.method !== "POST") return json({
    error: "Method not allowed"
  }, 405);

  const { journey_id, journey_secret, patch } = await req.json().catch(() => ({}));
  
  if (!journey_id || !journey_secret || typeof patch !== "object") {
    return json({
      error: "missing_params"
    }, 400);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false
    }
  });

  try {
    const clientIP = getClientIP(req);

    // Verify secret and check expiry using the secure function
    const { data: isValid, error: validationError } = await sb.rpc('is_journey_secret_valid', {
      journey_id,
      secret: journey_secret
    });

    if (validationError) {
      console.error('Journey validation error:', validationError);
      return json({
        error: "validation_failed",
        detail: validationError.message
      }, 500);
    }

    if (!isValid) {
      console.log(`Invalid or expired journey access attempt - ID: ${journey_id}, IP: ${clientIP}`);
      return json({
        error: "unauthorized_or_expired",
        message: "Journey secret is invalid or has expired"
      }, 401);
    }

    // Get current journey data for verification
    const { data: j, error: jErr } = await sb.from("journeys")
      .select("id, secret, state, upgraded, secret_expires_at, access_count")
      .eq("id", journey_id)
      .single();

    if (jErr || !j) {
      console.error('Journey lookup error:', jErr);
      return json({
        error: "journey_not_found"
      }, 404);
    }

    // Double-check secret match (defense in depth)
    if (j.secret !== journey_secret) {
      console.log(`Secret mismatch for journey ${journey_id} from IP: ${clientIP}`);
      return json({
        error: "unauthorized"
      }, 401);
    }

    // Check if journey is already upgraded (prevent state pollution)
    if (j.upgraded) {
      return json({
        error: "already_upgraded",
        message: "Journey has been migrated to a user account"
      }, 400);
    }

    // Log access for monitoring
    console.log(`Journey state update - ID: ${journey_id}, IP: ${clientIP}, Access Count: ${j.access_count + 1}`);

    // Merge patch into state (shallow by top-level keys)
    const newState = {
      ...j.state || {},
      ...patch
    };

    // Update journey with new state and increment access count
    const { error: updateError } = await sb.from("journeys").update({
      state: newState,
      access_count: (j.access_count || 0) + 1
    }).eq("id", journey_id);

    if (updateError) {
      console.error('Journey update error:', updateError);
      return json({
        error: "update_failed",
        detail: updateError.message
      }, 500);
    }

    return json({
      ok: true,
      expires_at: j.secret_expires_at
    });

  } catch (error) {
    console.error('Unexpected error in save_journey_state:', error);
    return json({
      error: "internal_error",
      detail: error.message
    }, 500);
  }
});
