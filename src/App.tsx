import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LiveAnnouncer } from "@/components/accessibility/LiveAnnouncer";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import BankCallback from './pages/BankCallback';
import Index from "./pages/Index";
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
  };


  // AUTO-LOAD: start with single mode using mock A (only if not manually triggered)
  const [hasManualSelection, setHasManualSelection] = useState(false);
  
  useEffect(() => {
    if (!ready || hasManualSelection) return;
    const txA = mapBoiToTransactions(mockA as any);
    setTransactions(txA);
    runDetection(txA).catch(err => {
      console.error("[auto detect] failed:", err);
      toast.error("Auto-detect failed (see console)");
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
            <BrowserRouter>
              <ScrollToTop behavior="auto" />
              <Routes>
                <Route path="/" element={<Index />} />
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
                <Route path="/bank-callback" element={<BankCallback />} />
              </Routes>
            </BrowserRouter>
          </LiveAnnouncer>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
