import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import React, { useEffect, useRef, useState } from "react";
import * as Comlink from "comlink";
import { usePlanStore } from "./store/usePlanStore";
import type { PlanInputs, SimResult, Transaction } from "./types";
import { toast } from "sonner";
import mockA from "./fixtures/mock-a-boi-transactions.json";
import mockB from "./fixtures/mock-b-boi-transactions.json";
import { mapBoiToTransactions } from "./lib/txMap";
// ✅ Vite worker import – gives you a Worker constructor
import SimWorker from "./workers/simWorker.ts?worker";

const queryClient = new QueryClient();

function App() {
  const {
    inputs, result, setResult, setInputs, setDetected, setTransactions, transactions
  } = usePlanStore();
  const workerRef = useRef<Worker | null>(null);
  const apiRef = useRef<{
    simulate: (i: PlanInputs) => Promise<SimResult>;
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
      simulate: (i: PlanInputs) => Promise<SimResult>;
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
  const runDetection = async (txA: Transaction[], txB?: Transaction[]) => {
    if (!apiRef.current) return;
    
    const resA = await apiRef.current.analyzeTransactions(txA);
    
    // For joint mode, also analyze user B's transactions
    let resB;
    if (txB) {
      resB = await apiRef.current.analyzeTransactions(txB);
    }
    
    setDetected(resA);

    // 1) Salary for user A
    const cA = resA.salaries?.[0];
    const inputsUpdate: any = {};
    
    if (cA) {
      inputsUpdate.a = {
        netMonthly: cA.amount,
        freq: "monthly",
        firstPayISO: cA.firstSeen,
      };
    }
    
    // 2) For joint mode, also set user B's salary
    if (resB) {
      const cB = resB.salaries?.[0];
      if (cB) {
        inputsUpdate.b = {
          netMonthly: cB.amount,
          freq: "monthly", 
          firstPayISO: cB.firstSeen,
        };
      }
      inputsUpdate.mode = "joint";
    } else {
      inputsUpdate.mode = "single";
    }

    // 3) Bills: combine bills from both users if in joint mode
    const billsA = (resA.recurring ?? []).map((r, i) => ({
      id: `det-a-${i}`,
      name: r.description,
      amount: r.amount,
      account: "A" as const,
      dueDateISO: r.sampleDates?.[r.sampleDates.length - 1],
    }));
    
    const billsB = resB ? (resB.recurring ?? []).map((r, i) => ({
      id: `det-b-${i}`,
      name: r.description,
      amount: r.amount,
      account: "B" as const,
      dueDateISO: r.sampleDates?.[r.sampleDates.length - 1],
    })) : [];
    
    inputsUpdate.bills = [...billsA, ...billsB];
    
    setInputs(inputsUpdate);
    await recalc();
  };

  // AUTO-LOAD: start with single mode using mock A
  useEffect(() => {
    if (!ready) return;
    const txA = mapBoiToTransactions(mockA as any);
    setTransactions(txA);
    runDetection(txA).catch(err => {
      console.error("[auto detect] failed:", err);
      toast.error("Auto-detect failed (see console)");
    });
  }, [ready]);

  // Function to switch to joint mode
  const switchToJointMode = async () => {
    if (!apiRef.current) return;
    const txA = mapBoiToTransactions(mockA as any);
    const txB = mapBoiToTransactions(mockB as any);
    setTransactions(txA); // Store A's transactions as primary
    await runDetection(txA, txB);
  };

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
    };
    const merged = { ...minimal, ...inputs } as PlanInputs;
    const r = await apiRef.current.simulate(merged);
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
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>

        {/* Temporary worker test UI (safe to remove later) */}
        <div className="fixed bottom-4 right-4 flex flex-col items-end gap-2">
          <button
            disabled={!ready}
            onClick={recalc}
            className="px-3 py-2 rounded-md border bg-white dark:bg-neutral-900 text-sm"
            title={!ready ? "Worker not ready yet" : "Run simulation in worker"}
          >
            Recalculate plan (worker)
          </button>
          <button
            disabled={!ready}
            onClick={demoDetect}
            className="px-3 py-2 rounded-md border bg-white dark:bg-neutral-900 text-sm"
            title={!ready ? "Worker not ready yet" : "Run recurring detection demo"}
          >
            Detect recurring (demo)
          </button>
          <button
            disabled={!ready}
            onClick={analyzeMockA}
            className="px-3 py-2 rounded-md border bg-white dark:bg-neutral-900 text-sm"
          >
            Analyze mock A (single)
          </button>
          <button
            disabled={!ready}
            onClick={switchToJointMode}
            className="px-3 py-2 rounded-md border bg-white dark:bg-neutral-900 text-sm"
          >
            Switch to Joint Mode
          </button>
          {result && (
            <div className="text-xs opacity-75 bg-white/70 dark:bg-black/40 backdrop-blur px-2 py-1 rounded">
              Min: €{result.minBalance.toFixed(2)} · End: €{result.endBalance.toFixed(2)}
            </div>
          )}
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
