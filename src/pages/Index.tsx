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
import { generatePredictedBills } from '@/services/tariffEngine';
import { Calendar as DayPicker } from '@/components/ui/calendar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer } from 'recharts';

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
  bills: Bill[];
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
}

const Index = () => {
  const [state, setState] = useState<AppState>({
    mode: 'single',
    userA: { transactions: [], paySchedule: null },
    bills: [],
    electricityReadings: [],
    tariffRates: null,
    forecastResult: null,
    isLoading: false,
    step: 'setup'
  });

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

      // Convert bill transactions to Bill objects
      const billTxs = mode === 'joint' 
        ? [...categorizedA.bills, ...(userB ? categorizeBankTransactions(userB.transactions).bills : [])]
        : categorizedA.bills;

      const bills: Bill[] = billTxs.map(tx => ({
        id: tx.id,
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
        ? generatePredictedBills({
            readings: prev.electricityReadings,
            tariff,
            periodsCount: 12,
            periodLengthDays: tariff.billingPeriodDays ?? 60
          })
        : [];

      const electricityBills: Bill[] = predicted.map((bill, index) => ({
        id: `elec_${index}`,
        name: `${tariff.supplier} ${tariff.plan} — Bill ${index + 1}`,
        amount: bill.totalInclVat,
        issueDate: bill.period.start,
        dueDate: bill.period.end,
        source: 'predicted-electricity' as const,
        movable: true
      }));

      return {
        ...prev,
        tariffRates: tariff,
        bills: electricityBills.length ? [...prev.bills, ...electricityBills] : prev.bills,
        step: electricityBills.length ? 'forecast' : prev.step
      };
    });
  };

  const runForecast = () => {
    if (!state.userA.paySchedule) return;

    setState(prev => ({ ...prev, isLoading: true }));

    try {
      const today = new Date().toISOString().split('T')[0];
      const allBills = state.bills;

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
              <div key={key} className="flex flex-col items-center space-y-2">
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
                  <p className="text-lg font-semibold">
                    {state.userA.paySchedule
                      ? `${state.userA.paySchedule.frequency} · Anchor ${state.userA.paySchedule.anchorDate}`
                      : 'Pay schedule not detected'}
                  </p>
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
                    <p className="text-lg font-semibold">
                      {state.userB.paySchedule
                        ? `${state.userB.paySchedule.frequency} · Anchor ${state.userB.paySchedule.anchorDate}`
                        : 'Pay schedule not detected'}
                    </p>
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

              {/* Wages & Bills Tables */}
              {(() => {
                const a = categorizeBankTransactions(state.userA.transactions);
                const b = state.mode === 'joint' && state.userB ? categorizeBankTransactions(state.userB.transactions) : null;
                const preview = (items: Transaction[]) => items.slice(0, 6);
                return (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-3">
                      <p className="text-sm font-medium">Person A · Wages</p>
                      <div className="rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Date</TableHead>
                              <TableHead>Description</TableHead>
                              <TableHead className="text-right">Amount</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {preview(a.wages).map((tx) => (
                              <TableRow key={tx.id}>
                                <TableCell>{tx.date}</TableCell>
                                <TableCell className="truncate max-w-[200px]">{tx.description}</TableCell>
                                <TableCell className="text-right">{formatCurrency(tx.amount)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>

                      <p className="text-sm font-medium">Person A · Bills</p>
                      <div className="rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Date</TableHead>
                              <TableHead>Description</TableHead>
                              <TableHead className="text-right">Amount</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {preview(a.bills).map((tx) => (
                              <TableRow key={tx.id}>
                                <TableCell>{tx.date}</TableCell>
                                <TableCell className="truncate max-w-[200px]">{tx.description}</TableCell>
                                <TableCell className="text-right">{formatCurrency(Math.abs(tx.amount))}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>

                    {state.mode === 'joint' && b && (
                      <div className="space-y-3">
                        <p className="text-sm font-medium">Person B · Wages</p>
                        <div className="rounded-md border">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Date</TableHead>
                                <TableHead>Description</TableHead>
                                <TableHead className="text-right">Amount</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {preview(b.wages).map((tx) => (
                                <TableRow key={tx.id}>
                                  <TableCell>{tx.date}</TableCell>
                                  <TableCell className="truncate max-w-[200px]">{tx.description}</TableCell>
                                  <TableCell className="text-right">{formatCurrency(tx.amount)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>

                        <p className="text-sm font-medium">Person B · Bills</p>
                        <div className="rounded-md border">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Date</TableHead>
                                <TableHead>Description</TableHead>
                                <TableHead className="text-right">Amount</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {preview(b.bills).map((tx) => (
                                <TableRow key={tx.id}>
                                  <TableCell>{tx.date}</TableCell>
                                  <TableCell className="truncate max-w-[200px]">{tx.description}</TableCell>
                                  <TableCell className="text-right">{formatCurrency(Math.abs(tx.amount))}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              <Button className="w-full" onClick={() => setState(prev => ({ ...prev, step: 'energy' }))}>
                Continue to Electricity
              </Button>
            </CardContent>
          </Card>
        )}

        {state.step === 'energy' && (
          <div className="max-w-4xl mx-auto space-y-6">
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
                    {state.bills.filter(b => b.source === 'imported').length} bills found
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

              const [sel, setSel] = [null, null] as unknown as [string | null, (v: string | null) => void];
              // Lightweight selection using a closure variable instead of React state to minimize edits.
              let selectedDate: string | null = null;

              const handleSelect = (d?: Date) => {
                selectedDate = d ? new Date(d).toISOString().slice(0,10) : null;
                // Force a re-render by toggling step quickly
                setState(prev => ({ ...prev }));
              };

              const selectedEvents = selectedDate ? (eventsByDate.get(selectedDate) || []) : [];

              return (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <CalendarIcon className="w-5 h-5" />
                      Forecast Calendar
                    </CardTitle>
                    <CardDescription>Select a date to see transactions due that day.</CardDescription>
                  </CardHeader>
                  <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="rounded-md border p-4">
                      <DayPicker
                        mode="single"
                        onSelect={handleSelect as any}
                      />
                    </div>
                    <div className="rounded-md border p-4">
                      <p className="text-sm font-medium mb-3">Transactions on Selected Date</p>
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
                  </CardContent>
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
