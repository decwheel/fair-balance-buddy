import { supabase } from "@/integrations/supabase/client";
import { logSecurityEvent } from "@/lib/security";

type JourneyKeys = {
  journey_id: string;
  journey_secret: string;
};

const J_ID = "journey_id";
const J_SECRET = "journey_secret";
const J_DATA = "journey_state"; // local shadow for quick resume
const H_ID = "household_id";
const H_DATA = "household_data";
const H_MIGRATED_AT = "household_migrated_at";
const P_ID = "pending_journey_id";
const P_SECRET = "pending_journey_secret";

export function getJourney(): JourneyKeys | null {
  try {
    const journey_id = localStorage.getItem(J_ID) || "";
    const journey_secret = localStorage.getItem(J_SECRET) || "";
    if (journey_id && journey_secret) return { journey_id, journey_secret };
  } catch {}
  return null;
}

export async function ensureGuestJourney(): Promise<JourneyKeys | null> {
  try {
    const have = getJourney();
    if (have) return have;
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData.session) return null;
    const { data, error } = await supabase.functions.invoke("create_guest_journey", { body: {} });
    if (error) { console.warn("[journey] create_guest_journey failed:", error); return null; }
    const journey_id: string = (data as any)?.journey_id || (data as any)?.id;
    const journey_secret: string = (data as any)?.journey_secret || (data as any)?.secret;
    if (journey_id && journey_secret) {
      localStorage.setItem(J_ID, journey_id);
      localStorage.setItem(J_SECRET, journey_secret);
      return { journey_id, journey_secret };
    }
  } catch (e) {
    console.warn("[journey] ensureGuestJourney error:", e);
  }
  return null;
}

export async function saveJourney(patch: Record<string, any>): Promise<boolean> {
  try {
    const local = (() => { try { return JSON.parse(localStorage.getItem(J_DATA) || "{}"); } catch { return {}; } })();
    const merged = { ...local, ...patch, updated_at: new Date().toISOString() };
    try { localStorage.setItem(J_DATA, JSON.stringify(merged)); } catch {}
    
    const keys = getJourney();
    if (!keys) return false;
    
    const { data, error } = await supabase.functions.invoke("save_journey_state", { 
      body: { 
        journey_id: keys.journey_id, 
        journey_secret: keys.journey_secret, 
        patch 
      } 
    });
    
    if (error) {
      // Handle journey expiry by creating a new journey
      if (error.message?.includes('unauthorized_or_expired') || error.message?.includes('expired')) {
        console.warn('[journey] Journey expired, creating new journey...');
        await ensureGuestJourney(); // This will create a new journey
        return false; // Don't retry save, user can trigger it again
      }
      
      console.warn("[journey] save_journey_state error:", error); 
      return false; 
    }
    
    // Update localStorage with expiry info if provided
    if (data && (data as any).expires_at) {
      const journeyData = { ...keys, expires_at: (data as any).expires_at };
      try {
        localStorage.setItem('journey', JSON.stringify(journeyData));
      } catch {}
    }
    
    return true;
  } catch (e) {
    console.warn("[journey] saveJourney error:", e);
    return false;
  }
}

export async function migrateJourneyToHousehold(): Promise<string | null> {
  try {
    let keys = getJourney();
    if (!keys) {
      try {
        const journey_id = sessionStorage.getItem(P_ID) || "";
        const journey_secret = sessionStorage.getItem(P_SECRET) || "";
        if (journey_id && journey_secret) keys = { journey_id, journey_secret };
      } catch {}
    }
    if (!keys) return null;
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      console.warn('[journey] No access token present at migration time');
      return null;
    }
    console.log('[journey] Migrating with keys + token?', {
      haveJourney: !!keys?.journey_id && !!keys?.journey_secret,
      journey_id: keys?.journey_id,
      haveToken: !!token,
    });
    const { data, error } = await supabase.functions.invoke("migrate_journey_to_household", { body: { ...keys }, headers: { Authorization: `Bearer ${token}` } });
    if (error) {
      console.error("[journey] migrate error (invoke):", error);
      let details = '';
      try {
        details = '\n' + JSON.stringify((error as any), null, 2);
      } catch {}
      try { alert(`Migration failed: ${error.message || 'invoke error'}${details}`); } catch {}
      try { await logSecurityEvent('journey_migration_failed', { error: error.message }, 'medium'); } catch {}
      return null;
    }
    const maybeErr = (data as any)?.error as string | undefined;
    const household_id: string | undefined = (data as any)?.household_id || (data as any)?.id;
    if (maybeErr && /already/i.test(maybeErr) && household_id) {
      try { sessionStorage.setItem(H_ID, household_id); } catch {}
      try { await logSecurityEvent('journey_migrated_already', { household_id }); } catch {}
      return household_id;
    }
    if (maybeErr && !/already/i.test(maybeErr)) {
      console.error("[journey] migrate error (data):", maybeErr, (data as any)?.detail);
      try { alert(`Migration failed: ${maybeErr}${(data as any)?.detail ? `\n${(data as any)?.detail}` : ''}`); } catch {}
      try { await logSecurityEvent('journey_migration_failed', { error: maybeErr, detail: (data as any)?.detail }, 'medium'); } catch {}
      return null;
    }
    if (household_id) {
      try { sessionStorage.setItem(H_ID, household_id); } catch {}
      try { sessionStorage.setItem(H_MIGRATED_AT, new Date().toISOString()); } catch {}
      try { localStorage.removeItem(J_ID); } catch {}
      try { localStorage.removeItem(J_SECRET); } catch {}
      try { localStorage.removeItem(J_DATA); } catch {}
      try { sessionStorage.removeItem(P_ID); } catch {}
      try { sessionStorage.removeItem(P_SECRET); } catch {}
      try { await logSecurityEvent('journey_migrated', { household_id }); } catch {}
      return household_id;
    }
    // No error but also no household_id
    console.warn("[journey] migrate returned no error and no household_id", data);
    try { alert("Migration did not return a household ID. Please try again."); } catch {}
  } catch (e) {
    console.error("[journey] migrate error:", e);
  }
  return null;
}

export async function loadNormalizedData(): Promise<Record<string, any> | null> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return null;
    const sb: any = supabase as any;
    const out: Record<string, any> = {};
    const tasks = [sb.from("persons").select("*"), sb.from("wages_detected").select("*")];
    const more = [
      sb.from("recurring_bills").select("*"),
      sb.from("electricity_readings").select("*"),
      sb.from("electricity_bills").select("*"),
      sb.from("forecasts").select("*"),
      sb.from("forecast_items").select("*")
    ];
    const [persons, wages] = await Promise.all(tasks);
    if (!persons.error) out.persons = persons.data;
    if (!wages.error) out.wages_detected = wages.data;
    const rest = await Promise.all(more);
    const [rb, er, eb, f, fi] = rest;
    if (!rb.error) out.recurring_bills = rb.data;
    if (!er.error) out.electricity_readings = er.data;
    if (!eb.error) out.electricity_bills = eb.data;
    if (!f.error) out.forecasts = f.data;
    if (!fi.error) out.forecast_items = fi.data;
    try { sessionStorage.setItem(H_DATA, JSON.stringify(out)); } catch {}
    return out;
  } catch (e) {
    console.warn("[journey] loadNormalizedData error:", e);
    return null;
  }
}

export function getHouseholdId(): string | null {
  try { return sessionStorage.getItem(H_ID); } catch { return null; }
}

export function getLocalJourneyState<T = any>(): T | null {
  try { const s = localStorage.getItem(J_DATA); return s ? JSON.parse(s) as T : null; } catch { return null; }
}

export function storePendingJourneyInSessionFromUrl(): { stored: boolean; removed: boolean } {
  try {
    const sp = new URLSearchParams(window.location.search);
    let id = sp.get("journey_id");
    let sec = sp.get("journey_secret");

    // Fallback: also look for params inside the URL hash (e.g. http://host/#/?journey_id=...)
    let hash = window.location.hash || "";
    if ((!id || !sec) && hash.includes("?")) {
      const qIndex = hash.indexOf("?");
      const hp = new URLSearchParams(hash.slice(qIndex + 1));
      id = id || hp.get("journey_id");
      sec = sec || hp.get("journey_secret");
    }

    if (id && sec) {
      sessionStorage.setItem(P_ID, id);
      sessionStorage.setItem(P_SECRET, sec);

      // Remove the keys from both search and hash, if present
      let updated = false;
      if (sp.has("journey_id") || sp.has("journey_secret")) {
        sp.delete("journey_id");
        sp.delete("journey_secret");
        updated = true;
      }
      if (hash.includes("?")) {
        const qIndex = hash.indexOf("?");
        const baseHash = hash.slice(0, qIndex);
        const hp = new URLSearchParams(hash.slice(qIndex + 1));
        if (hp.has("journey_id") || hp.has("journey_secret")) {
          hp.delete("journey_id");
          hp.delete("journey_secret");
          hash = baseHash + (hp.toString() ? `?${hp.toString()}` : "");
          updated = true;
        }
      }

      if (updated) {
        const url = `${window.location.pathname}${sp.toString() ? `?${sp.toString()}` : ''}${hash || ''}`;
        try { window.history.replaceState({}, "", url); } catch {}
      }

      return { stored: true, removed: true };
    }
  } catch {}
  return { stored: false, removed: false };
}

export function getNormalizedDataFromSession<T = any>(): T | null {
  try { const s = sessionStorage.getItem(H_DATA); return s ? JSON.parse(s) as T : null; } catch { return null; }
}
