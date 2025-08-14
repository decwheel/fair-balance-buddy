import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
import { formatCurrency, calculatePayDates } from '@/utils/dateUtils';
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
import { useToast } from '@/components/ui/use-toast';

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
  electricityMode: 'csv'
});

  const [billDialogOpen, setBillDialogOpen] = useState(false);
  const [billEditing, setBillEditing] = useState<Bill | null>(null);
  const { toast } = useToast();


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

      // Convert bill transactions to Bill objects (top recurring per person)
      function topRecurring(trans: Transaction[], take: number): Transaction[] {
        const bills = categorizeBankTransactions(trans).bills;
        const groups = new Map<string, { count: number; tx: Transaction }>();
        bills.forEach(tx => {
          const key = (tx.description || '').toUpperCase().replace(/\s+/g, ' ').trim();
          const g = groups.get(key);
          if (!g) groups.set(key, { count: 1, tx }); else g.count++;
          // keep the latest transaction as representative
          if (g && new Date(tx.date) > new Date(g.tx.date)) groups.set(key, { count: (g?.count||1), tx });
        });
        return Array.from(groups.values())
          .sort((a,b) => b.count - a.count)
          .slice(0, take)
          .map(g => g.tx);
      }

      const aTop = topRecurring(transactionsA, mode === 'joint' ? 6 : 6);
      const bTop = mode === 'joint' && userB ? topRecurring(userB.transactions, 11) : [];
      const billTxs = mode === 'joint' 
        ? [...aTop, ...bTop]
        : aTop;

      const bills: Bill[] = billTxs.map((tx, idx) => ({
        id: tx.id || `${mode}-${idx}`,
        name: tx.description,
        amount: Math.abs(tx.amount),
        issueDate: tx.date,
        dueDate: tx.date, // Simplified for MVP
        source: 'imported' as const,
        movable: false
      }));

setState(prev => ({
  ...prev,
  mode,
  userA: { transactions: transactionsA, paySchedule: payScheduleA },
  userB,
  bills,
  includedBillIds: bills.map(b => b.id!).filter(Boolean),
  isLoading: false,
  step: 'bank'
}));
    } catch (error) {
      console.error('Failed to load bank data:', error);
      setState(prev => ({ ...prev, isLoading: false }));
    }
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

      const addDays = (iso: string, days: number) => {
        const d = new Date(iso);
        d.setDate(d.getDate() + days);
        return d.toISOString().split('T')[0];
      };

      const anchorDue = tariff.nextDueDate;

      const electricityBills: Bill[] = predicted.map((bill, index) => {
        const dueDate = anchorDue ? addDays(anchorDue, index * periodDays) : bill.period.end;
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
  };

  const runForecast = () => {
    if (!state.userA.paySchedule) return;

    setState(prev => ({ ...prev, isLoading: true }));

    try {
      const today = new Date().toISOString().split('T')[0];
      const selectedBills = state.bills.filter(b => state.includedBillIds.includes(b.id!));
      const allBills = rollForwardPastBills(selectedBills);

      if (state.mode === 'single') {
        const baselineDeposit = 150; // Better initial guess
        const optimalDeposit = findDepositSingle(
          today,
          state.userA.paySchedule!,
          allBills,
          baselineDeposit
        );

        const result = runSingle(
          optimalDeposit,
          today,
          state.userA.paySchedule!,
          allBills,
          { months: 12, buffer: 0 }
        );

        setState(prev => ({
          ...prev,
          forecastResult: {
            depositA: optimalDeposit,
            minBalance: result.minBalance,
            timeline: result.timeline
          },
          isLoading: false,
          step: 'results'
        }));
      } else if (state.userB?.paySchedule) {
        const baselineDeposit = 800; // Joint initial guess
        const fairnessRatio = 0.55; // 55% for user A
        
        const { depositA, depositB } = findDepositJoint(
          today,
          state.userA.paySchedule!,
          state.userB.paySchedule!,
          allBills,
          fairnessRatio,
          baselineDeposit
        );

        const result = runJoint(
          depositA,
          depositB,
          today,
          state.userA.paySchedule!,
          state.userB.paySchedule!,
          allBills,
          { months: 12, fairnessRatioA: fairnessRatio }
        );

        setState(prev => ({
          ...prev,
          forecastResult: {
            depositA,
            depositB,
            minBalance: result.minBalance,
            timeline: result.timeline
          },
          isLoading: false,
          step: 'results'
        }));
      }
    } catch (error) {
      console.error('Forecast failed:', error);
      setState(prev => ({ ...prev, isLoading: false }));
    }
  };

  // Add/Edit bill handler
  const handleBillSubmit = async (values: { name: string; amount: number; dueDate: string; frequency: BillFrequency }) => {
    const seriesId = (globalThis.crypto && 'randomUUID' in globalThis.crypto) ? (globalThis.crypto as any).randomUUID() : `series_${Date.now()}`;

    if (billEditing) {
      // Simple edit of a single occurrence
      setState(prev => ({
        ...prev,
        bills: prev.bills.map(b => b.id === billEditing.id ? { ...b, name: values.name, amount: values.amount, dueDate: values.dueDate } : b)
      }));
      setBillEditing(null);
      toast({ description: 'Bill updated. Recalculating forecast…' });
      runForecast();
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

    // Update local state
    setState(prev => ({
      ...prev,
      bills: [...prev.bills, ...newBills],
      includedBillIds: Array.from(new Set([...prev.includedBillIds, ...newBills.map(b => b.id!)]))
    }));

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

    const allBills = [...state.bills, ...newBills].filter(b => state.includedBillIds.includes(b.id!) || newBills.some(nb => nb.id === b.id));
    if (state.mode === 'single') {
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
    runForecast();
  };

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
                  {state.userA.paySchedule && (
                    <p className="text-sm text-muted-foreground">
                      Next pay date: {(() => {
                        const dates = calculatePayDates(state.userA.paySchedule!.frequency, state.userA.paySchedule!.anchorDate, 3);
                        const today = new Date().toISOString().split('T')[0];
                        const next = dates.find(d => d >= today) ?? dates[dates.length - 1];
                        return next;
                      })()}
                    </p>
                  )}
                  <Badge variant="secondary">{state.userA.transactions.length} transactions</Badge>
                </div>
                {state.mode === 'joint' && state.userB && (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Person B</p>
                    {state.userB.paySchedule && (
                      <p className="text-sm text-muted-foreground">
                        Next pay date: {(() => {
                          const dates = calculatePayDates(state.userB!.paySchedule!.frequency, state.userB!.paySchedule!.anchorDate, 3);
                          const today = new Date().toISOString().split('T')[0];
                          const next = dates.find(d => d >= today) ?? dates[dates.length - 1];
                          return next;
                        })()}
                      </p>
                    )}
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
                  const monthly = avgOcc && pay?.frequency ? avgOcc * (factor[pay.frequency] ?? 1) : undefined;
                  const confirmed = who === 'A' ? state.wageConfirmedA : (state.wageConfirmedB ?? false);

                  return (
                    <div className="space-y-3">
                      <p className="text-sm font-medium">{label} · Detected Wages</p>
                      <div className="rounded-md border p-4 space-y-2">
                        <p className="text-sm">Is this your net salary and frequency?</p>
                        <div className="text-sm text-muted-foreground">
                          Detected: {pay ? pay.frequency : 'Unknown'} • Avg per month: {monthly ? formatCurrency(monthly) : '—'}
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
                              <TableHead className="text-right">Amount (€)</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {state.bills
                              .filter(b => b.source === 'imported')
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
                                  <TableCell className="text-sm">{b.name}</TableCell>
                                  <TableCell className="text-right font-medium">€{b.amount.toFixed(2)}</TableCell>
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
                    {state.bills.filter(b => b.source === 'imported').length} selected
                  </Badge>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium">Predicted Electricity Bills</p>
                  <Badge variant="secondary">
                    {state.bills.filter(b => b.source === 'predicted-electricity').length} over next year
                  </Badge>
                </div>
              </div>

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
                onClick={runForecast} 
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
                  Optimal Deposit{state.mode === 'joint' ? 's' : ''}
                </CardTitle>
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
                  
                  {state.mode === 'joint' && state.forecastResult.depositB && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Person B Deposit</p>
                      <p className="text-3xl font-bold text-primary">
                        {formatCurrency(state.forecastResult.depositB)}
                      </p>
                      <p className="text-sm text-muted-foreground">per pay period</p>
                    </div>
                  )}
                </div>
                
                <Alert className="mt-4 border-success">
                  <CheckCircle className="w-4 h-4 text-success" />
                  <AlertDescription>
                    With these deposits, your minimum balance will be{' '}
                    <strong className="text-success">
                      {formatCurrency(state.forecastResult.minBalance)}
                    </strong>
                    {' '}— staying above zero throughout the forecast period.
                  </AlertDescription>
                </Alert>
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
