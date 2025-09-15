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

// Simple in-memory rate limiting (resets on function restart)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10; // Max 10 journeys per IP per minute

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const key = ip;
  
  if (!rateLimitMap.has(key)) {
    rateLimitMap.set(key, { count: 1, windowStart: now });
    return true;
  }
  
  const record = rateLimitMap.get(key);
  
  // Reset window if expired
  if (now - record.windowStart > RATE_LIMIT_WINDOW) {
    rateLimitMap.set(key, { count: 1, windowStart: now });
    return true;
  }
  
  // Check if under limit
  if (record.count < RATE_LIMIT_MAX_REQUESTS) {
    record.count++;
    return true;
  }
  
  return false;
}

function getClientIP(req: Request): string {
  // Try to get real IP from headers (for proxies/load balancers)
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }
  
  const realIP = req.headers.get('x-real-ip');
  if (realIP) {
    return realIP;
  }
  
  // Fallback to connection info (may not be available in all environments)
  return 'unknown';
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: cors
  });
  
  if (req.method !== "POST") return json({
    error: "Method not allowed"
  }, 405);

  const clientIP = getClientIP(req);
  
  // Rate limiting check
  if (!checkRateLimit(clientIP)) {
    console.log(`Rate limit exceeded for IP: ${clientIP}`);
    return json({
      error: "rate_limit_exceeded",
      message: "Too many journey creation requests. Please try again later."
    }, 429);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false
    }
  });

  try {
    // Generate a secure secret
    const secret = crypto.randomUUID() + "-" + crypto.randomUUID();
    
    // Create journey with enhanced security data
    const { data, error } = await sb.from("journeys").insert({
      secret,
      state: {},
      secret_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
      created_by_ip: clientIP,
      access_count: 0
    }).select("id").single();

    if (error) {
      console.error('Database insert error:', error);
      return json({
        error: "db_insert_failed",
        detail: error.message
      }, 500);
    }

    console.log(`Created journey ${data.id} for IP: ${clientIP}`);

    return json({
      journey_id: data.id,
      journey_secret: secret
    });
  } catch (error) {
    console.error('Unexpected error in create_guest_journey:', error);
    return json({
      error: "internal_error",
      detail: error.message
    }, 500);
  }
});
