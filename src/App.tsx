import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LiveAnnouncer } from "@/components/accessibility/LiveAnnouncer";
import { createBrowserRouter, RouterProvider, Outlet } from "react-router-dom";
import BankCallback from './pages/BankCallback';
import UpgradeSuccess from './pages/UpgradeSuccess';
import Account from './pages/Account';
import { PaywallModal } from '@/components/billing/PaywallModal';
import Index from "./pages/Index";
import Landing from "./pages/Landing";
import NotFound from "./pages/NotFound";
import React, { useEffect, useRef, useState } from "react";
import * as Comlink from "comlink";
import { usePlanStore } from "./store/usePlanStore";
import type { PlanInputs, SimResult, Transaction, PayFrequency } from "./types";
import { toast } from "sonner";
import mockA from "./fixtures/mock-a-boi-transactions.json";
import mockB from "./fixtures/mock-b-boi-transactions.json";
import { mapBoiToTransactions } from "./lib/txMap";
import { addDaysISO, nextBusinessDay } from "./utils/dateUtils";
// ✅ Vite worker import – gives you a Worker constructor
import SimWorker from "./workers/simWorker.ts?worker";
import { expandRecurring } from "./lib/expandRecurring";
import { ThemeProvider } from "next-themes";
import { ThemeToggle } from "./components/ThemeToggle";
import { ScrollToTop } from "./components/ScrollToTop";
import { ensureGuestJourney, migrateJourneyToHousehold, loadNormalizedData, saveJourney, storePendingJourneyInSessionFromUrl, ensureHouseholdInSession } from "@/lib/journey.ts";
import { supabase } from "./integrations/supabase/client";
import { setupInactivityTimeout, startSessionValidation, logSecurityEvent } from "./lib/security";

const queryClient = new QueryClient();

function toMonthly(amount: number, freq: PayFrequency): number {
  const cycles =
    freq === "weekly" ? 52 / 12 :
    freq === "fortnightly" ? 26 / 12 :
    freq === "four_weekly" ? 13 / 12 : 1;
  return amount * cycles;
}

function lastPayDate(tx: Transaction[], amount: number): string | undefined {
  const tol = 1; // €1 tolerance to match salary transactions
  return tx
    .filter(t => t.amount > 0 && Math.abs(t.amount - amount) <= tol)
    .map(t => t.dateISO)
    .sort()
    .pop();
}

function nextPayDate(freq: PayFrequency, lastISO?: string): string {
  const todayISO = new Date().toISOString().slice(0, 10);
  if (freq === "monthly") {
    const today = new Date(todayISO);
    const nextMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
    return nextBusinessDay(nextMonth.toISOString().slice(0, 10));
  }

  const step =
    freq === "weekly" ? 7 :
    freq === "four_weekly" ? 28 : 14; // fortnightly/biweekly default 14
  let next = lastISO || todayISO;
  while (next <= todayISO) {
    next = addDaysISO(next, step);
  }
  return nextBusinessDay(next);
}

function App() {
  const {
    inputs, result, setResult, setInputs, setDetected, setTransactions, transactions
  } = usePlanStore();
  const workerRef = useRef<Worker | null>(null);
  const apiRef = useRef<{
    simulate: (i: PlanInputs, opts?: { includeSuggestions?: boolean }) => Promise<SimResult>;
    analyzeTransactions: (tx: Transaction[]) => Promise<{ salaries: any[]; recurring: any[] }>;
    ping: () => Promise<string>;
  } | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Handle Supabase magic-link/code callback: capture journey keys first, then exchange tokens for a session
    (async () => {
      try {
        // Persist any journey keys embedded in the redirect URL before modifying it
        try { storePendingJourneyInSessionFromUrl(); } catch {}
        const url = new URL(window.location.href);
        const hasCodeParam = !!url.searchParams.get('code');
        const hash = url.hash || '';
        const hasHashTokens = hash.includes('access_token') && hash.includes('refresh_token');

        if (hasCodeParam) {
          console.log('[auth] Exchanging code for session...');
          try {
            await supabase.auth.exchangeCodeForSession({ currentUrl: window.location.href });
            console.log('[auth] Exchange complete.');
            try { await logSecurityEvent('session_exchanged'); } catch {}
          } catch (e) {
            console.error('[auth] exchangeCodeForSession failed:', e);
          }
          try {
            const { data } = await supabase.auth.getSession();
            console.log('[auth] Session after exchange?', !!data?.session);
            if (data?.session) {
              await ensureHouseholdInSession();
              const migrated = await migrateJourneyToHousehold();
              if (migrated) {
                await loadNormalizedData();
                try { window.dispatchEvent(new CustomEvent('journey:migrated', { detail: { household_id: migrated } } as any)); } catch {}
              } else {
                await loadNormalizedData();
              }
              // After successful sign-in, direct users to the app
              try {
                const p = window.location.pathname;
                if (p === '/' || p === '' || p === '/index.html') {
                  window.location.href = '/app';
                }
              } catch {}
            }
          } catch {}
        } else if (hasHashTokens) {
          // Handle hash-based magic link (?type=magiclink#access_token=...&refresh_token=...)
          console.log('[auth] Setting session from hash tokens...');
          const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
          const access_token = params.get('access_token') || '';
          const refresh_token = params.get('refresh_token') || '';
          if (access_token && refresh_token) {
            await supabase.auth.setSession({ access_token, refresh_token });
            console.log('[auth] Session set from hash tokens.');
            try { await logSecurityEvent('session_exchanged_hash'); } catch {}
            try {
              await ensureHouseholdInSession();
              const migrated = await migrateJourneyToHousehold();
              if (migrated) {
                await loadNormalizedData();
                try { window.dispatchEvent(new CustomEvent('journey:migrated', { detail: { household_id: migrated } } as any)); } catch {}
              } else {
                await loadNormalizedData();
              }
              try {
                const p = window.location.pathname;
                if (p === '/' || p === '' || p === '/index.html') {
                  window.location.href = '/app';
                }
              } catch {}
            } catch {}
          }
        }

        // Clean OAuth params from URL but keep our own (e.g., journey_id)
        try {
          const u = new URL(window.location.href);
          const drop = ['code','type','access_token','refresh_token','expires_in','provider_token','token_type'];
          let changed = false;
          drop.forEach((k) => { if (u.searchParams.has(k)) { u.searchParams.delete(k); changed = true; } });
          if (u.hash) {
            const hp = new URLSearchParams(u.hash.startsWith('#') ? u.hash.slice(1) : u.hash);
            let hashChanged = false;
            ['access_token','refresh_token','expires_in','provider_token','token_type','type'].forEach((k)=>{
              if (hp.has(k)) { hp.delete(k); hashChanged = true; }
            });
            if (hashChanged) {
              u.hash = hp.toString() ? '#' + hp.toString() : '';
              changed = true;
            }
          }
          if (changed) {
            const clean = `${u.pathname}${u.search}${u.hash}`;
            window.history.replaceState({}, '', clean);
          }
        } catch {}
      } catch (e) {
        console.error('[auth] magic-link handling failed:', e);
      }
    })();

    // Ensure a guest journey exists for unauthenticated visitors (validate or create)
    ensureGuestJourney().catch(() => {});

    // Journey keys already captured above

    // If user signs in and a guest journey exists → migrate it
    const sub = supabase.auth.onAuthStateChange(async (evt, session) => {
      if ((evt === 'SIGNED_IN' || evt === 'INITIAL_SESSION') && session) {
        await ensureHouseholdInSession();
        const migrated = await migrateJourneyToHousehold();
        if (migrated) {
          await loadNormalizedData();
          try { window.dispatchEvent(new CustomEvent('journey:migrated', { detail: { household_id: migrated } } as any)); } catch {}
        }
        try {
          const p = window.location.pathname;
          if (p === '/' || p === '' || p === '/index.html') {
            window.location.href = '/app';
          }
        } catch {}
      }
    });
    return () => { try { sub.data.subscription.unsubscribe(); } catch {} };
  }, []);

  // Initialize client-side security helpers (session timeout + validation)
  useEffect(() => {
    const stopTimeout = setupInactivityTimeout(15, () => {
      try { console.warn('[security] Signed out due to inactivity'); } catch {}
    });
    const stopValidation = startSessionValidation(60);
    return () => { stopTimeout?.(); stopValidation?.(); };
  }, []);

  // On initial load, if a Supabase session already exists (magic-link redirect), migrate any guest journey.
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (data?.session) {
          await ensureHouseholdInSession();
          const migrated = await migrateJourneyToHousehold();
          if (migrated) {
            await loadNormalizedData();
            try { window.dispatchEvent(new CustomEvent('journey:migrated', { detail: { household_id: migrated } } as any)); } catch {}
          }
        }
      } catch {}
    })();
  }, []);

  useEffect(() => {
    // Spawn the web worker once (Vite's ?worker)
    const w = new SimWorker();
    // helpful error hooks
    w.addEventListener("error", (e) => {
      // Some browsers don't populate message—log everything we can
      console.error("[simWorker] error:", e.message, e.filename, e.lineno, e.colno, e);
      toast.error(`Worker error: ${e.message || "see console"}`);
    });
    w.addEventListener("messageerror", (e) => {
      console.error("[simWorker] messageerror:", e);
      toast.error("Worker message error (serialization). See console.");
    });
    const api = Comlink.wrap<{
      simulate: (i: PlanInputs, opts?: { includeSuggestions?: boolean }) => Promise<SimResult>;
      analyzeTransactions: (tx: Transaction[]) => Promise<{ salaries: any[]; recurring: any[] }>;
      ping: () => Promise<string>;
    }>(w);
    workerRef.current = w;
    apiRef.current = api;
    // handshake: only mark ready after ping succeeds
    (async () => {
      try {
        const pong = await api.ping();
        console.log("[simWorker] ping →", pong);
        setReady(true);
      } catch (err) {
        console.error("[simWorker] ping failed:", err);
        toast.error("Worker failed to start. See console.");
      }
    })();
    return () => w.terminate();
  }, []);

  // Helper: run detection for single or joint mode
  const runDetection = async (txA?: Transaction[], txB?: Transaction[]) => {
    if (!apiRef.current) return;

    // Normalize to arrays so we never read `.length` of undefined
    const A: Transaction[] = Array.isArray(txA) ? txA : [];
    const B: Transaction[] = Array.isArray(txB) ? txB : [];

    const slim = (t: Transaction) => ({ desc: t.description, amount: t.amount, date: t.dateISO });

    console.log('[runDetection] Starting detection for:', {
      txALength: A.length,
      txBLength: B.length,
      mode: B.length ? 'joint' : 'single',
      sampleTxA: A.slice(0, 3).map(slim),
      sampleTxB: B.slice(0, 3).map(slim),
      txBExists: txB != null,
      txBIsArray: Array.isArray(txB),
      txBType: typeof txB,
    });

    const resA = await apiRef.current.analyzeTransactions(A);
    console.log('[runDetection] Results A:', {
      salaries: resA.salaries?.length,
      recurring: resA.recurring?.length,
      sampleSalary: resA.salaries?.[0],
      sampleRecurring: resA.recurring?.[0],
    });

    let resB: any | undefined = undefined;
    if (B.length) {
      console.log('[runDetection] Analyzing B transactions…');
      resB = await apiRef.current.analyzeTransactions(B);
      console.log('[runDetection] Results B:', {
        salaries: resB.salaries?.length,
        recurring: resB.recurring?.length,
        sampleSalary: resB.salaries?.[0],
        sampleRecurring: resB.recurring?.[0],
      });
    }

    // Store into Zustand for Index.tsx to hydrate from
    setDetected({
      salaries: resA.salaries ?? [],
      recurring: resA.recurring ?? [],
      salariesB: resB?.salaries ?? [],
      recurringB: resB?.recurring ?? [],
    });

    console.log('[runDetection] Stored in zustand:', {
      salariesA: resA.salaries?.length,
      recurringA: resA.recurring?.length,
      salariesB: resB?.salaries?.length,
      recurringB: resB?.recurring?.length,
    });

    // --- inputs/bills population (unchanged except using A/B) ---
    const toMonthly = (amount: number, freq: PayFrequency) =>
      freq === 'weekly' ? (amount * 52) / 12 :
      freq === 'fortnightly' ? (amount * 26) / 12 :
      freq === 'four_weekly' ? (amount * 13) / 12 : amount;

    const lastPayDate = (tx: Transaction[], amount: number) =>
      tx.filter(t => t.amount > 0 && Math.abs(t.amount - amount) <= 1)
        .map(t => t.dateISO).sort().pop();

    const inputsUpdate: any = {};

    const cA = resA.salaries?.[0];
    if (cA) {
      const lastA = lastPayDate(A, cA.amount);
      inputsUpdate.a = {
        netMonthly: toMonthly(cA.amount, cA.freq),
        freq: cA.freq,
        firstPayISO: nextPayDate(cA.freq, lastA || cA.firstSeen),
      };
      inputsUpdate.startISO = inputsUpdate.a.firstPayISO;
    }

    if (resB) {
      const cB = resB.salaries?.[0];
      if (cB) {
        const lastB = lastPayDate(B, cB.amount);
        const firstB = nextPayDate(cB.freq, lastB || cB.firstSeen);
        inputsUpdate.b = {
          netMonthly: toMonthly(cB.amount, cB.freq),
          freq: cB.freq,
          firstPayISO: firstB,
        };
        inputsUpdate.startISO = inputsUpdate.startISO
          ? (inputsUpdate.startISO < firstB ? inputsUpdate.startISO : firstB)
          : firstB;
      }
      inputsUpdate.mode = 'joint';
    } else {
      inputsUpdate.mode = 'single';
    }

    // Expand detected recurring items into a 12‑month schedule (like fair-split)
    const startISO: string | undefined = inputsUpdate.startISO || inputs.startISO;
    if (startISO) {
      const expandedA = expandRecurring(resA.recurring ?? [], startISO, 12, 'det-a-');
      const expandedB = resB ? expandRecurring(resB.recurring ?? [], startISO, 12, 'det-b-') : [];
      inputsUpdate.bills = [...expandedA, ...expandedB];
    } else {
      inputsUpdate.bills = [];
    }

    setInputs(inputsUpdate);
    await recalc();

    // Persist detection step for guests
    try {
      await saveJourney({
        step: 'bank-detections',
        mode: inputsUpdate.mode,
        detected: {
          salariesA: (resA.salaries ?? []).slice(0, 5),
          recurringA: (resA.recurring ?? []).slice(0, 50),
          salariesB: (resB?.salaries ?? []).slice(0, 5),
          recurringB: (resB?.recurring ?? []).slice(0, 50),
        },
        inputs: inputsUpdate,
      });
    } catch {}
  };


  // AUTO-LOAD: start with single mode using mock A (only if not manually triggered)
  const [hasManualSelection, setHasManualSelection] = useState(false);
  
  useEffect(() => {
    if (!ready || hasManualSelection) return;
    // Skip auto-detect when we explicitly start at setup from Landing
    try {
      if (sessionStorage.getItem('start_at_setup') === '1') {
        sessionStorage.removeItem('start_at_setup');
        return;
      }
    } catch {}
    // Make sure a valid guest journey exists before first persistence
    ensureGuestJourney().then(() => {
      const txA = mapBoiToTransactions(mockA as any);
      setTransactions(txA);
      runDetection(txA).catch(err => {
        console.error("[auto detect] failed:", err);
        toast.error("Auto-detect failed (see console)");
      });
    }).catch(() => {
      const txA = mapBoiToTransactions(mockA as any);
      setTransactions(txA);
      runDetection(txA).catch(err => {
        console.error("[auto detect] failed:", err);
        toast.error("Auto-detect failed (see console)");
      });
    });
  }, [ready, hasManualSelection]);

  // Function to switch to joint mode
  const switchToJointMode = async () => {
    if (!apiRef.current) return;
    setHasManualSelection(true); // Prevent auto-load from interfering
    console.log('[switchToJointMode] Loading joint mode with User B data...');
    const txA = mapBoiToTransactions(mockA as any);
    const txB = mapBoiToTransactions(mockB as any);
    setTransactions(txA); // Store A's transactions as primary
    await runDetection(txA, txB);
  };

  // Expose functions to Index.tsx via window global
  useEffect(() => {
    if (ready && apiRef.current) {
      (window as any).__workerAPI = apiRef.current;
      (window as any).__switchToJointMode = switchToJointMode;
      (window as any).__runDetection = (txA?: Transaction[], txB?: Transaction[]) => {
        setHasManualSelection(true); // Mark as manual selection
        return runDetection(txA, txB);
      };
      // Dev helper: reset all in-memory state and any localStorage
      (window as any).__resetPlanStore = () => {
        try {
          usePlanStore.getState().setInputs({} as any);
          usePlanStore.getState().setResult(undefined as any);
          usePlanStore.getState().setDetected(undefined as any);
          usePlanStore.getState().setTransactions(undefined as any);
        } catch {}
        try { localStorage.clear(); } catch {}
        try { sessionStorage.clear(); } catch {}
        try { location.reload(); } catch {}
      };
    }
  }, [ready, switchToJointMode]);

  async function recalc() {
    if (!apiRef.current) return;
    // Minimal defaults so the button works immediately
    const minimal: PlanInputs = {
      a: { netMonthly: 1000, freq: "monthly", firstPayISO: "2025-09-01" },
      bills: [],
      elecPredicted: [],
      pots: [],
      startISO: "2025-09-01",
      minBalance: 0,
      mode: "single",
      weeklyAllowanceA: 0,
      weeklyAllowanceB: 0,
    };
    const merged = { ...minimal, ...inputs } as PlanInputs;
    const r = await apiRef.current.simulate(merged, { includeSuggestions: false });
    setResult(r);
  }

  async function demoDetect() {
    if (!apiRef.current) return;
    const base = new Date("2025-01-01");
    const iso = (d: Date) => d.toISOString().slice(0,10);
    const tx: Transaction[] = [];
    // salary monthly on 1st
    for (let i=0;i<4;i++){ const d = new Date(base); d.setMonth(d.getMonth()+i); tx.push({ id:`s${i}`, dateISO: iso(d), description:"ACME PAYROLL", amount: 4500 }); }
    // spotify monthly on 17th
    for (let i=0;i<4;i++){ const d = new Date(base); d.setMonth(d.getMonth()+i); d.setDate(17); tx.push({ id:`sp${i}`, dateISO: iso(d), description:"Spotify", amount: -11.99 }); }
    // gym weekly
    for (let i=0;i<8;i++){ const d = new Date(base); d.setDate(d.getDate()+7*i); tx.push({ id:`g${i}`, dateISO: iso(d), description:"FitGym", amount: -12.5 }); }
    const res = await (apiRef.current as any).analyzeTransactions(tx);
    console.log("[demoDetect] result:", res);
    toast.success(`Detected: ${res.salaries.length} salary + ${res.recurring.length} recurring`);
  }

  // (keep this if you still want the manual test button)
  async function analyzeMockA() {
    if (!apiRef.current) {
      console.warn("[analyzeMockA] worker API not ready");
      toast.error("Worker not ready yet");
      return;
    }
    try {
      const tx: Transaction[] = mapBoiToTransactions(mockA as any);
      console.log("[analyzeMockA] tx sample:", tx.slice(0, 5));
      await runDetection(tx);
    } catch (err) {
      console.error("[analyzeMockA] failed:", err);
      toast.error("Analyze failed (see console)");
    }
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <LiveAnnouncer>
            {/* Tiny theme toggle chip in top-left */}
            <ThemeToggle />
            <RouterProvider
              router={createBrowserRouter([
                {
                  path: '/',
                  element: (
                    <>
                      <ScrollToTop behavior="auto" />
                      <Outlet />
                      <PaywallModal />
                    </>
                  ),
                  children: [
                    { index: true, element: <Landing /> },
                    { path: 'app', element: <Index /> },
                    { path: 'upgrade-success', element: <UpgradeSuccess /> },
                    { path: 'account', element: <Account /> },
                    { path: 'bank-callback', element: <BankCallback /> },
                    { path: '*', element: <NotFound /> },
                  ],
                },
              ])}
              future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
            />
          </LiveAnnouncer>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
