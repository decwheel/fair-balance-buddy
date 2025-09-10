import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLinkAccount } from '@/hooks/useLinkAccount';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { usePlanStore } from '@/store/usePlanStore';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import {
  Calculator,
  Users,
  TrendingUp,
  Lightbulb,
  CheckCircle,
  AlertCircle,
  Euro,
  Calendar as CalendarIcon,
  Zap,
  PiggyBank
} from 'lucide-react';
import { EsbCsvUpload } from '@/components/energy/EsbCsvUpload';
import { LastBillUpload } from '@/components/energy/LastBillUpload';
import { loadMockTransactionsA, loadMockTransactionsB, categorizeBankTransactions, extractPayScheduleFromWages, Transaction } from '@/services/mockBank';
import { EsbReading } from '@/services/esbCsv';
import { TariffRates } from '@/services/billPdf';
import { Bill, PaySchedule, findDepositSingle, findDepositJoint, runSingle, runJoint } from '@/services/forecastAdapters';
import { generateBillSuggestions } from '@/services/optimizationEngine';
import { formatCurrency, calculatePayDates, addDaysISO } from '@/utils/dateUtils';
import { predictBills, ElectricityMode } from '@/services/electricityPredictors';
import { Calendar as DayPicker } from '@/components/ui/calendar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer } from 'recharts';
import { BillEditorDialog, BillFrequency } from '@/components/bills/BillEditorDialog';
import { BillDateWizard } from '@/components/bills/BillDateWizard';
import { generateOccurrences } from '@/utils/recurrence';
import { persistBills } from '@/services/supabaseBills';
import { rollForwardPastBills } from '@/utils/billUtils';
import type { RecurringItem, SalaryCandidate, SavingsPot, SimResult, PlanInputs } from '@/types';
import { useToast } from '@/components/ui/use-toast';
import { expandRecurring } from '../lib/expandRecurring';

// Identify electricity vendors from bank-recurring
const ELEC_VENDOR = /BORD G[ÁA]IS|ELECTRIC IRELAND|SSE|ENERGIA|FLOGAS|PINERGY|PREPAYPOWER/i;

// UI metadata used to render the Pattern column (keep anchor, drop "last …")
type RecurringMeta = Record<
  string,
  { freq: string; last: string; dueDay?: number; dayOfWeek?: number }
>;


interface AppState {
  mode: 'single' | 'joint';
  userA: {
    transactions: Transaction[];
    paySchedule: PaySchedule | null;
  };
  userB?: {
    transactions: Transaction[];
    paySchedule: PaySchedule | null;
  };
  linkedA: boolean;
  linkedB: boolean;
  wageConfirmedA: boolean;
  wageConfirmedB?: boolean;
  bills: Bill[];
  includedBillIds: string[]; // which bills are included in the forecast
  electricityReadings: EsbReading[];
  tariffRates: TariffRates | null;
  forecastResult: {
    depositA: number;
    depositB?: number;
    minBalance: number;
    timeline: Array<{ date: string; balance: number; event?: string }>;
  } | null;
  isLoading: boolean;
  step: 'setup' | 'bank' | 'energy' | 'forecast' | 'results';
  // Setup sub-phase: remain under 'setup' for couple flow selection and placeholder
  setupPhase?: 'choose-mode' | 'choose-couple-type' | 'separate-placeholder';
  selectedDate: string | null; // for calendar selection
  electricityMode: ElectricityMode;
  pots: SavingsPot[];
  weeklyAllowanceA: number;
  weeklyAllowanceB: number;
}

const Index = () => {
const [state, setState] = useState<AppState>({
  mode: 'single',
  userA: { transactions: [], paySchedule: null },
  linkedA: false,
  linkedB: false,
  bills: [],
  wageConfirmedA: false,
  includedBillIds: [],
  electricityReadings: [],
  tariffRates: null,
  forecastResult: null,
  isLoading: false,
  step: 'setup',
  setupPhase: 'choose-mode',
  selectedDate: null,
  electricityMode: 'csv',
  pots: [],
  weeklyAllowanceA: 100,
  weeklyAllowanceB: 100
});

  // live / mock toggle (Vite)
  const useMock = (import.meta.env.VITE_USE_MOCK_GC ?? 'true') === 'true';
  // institution list (live mode)
  const [institutions, setInstitutions] = useState<{id:string; name:string}[]>([]);
  const [instA, setInstA] = useState<{ id: string; name: string } | null>(null);
  const [instB, setInstB] = useState<{ id: string; name: string } | null>(null);
  const { link, busy } = useLinkAccount();

  const [billDialogOpen, setBillDialogOpen] = useState(false);
  const [billEditing, setBillEditing] = useState<Bill | null>(null);
  const { toast } = useToast();
  const [recurringMeta, setRecurringMeta] = useState<RecurringMeta>({});
  const [newPotName, setNewPotName] = useState('');
  const [newPotAmount, setNewPotAmount] = useState<number>(0);
  const [newPotOwner, setNewPotOwner] = useState<'A' | 'B' | 'JOINT'>('A');
  // New inputs for split pot creation (joint mode)
  const [newPotNameA, setNewPotNameA] = useState('');
  const [newPotAmountA, setNewPotAmountA] = useState<number>(0);
  const [newPotNameB, setNewPotNameB] = useState('');
  const [newPotAmountB, setNewPotAmountB] = useState<number>(0);
  const [showBillWizard, setShowBillWizard] = useState(false);
  const [dateMoves, setDateMoves] = useState<Array<{ name: string; fromISO: string; toISO: string }>>([]);
  // Live budget preview + binding mode for two-way coupling between allowances and pots
  const [budgetPreview, setBudgetPreview] = useState<{ availableA: number; availableB: number; monthlyJointA: number; monthlyJointB: number }>({ availableA: 0, availableB: 0, monthlyJointA: 0, monthlyJointB: 0 });
  const [bindingMode, setBindingMode] = useState<{ A: 'allowance' | 'pots'; B: 'allowance' | 'pots' }>({ A: 'allowance', B: 'allowance' });

  // Access plan store early so hooks below can depend on it safely
  const { detected, inputs, result: storeResult } = usePlanStore();

  // Helper: cycles per month for presenting monthly-equivalents
  const cyclesPerMonth = (freq?: string) => {
    switch ((freq || '').toUpperCase()) {
      case 'WEEKLY': return 52 / 12;
      case 'FORTNIGHTLY':
      case 'BIWEEKLY': return 26 / 12;
      case 'FOUR_WEEKLY': return 13 / 12;
      case 'MONTHLY':
      default: return 1;
    }
  };

  // --- Live budget recompute (keeps preview in sync and optionally rebalances allowance when pots drive) ---
  const recomputeLiveBudget = () => {
    try {
      if (!state.userA?.paySchedule) {
        setBudgetPreview({ availableA: 0, availableB: 0, monthlyJointA: 0, monthlyJointB: 0 });
        return;
      }

      // In joint mode, wait until both pay schedules are ready to avoid misleading single-mode estimates
      if (state.mode === 'joint' && !state.userB?.paySchedule) {
        setBudgetPreview({ availableA: 0, availableB: 0, monthlyJointA: 0, monthlyJointB: 0 });
        return;
      }

      // Wait for detections to load before first joint preview to avoid under-estimating deposits
      if (state.mode === 'joint') {
        const recA = (detected as any)?.recurring || [];
        const recB = (detected as any)?.recurringB || [];
        if ((recA.length === 0) && (recB.length === 0)) {
          return;
        }
      }

      // Build minimal bill set similar to runForecast (manual + predicted-electricity rolled forward)
      const elecPredicted = (state.bills || [])
        .filter(b => b.source === 'predicted-electricity')
        .map(b => ({ ...b, source: 'predicted-electricity' as const }));
      const manual = (state.bills || [])
        .filter(b => b.source === 'manual')
        .map(b => ({ ...b, source: b.source ?? 'manual' as const }));

      const firstAnchor = state.userB?.paySchedule
        ? (state.userA.paySchedule!.anchorDate < state.userB.paySchedule!.anchorDate ? state.userA.paySchedule!.anchorDate : state.userB.paySchedule!.anchorDate)
        : state.userA.paySchedule!.anchorDate;

      const provisionalBills = [...manual, ...elecPredicted];
      const allBillsProvisional = rollForwardPastBills(provisionalBills, firstAnchor);

      const startDateA = getStartDate(state.userA.paySchedule!, allBillsProvisional);
      const payScheduleA: PaySchedule = { ...state.userA.paySchedule!, anchorDate: startDateA };
      let payScheduleB: PaySchedule | null = null;
      let startDateB = '';
      if (state.mode === 'joint' && state.userB?.paySchedule) {
        startDateB = getStartDate(state.userB.paySchedule!, allBillsProvisional);
        payScheduleB = { ...state.userB.paySchedule!, anchorDate: startDateB };
      }

      // Monthly incomes
      const toMonthlySalary = (s?: SalaryCandidate): number | undefined => {
        if (!s) return undefined;
        switch (s.freq) {
          case 'weekly': return (s.amount * 52) / 12;
          case 'fortnightly': return (s.amount * 26) / 12;
          case 'four_weekly': return (s.amount * 13) / 12;
          case 'monthly':
          default: return s.amount;
        }
      };
      const toMonthlySchedule = (ps?: PaySchedule) => {
        if (!ps || !ps.averageAmount) return 0;
        switch (ps.frequency) {
          case 'WEEKLY': return (ps.averageAmount * 52) / 12;
          case 'FORTNIGHTLY':
          case 'BIWEEKLY': return (ps.averageAmount * 26) / 12;
          case 'FOUR_WEEKLY': return (ps.averageAmount * 13) / 12;
          case 'MONTHLY':
          default: return ps.averageAmount;
        }
      };
      const monthlyA = toMonthlySalary(topSalary) ?? toMonthlySchedule(payScheduleA);
      const monthlyB = state.mode === 'joint' ? (toMonthlySalary(topSalaryB) ?? toMonthlySchedule(payScheduleB!)) : 0;

      // Allowances (monthly)
      const allowanceMonthlyA = (state.weeklyAllowanceA ?? 0) * 52 / 12;
      const allowanceMonthlyB = (state.weeklyAllowanceB ?? 0) * 52 / 12;

      // Pots
      const sumA = (state.pots || []).filter(p => p.owner === 'A').reduce((s, p) => s + p.monthly, 0);
      const sumB = (state.pots || []).filter(p => p.owner === 'B').reduce((s, p) => s + p.monthly, 0);
      const sumJ = (state.pots || []).filter(p => p.owner === 'JOINT').reduce((s, p) => s + p.monthly, 0);
      const prelimRatioA = (monthlyA + monthlyB) > 0 ? monthlyA / (monthlyA + monthlyB) : 0.5;
      const jointShareA = sumJ * prelimRatioA;
      const jointShareB = sumJ * (1 - prelimRatioA);

      // Effective-income fairness (matches Calculate) for deposit computation
      const effA = (monthlyA || 0) - allowanceMonthlyA - sumA - jointShareA;
      const effB = (monthlyB || 0) - (state.mode === 'joint' ? allowanceMonthlyB + sumB + jointShareB : 0);
      const fairnessEffA = (state.mode === 'joint' && (effA + effB) > 0)
        ? (effA / (effA + effB))
        : 1;

      // Build expanded bill set (manual + imported recurring + electricity)
      const months = 12;
      const startMin = (state.mode === 'joint' && startDateB) ? (startDateA < startDateB ? startDateA : startDateB) : startDateA;
      const importedA = expandRecurring(detected?.recurring ?? [], startMin, months, 'imp-a-');
      const importedB = expandRecurring((detected?.recurringB ?? (detected as any)?.allRecurring ?? []), startMin, months, 'imp-b-');
      let mergedBills = [...manual, ...importedA, ...importedB, ...elecPredicted];
      // Apply any pending date moves as forecast does
      const movesToApply = dateMoves;
      if (movesToApply.length) {
        const moveKey = (m: {name:string;fromISO:string; id?:string}) => `${m.id || m.name}@@${m.fromISO}`;
        const map = new Map(movesToApply.map(m => [moveKey(m), m.toISO]));
        mergedBills = mergedBills.map(b => {
          const keyById = b.id ? `${b.id}@@${b.dueDate}` : '';
          const keyByName = `${b.name}@@${b.dueDate}`;
          if (keyById && map.has(keyById)) return { ...b, dueDate: map.get(keyById)! };
          if (map.has(keyByName)) return { ...b, dueDate: map.get(keyByName)! };
          return b;
        });
      }

      // Align merged bills to the start (roll-forward + normalized fields) just like forecast
      const mergedBillsRolled = rollForwardPastBills(
        mergedBills.map(b => ({
          id: b.id || '',
          name: b.name,
          amount: b.amount,
          issueDate: b.issueDate || (b as any).dueDateISO || b.dueDate || startMin,
          dueDate: b.dueDate || (b as any).dueDateISO || startMin,
          source: (b.source === 'electricity' ? 'predicted-electricity' : b.source) as "manual" | "predicted-electricity" | "imported",
          movable: b.movable
        })),
        startMin
      ).filter(b => !b.dueDate || b.dueDate >= startMin);

      // Deposits (monthly) — reuse frozen requiredDepositA/B (per‑pay) from storeResult
      let monthlyJointA = 0, monthlyJointB = 0;
      const frozenNow = storeResult as any;
      if (!frozenNow || typeof frozenNow.requiredDepositA !== 'number' || (state.mode === 'joint' && (!payScheduleB || typeof frozenNow.requiredDepositB !== 'number'))) {
        // Wait until frozen deposits are computed
        return;
      }
      monthlyJointA = frozenNow.requiredDepositA * cyclesPerMonth(payScheduleA.frequency);
      if (state.mode === 'joint' && payScheduleB) {
        monthlyJointB = (frozenNow.requiredDepositB || 0) * cyclesPerMonth(payScheduleB.frequency);
      }

      // Available for savings this month (personal), subtract existing owner pots
      // Compute availability from current monthly incomes and frozen deposits
      const availableA = Math.max(0, (monthlyA || 0) - allowanceMonthlyA - monthlyJointA - sumA);
      const availableB = Math.max(0, (monthlyB || 0) - (state.mode === 'joint' ? (allowanceMonthlyB + monthlyJointB) : 0) - sumB);

      // Do not auto-rebalance weekly allowances when pots change; keep allowance stable

      console.log('[budget] recompute', {
        monthlyA: +((monthlyA || 0)).toFixed(2),
        monthlyB: +((monthlyB || 0)).toFixed(2),
        allowanceMonthlyA: +allowanceMonthlyA.toFixed(2),
        allowanceMonthlyB: +allowanceMonthlyB.toFixed(2),
        monthlyJointA: +monthlyJointA.toFixed(2),
        monthlyJointB: +monthlyJointB.toFixed(2),
        fairnessEffA: +fairnessEffA.toFixed(4),
        availableA: +availableA.toFixed(2),
        availableB: +availableB.toFixed(2)
      });
      setBudgetPreview({
        availableA: +availableA.toFixed(2),
        availableB: +availableB.toFixed(2),
        monthlyJointA: +monthlyJointA.toFixed(2),
        monthlyJointB: +monthlyJointB.toFixed(2)
      });
    } catch (e) {
      console.warn('[budget] live recompute failed:', e);
    }
  };

  // Compute and freeze deposits once per Forecast entry (or when detections become available)
  const computeAndFreezeDepositsIfNeeded = () => {
    try {
      const storeNow = usePlanStore.getState();
      const r = storeNow.result as any;
      // Already frozen? skip
      if (r && typeof r.requiredDepositA === 'number' && (state.mode === 'single' || typeof r.requiredDepositB === 'number')) return;

      if (!state.userA?.paySchedule) return;
      if (state.mode === 'joint' && !state.userB?.paySchedule) return;

      // Require detections in joint mode to avoid partial bill sets
      if (state.mode === 'joint') {
        const recA = (detected as any)?.recurring || [];
        const recB = (detected as any)?.recurringB || [];
        if ((recA.length === 0) && (recB.length === 0)) return;
      }
      // Use detected salaries or schedule-derived monthly incomes

      // Build bill set identical to forecast
      const elecPredicted = (state.bills || [])
        .filter(b => b.source === 'predicted-electricity')
        .map(b => ({ ...b, source: 'predicted-electricity' as const }));
      const manual = (state.bills || [])
        .filter(b => b.source === 'manual')
        .map(b => ({ ...b, source: b.source ?? 'manual' as const }));

      // Effective start and schedules
      const firstAnchor = state.userB?.paySchedule
        ? (state.userA.paySchedule!.anchorDate < state.userB.paySchedule!.anchorDate ? state.userA.paySchedule!.anchorDate : state.userB.paySchedule!.anchorDate)
        : state.userA.paySchedule!.anchorDate;
      const provisionalBills = [...manual, ...elecPredicted];
      const allBillsProvisional = rollForwardPastBills(provisionalBills, firstAnchor);
      const startDateA = getStartDate(state.userA.paySchedule!, allBillsProvisional);
      const psA: PaySchedule = { ...state.userA.paySchedule!, anchorDate: startDateA };
      let psB: PaySchedule | null = null;
      let startDateB = '';
      if (state.mode === 'joint' && state.userB?.paySchedule) {
        startDateB = getStartDate(state.userB.paySchedule!, allBillsProvisional);
        psB = { ...state.userB.paySchedule!, anchorDate: startDateB };
      }
      const months = 12;
      const startMin = (state.mode === 'joint' && startDateB) ? (startDateA < startDateB ? startDateA : startDateB) : startDateA;
      const importedA = expandRecurring((detected as any)?.recurring ?? [], startMin, months, 'imp-a-');
      const importedB = expandRecurring(((detected as any)?.recurringB ?? (detected as any)?.allRecurring ?? []), startMin, months, 'imp-b-');
      let mergedBills = [...manual, ...importedA, ...importedB, ...elecPredicted];
      // Apply pending date moves
      if (dateMoves.length) {
        const moveKey = (m: {name:string;fromISO:string; id?:string}) => `${m.id || m.name}@@${m.fromISO}`;
        const map = new Map(dateMoves.map(m => [moveKey(m), m.toISO]));
        mergedBills = mergedBills.map(b => {
          const keyById = b.id ? `${b.id}@@${b.dueDate}` : '';
          const keyByName = `${b.name}@@${b.dueDate}`;
          if (keyById && map.has(keyById)) return { ...b, dueDate: map.get(keyById)! };
          if (map.has(keyByName)) return { ...b, dueDate: map.get(keyByName)! };
          return b;
        });
      }
      const mergedBillsRolled = rollForwardPastBills(
        mergedBills.map(b => ({
          id: b.id || '',
          name: b.name,
          amount: b.amount,
          issueDate: b.issueDate || (b as any).dueDateISO || b.dueDate || startMin,
          dueDate: b.dueDate || (b as any).dueDateISO || startMin,
          source: (b.source === 'electricity' ? 'predicted-electricity' : b.source) as 'manual' | 'predicted-electricity' | 'imported',
          movable: b.movable
        })),
        startMin
      ).filter(b => !b.dueDate || b.dueDate >= startMin);

      // Effective-income fairness (matches Calculate)
      const toMonthlySchedule = (ps?: PaySchedule) => {
        if (!ps || !ps.averageAmount) return 0;
        switch (ps.frequency) {
          case 'WEEKLY': return (ps.averageAmount * 52) / 12;
          case 'FORTNIGHTLY':
          case 'BIWEEKLY': return (ps.averageAmount * 26) / 12;
          case 'FOUR_WEEKLY': return (ps.averageAmount * 13) / 12;
          case 'MONTHLY':
          default: return ps.averageAmount;
        }
      };
      const monthlyIncomeA = toMonthlySalary(topSalary) ?? toMonthlySchedule(psA);
      const monthlyIncomeB = state.mode === 'joint' ? (toMonthlySalary(topSalaryB) ?? toMonthlySchedule(psB!)) : 0;
      const allowanceMonthlyA = (state.weeklyAllowanceA ?? 0) * 52 / 12;
      const allowanceMonthlyB = (state.weeklyAllowanceB ?? 0) * 52 / 12;
      const sumA = (state.pots || []).filter(p => p.owner === 'A').reduce((s, p) => s + p.monthly, 0);
      const sumB = (state.pots || []).filter(p => p.owner === 'B').reduce((s, p) => s + p.monthly, 0);
      const sumJ = (state.pots || []).filter(p => p.owner === 'JOINT').reduce((s, p) => s + p.monthly, 0);
      const prelimRatioA = (monthlyIncomeA + monthlyIncomeB) > 0 ? monthlyIncomeA / (monthlyIncomeA + monthlyIncomeB) : 0.5;
      const jointShareA = sumJ * prelimRatioA;
      const jointShareB = sumJ * (1 - prelimRatioA);
      const effA = (monthlyIncomeA || 0) - allowanceMonthlyA - sumA - jointShareA;
      const effB = (monthlyIncomeB || 0) - (state.mode === 'joint' ? allowanceMonthlyB + sumB + jointShareB : 0);
      const fairnessEffA = (state.mode === 'joint' && (effA + effB) > 0) ? (effA / (effA + effB)) : 1;

      // Compute and freeze
      if (state.mode === 'single' || !psB) {
        const depA = findDepositSingle(startDateA, psA, mergedBillsRolled as any, 0);
        const monthlyDepositA = depA * cyclesPerMonth(psA.frequency);
        storeNow.setResult({
          ...storeNow.result,
          requiredDepositA: depA,
          startISO: startDateA,
          frozenBudget: {
            monthlyIncomeA,
            monthlyIncomeB: 0,
            monthlyDepositA,
            monthlyDepositB: 0
          }
        } as any);
      } else {
        const dep = findDepositJoint(startMin, psA, psB, mergedBillsRolled as any, fairnessEffA, 0);
        const monthlyDepositA = dep.depositA * cyclesPerMonth(psA.frequency);
        const monthlyDepositB = dep.depositB * cyclesPerMonth(psB.frequency);
        storeNow.setResult({
          ...storeNow.result,
          requiredDepositA: dep.depositA,
          requiredDepositB: dep.depositB,
          startISO: startMin,
          frozenBudget: {
            monthlyIncomeA,
            monthlyIncomeB,
            monthlyDepositA,
            monthlyDepositB
          }
        } as any);
      }
    } catch (e) {
      console.warn('[budget] computeAndFreezeDeposits failed:', e);
    }
  };

  // Trigger freezing deposits once when Forecast is ready
  useEffect(() => {
    if (state.step !== 'forecast') return;
    computeAndFreezeDepositsIfNeeded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.step, state.userA?.paySchedule, state.userB?.paySchedule, detected, dateMoves, inputs]);

  useEffect(() => {
    if (state.step === 'forecast') recomputeLiveBudget();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.step, state.weeklyAllowanceA, state.weeklyAllowanceB, state.pots, state.mode, state.userA?.paySchedule, state.userB?.paySchedule, state.bills, detected, dateMoves, (storeResult as any)?.requiredDepositA, (storeResult as any)?.requiredDepositB]);

  // 🔌 NEW: read worker detections (salary + recurring) from the store
  // store access already declared above for effects
  const topSalary: SalaryCandidate | undefined = detected?.salaries?.[0];
  const topSalaryB: SalaryCandidate | undefined = (detected as any)?.salariesB?.[0];
  const recurringFromStore: RecurringItem[] = detected?.recurring ?? [];
  const recurringFromStoreB: RecurringItem[] = (detected as any)?.recurringB ?? [];


  // Load mock bank data
  const loadBankData = async (mode: 'single' | 'joint') => {
    // LIVE mode: go straight to bank step and load institutions
    if (!useMock) {
      setState(prev => ({ ...prev, mode, step: 'bank', isLoading: true }));
      try {
        const { data, error } = await supabase.functions.invoke('get_institutions');
        if (error) throw error;
        const list = Array.isArray(data) ? data : (data.institutions ?? data.results ?? []);
        setInstitutions(list.map((i: any) => ({ id: i.id, name: i.name })));
      } catch (err) {
        console.error('get_institutions failed:', err);
      } finally {
        setState(prev => ({ ...prev, isLoading: false }));
      }
      return;
    }

    // MOCK mode: do NOT preload anything; show only the link buttons.
    // Also purge any previously-hydrated detected bills so the table starts empty.
    setState(prev => ({
      ...prev,
      mode,
      step: 'bank',
      isLoading: false,
      linkedA: false,
      linkedB: false,
      bills: prev.bills.filter(
        b => (b as any).source !== 'detected' && !String(b.id || '').startsWith('det-')
      ),
      includedBillIds: prev.includedBillIds.filter(
        id => !String(id || '').startsWith('det-')
      )
    }));
  };

  useEffect(() => {
    console.log('[VITE_SUPABASE_URL]', import.meta.env.VITE_SUPABASE_URL);
    console.log('[VITE_SUPABASE_ANON_KEY]', (import.meta.env.VITE_SUPABASE_ANON_KEY || '').slice(0, 10) + '...');
    console.log('[VITE_USE_MOCK_GC]', import.meta.env.VITE_USE_MOCK_GC);
  }, []);

  // 🔁 NEW: whenever worker/store detections change, hydrate the page state from them
  useEffect(() => {
    if (!detected) return;
    // Only import worker bills after at least one partner has linked this session
    if (!state.linkedA && !state.linkedB) return;

    console.log('[Index] Processing detected data:', {
      recurringA: recurringFromStore.length,
      recurringB: recurringFromStoreB.length,
      mode: state.mode,
      detected: detected,
      recurringFromStore: recurringFromStore,
      recurringFromStoreB: recurringFromStoreB
    });

    // Map worker-recurring → UI Bill[] and collect display metadata (freq, last, dueDay)
    const meta: RecurringMeta = {};

    // Process User A's bills (only if A is linked)
    const importedFromDetectedA: Bill[] = state.linkedA
      ? recurringFromStore.map((r, i) => {
      const lastDate =
        (r.sampleDates && r.sampleDates.length
          ? [...r.sampleDates].sort().slice(-1)[0]
          : '') || '';
      const id = `det-a-${i}`;
      meta[id] = {
        freq: r.freq,
        last: lastDate,
        dueDay: (r as any).dueDay,
        dayOfWeek: (r as any).dayOfWeek,
      };
      return {
        id,
        name: r.description,
        amount: r.amount,
        issueDate: lastDate,
        dueDate: lastDate,
        source: 'detected' as any,
        movable: false,
        // @ts-ignore – UI-only field
        owner: 'A',
      };
      })
    : [];

    // Process User B's bills (only if B is linked)
    const importedFromDetectedB: Bill[] =
      (state.mode === 'joint' && state.linkedB)
        ? recurringFromStoreB.map((r, i) => {
      const lastDate =
        (r.sampleDates && r.sampleDates.length
          ? [...r.sampleDates].sort().slice(-1)[0]
          : '') || '';
      const id = `det-b-${i}`;
      meta[id] = {
        freq: r.freq,
        last: lastDate,
        dueDay: (r as any).dueDay,
        dayOfWeek: (r as any).dayOfWeek,
      };
      return {
        id,
        name: r.description,
        amount: r.amount,
        issueDate: lastDate,
        dueDate: lastDate,
        source: 'detected' as any,
        movable: false,
        // @ts-ignore – UI-only field
        owner: 'B',
      };
    })
    : [];

    const allImportedBills = [...importedFromDetectedA, ...importedFromDetectedB];

    console.log('[Index] Final bill processing:', {
      importedFromDetectedA: importedFromDetectedA.length,
      importedFromDetectedB: importedFromDetectedB.length,
      allImportedBills: allImportedBills.length,
      sampleA: importedFromDetectedA[0]?.name,
      sampleB: importedFromDetectedB[0]?.name
    });

    setRecurringMeta(meta);
    setState(prev => ({
        ...prev,
        bills: [
          // keep any non-worker bills (eg. predicted-electricity, manual)
          ...prev.bills.filter(
            b => (b as any).source !== 'detected' && !String(b.id || '').startsWith('det-')
          ),
          ...allImportedBills,
        ],
        includedBillIds: allImportedBills.map(b => b.id!),
      }));
    // Re-run when worker detections are present OR when bank data loads
    }, [detected, state.linkedA, state.linkedB]);

  // When useLinkAccount (mock) dispatches transactions → hydrate state for that partner
  useEffect(() => {
    const onTx = (e: any) => {
      if (!e?.detail) return;
      const { partner, transactions } = e.detail as { partner: 'A' | 'B'; transactions: Transaction[] };
      const categorized = categorizeBankTransactions(transactions);
      const pay = extractPayScheduleFromWages(categorized.wages);

      let nextState!: AppState;
      setState(prev => {
        nextState =
          partner === 'A'
            ? { ...prev, userA: { transactions, paySchedule: pay }, linkedA: true, step: 'bank' }
            : { ...prev, userB: { transactions, paySchedule: pay } as any, linkedB: true, mode: prev.mode === 'single' ? 'joint' : prev.mode, step: 'bank' };
        return nextState;
      });

      if (nextState) {
        const txA = nextState.userA?.transactions ?? [];
        const txB = nextState.userB?.transactions ?? [];
        (window as any).__runDetection?.(txA, txB);
      } else {
        console.warn('[Index] onTx: nextState undefined after setState; skipping detection');
      }
    };

    window.addEventListener('gc:transactions' as any, onTx);
    return () => window.removeEventListener('gc:transactions' as any, onTx);
  }, []);


  // After user finishes bank auth (live), callback posts a message → pull transactions
  useEffect(() => {
    const handler = async (e: MessageEvent<any>) => {
      if (!e?.data || e.data.type !== 'GC_LINK_DONE') return;
      const { partner, requisitionId } = e.data as { partner: 'A' | 'B'; requisitionId: string };

      setState(prev => ({ ...prev, isLoading: true, step: 'bank' }));
      const { data, error } = await supabase.functions.invoke('gc_pull', { body: { requisitionId, partner } });
      setState(prev => ({ ...prev, isLoading: false }));
      if (error) { console.error('gc_pull error:', error); alert(/*…*/); return; }

      const txs = Array.isArray(data) ? data : (data.transactions ?? []);
      const categorized = categorizeBankTransactions(txs);
      const pay = extractPayScheduleFromWages(categorized.wages);

      let nextState!: AppState;
      setState(prev => {
        nextState =
          partner === 'A'
            ? { ...prev, userA: { transactions: txs, paySchedule: pay }, linkedA: true, step: 'bank' }
            : { ...prev, userB: { transactions: txs, paySchedule: pay } as any, linkedB: true, mode: prev.mode === 'single' ? 'joint' : prev.mode, step: 'bank' };
        return nextState;
      });

      (window as any).__runDetection?.(
        nextState.userA.transactions ?? [],
        nextState.userB?.transactions ?? []
      );
    };

    window.addEventListener('message', handler);
    const bc = new BroadcastChannel('fair-balance-buddy');
    bc.onmessage = handler as any;
    return () => { window.removeEventListener('message', handler); bc.close(); };
  }, []);


  // Safety: if both get linked at any time, run joint detection
  useEffect(() => {
    if (state.linkedA && state.linkedB) {
      (window as any).__runDetection?.(state.userA.transactions, state.userB?.transactions);
    }
  }, [state.linkedA, state.linkedB]);


  // Render a compact pattern string (no "last …" – that's already the Date column)
  const dowShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const formatPattern = (m?: RecurringMeta[string]) => {
    if (!m) return '—';
    const f = (m.freq || '').toLowerCase();
    if (f === 'monthly' && m.dueDay) return `monthly · day ${m.dueDay}`;
    if ((f === 'weekly' || f === 'fortnightly') && m.dayOfWeek != null)
      return `${f} · ${dowShort[m.dayOfWeek]}`;
    return f || '—';
  };

  const handleEnergyReadings = (readings: EsbReading[]) => {
    setState(prev => ({
      ...prev,
      electricityReadings: readings
    }));
  };

  const handleTariffExtracted = (tariff: TariffRates) => {
    const predicted = state.electricityReadings.length
      ? predictBills({
          mode: state.electricityMode,
          readings: state.electricityReadings,
          tariff,
          months: 12
        })
      : [];


    setState(prev => {
      // Use the predictor’s own issued/due dates (parity with fair-split)
      const electricityBills: Bill[] = predicted.map((bill, index) => {
        const issued = (bill as any).issuedDate ?? bill.period.end; // fallback if not set
        const due    = (bill as any).dueDate    ?? bill.period.end;
        return {
          id: `elec_${index}`,
          name: `${tariff.supplier} ${tariff.plan} — Bill ${index + 1}`,
          amount: bill.totalInclVat,
          issueDate: issued,
          dueDate: due,
          source: 'predicted-electricity' as const,
          movable: true,
          account: 'JOINT' as const,
        };
      });

      // Drop future electricity BANK recurrences in favour of predictions
      const firstPredStart = predicted[0]?.period.start
        ? new Date(predicted[0].period.start)
        : null;
      const billsSansFutureElec = prev.bills.filter(b => {
        if (!firstPredStart) return true;
        const name = (b.name || '').toString();
        const isElec = ELEC_VENDOR.test(name);
        if (!isElec) return true;
        const d = new Date(b.dueDate || b.issueDate || '1900-01-01');
        return d < firstPredStart; // keep only past electricity bank items
      });

      return {
        ...prev,
        tariffRates: tariff,
        bills: electricityBills.length ? [...billsSansFutureElec, ...electricityBills] : prev.bills,
        includedBillIds: electricityBills.length ? Array.from(new Set([
          ...prev.includedBillIds,
          ...electricityBills.map(b => b.id!)
        ])) : prev.includedBillIds,
        step: electricityBills.length ? 'forecast' : prev.step
      };
    });

    // Store the electricity bills in the plan store
    if (predicted.length > 0) {
      const currentElecBills = predicted.map((bill, index) => {
        const issued = (bill as any).issuedDate ?? bill.period.end;
        const due    = (bill as any).dueDate    ?? bill.period.end;
        return {
          id: `elec_${index}`,
          name: `${tariff.supplier} ${tariff.plan} — Bill ${index + 1}`,
          amount: bill.totalInclVat,
          issueDate: issued,
          dueDate: due,
          source: 'predicted-electricity' as const,
          movable: true,
          account: 'JOINT' as const,
          dueDateISO: due,
        };
      });

      usePlanStore.getState().setInputs({ elecPredicted: currentElecBills });
      const api = (window as any).__workerAPI;
      if (api) {
        const currentInputs = { ...usePlanStore.getState().inputs, elecPredicted: currentElecBills } as PlanInputs;
        api.simulate(currentInputs).then(res => {
        usePlanStore.getState().setResult({ ...usePlanStore.getState().result, ...res });
        }).catch(err => console.error('[forecast] worker sim failed:', err));
      }
    }
  };

  // Determine the forecast start date: the most recent pay date before the earliest bill
  const getStartDate = (paySchedule: PaySchedule, bills: Bill[]): string => {
    const earliestDue = bills.reduce((min, b) => (b.dueDate < min ? b.dueDate : min), '9999-12-31');
    const pays = calculatePayDates(paySchedule.frequency, paySchedule.anchorDate, 18);
    const before = pays.filter(p => p <= earliestDue);
    return before.length ? before[before.length - 1] : pays[0];
  };

  const runForecast = async (currentState: AppState = state, movesOverride?: Array<{ id?: string; name: string; fromISO: string; toISO: string }>) => {
    if (!currentState.userA.paySchedule) return;

    // Work with the most up-to-date state (e.g. newly added bills)
    setState({ ...currentState, isLoading: true });

    try {
      const elecPredicted = (currentState.bills ?? [])
        .filter(b => b.source === 'predicted-electricity')
        .map(b => ({ ...b, source: 'predicted-electricity' as const }));
      const manual = (currentState.bills ?? [])
        .filter(b => b.source === 'manual')
        .map(b => ({ ...b, source: b.source ?? 'manual' as const }));

      const firstPayDate = currentState.userB?.paySchedule
        ? (currentState.userA.paySchedule!.anchorDate < currentState.userB.paySchedule.anchorDate
            ? currentState.userA.paySchedule!.anchorDate
            : currentState.userB.paySchedule.anchorDate)
        : currentState.userA.paySchedule!.anchorDate;

      const provisionalBills = [...manual, ...elecPredicted];
      const allBillsProvisional = rollForwardPastBills(provisionalBills, firstPayDate);

      const startDateA = getStartDate(currentState.userA.paySchedule!, allBillsProvisional);
      const payScheduleA: PaySchedule = { ...currentState.userA.paySchedule!, anchorDate: startDateA };

      let startDateB = '';
      if (currentState.mode === 'joint' && currentState.userB?.paySchedule) {
        const detectedNextPayB =
          (usePlanStore.getState().detected as any)?.salaryB?.nextDateISO ||
          (usePlanStore.getState().detected as any)?.topSalaryB?.nextDateISO;
        startDateB = detectedNextPayB ?? getStartDate(currentState.userB.paySchedule!, allBillsProvisional);
      }

      const startDate = startDateB && startDateA > startDateB ? startDateB : startDateA;

      const months = 12;
      const importedA = expandRecurring(detected?.recurring ?? [], startDate, months, 'imp-a-');
      const importedB = expandRecurring(
        (detected?.recurringB ?? (detected as any)?.allRecurring ?? []),
        startDate,
        months,
        'imp-b-'
      );
      let mergedBills = [...manual, ...importedA, ...importedB, ...elecPredicted];
      // Apply any pending date moves (name + fromISO → toISO)
      const movesToApply = movesOverride && movesOverride.length ? movesOverride : dateMoves;
      if (movesToApply.length) {
        const moveKey = (m: {name:string;fromISO:string; id?:string}) => `${m.id || m.name}@@${m.fromISO}`;
        const map = new Map(movesToApply.map(m => [moveKey(m), m.toISO]));
        let applied = 0;
        mergedBills = mergedBills.map(b => {
          const keyById = b.id ? `${b.id}@@${b.dueDate}` : '';
          const keyByName = `${b.name}@@${b.dueDate}`;
          if (keyById && map.has(keyById)) { applied++; return { ...b, dueDate: map.get(keyById)! }; }
          if (map.has(keyByName)) { applied++; return { ...b, dueDate: map.get(keyByName)! }; }
          return b;
        });
        console.log('[forecast] applied date moves:', applied, 'of', movesToApply.length);
      }
      console.log(
        '[forecast] bills: manual=%d, importedA=%d, importedB=%d, elec=%d, total=%d',
        manual.length,
        importedA.length,
        importedB.length,
        elecPredicted.length,
        mergedBills.length
      );

      const api = (window as any).__workerAPI;
      let workerResult: SimResult | undefined;
      if (api && currentState.mode === 'joint') {
        const planForWorker: PlanInputs = {
          ...usePlanStore.getState().inputs,
          bills: mergedBills,
          elecPredicted: elecPredicted,
          weeklyAllowanceA: currentState.weeklyAllowanceA ?? 0,
          weeklyAllowanceB: currentState.weeklyAllowanceB ?? 0,
          startISO: startDate,
          mode: 'joint',
        } as any;
        try {
          workerResult = await api.simulate(planForWorker);
          usePlanStore.getState().setResult({ ...usePlanStore.getState().result, ...workerResult });
        } catch (e) {
          console.warn('[forecast] worker simulate failed:', e);
        }
      }

      // Use the same start the solver will use
      const allBills = rollForwardPastBills(
        mergedBills.map(b => ({
          id: b.id || '',
          name: b.name,
          amount: b.amount,
          issueDate: b.issueDate || (b as any).dueDateISO || b.dueDate || startDate,
          dueDate: b.dueDate || (b as any).dueDateISO || startDate,
          source: (b.source === 'electricity' ? 'predicted-electricity' : b.source) as "manual" | "predicted-electricity" | "imported",
          movable: b.movable
        })), 
        startDate
      ).filter(b => !b.dueDate || b.dueDate >= startDate);

      if (currentState.mode === 'single') {
        // Evaluate multiple candidate start dates to reduce deposit/snowballing
        const cands = calculatePayDates(payScheduleA.frequency, payScheduleA.anchorDate, 6)
          .filter(d => d >= startDateA)
          .slice(0, payScheduleA.frequency === 'WEEKLY' ? 4 : payScheduleA.frequency === 'FORTNIGHTLY' || payScheduleA.frequency === 'BIWEEKLY' ? 2 : 1);
        const tryStarts = [startDateA, ...cands.filter(d => d !== startDateA)];

        let bestDep = Infinity;
        let bestRes: { minBalance: number; timeline: any } | null = null;
        let bestStart = startDateA;
        for (const s of tryStarts) {
          const dep = findDepositSingle(s, { ...payScheduleA, anchorDate: s }, allBills, 0);
          const res = runSingle(dep, s, { ...payScheduleA, anchorDate: s }, allBills, { months: 12, buffer: 0 });
          if (res.minBalance < 0) continue;
          if (dep < bestDep) { bestDep = dep; bestRes = res; bestStart = s; }
          else if (dep === bestDep && bestRes && Math.abs(bestRes.timeline.at(-1)?.balance ?? 0) > Math.abs(res.timeline.at(-1)?.balance ?? 0)) {
            bestRes = res; bestStart = s;
          }
        }

        const depositA = isFinite(bestDep) ? bestDep : findDepositSingle(startDateA, payScheduleA, allBills, 0);
        const resultObj = bestRes || runSingle(depositA, startDateA, payScheduleA, allBills, { months: 12, buffer: 0 });

        // Use worker suggestions if present; otherwise compute locally
        try {
          // Build PlanInputs from the exact merged bill set we just simulated
          const toLowerFreq = (f: PaySchedule['frequency']): 'weekly'|'fortnightly'|'four_weekly'|'monthly' => {
            switch (f) {
              case 'WEEKLY': return 'weekly';
              case 'FORTNIGHTLY':
              case 'BIWEEKLY': return 'fortnightly';
              case 'FOUR_WEEKLY': return 'four_weekly';
              case 'MONTHLY':
              default: return 'monthly';
            }
          };
          const planForSuggestions: PlanInputs = {
            a: { netMonthly: 0, freq: toLowerFreq(payScheduleA.frequency), firstPayISO: startDateA },
            bills: mergedBills.map(b => ({
              id: b.id || '',
              name: b.name,
              amount: b.amount,
              dueDateISO: b.dueDate,
              account: 'A',
              movable: b.movable,
              source: b.source as any,
            })) as any,
            elecPredicted: [],
            pots: currentState.pots,
            startISO: bestStart,
            minBalance: 0,
            mode: 'single',
            weeklyAllowanceA: currentState.weeklyAllowanceA,
          };
          const s = generateBillSuggestions(
            planForSuggestions,
            { monthlyA: depositA },
            resultObj.minBalance
          );
          usePlanStore.getState().setResult({
            ...usePlanStore.getState().result,
            billSuggestions: s
          });
        } catch (e) {
          console.warn('Bill suggestions generation failed:', e);
        }

        // Freeze per‑pay deposits for preview reuse
        usePlanStore.getState().setResult({
          ...usePlanStore.getState().result,
          requiredDepositA: depositA,
          startISO: startDateA
        } as any);

        setState(prev => ({
          ...prev,
          forecastResult: {
            depositA,
            minBalance: resultObj.minBalance,
            timeline: resultObj.timeline
          },
          isLoading: false,
          step: 'results'
        }));
      } else if (currentState.userB?.paySchedule) {
        // Use optimized deposits from worker result if available, otherwise use old forecast
        const workerResult = storeResult;
        const useWorkerOptimization = !!(
          workerResult &&
          typeof workerResult.requiredDepositA === 'number' &&
          typeof workerResult.requiredDepositB === 'number'
        );

        const payScheduleB: PaySchedule = { ...currentState.userB.paySchedule!, anchorDate: startDateB };
        console.log('[forecast] first B payday anchor=%s', payScheduleB.anchorDate);

        const toMonthly = (s?: SalaryCandidate): number | undefined => {
          if (!s) return undefined;
          switch (s.freq) {
            case 'weekly':
              return (s.amount * 52) / 12;
            case 'fortnightly':
              return (s.amount * 26) / 12;
            case 'four_weekly':
              return (s.amount * 13) / 12;
            case 'monthly':
            default:
              return s.amount;
          }
        };
        const toMonthlySchedule = (ps?: PaySchedule) => {
          if (!ps || !ps.averageAmount) return 0;
          switch (ps.frequency) {
            case 'WEEKLY':
              return (ps.averageAmount * 52) / 12;
            case 'FORTNIGHTLY':
            case 'BIWEEKLY':
              return (ps.averageAmount * 26) / 12;
            case 'FOUR_WEEKLY':
              return (ps.averageAmount * 13) / 12;
            case 'MONTHLY':
            default:
              return ps.averageAmount;
          }
        };

        // Base monthly incomes
        const monthlyA = toMonthly(topSalary) ?? toMonthlySchedule(payScheduleA);
        const monthlyB = toMonthly(topSalaryB) ?? toMonthlySchedule(payScheduleB);

        // Weekly allowance → monthly
        const allowanceMonthlyA = (currentState.weeklyAllowanceA ?? 100) * 52 / 12;
        const allowanceMonthlyB = (currentState.weeklyAllowanceB ?? 100) * 52 / 12;

        // Pots: subtract owner pots fully; split JOINT pots by prelim ratio
        const prelimRatioA = (monthlyA + monthlyB) > 0 ? monthlyA / (monthlyA + monthlyB) : 0.5;
        const sumA = (currentState.pots ?? []).filter(p => p.owner === 'A').reduce((s,p)=>s+p.monthly,0);
        const sumB = (currentState.pots ?? []).filter(p => p.owner === 'B').reduce((s,p)=>s+p.monthly,0);
        const sumJ = (currentState.pots ?? []).filter(p => p.owner === 'JOINT').reduce((s,p)=>s+p.monthly,0);
        const jointShareA = sumJ * prelimRatioA;
        const jointShareB = sumJ * (1 - prelimRatioA);

        // Effective incomes (available for joint)
        const effA = monthlyA - allowanceMonthlyA - sumA - jointShareA;
        const effB = monthlyB - allowanceMonthlyB - sumB - jointShareB;

        // Final fairness ratio
        const fairnessRatioA = (effA + effB) > 0 ? effA / (effA + effB) : 0.5;
        console.log('[forecast] fairnessRatioA=%s effA=%s effB=%s', fairnessRatioA.toFixed(4), effA.toFixed(2), effB.toFixed(2));

        let depositA: number;
        let depositB: number | undefined;
        let simResult: { minBalance: number; timeline: any };
        if (useWorkerOptimization) {
          depositA = workerResult.requiredDepositA!;
          depositB = workerResult.requiredDepositB!;
          // Align start date with worker pick to ensure minBalance consistency
          const startFromWorker = workerResult.startISO || startDate;
          const psAAligned: PaySchedule = { ...payScheduleA, anchorDate: startFromWorker };
          const psBAligned: PaySchedule = { ...payScheduleB, anchorDate: startFromWorker };
          simResult = runJoint(
            depositA,
            depositB,
            startFromWorker,
            psAAligned,
            psBAligned,
            allBills,
            { months: 12, fairnessRatioA }
          );
        } else {
          const startDateJoint = startDate;
          const deposits = findDepositJoint(
            startDateJoint,
            payScheduleA,
            payScheduleB,
            allBills,
            fairnessRatioA,
            0
          );
          depositA = deposits.depositA;
          depositB = deposits.depositB;
          simResult = runJoint(
            depositA,
            depositB,
            startDateJoint,
            payScheduleA,
            payScheduleB,
            allBills,
            { months: 12, fairnessRatioA }
          );
        }

        console.log('[forecast] deposits: A=%s, B=%s', depositA.toFixed(2), (depositB ?? 0).toFixed(2));
        // Freeze per‑pay deposits for preview reuse
        const frozenStart = useWorkerOptimization ? (workerResult.startISO || startDate) : startDate;
        usePlanStore.getState().setResult({
          ...usePlanStore.getState().result,
          requiredDepositA: depositA,
          requiredDepositB: depositB,
          startISO: frozenStart
        } as any);

        if (!useWorkerOptimization) {
          setTimeout(() => {
            try {
              const inputsForSuggestions: PlanInputs = {
                ...(inputs as PlanInputs),
                fairnessRatio: { a: effA, b: effB },
              };
              console.log('[forecast] suggestions fairness inputs', { effA: +effA.toFixed(2), effB: +effB.toFixed(2) });
              const s = generateBillSuggestions(
                inputsForSuggestions,
                { monthlyA: depositA, monthlyB: depositB },
                simResult.minBalance
              );
              usePlanStore.getState().setResult({
                ...usePlanStore.getState().result,
                billSuggestions: s
              });
            } catch (e) {
              console.warn('Bill suggestions generation failed:', e);
            }
          }, 0);
        } else {
          usePlanStore.getState().setResult({
            ...usePlanStore.getState().result,
            billSuggestions: workerResult.billSuggestions ?? []
          });
        }
        setState((prev) => ({
          ...prev,
          forecastResult: {
            depositA,
            depositB,
            minBalance: simResult.minBalance,
            timeline: simResult.timeline
          },
          isLoading: false,
          step: 'results'
        }));
      }
    } catch (error) {
      console.error('Forecast failed:', error);
      setState(prev => ({ ...prev, isLoading: false }));
      toast({
        title: 'Calculation failed',
        description: (error as Error)?.message ?? 'Check console for details',
        variant: 'destructive'
      });
    }
  };

  // Add/Edit bill handler
  const handleBillSubmit = async (values: { name: string; amount: number; dueDate: string; frequency: BillFrequency }) => {
    const seriesId = (globalThis.crypto && 'randomUUID' in globalThis.crypto) ? (globalThis.crypto as any).randomUUID() : `series_${Date.now()}`;

    if (billEditing) {
      // Simple edit of a single occurrence
      const updatedBills = state.bills.map(b =>
        b.id === billEditing.id ? { ...b, name: values.name, amount: values.amount, dueDate: values.dueDate } : b
      );
      const newState = { ...state, bills: updatedBills };
      setBillEditing(null);
      toast({ description: 'Bill updated. Recalculating forecast…' });
      runForecast(newState);
      return;
    }

    // Generate occurrences based on frequency
    const dates = generateOccurrences(values.dueDate, values.frequency, 12);
    const newBills: Bill[] = dates.map((d, idx) => ({
      id: `${seriesId}_${idx}`,
      name: values.name,
      amount: values.amount,
      issueDate: d,
      dueDate: d,
      source: 'manual' as const,
      movable: false,
    }));

    const updatedState: AppState = {
      ...state,
      bills: [...state.bills, ...newBills],
      includedBillIds: Array.from(new Set([...state.includedBillIds, ...newBills.map(b => b.id!)]))
    };

    // Persist to Supabase if authenticated
    persistBills(newBills.map(nb => ({
      name: nb.name,
      amount: nb.amount,
      due_date: nb.dueDate,
      frequency: values.frequency,
      recurrence_anchor: values.dueDate,
      recurrence_interval: 1,
      series_id: seriesId,
      movable: nb.movable,
      source: nb.source
    }))).then(({ persisted, count }) => {
      if (persisted) {
        toast({ description: `${count} bill${count === 1 ? '' : 's'} saved to your account.` });
      } else {
        toast({ description: 'Saved locally. Sign in to persist bills to your account.' });
      }
    });

    // Suggest deposit change from the pay date before the first due date
    const earliest = dates[0];
    const startDate = (() => {
      const payA = state.userA.paySchedule;
      if (!payA) return new Date().toISOString().slice(0,10);
      const pays = calculatePayDates(payA.frequency, payA.anchorDate, 18);
      const before = pays.filter(p => p <= earliest);
      return before.length ? before[before.length - 1] : pays[0];
    })();

    const allBills = updatedState.bills.filter(b => updatedState.includedBillIds.includes(b.id!));
    if (updatedState.mode === 'single') {
      const baseline = 150;
      const dep = findDepositSingle(startDate, state.userA.paySchedule!, allBills, baseline);
      toast({ description: `From ${startDate}, set your deposit to ${formatCurrency(dep)} to stay above zero.` });
    } else if (state.userB?.paySchedule) {
      const baseline = 800;
      const fairness = 0.55;
      const { depositA, depositB } = findDepositJoint(startDate, state.userA.paySchedule!, state.userB.paySchedule!, allBills, fairness, baseline);
      toast({ description: `From ${startDate}, set deposits to ${formatCurrency(depositA)} (A) and ${formatCurrency(depositB)} (B).` });
    }

    // Re-run forecast with updated bills
    runForecast(updatedState);
  };

  function handleAddPot(potName: string, monthlyAmount: number, owner: 'A'|'B'|'JOINT') {
    const potId = (globalThis.crypto && 'randomUUID' in globalThis.crypto)
      ? (globalThis.crypto as any).randomUUID()
      : `pot_${Date.now()}`;
    setState(prev => ({
      ...prev,
      pots: [...prev.pots, { id: potId, name: potName, monthly: monthlyAmount, owner }]
    }));
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-secondary/20">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent mb-4">
            FairSplit
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Smart cash-flow forecasting and bill smoothing for Irish households.
            Calculate optimal deposits to keep your balance above zero.
          </p>
        </div>

        {/* Progress indicator */}
        <div className="mb-8">
          <div className="flex justify-center space-x-4 mb-4">
            {[
              { key: 'setup', label: 'Setup', icon: Calculator },
              { key: 'bank', label: 'Bank Data', icon: TrendingUp },
              { key: 'energy', label: 'Electricity', icon: Lightbulb },
              { key: 'forecast', label: 'Forecast', icon: CalendarIcon },
              { key: 'results', label: 'Results', icon: CheckCircle }
            ].map(({ key, label, icon: Icon }) => (
              <div key={key} className="flex flex-col items-center space-y-2 cursor-pointer" onClick={() => setState(prev => ({ ...prev, step: key as AppState['step'] }))}>
                <div className={`
                  w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors
                  ${state.step === key
                    ? 'bg-primary border-primary text-primary-foreground'
                    : 'border-border text-muted-foreground'
                  }
                `}>
                  <Icon className="w-5 h-5" />
                </div>
                <span className="text-xs font-medium">{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Step Content */}
        {state.step === 'setup' && state.setupPhase === 'choose-mode' && (
          <Card className="max-w-2xl mx-auto">
            <CardHeader>
              <CardTitle>Choose Your Mode</CardTitle>
              <CardDescription>
                Select whether you're forecasting for yourself or a couple
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Button
                  variant="outline"
                  className="h-24 flex flex-col space-y-2"
                  onClick={() => loadBankData('single')}
                  disabled={state.isLoading}
                >
                  <Calculator className="w-6 h-6" />
                  <span className="font-medium">Single</span>
                  <span className="text-xs text-muted-foreground">Individual forecasting</span>
                </Button>

                <Button
                  variant="outline"
                  className="h-24 flex flex-col space-y-2"
                  onClick={() => setState(prev => ({ ...prev, setupPhase: 'choose-couple-type' }))}
                  disabled={state.isLoading}
                >
                  <Users className="w-6 h-6" />
                  <span className="font-medium">Couple</span>
                  <span className="text-xs text-muted-foreground">Couple's forecasting</span>
                </Button>
              </div>

              {state.isLoading && (
                <div className="space-y-2">
                  <Progress value={undefined} />
                  <p className="text-sm text-center text-muted-foreground">
                    Loading mock bank data...
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {state.step === 'setup' && state.setupPhase === 'choose-couple-type' && (
          <Card className="max-w-2xl mx-auto">
            <CardHeader>
              <CardTitle>Couple Setup</CardTitle>
              <CardDescription>
                Pick how you want to set up your couple forecast
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Button
                  variant="outline"
                  className="h-24 flex flex-col space-y-2"
                  onClick={() => setState(prev => ({ ...prev, setupPhase: 'separate-placeholder' }))}
                >
                  <Calculator className="w-6 h-6" />
                  <span className="font-medium">Separate Accounts</span>
                  <span className="text-xs text-muted-foreground">Two individuals, combined plan</span>
                </Button>

                <Button
                  variant="outline"
                  className="h-24 flex flex-col space-y-2"
                  onClick={() => loadBankData('joint')}
                  disabled={state.isLoading}
                >
                  <Users className="w-6 h-6" />
                  <span className="font-medium">Joint Account</span>
                  <span className="text-xs text-muted-foreground">Shared account forecasting</span>
                </Button>
              </div>
              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setState(prev => ({ ...prev, setupPhase: 'choose-mode' }))}>Back</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {state.step === 'setup' && state.setupPhase === 'separate-placeholder' && (
          <Card className="max-w-2xl mx-auto">
            <CardHeader>
              <CardTitle>Separate Accounts (Coming Soon)</CardTitle>
              <CardDescription>
                We’re building this flow. For now, you can go back and choose Joint Account.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <AlertDescription>
                  Placeholder: Separate Accounts will let each person link their own account and combine plans without a shared joint account.
                </AlertDescription>
              </Alert>
              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setState(prev => ({ ...prev, setupPhase: 'choose-couple-type' }))}>Back</Button>
                <Button onClick={() => setState(prev => ({ ...prev, setupPhase: 'choose-couple-type' }))}>Choose Different Option</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {state.step === 'bank' && (
          <Card className="max-w-4xl mx-auto">
            <CardHeader>
              <CardTitle>Review Bank Data</CardTitle>
              <CardDescription>Confirm detected pay schedules, wages, and bills for each person.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-8">
              {state.isLoading && (
                <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
                  <Progress value={undefined} className="w-1/2" />
                  <p>Fetching bank institutions…</p>
                </div>
              )}
              {/* Link accounts (A & B) */}
              <div className="rounded-xl border p-4">
                <h3 className="font-semibold mb-3">Link accounts</h3>
                <div className={`grid gap-4 ${state.mode === 'joint' ? 'md:grid-cols-2' : 'md:grid-cols-1'}`}>
                  {/* Partner A */}
                  <div className="rounded-lg border p-3">
                    <div className="text-sm mb-2">Person A</div>
                    {useMock ? (
                      <Button onClick={() => link('A')} disabled={busy === 'A'}>
                        {busy === 'A' ? 'Linking…' : 'Link account (A)'}
                      </Button>
                    ) : (
                      <>
                        <Input
                          list="instListA"
                          placeholder="Choose bank…"
                          className="mb-2"
                          onChange={(e) => {
                            const chosen = institutions.find(i => i.name === e.target.value);
                            setInstA(chosen ?? null);
                          }}
                        />
                        <datalist id="instListA">
                          {institutions.slice(0, 50).map(i => (
                            <option key={i.id} value={i.name} />
                          ))}
                        </datalist>
                        <Button
                          onClick={() => instA && link('A', instA.id)}
                          disabled={!instA || busy === 'A'}
                        >
                          {busy === 'A' ? 'Opening bank…' : 'Link account (A)'}
                        </Button>
                      </>
                    )}
                  </div>
                  {/* Partner B */}
                  {state.mode === 'joint' && (
                    <div className="rounded-lg border p-3">
                      <div className="text-sm mb-2">Person B</div>
                      {useMock ? (
                        <Button onClick={() => link('B')} disabled={busy === 'B'}>
                          {busy === 'B' ? 'Linking…' : 'Link account (B)'}
                        </Button>
                      ) : (
                        <>
                          <Input
                            list="instListB"
                            placeholder="Choose bank…"
                            className="mb-2"
                            onChange={(e) => {
                              const chosen = institutions.find(i => i.name === e.target.value);
                              setInstB(chosen ?? null);
                            }}
                          />
                          <datalist id="instListB">
                            {institutions.slice(0, 50).map(i => (
                              <option key={i.id} value={i.name} />
                            ))}
                          </datalist>
                          <Button
                            onClick={() => instB && link('B', instB.id)}
                            disabled={!instB || busy === 'B'}
                          >
                            {busy === 'B' ? 'Opening bank…' : 'Link account (B)'}
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
                {!useMock && (
                  <p className="text-xs text-muted mt-2">
                    You’ll authenticate with your bank in a new tab. Return here when finished.
                  </p>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Person A</p>
                  <Badge variant="secondary">{state.userA.transactions.length} transactions</Badge>
                </div>
                {state.mode === 'joint' && state.userB && (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Person B</p>
                    <Badge variant="secondary">{state.userB.transactions.length} transactions</Badge>
                  </div>
                )}
              </div>

              {/* Wage confirmation and Bills selection */}
              {(() => {
                const a = categorizeBankTransactions(state.userA.transactions);
                const b = state.mode === 'joint' && state.userB ? categorizeBankTransactions(state.userB.transactions) : null;
                const wageBlock = (
                  label: string,
                  pay: PaySchedule | null,
                  wages: Transaction[],
                  who: 'A' | 'B'
                ) => {
                  const avgOcc = wages.length ? wages.reduce((s, w) => s + w.amount, 0) / wages.length : undefined;
                  const factor: Record<NonNullable<PaySchedule['frequency']>, number> = {
                    WEEKLY: 52 / 12,
                    FORTNIGHTLY: 26 / 12,
                    BIWEEKLY: 26 / 12,
                    FOUR_WEEKLY: 13 / 12,
                    MONTHLY: 1,
                  } as const;
                  // 🧠 Prefer worker/store salary if available
                  // ✅ Use inputs (already coerced to monthly & per-occurrence amount)
                  const userInputs = who === 'A' ? inputs?.a : inputs?.b;
                  const monthlyFromInputs = userInputs?.netMonthly;
                  const freqFromInputs = userInputs?.freq ? String(userInputs.freq).toUpperCase() : undefined;

                  // Fallback to the old local average if worker hasn’t populated yet
                  const monthly =
                    monthlyFromInputs ??
                    (avgOcc && pay?.frequency ? avgOcc * (factor[pay.frequency] ?? 1) : undefined);
                  const confirmed = who === 'A' ? state.wageConfirmedA : (state.wageConfirmedB ?? false);
                  const lastSeenFromStore = who === 'A' ? topSalary?.firstSeen : topSalaryB?.firstSeen;

                  return (
                    <div className="space-y-3">
                      <p className="text-sm font-medium">{label} · Detected Wages</p>
                      <div className="rounded-md border p-4 space-y-2">
                        <p className="text-sm">Is this your net salary and frequency?</p>
                        <div className="text-sm text-muted-foreground">
                          Detected: {freqFromInputs ?? (pay ? pay.frequency : 'Unknown')}
                          {' '}• Avg per month: {monthly ? formatCurrency(monthly) : '—'}
                          {lastSeenFromStore ? <> • Last seen: {lastSeenFromStore}</> : null}
                          {pay && (
                            <>
                              {' '}• Next pay: {(() => {
                                const dates = calculatePayDates(pay.frequency, pay.anchorDate, 3);
                                const today = new Date().toISOString().split('T')[0];
                                const next = dates.find(d => d >= today) ?? dates[dates.length - 1];
                                return next;
                              })()}
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={confirmed}
                            onCheckedChange={(v) =>
                              setState((prev) => ({
                                ...prev,
                                ...(who === 'A'
                                  ? { wageConfirmedA: !!v }
                                  : { wageConfirmedB: !!v }),
                              }))
                            }
                          />
                          <span className="text-sm">Yes, confirm</span>
                        </div>
                      </div>
                    </div>
                  );
                };

                return (
                  <div className="space-y-8">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      {state.linkedA &&
                        wageBlock('Person A', state.userA.paySchedule, a.wages, 'A')}
                      {state.mode === 'joint' && state.userB && state.linkedB && b &&
                        wageBlock('Person B', state.userB.paySchedule, b.wages, 'B')}
                    </div>

                    <div className="space-y-3">
                      <p className="text-sm font-medium">Bills to include in forecast</p>
                      <div className="rounded-md border overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-12">Include</TableHead>
                              <TableHead>Date</TableHead>
                              <TableHead>Owner</TableHead>
                              <TableHead>Name</TableHead>
                              <TableHead>Pattern</TableHead>
                              <TableHead className="text-right">Amount (€)</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {state.bills
                              // Only show bills produced by the worker
                              .filter(b => (b as any).source === 'detected' || String(b.id || '').startsWith('det-'))
                              .map((b) => (
                                <TableRow key={b.id}>
                                  <TableCell>
                                    <Checkbox
                                      checked={state.includedBillIds.includes(b.id!)}
                                      onCheckedChange={(v) => setState(prev => ({
                                        ...prev,
                                        includedBillIds: v ? Array.from(new Set([...prev.includedBillIds, b.id!])) : prev.includedBillIds.filter(id => id !== b.id)
                                      }))}
                                    />
                                  </TableCell>
                                  <TableCell className="text-sm">{b.dueDate}</TableCell>
                                  <TableCell className="text-sm">
                                    {(b as any).owner ?? (String(b.id).startsWith('det-b') ? 'B' : 'A')}
                                  </TableCell>
                                   <TableCell className="text-sm p-2">
                                     <Input
                                       value={b.name}
                                       onChange={(e) => {
                                         setState(prev => ({
                                           ...prev,
                                           bills: prev.bills.map(bill =>
                                             bill.id === b.id ? { ...bill, name: e.target.value } : bill
                                           )
                                         }));
                                       }}
                                       className="h-12 text-sm font-medium bg-card border-2 border-input focus:border-primary focus:ring-2 focus:ring-primary/20 rounded-md px-3 w-full min-w-[140px] max-w-[220px] shadow-sm"
                                     />
                                   </TableCell>
                                   <TableCell className="text-sm">
                                     {formatPattern(recurringMeta[b.id!])}
                                   </TableCell>
                                   <TableCell className="text-right p-2">
                                     <Input
                                       type="number"
                                       step="0.01"
                                       value={b.amount.toFixed(2)}
                                       onChange={(e) => {
                                         const newAmount = parseFloat(e.target.value) || 0;
                                         setState(prev => ({
                                           ...prev,
                                           bills: prev.bills.map(bill =>
                                             bill.id === b.id ? { ...bill, amount: newAmount } : bill
                                           )
                                         }));
                                       }}
                                       className="h-12 text-base text-right font-medium bg-card border-2 border-input focus:border-primary focus:ring-2 focus:ring-primary/20 rounded-md px-3 min-w-[100px] shadow-sm"
                                     />
                                   </TableCell>
                                </TableRow>
                              ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>

                    <Button className="w-full" onClick={() => setState(prev => ({ ...prev, step: 'energy' }))}>
                      Continue to Electricity
                    </Button>
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        )}

        {state.step === 'energy' && (
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="rounded-md border p-4">
              <p className="text-sm font-medium mb-2">Electricity prediction method</p>
              <div className="flex flex-wrap gap-4 text-sm">
                {([
                  { key: 'csv', label: 'Smart‑meter CSV + last bill' },
                  { key: 'bills6', label: '6 consecutive bills' },
                  { key: 'billsSome', label: 'Some recent bills' },
                ] as Array<{key: ElectricityMode; label: string}>).map(({ key, label }) => (
                  <label key={key} className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="elecMode"
                      checked={state.electricityMode === key}
                      onChange={() => setState(prev => ({ ...prev, electricityMode: key }))}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>
            <EsbCsvUpload onReadingsLoaded={handleEnergyReadings} isLoading={state.isLoading} />
            <LastBillUpload onTariffExtracted={handleTariffExtracted} isLoading={state.isLoading} />
          </div>
        )}

        {state.step === 'forecast' && (
          <Card className="max-w-4xl mx-auto">
            <CardHeader>
              <CardTitle>Ready to Forecast</CardTitle>
              <CardDescription>
                We've loaded your bank data and electricity usage. Review predicted electricity bills, then calculate optimal deposits.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <p className="text-sm font-medium">Bank Bills</p>
                  <Badge variant="secondary">
                    {state.bills.filter(
                      b => (b as any).source === 'detected' || String(b.id || '').startsWith('det-')
                    ).length} selected
                  </Badge>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium">Predicted Electricity Bills</p>
                  <Badge variant="secondary">
                    {state.bills.filter(b => b.source === 'predicted-electricity').length} over next year
                  </Badge>
                </div>
              </div>

              <Card className="mb-4">
                <CardContent>
                  <h4 className="text-sm font-medium">Weekly Spending Allowance</h4>
                  {state.mode === 'joint' ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <div>
                        <label className="text-sm">Person A Allowance (€ per week)</label>
                        <Input
                          type="number"
                          value={state.weeklyAllowanceA}
                          onChange={e => { setBindingMode(prev => ({ ...prev, A: 'allowance' })); setState(prev => ({ ...prev, weeklyAllowanceA: parseFloat(e.target.value) || 0 })); }}
                        />
                      </div>
                      <div>
                        <label className="text-sm">Person B Allowance (€ per week)</label>
                        <Input
                          type="number"
                          value={state.weeklyAllowanceB}
                          onChange={e => { setBindingMode(prev => ({ ...prev, B: 'allowance' })); setState(prev => ({ ...prev, weeklyAllowanceB: parseFloat(e.target.value) || 0 })); }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className="text-sm">Your Weekly Allowance (€ per week)</label>
                      <Input
                        type="number"
                        value={state.weeklyAllowanceA}
                        onChange={e => { setBindingMode(prev => ({ ...prev, A: 'allowance' })); setState(prev => ({ ...prev, weeklyAllowanceA: parseFloat(e.target.value) || 0 })); }}
                      />
                    </div>
                  )}
                  {/* Availability moved to Savings Pots section */}
                  <p className="text-xs text-muted-foreground mt-1">
                    (This amount will be kept in your personal account each pay period and not used for bills.)
                  </p>
                </CardContent>
              </Card>

              <Card className="mb-4">
                <CardContent>
                  <h4 className="text-sm font-medium mb-2">Savings Pots</h4>
                  {state.mode === 'joint' ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-2">
                      <div className="flex flex-wrap gap-2 items-end">
                        <Input placeholder="A Pot name" value={newPotNameA} onChange={e => setNewPotNameA(e.target.value)} />
                        <Input type="number" placeholder="Monthly amount" className="w-32" value={newPotAmountA} onChange={e => setNewPotAmountA(parseFloat(e.target.value) || 0)} />
                        <Button onClick={() => { handleAddPot(newPotNameA, newPotAmountA, 'A'); setNewPotNameA(''); setNewPotAmountA(0); }}>Add</Button>
                      </div>
                      <div className="flex flex-wrap gap-2 items-end">
                        <Input placeholder="B Pot name" value={newPotNameB} onChange={e => setNewPotNameB(e.target.value)} />
                        <Input type="number" placeholder="Monthly amount" className="w-32" value={newPotAmountB} onChange={e => setNewPotAmountB(parseFloat(e.target.value) || 0)} />
                        <Button onClick={() => { handleAddPot(newPotNameB, newPotAmountB, 'B'); setNewPotNameB(''); setNewPotAmountB(0); }}>Add</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2 items-end mb-2">
                      <Input placeholder="Pot name" value={newPotName} onChange={e => setNewPotName(e.target.value)} />
                      <Input type="number" placeholder="Monthly amount" className="w-32" value={newPotAmount} onChange={e => setNewPotAmount(parseFloat(e.target.value) || 0)} />
                      <Button onClick={() => { handleAddPot(newPotName, newPotAmount, 'A'); setNewPotName(''); setNewPotAmount(0); }}>Add</Button>
                    </div>
                  )}
                  {state.mode === 'joint' ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <div>
                        <p className="text-xs text-muted-foreground">Available for A savings this month: <strong>{formatCurrency(budgetPreview.availableA || 0)}</strong></p>
                        <ul className="mt-2 space-y-2">
                          {state.pots.filter(p => p.owner === 'A').map(p => (
                            <li key={p.id} className="flex items-center gap-2 text-sm">
                              <button aria-label="Remove" className="text-gray-500 hover:text-red-600" onClick={() => { setBindingMode(prev => ({ ...prev, A: 'pots' })); setState(prev => ({ ...prev, pots: prev.pots.filter(x => x.id !== p.id) })); }}>×</button>
                              <span className="min-w-24 truncate" title={p.name}>{p.name}</span>
                          <Input type="number" className="w-28" value={p.monthly}
                                onChange={e => { const amt = parseFloat(e.target.value) || 0; setState(prev => ({ ...prev, pots: prev.pots.map(x => x.id === p.id ? { ...x, monthly: amt } : x) })); }} />
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Available for B savings this month: <strong>{formatCurrency(budgetPreview.availableB || 0)}</strong></p>
                        <ul className="mt-2 space-y-2">
                          {state.pots.filter(p => p.owner === 'B').map(p => (
                            <li key={p.id} className="flex items-center gap-2 text-sm">
                              <button aria-label="Remove" className="text-gray-500 hover:text-red-600" onClick={() => { setBindingMode(prev => ({ ...prev, B: 'pots' })); setState(prev => ({ ...prev, pots: prev.pots.filter(x => x.id !== p.id) })); }}>×</button>
                              <span className="min-w-24 truncate" title={p.name}>{p.name}</span>
                          <Input type="number" className="w-28" value={p.monthly}
                                onChange={e => { const amt = parseFloat(e.target.value) || 0; setState(prev => ({ ...prev, pots: prev.pots.map(x => x.id === p.id ? { ...x, monthly: amt } : x) })); }} />
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ) : (
                    <>
                    <p className="text-xs text-muted-foreground">Available for savings this month: <strong>{formatCurrency(budgetPreview.availableA || 0)}</strong></p>
                    <ul className="mt-2 space-y-2">
                      {state.pots.filter(p => p.owner === 'A').map(p => (
                        <li key={p.id} className="flex items-center gap-2 text-sm">
                          <button aria-label="Remove" className="text-gray-500 hover:text-red-600" onClick={() => { setBindingMode(prev => ({ ...prev, A: 'pots' })); setState(prev => ({ ...prev, pots: prev.pots.filter(x => x.id !== p.id) })); }}>×</button>
                          <span className="min-w-24 truncate" title={p.name}>{p.name}</span>
                          <Input type="number" className="w-28" value={p.monthly}
                            onChange={e => { const amt = parseFloat(e.target.value) || 0; setBindingMode(prev => ({ ...prev, A: 'pots' })); setState(prev => ({ ...prev, pots: prev.pots.map(x => x.id === p.id ? { ...x, monthly: amt } : x) })); }} />
                        </li>
                      ))}
                    </ul>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Electricity Forecast Details */}
              {(() => {
                const elec = state.bills.filter(b => b.source === 'predicted-electricity').slice(0, 12);
                if (!elec.length) return null;
                const chartData = elec.map((b) => ({ date: b.dueDate.slice(5), amount: b.amount }));
                return (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="rounded-md border p-4">
                      <p className="text-sm font-medium mb-3">Next 12 Months — Bill Dates & Amounts</p>
                      <div className="max-h-64 overflow-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Due Date</TableHead>
                              <TableHead>Bill</TableHead>
                              <TableHead className="text-right">Amount</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {elec.map((b) => (
                              <TableRow key={b.id}>
                                <TableCell>{b.dueDate}</TableCell>
                                <TableCell className="truncate max-w-[220px]">{b.name}</TableCell>
                                <TableCell className="text-right">{formatCurrency(b.amount)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                    <div className="rounded-md border p-4">
                      <p className="text-sm font-medium mb-3">Bills per Period (Bar Chart)</p>
                      <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={chartData}>
                            <XAxis dataKey="date" tickLine={false} axisLine={false} />
                            <YAxis tickLine={false} axisLine={false} />
                            <Bar dataKey="amount" fill="hsl(var(--primary))" radius={[4,4,0,0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                );
              })()}

              <Button
                onClick={() => runForecast()}
                disabled={state.isLoading}
                className="w-full deposit-highlight"
              >
                {state.isLoading ? 'Calculating...' : 'Calculate Optimal Deposits'}
              </Button>
            </CardContent>
          </Card>
        )}

        {state.step === 'results' && state.forecastResult && (
          <div className="space-y-6">
            <Card className="deposit-highlight">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PiggyBank className="w-6 h-6" />
                  Optimized Deposit{state.mode === 'joint' ? 's' : ''}
                </CardTitle>
                <CardDescription>
                  These amounts are calculated using advanced optimization to minimize deposits while maintaining positive balance.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <p className="text-sm font-medium">
                      {state.mode === 'joint' ? 'Person A' : 'Your'} Deposit
                    </p>
                    <p className="text-3xl font-bold text-primary">
                      {formatCurrency(state.forecastResult.depositA)}
                    </p>
                    <p className="text-sm text-muted-foreground">per pay period</p>
                    <p className="text-xs text-muted-foreground">
                      ≈ {formatCurrency((state.forecastResult.depositA || 0) * cyclesPerMonth(state.userA.paySchedule?.frequency))} per month
                    </p>
                  </div>

                  {state.mode === 'joint' && typeof state.forecastResult.depositB === 'number' && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Person B Deposit</p>
                      <p className="text-3xl font-bold text-primary">
                        {formatCurrency(state.forecastResult.depositB)}
                      </p>
                      <p className="text-sm text-muted-foreground">per pay period</p>
                      <p className="text-xs text-muted-foreground">
                        ≈ {formatCurrency((state.forecastResult.depositB || 0) * cyclesPerMonth(state.userB?.paySchedule?.frequency))} per month
                      </p>
                    </div>
                  )}
                </div>

                {state.forecastResult.minBalance >= 0 ? (
                  <Alert className="mt-4 border-success">
                    <CheckCircle className="w-4 h-4 text-success" />
                    <AlertDescription>
                      With these optimized deposits, your minimum balance will be{' '}
                      <strong className="text-success">
                        {formatCurrency(state.forecastResult.minBalance)}
                      </strong>
                      {' '}— staying above zero throughout the forecast period.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Alert className="mt-4 border-destructive">
                    <AlertCircle className="w-4 h-4 text-destructive" />
                    <AlertDescription>
                      Even with these deposits, your minimum balance will be{' '}
                      <strong className="text-destructive">
                        {formatCurrency(state.forecastResult.minBalance)}
                      </strong>
                      , so the account would dip below zero.
                    </AlertDescription>
                  </Alert>
                )}

                  {/* Bill Movement Suggestions */}
                  <div className="mt-6">
                    <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                      <Lightbulb className="w-4 h-4" />
                      Optimization Suggestions
                    </h4>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs text-muted-foreground">
                        {storeResult?.billSuggestions?.length
                          ? `${storeResult.billSuggestions.length} suggestion${storeResult.billSuggestions.length === 1 ? '' : 's'} available`
                          : (dateMoves.length > 0 ? 'All suggested changes applied' : 'No suggestions found yet')}
                      </p>
                      {!!storeResult?.billSuggestions?.length && (
                        <Button size="sm" variant="outline" onClick={() => setShowBillWizard(true)}>
                          Review & Apply
                        </Button>
                      )}
                    </div>
                  </div>
              </CardContent>
            </Card>

            {/* Calendar of Forecasted Transactions */}
            {(() => {
              const eventsByDate = new Map<string, string[]>();
              state.forecastResult!.timeline.forEach((t) => {
                const key = t.date;
                if (!eventsByDate.has(key)) eventsByDate.set(key, []);
                if (t.event) eventsByDate.get(key)!.push(t.event);
              });

              // Prepare helpers for balances and rendering
              const timeline = [...state.forecastResult!.timeline].sort((a, b) => a.date.localeCompare(b.date));
              const getBalanceForDate = (d: Date) => {
                const iso = d.toISOString().slice(0, 10);
                let bal = timeline[0]?.balance ?? 0;
                for (const t of timeline) {
                  if (t.date <= iso) bal = t.balance; else break;
                }
                return bal;
              };

              const CustomDayContent = (props: any) => {
                const date: Date = props.date;
                const iso = date.toISOString().slice(0, 10);
                const hasEvents = eventsByDate.has(iso);
                const bal = getBalanceForDate(date);
                const isNeg = bal < 0;
                return (
                  <div className="flex flex-col items-center justify-center">
                    <span className="leading-none">{date.getDate()}</span>
                    <span className={`text-[10px] leading-none ${isNeg ? 'text-destructive' : 'text-muted-foreground'}`}>
                      {Math.round(bal)}
                    </span>
                    {hasEvents && <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />}
                  </div>
                );
              };

              const allEventDates = Array.from(eventsByDate.keys()).sort();
              const selectedDate = state.selectedDate ?? allEventDates[0] ?? null;
              const handleSelect = (d?: Date) => {
                const iso = d ? new Date(d).toISOString().slice(0,10) : null;
                setState(prev => ({ ...prev, selectedDate: iso }));
              };
              const selectedEvents = selectedDate ? (eventsByDate.get(selectedDate) || []) : [];
              const billsOnSelected = selectedDate ? state.bills.filter(b => b.dueDate === selectedDate) : [];

              return (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <CalendarIcon className="w-5 h-5" />
                      Forecast Calendar
                    </CardTitle>
                    <CardDescription>Select a date to see transactions due that day, add bills, or edit existing ones.</CardDescription>
                  </CardHeader>
                  <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="rounded-md border p-4">
                      <DayPicker
                        mode="single"
                        showOutsideDays
                        defaultMonth={selectedDate ? new Date(selectedDate) : (allEventDates[0] ? new Date(allEventDates[0]) : new Date())}
                        selected={selectedDate ? new Date(selectedDate) : undefined}
                        onSelect={handleSelect as any}
                        components={{ DayContent: CustomDayContent }}
                      />
                    </div>
                    <div className="rounded-md border p-4 space-y-4">
                      <div>
                        <p className="text-sm font-medium mb-2">Transactions on Selected Date</p>
                        {selectedDate ? (
                          selectedEvents.length ? (
                            <ul className="list-disc pl-5 space-y-2">
                              {selectedEvents.map((e, i) => (
                                <li key={i}>{e}</li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-sm text-muted-foreground">No transactions on {selectedDate}.</p>
                          )
                        ) : (
                          <p className="text-sm text-muted-foreground">Pick a date to view transactions.</p>
                        )}
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-sm font-medium">Bills on this date</p>
                          <Button size="sm" onClick={() => setBillDialogOpen(true)} disabled={!selectedDate}>Add Bill</Button>
                        </div>
                        {selectedDate && billsOnSelected.length > 0 ? (
                          <ul className="space-y-2">
                            {billsOnSelected.map((b) => (
                              <li key={b.id} className="flex items-center justify-between text-sm">
                                <span className="truncate mr-2">{b.name} — {formatCurrency(b.amount)}</span>
                                <Button size="sm" variant="outline" onClick={() => { setBillEditing(b); setBillDialogOpen(true); }}>Edit</Button>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-sm text-muted-foreground">No saved bills on this date.</p>
                        )}
                      </div>
                    </div>
                  </CardContent>

                  {/* Bill Editor Dialog */}
                  <BillEditorDialog
                    open={billDialogOpen}
                    onOpenChange={(o) => { setBillDialogOpen(o); if (!o) setBillEditing(null); }}
                    initialDate={selectedDate || undefined}
                    initialValues={billEditing ? { name: billEditing.name, amount: billEditing.amount, dueDate: billEditing.dueDate, frequency: 'one-off' as BillFrequency } : undefined}
                    onSubmit={handleBillSubmit}
                  />
                </Card>
              );
            })()}

            <Button
              variant="outline"
              onClick={() => setState(prev => ({ ...prev, step: 'setup', forecastResult: null }))}
            >
              Start New Forecast
            </Button>
          </div>
        )}
      </div>

      {/* Review & Apply: Bill Date Suggestions */}
      {state.step === 'results' && showBillWizard && (
        <BillDateWizard
          open={showBillWizard}
          suggestions={(storeResult?.billSuggestions || []).map(s => ({
            billId: s.billId,
            name: s.name || state.bills.find(b => b.id === s.billId)?.name,
            currentDate: s.currentDate,
            suggestedDate: s.suggestedDate
          }))}
          currentMonthlyA={(state.forecastResult?.depositA || 0) * cyclesPerMonth(state.userA.paySchedule?.frequency)}
          currentMonthlyB={typeof state.forecastResult?.depositB === 'number' ? (state.forecastResult?.depositB || 0) * cyclesPerMonth(state.userB?.paySchedule?.frequency) : undefined}
          onPreview={async (ids) => {
            try {
              // Rebuild the same merged bill set we use for results, then apply selection
              const currentState = state;
              if (!currentState.userA?.paySchedule) return undefined;

              const elecPredicted = (currentState.bills ?? [])
                .filter(b => b.source === 'predicted-electricity')
                .map(b => ({ ...b, source: 'predicted-electricity' as const }));
              const manual = (currentState.bills ?? [])
                .filter(b => b.source === 'manual')
                .map(b => ({ ...b, source: b.source ?? 'manual' as const }));

              const firstPayDate = currentState.userB?.paySchedule
                ? (currentState.userA.paySchedule!.anchorDate < currentState.userB.paySchedule.anchorDate
                    ? currentState.userA.paySchedule!.anchorDate
                    : currentState.userB.paySchedule.anchorDate)
                : currentState.userA.paySchedule!.anchorDate;

              const provisionalBills = [...manual, ...elecPredicted];
              const allBillsProvisional = rollForwardPastBills(provisionalBills, firstPayDate);

              const startDateA = getStartDate(currentState.userA.paySchedule!, allBillsProvisional);
              const payScheduleA: PaySchedule = { ...currentState.userA.paySchedule!, anchorDate: startDateA };

              let startDateB = '';
              if (currentState.mode === 'joint' && currentState.userB?.paySchedule) {
                startDateB = getStartDate(currentState.userB.paySchedule!, allBillsProvisional);
              }
              const startDate = startDateB && startDateA > startDateB ? startDateB : startDateA;

              const months = 12;
              const importedA = expandRecurring(detected?.recurring ?? [], startDate, months, 'imp-a-');
              const importedB = expandRecurring((detected?.recurringB ?? (detected as any)?.allRecurring ?? []), startDate, months, 'imp-b-');
              let previewBills = [...manual, ...importedA, ...importedB, ...elecPredicted];

              // Apply the selection by id mapping
              const idToNewDate = new Map<string, string>();
              (storeResult.billSuggestions || []).forEach(s => { if (ids.includes(s.billId)) idToNewDate.set(s.billId, s.suggestedDate); });
              previewBills = previewBills.map(b => (b.id && idToNewDate.has(b.id)) ? { ...b, dueDate: idToNewDate.get(b.id)! } : b);

              if (currentState.mode === 'single') {
                // Align preview bill set to the same "rolled-forward" shape used in results
                const rb = rollForwardPastBills(
                  previewBills.map(b => ({
                    id: b.id || '',
                    name: b.name,
                    amount: b.amount,
                    issueDate: b.issueDate || (b as any).dueDateISO || b.dueDate || startDate,
                    dueDate: b.dueDate || (b as any).dueDateISO || startDate,
                    source: (b.source === 'electricity' ? 'predicted-electricity' : b.source) as "manual" | "predicted-electricity" | "imported",
                    movable: b.movable
                  })),
                  startDate
                ).filter(b => !b.dueDate || b.dueDate >= startDate);
                const depA = findDepositSingle(startDate, payScheduleA, rb, 0);
                return { a: depA * cyclesPerMonth(payScheduleA.frequency) } as any;
              } else if (currentState.userB?.paySchedule) {
                // Mirror fairness computation from results
                const toMonthlySchedule = (ps: PaySchedule | undefined) => {
                  if (!ps) return 0;
                  switch (ps.frequency) {
                    case 'WEEKLY': return (ps.averageAmount ?? 0) * 52 / 12;
                    case 'BIWEEKLY':
                    case 'FORTNIGHTLY': return (ps.averageAmount ?? 0) * 26 / 12;
                    case 'FOUR_WEEKLY': return (ps.averageAmount ?? 0) * 13 / 12;
                    case 'MONTHLY':
                    default: return (ps.averageAmount ?? 0);
                  }
                };
                const payScheduleB: PaySchedule = { ...currentState.userB.paySchedule!, anchorDate: startDateB || currentState.userB.paySchedule!.anchorDate };
                const monthlyA = toMonthlySchedule(payScheduleA);
                const monthlyB = toMonthlySchedule(payScheduleB);
                const allowanceMonthlyA = (currentState.weeklyAllowanceA ?? 0) * 52 / 12;
                const allowanceMonthlyB = (currentState.weeklyAllowanceB ?? 0) * 52 / 12;
                const sumA = (currentState.pots ?? []).filter(p => p.owner === 'A').reduce((s,p)=>s+p.monthly,0);
                const sumB = (currentState.pots ?? []).filter(p => p.owner === 'B').reduce((s,p)=>s+p.monthly,0);
                const sumJ = (currentState.pots ?? []).filter(p => p.owner === 'JOINT').reduce((s,p)=>s+p.monthly,0);
                const prelimRatioA = (monthlyA + monthlyB) > 0 ? monthlyA / (monthlyA + monthlyB) : 0.5;
                const jointShareA = sumJ * prelimRatioA;
                const jointShareB = sumJ * (1 - prelimRatioA);
                const effA = monthlyA - allowanceMonthlyA - sumA - jointShareA;
                const effB = monthlyB - allowanceMonthlyB - sumB - jointShareB;
                const fairness = (effA + effB) > 0 ? effA / (effA + effB) : 0.5;
                const { depositA, depositB } = findDepositJoint(startDate, payScheduleA, payScheduleB, previewBills, fairness, 0);
                return { a: depositA * cyclesPerMonth(payScheduleA.frequency), b: depositB * cyclesPerMonth(payScheduleB.frequency) } as any;
              }
            } catch {}
            return undefined;
          }}
          onApply={(selected) => {
            const moves = selected.map(s => ({
              id: s.billId,
              name: s.name || s.billId,
              fromISO: s.currentDate,
              toISO: s.suggestedDate
            }));
            if (moves.length === 0) { setShowBillWizard(false); return; }
            setDateMoves(prev => [...prev, ...moves]);
            setShowBillWizard(false);
            // Ensure moves are applied in the very next recompute using the fresh list
            runForecast({ ...state }, moves);
          }}
          onClose={() => setShowBillWizard(false)}
        />
      )}
    </div>
  );
};

export default Index;
