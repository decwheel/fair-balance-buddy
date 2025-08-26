import { useState, useEffect } from 'react';
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
import { generateOccurrences } from '@/utils/recurrence';
import { persistBills } from '@/services/supabaseBills';
import { rollForwardPastBills } from '@/utils/billUtils';
import type { RecurringItem, SalaryCandidate, SavingsPot, SimResult, PlanInputs } from '@/types';
import { useToast } from '@/components/ui/use-toast';
import { expandRecurring } from '../lib/expandRecurring';

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
  bills: [],
  wageConfirmedA: false,
  includedBillIds: [],
  electricityReadings: [],
  tariffRates: null,
  forecastResult: null,
  isLoading: false,
  step: 'setup',
  selectedDate: null,
  electricityMode: 'csv',
  pots: [],
  weeklyAllowanceA: 100,
  weeklyAllowanceB: 100
});

  const [billDialogOpen, setBillDialogOpen] = useState(false);
  const [billEditing, setBillEditing] = useState<Bill | null>(null);
  const { toast } = useToast();
  const [recurringMeta, setRecurringMeta] = useState<RecurringMeta>({});
  const [newPotName, setNewPotName] = useState('');
  const [newPotAmount, setNewPotAmount] = useState<number>(0);
  const [newPotOwner, setNewPotOwner] = useState<'A' | 'B' | 'JOINT'>('A');

  // 🔌 NEW: read worker detections (salary + recurring) from the store
  const { detected, inputs, result: storeResult } = usePlanStore();
  const topSalary: SalaryCandidate | undefined = detected?.salaries?.[0];
  const topSalaryB: SalaryCandidate | undefined = (detected as any)?.salariesB?.[0];
  const recurringFromStore: RecurringItem[] = detected?.recurring ?? [];
  const recurringFromStoreB: RecurringItem[] = (detected as any)?.recurringB ?? [];


  // Load mock bank data
  const loadBankData = async (mode: 'single' | 'joint') => {
           setState(prev => ({ ...prev, isLoading: true }));
    
    try {
      const transactionsA = await loadMockTransactionsA();
      const categorizedA = categorizeBankTransactions(transactionsA);
      const payScheduleA = extractPayScheduleFromWages(categorizedA.wages);

      let userB = undefined;
      if (mode === 'joint') {
        const transactionsB = await loadMockTransactionsB();
        const categorizedB = categorizeBankTransactions(transactionsB);
        const payScheduleB = extractPayScheduleFromWages(categorizedB.wages);
        userB = { transactions: transactionsB, paySchedule: payScheduleB };
      }

      // ❌ Don’t seed UI bills from mock categorisation.
      // We want the worker’s detections to be the source of truth shown in the table.

        setState(prev => ({
  ...prev,
  mode,
  userA: { transactions: transactionsA, paySchedule: payScheduleA },
  userB,
  // ⚠️ Keep whatever the worker may have already populated
  bills: prev.bills,
  includedBillIds: prev.includedBillIds,
  isLoading: false,
  step: 'bank'
}));

      // 🔌 NEW: Trigger worker detection system
      const switchToJointMode = (window as any).__switchToJointMode;
      const runDetection = (window as any).__runDetection;
      
      if (mode === 'joint' && switchToJointMode) {
        console.log('[loadBankData] Triggering joint mode detection...');
        await switchToJointMode();
      } else if (mode === 'single' && runDetection) {
        console.log('[loadBankData] Triggering single mode detection...');
        const { mapBoiToTransactions } = await import('../lib/txMap');
        const mockA = await import('../fixtures/mock-a-boi-transactions.json');
        const txA = mapBoiToTransactions(mockA as any);
        await runDetection(txA);
      }
    } catch (error) {
      console.error('Failed to load bank data:', error);
      setState(prev => ({ ...prev, isLoading: false }));
    }
  };

  // 🔁 NEW: whenever worker/store detections change, hydrate the page state from them
  useEffect(() => {
    if (!detected || (!recurringFromStore.length && !recurringFromStoreB.length)) return;
    
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
    
    // Process User A's bills
    const importedFromDetectedA: Bill[] = recurringFromStore.map((r, i) => {
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
      };
    });

    // Process User B's bills (for joint mode)
    const importedFromDetectedB: Bill[] = recurringFromStoreB.map((r, i) => {
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
        name: `[B] ${r.description}`, // Prefix with [B] to distinguish
        amount: r.amount,
        issueDate: lastDate,
        dueDate: lastDate,
        source: 'detected' as any,
        movable: false,
      };
    });

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
    }, [detected, state.userA.transactions.length]);  

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
    setState(prev => {
      const predicted = prev.electricityReadings.length
        ? predictBills({
            mode: prev.electricityMode,
            readings: prev.electricityReadings,
            tariff,
            months: 12
          })
        : [];

      const periodDays = tariff.billingPeriodDays ?? (prev.electricityMode === 'bills6' ? 61 : 60);

      const anchorDue = tariff.nextDueDate;

      const electricityBills: Bill[] = predicted.map((bill, index) => {
        const dueDate = anchorDue ? addDaysISO(anchorDue, index * periodDays) : bill.period.end;
        return ({
          id: `elec_${index}`,
          name: `${tariff.supplier} ${tariff.plan} — Bill ${index + 1}`,
          amount: bill.totalInclVat,
          issueDate: bill.period.start,
          dueDate,
          source: 'predicted-electricity' as const,
          movable: true
        });
      });

      return {
        ...prev,
        tariffRates: tariff,
        bills: electricityBills.length ? [...prev.bills, ...electricityBills] : prev.bills,
        includedBillIds: electricityBills.length ? Array.from(new Set([
          ...prev.includedBillIds,
          ...electricityBills.map(b => b.id!)
        ])) : prev.includedBillIds,
        step: electricityBills.length ? 'forecast' : prev.step
      };
    });

    usePlanStore.getState().setInputs({ elecPredicted: electricityBills });
    const api = (window as any).__workerAPI;
    if (api) {
      const currentInputs = { ...usePlanStore.getState().inputs, elecPredicted: electricityBills } as PlanInputs;
      api.simulate(currentInputs).then(res => {
        usePlanStore.getState().setResult(res);
      }).catch(err => console.error('[forecast] worker sim failed:', err));
    }
  };

  // Determine the forecast start date: the most recent pay date before the earliest bill
  const getStartDate = (paySchedule: PaySchedule, bills: Bill[]): string => {
    const earliestDue = bills.reduce((min, b) => (b.dueDate < min ? b.dueDate : min), '9999-12-31');
    const pays = calculatePayDates(paySchedule.frequency, paySchedule.anchorDate, 18);
    const before = pays.filter(p => p <= earliestDue);
    return before.length ? before[before.length - 1] : pays[0];
  };

  const runForecast = (currentState: AppState = state) => {
    if (!currentState.userA.paySchedule) return;

    // Work with the most up-to-date state (e.g. newly added bills)
    setState({ ...currentState, isLoading: true });

    try {
      const elecPredicted = (currentState.bills ?? [])
        .filter(b => b.source === 'predicted-electricity')
        .map(b => ({ ...b, account: 'JOINT' as const, source: 'electricity' as const }));
      const manual = (currentState.bills ?? [])
        .filter(b => b.source === 'manual')
        .map(b => ({ ...b, account: b.account ?? 'JOINT', source: b.source ?? 'manual' }));

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
      const mergedBills = [...manual, ...importedA, ...importedB, ...elecPredicted];
      console.log(
        '[forecast] bills: manual=%d, importedA=%d, importedB=%d, elec=%d, total=%d',
        manual.length,
        importedA.length,
        importedB.length,
        elecPredicted.length,
        mergedBills.length
      );

      const api = (window as any).__workerAPI;
      if (api) {
        const planForWorker: PlanInputs = {
          ...usePlanStore.getState().inputs,
          bills: mergedBills,
          elecPredicted: elecPredicted,
          weeklyAllowanceA: currentState.weeklyAllowanceA ?? 0,
          weeklyAllowanceB: currentState.weeklyAllowanceB ?? 0,
          startISO: startDate,
          mode: 'joint',
        } as any;
        api
          .simulate(planForWorker)
          .then(res => usePlanStore.getState().setResult(res))
          .catch(() => {});
      }

      // Use the same start the solver will use
      const allBills = rollForwardPastBills(mergedBills, startDate)
        .filter(b => !b.dueDate || b.dueDate >= startDate);

      if (currentState.mode === 'single') {
          // Use optimized deposits from worker result if available, otherwise use old forecast
          const workerResult = storeResult;
        const useWorkerOptimization = workerResult && workerResult.requiredDepositA;

        let depositA: number;
        let resultObj: { minBalance: number; timeline: any };
        if (useWorkerOptimization) {
          depositA = workerResult.requiredDepositA;
          resultObj = runSingle(
            depositA,
            startDateA,
            payScheduleA,
            allBills,
            { months: 12, buffer: 0 }
          );
        } else {
          const baselineDeposit = 150;
          depositA = findDepositSingle(
            startDateA,
            payScheduleA,
            allBills,
            baselineDeposit
          );
          resultObj = runSingle(
            depositA,
            startDateA,
            payScheduleA,
            allBills,
            { months: 12, buffer: 0 }
          );
        }

        if (!useWorkerOptimization) {
          setTimeout(() => {
            try {
              const s = generateBillSuggestions(
                inputs as PlanInputs,
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
          }, 0);
        } else {
          usePlanStore.getState().setResult({
            ...usePlanStore.getState().result,
            billSuggestions: workerResult.billSuggestions ?? []
          });
        }

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
          simResult = runJoint(
            depositA,
            depositB,
            startDate,
            payScheduleA,
            payScheduleB,
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

        if (!useWorkerOptimization) {
          setTimeout(() => {
            try {
              const s = generateBillSuggestions(
                inputs as PlanInputs,
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
        {state.step === 'setup' && (
          <Card className="max-w-2xl mx-auto">
            <CardHeader>
              <CardTitle>Choose Your Mode</CardTitle>
              <CardDescription>
                Select whether you're forecasting for yourself or a joint account
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
                  <span className="font-medium">Single Account</span>
                  <span className="text-xs text-muted-foreground">Individual forecasting</span>
                </Button>
                
                <Button
                  variant="outline"
                  className="h-24 flex flex-col space-y-2"
                  onClick={() => loadBankData('joint')}
                  disabled={state.isLoading}
                >
                  <Users className="w-6 h-6" />
                  <span className="font-medium">Joint Account</span>
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

        {state.step === 'bank' && (
          <Card className="max-w-4xl mx-auto">
            <CardHeader>
              <CardTitle>Review Bank Data</CardTitle>
              <CardDescription>Confirm detected pay schedules, wages, and bills for each person.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-8">
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
                      {wageBlock('Person A', state.userA.paySchedule, a.wages, 'A')}
                      {state.mode === 'joint' && state.userB && b && wageBlock('Person B', state.userB.paySchedule, b.wages, 'B')}
                    </div>

                    <div className="space-y-3">
                      <p className="text-sm font-medium">Bills to include in forecast</p>
                      <div className="rounded-md border overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-12">Include</TableHead>
                              <TableHead>Date</TableHead>
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
                    <div className="flex gap-4">
                      <div>
                        <label className="text-sm">Person A Allowance (€ per week)</label>
                        <Input
                          type="number"
                          value={state.weeklyAllowanceA}
                          onChange={e => setState(prev => ({ ...prev, weeklyAllowanceA: parseFloat(e.target.value) || 0 }))}
                        />
                      </div>
                      <div>
                        <label className="text-sm">Person B Allowance (€ per week)</label>
                        <Input
                          type="number"
                          value={state.weeklyAllowanceB}
                          onChange={e => setState(prev => ({ ...prev, weeklyAllowanceB: parseFloat(e.target.value) || 0 }))}
                        />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className="text-sm">Your Weekly Allowance</label>
                      <Input
                        type="number"
                        value={state.weeklyAllowanceA}
                        onChange={e => setState(prev => ({ ...prev, weeklyAllowanceA: parseFloat(e.target.value) || 0 }))}
                      />
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    (This amount will be kept in your personal account each pay period and not used for bills.)
                  </p>
                </CardContent>
              </Card>

              <Card className="mb-4">
                <CardContent>
                  <h4 className="text-sm font-medium mb-2">Savings Pots</h4>
                  <div className="flex flex-wrap gap-2 items-end mb-2">
                    <Input
                      placeholder="Pot name"
                      value={newPotName}
                      onChange={e => setNewPotName(e.target.value)}
                    />
                    <Input
                      type="number"
                      placeholder="Monthly amount"
                      className="w-32"
                      value={newPotAmount}
                      onChange={e => setNewPotAmount(parseFloat(e.target.value) || 0)}
                    />
                    {state.mode === 'joint' && (
                      <select
                        className="border rounded px-2 py-1"
                        value={newPotOwner}
                        onChange={e => setNewPotOwner(e.target.value as 'A' | 'B' | 'JOINT')}
                      >
                        <option value="A">A</option>
                        <option value="B">B</option>
                        <option value="JOINT">Joint</option>
                      </select>
                    )}
                    <Button
                      onClick={() => {
                        handleAddPot(newPotName, newPotAmount, state.mode === 'joint' ? newPotOwner : 'A');
                        setNewPotName('');
                        setNewPotAmount(0);
                      }}
                    >
                      Add
                    </Button>
                  </div>
                  {state.pots.length > 0 && (
                    <ul className="mt-2 list-disc pl-5 space-y-1">
                      {state.pots.map(p => (
                        <li key={p.id} className="text-sm">
                          {p.name}: {formatCurrency(p.monthly)} ({p.owner})
                        </li>
                      ))}
                    </ul>
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
                  </div>
                  
                  {state.mode === 'joint' && typeof state.forecastResult.depositB === 'number' && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Person B Deposit</p>
                      <p className="text-3xl font-bold text-primary">
                        {formatCurrency(state.forecastResult.depositB)}
                      </p>
                      <p className="text-sm text-muted-foreground">per pay period</p>
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
                  {storeResult?.billSuggestions && storeResult.billSuggestions.length > 0 && (
                    <div className="mt-6">
                      <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                        <Lightbulb className="w-4 h-4" />
                        Optimization Suggestions
                      </h4>
                      <div className="space-y-2">
                        {storeResult.billSuggestions.map((suggestion, index) => (
                          <Alert key={index} className="border-blue-200">
                            <AlertCircle className="w-4 h-4 text-blue-500" />
                            <AlertDescription>
                              <strong>Bill Movement:</strong> {suggestion.reason}
                              <br />
                            <span className="text-sm text-muted-foreground">
                              Move from {suggestion.currentDate} to {suggestion.suggestedDate}
                            </span>
                          </AlertDescription>
                        </Alert>
                      ))}
                    </div>
                  </div>
                )}
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
    </div>
  );
};

export default Index;
