import { supabase } from "@/integrations/supabase/client";

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
    const { error } = await supabase.functions.invoke("save_journey_state", { body: { ...keys, patch } });
    if (error) { console.warn("[journey] save_journey_state error:", error); return false; }
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
    if (!token) return null;
    const { data, error } = await supabase.functions.invoke("migrate_journey_to_household", { body: { ...keys }, headers: { Authorization: `Bearer ${token}` } });
    if (error) { console.error("[journey] migrate error:", error); return null; }
    const household_id: string | undefined = (data as any)?.household_id || (data as any)?.id;
    if (household_id) {
      try { sessionStorage.setItem(H_ID, household_id); } catch {}
      try { sessionStorage.setItem(H_MIGRATED_AT, new Date().toISOString()); } catch {}
      try { localStorage.removeItem(J_ID); } catch {}
      try { localStorage.removeItem(J_SECRET); } catch {}
      try { localStorage.removeItem(J_DATA); } catch {}
      try { sessionStorage.removeItem(P_ID); } catch {}
      try { sessionStorage.removeItem(P_SECRET); } catch {}
      return household_id;
    }
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
    const id = sp.get("journey_id");
    const sec = sp.get("journey_secret");
    if (id && sec) {
      sessionStorage.setItem(P_ID, id);
      sessionStorage.setItem(P_SECRET, sec);
      try {
        sp.delete("journey_id");
        sp.delete("journey_secret");
        const url = `${window.location.pathname}${sp.toString() ? `?${sp.toString()}` : ''}${window.location.hash || ''}`;
        window.history.replaceState({}, "", url);
      } catch {}
      return { stored: true, removed: true };
    }
  } catch {}
  return { stored: false, removed: false };
}

export function getNormalizedDataFromSession<T = any>(): T | null {
  try { const s = sessionStorage.getItem(H_DATA); return s ? JSON.parse(s) as T : null; } catch { return null; }
}
