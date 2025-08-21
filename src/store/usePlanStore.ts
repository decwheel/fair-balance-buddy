import { create } from "zustand";
import type {
  PlanInputs, SimResult, Transaction, SalaryCandidate, RecurringItem
} from "../types";

type State = {
  inputs: Partial<PlanInputs>;
  result?: SimResult;
  transactions?: Transaction[];
  detected?: { 
    salaries: SalaryCandidate[]; 
    recurring: RecurringItem[];
    salariesB?: SalaryCandidate[];
    recurringB?: RecurringItem[];
  };
  setInputs: (patch: Partial<PlanInputs>) => void;
  setResult: (r?: SimResult) => void;
   setTransactions: (tx?: Transaction[]) => void;
   setDetected: (d?: { 
     salaries: SalaryCandidate[]; 
     recurring: RecurringItem[];
     salariesB?: SalaryCandidate[];
     recurringB?: RecurringItem[];
   }) => void;
};

export const usePlanStore = create<State>((set) => ({
  inputs: {},
  result: undefined,
  setInputs: (patch) => set((s) => ({ inputs: { ...s.inputs, ...patch } })),
  setResult: (r) => set(() => ({ result: r })),
  setTransactions: (tx) => set(() => ({ transactions: tx })),
  setDetected: (d) => set(() => ({ detected: d })),
}));
