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
// Legacy electricity uploads now wrapped via ElectricityUpload component
import { loadMockTransactionsA, loadMockTransactionsB, categorizeBankTransactions, extractPayScheduleFromWages, Transaction } from '@/services/mockBank';
import { EsbReading } from '@/services/esbCsv';
import { TariffRates } from '@/services/billPdf';
import { Bill, PaySchedule, findDepositSingle, findDepositJoint, runSingle, runJoint } from '@/services/forecastAdapters';
import { generateBillSuggestions } from '@/services/optimizationEngine';
import { formatCurrency, calculatePayDates, addDaysISO, formatDate, addMonthsClampISO } from '@/utils/dateUtils';
import { predictBills, ElectricityMode } from '@/services/electricityPredictors';
import { Calendar as DayPicker } from '@/components/ui/calendar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend, LineChart, Line } from 'recharts';
import { BillEditorDialog, BillFrequency } from '@/components/bills/BillEditorDialog';
import { BillDateWizard } from '@/components/bills/BillDateWizard';
import { generateOccurrences } from '@/utils/recurrence';
import { persistBills } from '@/services/supabaseBills';
import { rollForwardPastBills } from '@/utils/billUtils';
import type { RecurringItem, SalaryCandidate, SavingsPot, SimResult, PlanInputs } from '@/types';
import { useToast } from '@/components/ui/use-toast';
import { ensureGuestJourney, saveJourney, getLocalJourneyState, getHouseholdId, loadNormalizedData, getJourney, getNormalizedDataFromSession } from '@/lib/journey.ts';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { expandRecurring } from '../lib/expandRecurring';
import { Stepper } from '@/components/Stepper';
import { BillsList } from '@/components/BillsList';
import { StickySummaryBar } from '@/components/StickySummaryBar';
import { WagesCard } from '@/components/WagesCard';
import { LinkBankTiles, type BankInfo } from '@/components/LinkBankTiles';
import { WagesBottomSheet } from '@/components/WagesBottomSheet';
import { ElectricityUpload } from '@/components/ElectricityUpload';
import { ForecastForm } from '@/components/ForecastForm';
import { ResultsHero } from '@/components/ResultsHero';
import { useInView } from '@/hooks/useInView';
import { ForecastCalendar } from '@/components/ForecastCalendar';
import { SavingsPanel } from '@/components/SavingsPanel';
import { CashflowSummary } from '@/components/CashflowSummary';
import { useAnnounce } from '@/components/accessibility/LiveAnnouncer';
import { track } from '@/lib/analytics';
import { Menu, Home, UserPlus, Link2, Settings as SettingsIcon, LogOut, Save, PlayCircle, LogIn } from 'lucide-react';

function HeaderActions({ onTryGuest, onSignIn, onSignUp }: { onTryGuest: () => void; onSignIn: () => void; onSignUp: () => void }) {
  const [email, setEmail] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authStep, setAuthStep] = useState<'form'|'sent'|'code'|'done'>('form');
  const [authBusy, setAuthBusy] = useState(false);
  const [otp, setOtp] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const [householdOpen, setHouseholdOpen] = useState(false);

  // (snapshot saver is attached by Index component)
  const { toast } = useToast();
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (evt, session) => {
      if (evt === 'SIGNED_IN' || evt === 'USER_UPDATED' || evt === 'TOKEN_REFRESHED') {
        const { data } = await supabase.auth.getUser();
        setEmail(data.user?.email ?? null);
      }
      if (evt === 'SIGNED_OUT') setEmail(null);
    });
    return () => { try { subscription.unsubscribe(); } catch {} };
  }, []);

  // (removed mistakenly inserted normalized-data effect; handled in Index component)


  const hasJourney = (() => { try { return !!localStorage.getItem('journey_id'); } catch { return false; } })();

  return (
    <div className="relative mb-8">
      {/* Centered title */}
      <div className="flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">FairSplit</h1>
          <p className="text-sm text-muted-foreground">Smart cash-flow and fair deposits.</p>
        </div>
      </div>

      {/* Right-side controls */}
      <div className="absolute right-0 top-0 h-10 flex items-center gap-2">
        {!email && !hasJourney && (
          <>
            {/* Inline buttons only on ≥sm screens */}
            <div className="hidden sm:flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={onTryGuest}>
                <PlayCircle className="mr-2 h-4 w-4" /> Try it
              </Button>
              <Button size="sm" onClick={() => setAuthOpen(true)}>
                <LogIn className="mr-2 h-4 w-4" /> Sign in
              </Button>
            </div>
            {/* Hamburger menu for small screens */}
            <Sheet>
              <SheetTrigger asChild>
                <Button size="icon" variant="ghost" aria-label="Menu">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-64">
                <div className="space-y-2 mt-4">
                  <Button className="w-full justify-start" variant="secondary" onClick={onTryGuest}>
                    <PlayCircle className="mr-2 h-4 w-4" /> Try it without an account
                  </Button>
                  <Button className="w-full justify-start" onClick={() => setAuthOpen(true)}>
                    <LogIn className="mr-2 h-4 w-4" /> Sign in
                  </Button>
                </div>
              </SheetContent>
            </Sheet>
          </>
        )}
        {!email && hasJourney && (
          <Sheet>
            <SheetTrigger asChild>
              <Button size="icon" variant="ghost" aria-label="Menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-64">
              <div className="space-y-2 mt-4">
                <Button className="w-full justify-start" onClick={() => {
                  try { (window as any).__saveJourneySnapshot?.(); } catch {}
                  setAuthOpen(true);
                }}>
                  <Save className="mr-2 h-4 w-4" /> Save progress (Sign up)
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        )}
        {!!email && (
          <>
            {/* Mobile: hamburger sheet */}
            <div className="sm:hidden">
              <Sheet>
                <SheetTrigger asChild>
                  <Button size="icon" variant="ghost" aria-label="Menu">
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-64">
                  <div className="space-y-2 mt-4">
                    <Button className="w-full justify-start" variant="ghost" onClick={() => setHouseholdOpen(true)}>
                      <Home className="mr-2 h-4 w-4" /> Household
                    </Button>
                    <Button className="w-full justify-start" variant="ghost" onClick={() => alert('Invite partner coming soon')}>
                      <UserPlus className="mr-2 h-4 w-4" /> Invite partner
                    </Button>
                    <Button className="w-full justify-start" variant="ghost" onClick={() => { try { (window as any).scrollTo({ top: 0, behavior: 'smooth' }); } catch {} }}>
                      <Link2 className="mr-2 h-4 w-4" /> Bank connections
                    </Button>
                    <Button className="w-full justify-start" variant="ghost" onClick={() => alert('Settings coming soon')}>
                      <SettingsIcon className="mr-2 h-4 w-4" /> Settings
                    </Button>
                    <Button className="w-full justify-start" variant="destructive" onClick={async () => { try { await supabase.auth.signOut(); } catch (e) { console.warn(e); } }}>
                      <LogOut className="mr-2 h-4 w-4" /> Sign out
                    </Button>
                  </div>
                </SheetContent>
              </Sheet>
            </div>

            {/* Desktop/tablet: avatar dropdown */}
            <div className="hidden sm:flex">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <div className="flex items-center gap-2 cursor-pointer select-none">
                    <Avatar className="h-8 w-8"><AvatarFallback>{(email[0] || 'U').toUpperCase()}</AvatarFallback></Avatar>
                    <span className="text-sm hidden sm:inline">{email}</span>
                  </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setHouseholdOpen(true)}>
                    <Home className="mr-2 h-4 w-4" /> <span>Household</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => alert('Invite partner coming soon')}>
                    <UserPlus className="mr-2 h-4 w-4" /> <span>Invite partner</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { try { (window as any).scrollTo({ top: 0, behavior: 'smooth' }); } catch {} }}>
                    <Link2 className="mr-2 h-4 w-4" /> <span>Bank connections</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => alert('Settings coming soon')}>
                    <SettingsIcon className="mr-2 h-4 w-4" /> <span>Settings</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={async () => { try { await supabase.auth.signOut(); } catch (e) { console.warn(e); } }}>
                    <LogOut className="mr-2 h-4 w-4" /> <span>Sign out</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </>
        )}
      </div>
      {/* Auth dialog for email-based OTP sign-in/sign-up */}
      <Dialog open={authOpen} onOpenChange={(v)=>{ setAuthOpen(v); if (!v){ setAuthStep('form'); setAuthEmail(''); setOtp(''); setResendIn(0);} }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {authStep === 'form' && 'Enter your email'}
              {authStep === 'sent' && 'Magic link sent'}
              {authStep === 'code' && 'Enter verification code'}
              {authStep === 'done' && 'Signed in'}
            </DialogTitle>
          </DialogHeader>
          {authStep === 'form' && (
            <div className="space-y-3">
              <Input
                type="email"
                placeholder="you@example.com"
                value={authEmail}
                onChange={(e)=> setAuthEmail(e.target.value)}
                autoFocus
              />
              <div className="flex justify-between items-center">
                <div className="text-xs text-muted-foreground">We’ll send you a magic link.</div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={()=> setAuthOpen(false)}>Cancel</Button>
                  <Button size="sm" disabled={authBusy || !authEmail} onClick={async ()=>{
                    const emailVal = (authEmail || '').trim();
                    if (!emailVal) return;
                    try {
                      setAuthBusy(true);
                      // Include journey keys in redirect so migration works across domains
                      let redirectTo: string | undefined = undefined;
                      try {
                        const keys = getJourney();
                        const base = `${window.location.origin}${window.location.pathname}`;
                        if (keys?.journey_id && keys?.journey_secret) {
                          const sp = new URLSearchParams(window.location.search);
                          sp.set('journey_id', keys.journey_id);
                          sp.set('journey_secret', keys.journey_secret);
                          redirectTo = `${base}?${sp.toString()}`;
                        } else {
                          redirectTo = base;
                        }
                      } catch {}
                      await supabase.auth.signInWithOtp({ email: emailVal, options: { emailRedirectTo: redirectTo } });
                      setAuthStep('sent');
                      setResendIn(30);
                      toast({ description: 'Magic link sent. Check your email.' });
                      // start resend cooldown
                      const timer = setInterval(()=> setResendIn((s)=>{ if (s<=1){ clearInterval(timer); return 0;} return s-1; }), 1000);
                    } catch (e) {
                      console.warn(e);
                      toast({ description: 'Failed to send email. Try again.', variant: 'destructive' });
                    } finally { setAuthBusy(false); }
                  }}>Continue</Button>
                </div>
              </div>
            </div>
          )}
          {authStep === 'sent' && (
            <div className="space-y-3">
              <p className="text-sm">We sent a magic link to <span className="font-medium">{authEmail}</span>. Open it on this device to finish signing in.</p>
              <div className="flex flex-wrap gap-2 justify-between">
                <Button size="sm" variant="secondary" onClick={()=> setAuthStep('form')}>Change email</Button>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={()=> setAuthStep('code')}>Use code instead</Button>
                  <Button size="sm" disabled={resendIn>0 || authBusy} onClick={async ()=>{
                    try {
                      setAuthBusy(true);
                      let redirectTo: string | undefined = undefined;
                      try {
                        const keys = getJourney();
                        const base = `${window.location.origin}${window.location.pathname}`;
                        if (keys?.journey_id && keys?.journey_secret) {
                          const sp = new URLSearchParams(window.location.search);
                          sp.set('journey_id', keys.journey_id);
                          sp.set('journey_secret', keys.journey_secret);
                          redirectTo = `${base}?${sp.toString()}`;
                        } else {
                          redirectTo = base;
                        }
                      } catch {}
                      await supabase.auth.signInWithOtp({ email: authEmail, options: { emailRedirectTo: redirectTo } });
                      setResendIn(30);
                      toast({ description: 'Magic link resent.' });
                    } finally { setAuthBusy(false);} 
                  }}>{resendIn>0? `Resend (${resendIn})` : 'Resend'}</Button>
                </div>
              </div>
            </div>
          )}
          {authStep === 'code' && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Enter the 6‑digit code from your email for {authEmail}.</p>
              <div className="flex justify-center">
                <InputOTP maxLength={6} value={otp} onChange={setOtp}>
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
              </div>
              <div className="flex justify-between">
                <Button size="sm" variant="secondary" onClick={()=> setAuthStep('sent')}>Back</Button>
                <Button size="sm" disabled={otp.length!==6 || authBusy} onClick={async ()=>{
                  try {
                    setAuthBusy(true);
                    await supabase.auth.verifyOtp({ email: authEmail, token: otp, type: 'email' });
                    toast({ description: 'Signed in.' });
                    setAuthStep('done');
                    setTimeout(()=> setAuthOpen(false), 600);
                  } catch (e) {
                    console.warn(e);
                    toast({ description: 'Invalid code. Try again.', variant: 'destructive' });
                  } finally { setAuthBusy(false); }
                }}>Verify</Button>
              </div>
            </div>
          )}
          {authStep === 'done' && (
            <div className="space-y-2">
              <p className="text-sm">You are signed in.</p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Household dialog */}
      <Dialog open={householdOpen} onOpenChange={setHouseholdOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Household</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-sm">
              <div><span className="text-muted-foreground">Household ID:</span> <code>{getHouseholdId() || '—'}</code></div>
              <div><span className="text-muted-foreground">Last migration:</span> {(() => {
                try { 
                  const migratedAt = sessionStorage.getItem('household_migrated_at');
                  return migratedAt ? new Date(migratedAt).toLocaleString() : '—';
                } catch { 
                  return '—';
                }
              })()}</div>
            </div>
            <div>
              <div className="text-sm font-medium mb-1">Members</div>
              <div className="space-y-1 text-sm">
                {(() => {
                  const data = getNormalizedDataFromSession<any>() || {};
                  const persons: any[] = Array.isArray(data.persons) ? data.persons : [];
                  if (persons.length === 0) return <div className="text-muted-foreground">No members yet.</div>;
                  return persons.map((p, i) => (
                    <div key={p.id || i} className="flex items-center justify-between border rounded px-2 py-1">
                      <div className="truncate">
                        {p.display_name || p.name || p.email || p.id || `Member ${i+1}`}
                      </div>
                      <div className="text-xs text-muted-foreground">{p.email || ''}</div>
                    </div>
                  ));
                })()}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 justify-end">
              <Button variant="outline" onClick={() => alert('Invite partner coming soon')}>Invite partner</Button>
              <Button onClick={handleManageBankConnections}>
                Manage bank connections
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Hoisted helper for salary candidate -> monthly euros
function toMonthlySalary(s?: SalaryCandidate): number | undefined {
  if (!s) return undefined as number | undefined;
  switch (s.freq) {
    case 'weekly': return (s.amount * 52) / 12;
    case 'fortnightly': return (s.amount * 26) / 12;
    case 'four_weekly': return (s.amount * 13) / 12;
    case 'monthly':
    default: return s.amount;
  }
}

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
  const { announce } = useAnnounce();
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
  const [newPotTarget, setNewPotTarget] = useState<number | ''>('');
  const [newPotOwner, setNewPotOwner] = useState<'A' | 'B' | 'JOINT'>('A');

  // New inputs for split pot creation (joint mode)  
  const [newPotNameA, setNewPotNameA] = useState('');
  const [newPotAmountA, setNewPotAmountA] = useState<number>(0);
  const [newPotTargetA, setNewPotTargetA] = useState<number | ''>('');
  const [newPotNameB, setNewPotNameB] = useState('');
  const [newPotAmountB, setNewPotAmountB] = useState<number>(0);
  const [newPotTargetB, setNewPotTargetB] = useState<number | ''>('');

  const handleManageBankConnections = () => {
    setHouseholdOpen(false);
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch {}
    setState(prev => ({ ...prev, step: 'bank' }));
  };
  const [showBillWizard, setShowBillWizard] = useState(false);
  const [dateMoves, setDateMoves] = useState<Array<{ name: string; fromISO: string; toISO: string }>>([]);
  // Live budget preview + binding mode for two-way coupling between allowances and pots
  const [budgetPreview, setBudgetPreview] = useState<{ availableA: number; availableB: number; monthlyJointA: number; monthlyJointB: number }>({ availableA: 0, availableB: 0, monthlyJointA: 0, monthlyJointB: 0 });
  const [bindingMode, setBindingMode] = useState<{ A: 'allowance' | 'pots'; B: 'allowance' | 'pots' }>({ A: 'allowance', B: 'allowance' });
  // Detailed savings pots toggle for summary charts
  const [showPotsA, setShowPotsA] = useState(false);
  const [showPotsB, setShowPotsB] = useState(false);
  const [billGroupBy, setBillGroupBy] = useState<'month'|'owner'>('owner');
  // Results: Cash Flow Summary view toggles
  const [summaryView, setSummaryView] = useState<'household'|'person'>('household');
  const [showHouseholdDetails, setShowHouseholdDetails] = useState(false);
  // Focused category for Household donut (hover/tap)
  const [householdFocus, setHouseholdFocus] = useState<string | null>(null);
  // In-view observers for charts to delay animation until visible
  const [houseDonutRef, houseDonutInView] = useInView<HTMLDivElement>({ threshold: 0.2, rootMargin: '0px 0px -40px 0px', once: true });
  const [personADonutRef, personADonutInView] = useInView<HTMLDivElement>({ threshold: 0.2, rootMargin: '0px 0px -40px 0px', once: true });
  const [personBDonutRef, personBDonutInView] = useInView<HTMLDivElement>({ threshold: 0.2, rootMargin: '0px 0px -40px 0px', once: true });

  // Access plan store early so hooks below can depend on it safely
  const { detected, inputs, result: storeResult } = usePlanStore();

  // Link tiles & wages sheet state
  const [openSheetFor, setOpenSheetFor] = useState<'A'|'B'|null>(null);
  const [bankInfoA, setBankInfoA] = useState<BankInfo | undefined>(undefined);
  const [bankInfoB, setBankInfoB] = useState<BankInfo | undefined>(undefined);
  const [householdBannerId, setHouseholdBannerId] = useState<string | null>(null);

  // Expose a snapshot saver globally so header menu can save a complete migration state right before auth
  useEffect(() => {
    (window as any).__saveJourneySnapshot = async () => {
      try {
        const persons = (() => {
          const arr: any[] = [];
          arr.push({ label: 'A', display_name: 'A' });
          if (state.mode === 'joint' && state.userB?.paySchedule) arr.push({ label: 'B', display_name: 'B' });
          return arr;
        })();
        const wages = (() => {
          const mapFq = (f?: string) => {
            if (!f) return 'MONTHLY';
            const u = f.toUpperCase();
            return ['WEEKLY','FORTNIGHTLY','BIWEEKLY','FOUR_WEEKLY','MONTHLY'].includes(u) ? u : 'MONTHLY';
          };
          const items: any[] = [];
          if (state.userA?.paySchedule) {
            items.push({ label: 'A', frequency: mapFq(state.userA.paySchedule.frequency), amount_per_month: state.userA.paySchedule.averageAmount ?? 0, last_seen_date: null, next_date: state.userA.paySchedule.anchorDate, confirmed: true });
          }
          if (state.mode === 'joint' && state.userB?.paySchedule) {
            items.push({ label: 'B', frequency: mapFq(state.userB.paySchedule.frequency), amount_per_month: state.userB.paySchedule.averageAmount ?? 0, last_seen_date: null, next_date: state.userB.paySchedule.anchorDate, confirmed: true });
          }
          return items;
        })();
        const lowerOwner = (o?: any) => {
          if (!o) return 'joint';
          const u = String(o).toUpperCase();
          return u === 'A' ? 'A' : u === 'B' ? 'B' : 'joint';
        };
        const bills = (state.bills || [])
          .filter(b => state.includedBillIds.includes(b.id!))
          .map(b => ({
            name: b.name,
            owner: lowerOwner((b as any).owner),
            frequency: 'monthly',
            day_rule: (b as any).dueDay ? `day ${(b as any).dueDay}` : undefined,
            category: undefined,
            amount: b.amount,
            confidence: 1
          }));
        const electricity_readings = (state.electricityReadings || []).map(r => ({ start_at: (r as any).startISO || (r as any).start_at || null, end_at: (r as any).endISO || (r as any).end_at || null, kwh: (r as any).kwh }));
        const electricity_bills: any[] = [];
        const entries = (usePlanStore.getState().result as any)?.entries as Array<{ dateISO?: string; date?: string; label: string; delta: number }> | undefined;
        const forecast_items = Array.isArray(entries)
          ? entries.map(e => ({ dt: (e.dateISO || e.date || '').slice(0,10), kind: undefined, person: undefined, name: e.label, amount: e.delta }))
          : [];
        const forecast_starts_on = (usePlanStore.getState().result as any)?.startISO || state.userA?.paySchedule?.anchorDate || null;
        const forecast_months = 12;
        await saveJourney({ persons, wages, bills, electricity_readings, electricity_bills, forecast_items, forecast_starts_on, forecast_months });
      } catch (e) { console.warn('save snapshot failed', e); }
    };
    return () => { try { delete (window as any).__saveJourneySnapshot; } catch {} };
  }, [state]);

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
      let importedA = expandRecurring(detected?.recurring ?? [], startMin, months, 'imp-a-');
      let importedB = expandRecurring((detected?.recurringB ?? (detected as any)?.allRecurring ?? []), startMin, months, 'imp-b-');
      // Apply include filters and user edits based on detected-series edits from Bank screen
      try {
        const detectedSeries = (state.bills || []).filter(b => (b as any).source === 'detected');
        const includeA = new Set<string>();
        const includeB = new Set<string>();
        const editsA = new Map<string, { name: string; amount: number }>();
        const editsB = new Map<string, { name: string; amount: number }>();
        for (const b of detectedSeries) {
          const owner = (b as any).owner as 'A'|'B'|'JOINT'|undefined;
          const key = (b as any).seriesKey || `${owner || 'A'}::${b.name}`;
          const included = (state.includedBillIds || []).includes(b.id!);
          const patch = { name: b.name, amount: b.amount };
          if (owner === 'B') {
            editsB.set(key, patch);
            if (included) includeB.add(key);
          } else {
            editsA.set(key, patch);
            if (included) includeA.add(key);
          }
        }
        const hasA = Array.from(editsA.keys()).length > 0;
        const hasB = Array.from(editsB.keys()).length > 0;
        importedA = importedA
          .filter(b => (!hasA || includeA.size === 0) ? true : includeA.has((b as any).seriesKey || `A::${b.name}`))
          .map(b => {
            const over = editsA.get((b as any).seriesKey || `A::${b.name}`);
            return over ? { ...b, name: over.name, amount: over.amount } : b;
          });
        importedB = importedB
          .filter(b => (!hasB || includeB.size === 0) ? true : includeB.has((b as any).seriesKey || `B::${b.name}`))
          .map(b => {
            const over = editsB.get((b as any).seriesKey || `B::${b.name}`);
            return over ? { ...b, name: over.name, amount: over.amount } : b;
          });
      } catch {}
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

      // Debug: monthly totals using detected recurring (normalized) + electricity average over 12 months
      const toMonthlyNorm = (amt: number, freq: string) => {
        switch (freq?.toLowerCase()) {
          case 'weekly': return (amt * 52) / 12;
          case 'fortnightly': return (amt * 26) / 12;
          case 'four_weekly': return (amt * 13) / 12;
          case 'monthly':
          default: return amt;
        }
      };
      const recurringA = (detected as any)?.recurring ?? [];
      const recurringB = (detected as any)?.recurringB ?? [];
      const recurringMonthly = [...recurringA, ...recurringB].reduce((s, r) => s + toMonthlyNorm(Number(r.amount) || 0, r.freq), 0);
      const horizonEndISO = (() => { const d = new Date(startMin + 'T00:00:00'); d.setMonth(d.getMonth() + 12); return d.toISOString().slice(0,10); })();
      const elecOnly = mergedBillsRolled.filter(b => (b as any).source === 'predicted-electricity' && b.dueDate >= startMin && b.dueDate <= horizonEndISO);
      const elecTotal = elecOnly.reduce((s, b) => s + (Number(b.amount) || 0), 0);
      const electricityMonthly = elecTotal / 12;
      const idealMonthly = recurringMonthly + electricityMonthly;
      console.log('[forecast] monthly totals', { idealMonthly: Math.round(idealMonthly), electricityMonthly: Math.round(electricityMonthly) });

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
        owner: 'A',
        seriesKey: `A::${r.description}::${r.freq}::${(r as any).dueDay ?? ''}::${(r as any).dayOfWeek ?? ''}::${Math.round(Math.abs(r.amount || 0))}`,
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
        owner: 'B',
        seriesKey: `B::${r.description}::${r.freq}::${(r as any).dueDay ?? ''}::${(r as any).dayOfWeek ?? ''}::${Math.round(Math.abs(r.amount || 0))}`,
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

      // Update state for the relevant partner
      setState(prev => (
        partner === 'A'
          ? { ...prev, userA: { transactions, paySchedule: pay }, linkedA: true, step: 'bank' }
          : { ...prev, userB: { transactions, paySchedule: pay } as any, linkedB: true, mode: prev.mode === 'single' ? 'joint' : prev.mode, step: 'bank' }
      ));

      // Update bank tile info and open wages sheet
      const nowISO = new Date().toISOString();
      if (partner === 'A') {
        setBankInfoA(prev => prev || { name: (instA?.name || 'Linked bank'), linkedAtISO: nowISO });
      } else {
        setBankInfoB(prev => prev || { name: (instB?.name || 'Linked bank'), linkedAtISO: nowISO });
      }
      track('bank_link_success', { person: partner });
      setOpenSheetFor(partner);
      track('wages_sheet_opened', { person: partner });
      announce(`Person ${partner} linked. Detected wages available.`);

      // Kick off detection using known transactions without relying on setState return value
      const txA = partner === 'A' ? transactions : (state.userA?.transactions ?? []);
      const txB = partner === 'B' ? transactions : (state.userB?.transactions ?? []);
      (window as any).__runDetection?.(txA, txB);
      // Persist bank linkage step for guest journey
      try {
        saveJourney({
          step: 'bank-link',
          partner,
          linkedA: partner === 'A' ? true : state.linkedA,
          linkedB: partner === 'B' ? true : state.linkedB,
          payScheduleA: partner === 'A' ? pay : state.userA?.paySchedule ?? null,
          payScheduleB: partner === 'B' ? pay : state.userB?.paySchedule ?? null,
        }).catch(()=>{});
      } catch {}
    };

    window.addEventListener('gc:transactions' as any, onTx);
    return () => window.removeEventListener('gc:transactions' as any, onTx);
  }, [state.userA?.transactions, state.userB?.transactions]);


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

      // update bank info and open the wages sheet
      const nowISO = new Date().toISOString();
      if (partner === 'A') {
        setBankInfoA(prev => prev || { name: (instA?.name || 'Linked bank'), linkedAtISO: nowISO });
      } else {
        setBankInfoB(prev => prev || { name: (instB?.name || 'Linked bank'), linkedAtISO: nowISO });
      }
      track('bank_link_success', { person: partner });
      setOpenSheetFor(partner);
      track('wages_sheet_opened', { person: partner });
      announce(`Person ${partner} linked. Detected wages available.`);

      (window as any).__runDetection?.(
        nextState.userA.transactions ?? [],
        nextState.userB?.transactions ?? []
      );
      // Persist pull completion
      try {
        saveJourney({
          step: 'bank-pull',
          partner,
          requisitionId,
          linkedA: nextState.linkedA,
          linkedB: nextState.linkedB,
          payScheduleA: nextState.userA.paySchedule,
          payScheduleB: nextState.userB?.paySchedule ?? null,
        }).catch(()=>{});
      } catch {}
    };

    window.addEventListener('message', handler);
    const bc = new BroadcastChannel('fair-balance-buddy');
    bc.onmessage = handler as any;
    return () => { window.removeEventListener('message', handler); bc.close(); };
  }, []);

  // On mount: if we already have a household_id (post-migration), load normalized data and apply to UI
  useEffect(() => {
    const hid = getHouseholdId();
    if (!hid) return;
    setHouseholdBannerId(() => {
      try { return sessionStorage.getItem('household_banner_dismissed') ? null : hid; } catch { return hid; }
    });
    (async () => {
      await loadNormalizedData();
      try {
        const raw = sessionStorage.getItem('household_data');
        if (!raw) return;
        const data = JSON.parse(raw || '{}');
        const wd: any[] = Array.isArray(data.wages_detected) ? data.wages_detected : [];
        const toPS = (r: any) => ({
          frequency: String(r?.frequency || r?.freq || 'MONTHLY').toUpperCase(),
          anchorDate: r?.anchor_date || r?.anchorDate || r?.first_pay_date || new Date().toISOString().slice(0,10),
          averageAmount: Number(r?.average_amount ?? r?.amount ?? r?.per_occurrence ?? 0) || undefined,
        });
        const psA = wd[0] ? toPS(wd[0]) : null;
        const psB = wd[1] ? toPS(wd[1]) : null;
        const rb: any[] = Array.isArray(data.recurring_bills) ? data.recurring_bills : [];
        const eb: any[] = Array.isArray(data.electricity_bills) ? data.electricity_bills : [];
        const mapBill = (r: any, src: 'manual'|'predicted-electricity') => ({
          id: (r?.id && String(r.id)) || `b_${Math.random().toString(36).slice(2,8)}`,
          name: r?.name || r?.label || 'Bill',
          amount: Number(r?.amount ?? r?.value ?? 0) || 0,
          issueDate: r?.issue_date || r?.due_date || r?.date || new Date().toISOString().slice(0,10),
          dueDate: r?.due_date || r?.issue_date || r?.date || new Date().toISOString().slice(0,10),
          source: src,
          movable: Boolean(r?.movable ?? true),
        });
        const bills = [...rb.map((r) => mapBill(r, 'manual')), ...eb.map((r) => mapBill(r, 'predicted-electricity'))];
        const included = bills.map(b => b.id!);
        setState(prev => ({
          ...prev,
          mode: psB ? 'joint' : 'single',
          userA: { 
            transactions: [], 
            paySchedule: psA ? {
              ...psA,
              frequency: (psA.frequency as "WEEKLY" | "FORTNIGHTLY" | "BIWEEKLY" | "FOUR_WEEKLY" | "MONTHLY")
            } : null
          },
          userB: psB ? { 
            transactions: [], 
            paySchedule: {
              ...psB,
              frequency: (psB.frequency as "WEEKLY" | "FORTNIGHTLY" | "BIWEEKLY" | "FOUR_WEEKLY" | "MONTHLY")
            }
          } as any : prev.userB,
          linkedA: !!psA,
          linkedB: !!psB,
          bills,
          includedBillIds: included,
          step: 'forecast',
        }));
        try { usePlanStore.getState().setDetected(undefined as any); } catch {}
        setTimeout(() => { try { (window as any).__runDetection?.([], []); } catch {} }, 0);
      } catch (e) { console.warn('Failed to apply normalized data', e); }
    })();
  }, []);

  // Listen for migration event to apply normalized data immediately
  useEffect(() => {
    const onMigrated = async (e: any) => {
      const hid = e?.detail?.household_id || getHouseholdId();
      if (!hid) return;
    setHouseholdBannerId(() => {
      try { return sessionStorage.getItem('household_banner_dismissed') ? null : hid; } catch { return hid; }
    });
      await loadNormalizedData();
      try {
        const raw = sessionStorage.getItem('household_data');
        if (!raw) return;
        const data = JSON.parse(raw || '{}');
        const wd: any[] = Array.isArray(data.wages_detected) ? data.wages_detected : [];
        const toPS = (r: any) => ({
          frequency: String(r?.frequency || r?.freq || 'MONTHLY').toUpperCase(),
          anchorDate: r?.anchor_date || r?.anchorDate || r?.first_pay_date || new Date().toISOString().slice(0,10),
          averageAmount: Number(r?.average_amount ?? r?.amount ?? r?.per_occurrence ?? 0) || undefined,
        });
        const psA = wd[0] ? toPS(wd[0]) : null;
        const psB = wd[1] ? toPS(wd[1]) : null;
        const rb: any[] = Array.isArray(data.recurring_bills) ? data.recurring_bills : [];
        const eb: any[] = Array.isArray(data.electricity_bills) ? data.electricity_bills : [];
        const mapBill = (r: any, src: 'manual'|'predicted-electricity') => ({
          id: (r?.id && String(r.id)) || `b_${Math.random().toString(36).slice(2,8)}`,
          name: r?.name || r?.label || 'Bill',
          amount: Number(r?.amount ?? r?.value ?? 0) || 0,
          issueDate: r?.issue_date || r?.due_date || r?.date || new Date().toISOString().slice(0,10),
          dueDate: r?.due_date || r?.issue_date || r?.date || new Date().toISOString().slice(0,10),
          source: src,
          movable: Boolean(r?.movable ?? true),
        });
        const bills = [...rb.map((r) => mapBill(r, 'manual')), ...eb.map((r) => mapBill(r, 'predicted-electricity'))];
        const included = bills.map(b => b.id!);
        setState(prev => ({
          ...prev,
          mode: psB ? 'joint' : 'single',
          userA: { 
            transactions: [], 
            paySchedule: psA ? {
              ...psA,
              frequency: (psA.frequency as "WEEKLY" | "FORTNIGHTLY" | "BIWEEKLY" | "FOUR_WEEKLY" | "MONTHLY")
            } : null
          },
          userB: psB ? { 
            transactions: [], 
            paySchedule: {
              ...psB,
              frequency: (psB.frequency as "WEEKLY" | "FORTNIGHTLY" | "BIWEEKLY" | "FOUR_WEEKLY" | "MONTHLY")
            }
          } as any : prev.userB,
          linkedA: !!psA,
          linkedB: !!psB,
          bills,
          includedBillIds: included,
          step: 'forecast',
        }));
        try { usePlanStore.getState().setDetected(undefined as any); } catch {}
        setTimeout(() => { try { (window as any).__runDetection?.([], []); } catch {} }, 0);
      } catch {}
    };
    window.addEventListener('journey:migrated' as any, onMigrated);
    return () => window.removeEventListener('journey:migrated' as any, onMigrated);
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
    try { saveJourney({ step: 'energy-readings', readings }).catch(()=>{}); } catch {}
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
        step: prev.step
      };
    });

    try { saveJourney({ step: 'energy-tariff', tariff, predictedCount: predicted.length }).catch(()=>{}); } catch {}

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
        api.simulate(currentInputs, { includeSuggestions: false }).then(res => {
          usePlanStore.getState().setResult({ ...usePlanStore.getState().result, ...res });
        }).catch(err => console.error('[forecast] worker sim failed:', err));
      }
    }
  };

  // Bridge: when both readings and tariff exist (via ElectricityUpload), build predicted electricity bills
  useEffect(() => {
    try {
      if (state.electricityReadings.length && state.tariffRates) {
        const alreadyPredicted = (state.bills || []).some(b => b.source === 'predicted-electricity');
        if (!alreadyPredicted) {
          handleTariffExtracted(state.tariffRates);
        }
      }
    } catch {}
  }, [state.electricityReadings, state.tariffRates]);

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
      // Expand worker-detected recurring series
      let importedA = expandRecurring(detected?.recurring ?? [], startDate, months, 'imp-a-');
      let importedB = expandRecurring(
        (detected?.recurringB ?? (detected as any)?.allRecurring ?? []),
        startDate,
        months,
        'imp-b-'
      );
      // Apply include filters and user edits (name/amount) captured on the detected series
      try {
        const detectedSeries = (currentState.bills || []).filter(b => (b as any).source === 'detected');
        const includeA = new Set<string>();
        const includeB = new Set<string>();
        const editsA = new Map<string, { name: string; amount: number }>();
        const editsB = new Map<string, { name: string; amount: number }>();
        for (const b of detectedSeries) {
          const owner = (b as any).owner as 'A'|'B'|'JOINT'|undefined;
          const key = (b as any).seriesKey || `${owner || 'A'}::${b.name}`;
          const included = (currentState.includedBillIds || []).includes(b.id!);
          const patch = { name: b.name, amount: b.amount };
          if (owner === 'B') {
            editsB.set(key, patch);
            if (included) includeB.add(key);
          } else {
            editsA.set(key, patch);
            if (included) includeA.add(key);
          }
        }
        // Filter to included series only (if any detected exist for that owner)
        const hasA = Array.from(editsA.keys()).length > 0;
        const hasB = Array.from(editsB.keys()).length > 0;
        importedA = importedA
          .filter(b => (!hasA || includeA.size === 0) ? true : includeA.has((b as any).seriesKey || `A::${b.name}`))
          .map(b => {
            const over = editsA.get((b as any).seriesKey || `A::${b.name}`);
            return over ? { ...b, name: over.name, amount: over.amount } : b;
          });
        importedB = importedB
          .filter(b => (!hasB || includeB.size === 0) ? true : includeB.has((b as any).seriesKey || `B::${b.name}`))
          .map(b => {
            const over = editsB.get((b as any).seriesKey || `B::${b.name}`);
            return over ? { ...b, name: over.name, amount: over.amount } : b;
          });
      } catch {}
      let mergedBills = [...manual, ...importedA, ...importedB, ...elecPredicted];
      // Apply any pending date moves (name + fromISO → toISO)
      const movesToApply = movesOverride && movesOverride.length ? movesOverride : dateMoves;
      if (movesToApply.length) {
        const entries: Array<[string, string]> = [];
        for (const m of movesToApply) {
          // Support both id@@from and name@@from keys; some suggestions use fallback ids
          entries.push([`${(m as any).id || m.name}@@${m.fromISO}`, m.toISO]);
          entries.push([`${m.name}@@${m.fromISO}`, m.toISO]);
        }
        const map = new Map(entries);
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
          workerResult = await api.simulate(planForWorker, { includeSuggestions: false });
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

        // Final fairness ratio: use income-based ratio when using worker optimization to match worker's assumptions;
        // otherwise use effective-income (after allowances & pots) for local search.
        const fairnessIncomeA = (monthlyA + monthlyB) > 0 ? (monthlyA / (monthlyA + monthlyB)) : 0.5;
        const fairnessEffA = (effA + effB) > 0 ? (effA / (effA + effB)) : 0.5;
        const fairnessRatioA = useWorkerOptimization ? fairnessIncomeA : fairnessEffA;
        console.log('[forecast] fairnessRatioA=%s effA=%s effB=%s incomeA=%s', fairnessRatioA.toFixed(4), effA.toFixed(2), effB.toFixed(2), fairnessIncomeA.toFixed(4));

        let depositA: number;
        let depositB: number | undefined;
        let simResult: { minBalance: number; endBalance?: number; timeline: any };
        if (useWorkerOptimization) {
          depositA = workerResult.requiredDepositA!;
          depositB = workerResult.requiredDepositB!;
          const startFromWorker = workerResult.startISO || startDate;
          // Use the same anchors the worker used (avoid misaligning pay cycles)
          const anchors = usePlanStore.getState().inputs;
          const psAAligned: PaySchedule = { ...payScheduleA, anchorDate: (anchors as any)?.a?.firstPayISO || payScheduleA.anchorDate };
          const psBAligned: PaySchedule = { ...payScheduleB, anchorDate: (anchors as any)?.b?.firstPayISO || payScheduleB.anchorDate };
          simResult = runJoint(
            depositA,
            depositB,
            startFromWorker,
            psAAligned,
            psBAligned,
            allBills,
            { months: 12, fairnessRatioA, initialBalance: (usePlanStore.getState().inputs as any)?.initialBalance ?? 0 }
          );
          // Hard guard: if negative due to rounding, loop bump until non-negative (bounded)
          const cycles = (fq: PaySchedule['frequency']) => fq==='WEEKLY'?52/12 : (fq==='FORTNIGHTLY'||fq==='BIWEEKLY'?26/12 : (fq==='FOUR_WEEKLY'?13/12 : 1));
          {
            let guards = 0;
            while (simResult.minBalance < 0 && guards++ < 12) {
              const short = -simResult.minBalance;
              const monthlyBump = Math.max(1, Math.ceil(short / 12));
              const bumpA = Math.max(1, Math.ceil((monthlyBump * fairnessRatioA) / cycles(psAAligned.frequency)));
              const bumpB = Math.max(0, Math.ceil((monthlyBump * (1 - fairnessRatioA)) / cycles(psBAligned.frequency)));
              depositA += bumpA;
              depositB = (depositB || 0) + bumpB;
              simResult = runJoint(
                depositA,
                depositB,
                startFromWorker,
                psAAligned,
                psBAligned,
                allBills,
                { months: 12, fairnessRatioA }
              );
            }
          }
          // Shave down via bisection on monthly deposits to get closer to ideal while staying >= 0
          {
            const cyclesLocal = (fq: PaySchedule['frequency']) => fq==='WEEKLY'?52/12 : (fq==='FORTNIGHTLY'||fq==='BIWEEKLY'?26/12 : (fq==='FOUR_WEEKLY'?13/12 : 1));
            const cyA = cyclesLocal(psAAligned.frequency);
            const cyB = cyclesLocal(psBAligned.frequency);
            const baseMonthlyA = depositA * cyA;
            const baseMonthlyB = (depositB || 0) * cyB;
            let lo = 0.0, hi = 1.0;
            let bestA = depositA, bestB = (depositB || 0);
            for (let i = 0; i < 10; i++) {
              const f = (lo + hi) / 2;
              const testA = Math.max(0, Math.floor((baseMonthlyA * f) / cyA));
              const testB = Math.max(0, Math.floor((baseMonthlyB * f) / cyB));
              const r = runJoint(testA, testB, startFromWorker, psAAligned, psBAligned, allBills, { months: 12, fairnessRatioA, initialBalance: (usePlanStore.getState().inputs as any)?.initialBalance ?? 0 });
              if (r.minBalance >= 0) { hi = f; bestA = testA; bestB = testB; simResult = r; } else { lo = f; }
            }
            depositA = bestA; depositB = bestB;
          }
          // Trim end-balance: reduce per-pay by €1 while keeping minBalance >= 0 (cap at 6 steps)
          {
            // Reduce end-balance toward ~€50 while keeping min >= 0
            const target = (usePlanStore.getState().inputs as any)?.initialBalance ?? 50;
            let steps = 0;
            while (steps++ < 180 && (simResult.endBalance ?? 0) > target) {
              const trialA = Math.max(0, depositA - 1);
              const trialB = Math.max(0, (depositB || 0) - 1);
              const r = runJoint(trialA, trialB, startFromWorker, psAAligned, psBAligned, allBills, { months: 12, fairnessRatioA, initialBalance: (usePlanStore.getState().inputs as any)?.initialBalance ?? 0 });
              if (r.minBalance >= 0) { depositA = trialA; depositB = trialB; simResult = r; } else { break; }
            }
          }
          // Final guarantee after all trimming: ensure minBalance is non-negative
          {
            let guards = 0;
            while (simResult.minBalance < 0 && guards++ < 6) {
              const short = -simResult.minBalance;
              const monthlyBump = Math.max(1, Math.ceil(short / 12));
              const bumpA = Math.max(1, Math.ceil((monthlyBump * fairnessRatioA) / (psAAligned.frequency==='WEEKLY'?52/12:(psAAligned.frequency==='FORTNIGHTLY'||psAAligned.frequency==='BIWEEKLY'?26/12:(psAAligned.frequency==='FOUR_WEEKLY'?13/12:1)))));
              const bumpB = Math.max(0, Math.ceil((monthlyBump * (1 - fairnessRatioA)) / (psBAligned.frequency==='WEEKLY'?52/12:(psBAligned.frequency==='FORTNIGHTLY'||psBAligned.frequency==='BIWEEKLY'?26/12:(psBAligned.frequency==='FOUR_WEEKLY'?13/12:1)))));
              depositA += bumpA;
              depositB = (depositB || 0) + bumpB;
              simResult = runJoint(depositA, depositB, startFromWorker, psAAligned, psBAligned, allBills, { months: 12, fairnessRatioA, initialBalance: (usePlanStore.getState().inputs as any)?.initialBalance ?? 0 });
            }
          }

          // Defer bill suggestions to the worker in the background to keep UI snappy
          setTimeout(() => {
            try {
              const api = (window as any).__workerAPI;
              if (!api) return;
              api.simulate({ ...(inputs as PlanInputs), startISO: startFromWorker, bills: mergedBills, elecPredicted }, { includeSuggestions: true })
                .then((r: SimResult) => {
                  if (r?.billSuggestions?.length) {
                    usePlanStore.getState().setResult({
                      ...usePlanStore.getState().result,
                      billSuggestions: r.billSuggestions
                    });
                  }
                })
                .catch((err: any) => console.warn('[forecast] background suggestions failed:', err));
            } catch (e) {
              console.warn('[forecast] scheduling background suggestions failed:', e);
            }
          }, 0);
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
        // Background: ask the worker to log gating/currentMonthly using trimmed deposits (non-blocking)
        setTimeout(() => {
          try {
            const api = (window as any).__workerAPI;
            if (!api) return;
            const inputsForSuggestions: PlanInputs = {
              ...(inputs as PlanInputs),
              bills: mergedBills,
              elecPredicted,
              startISO: startDate,
              mode: 'joint',
            } as any;
            api.explainGating(inputsForSuggestions, { a: depositA, b: depositB }, simResult.minBalance).catch(()=>{});
          } catch {}
        }, 0);
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
          // Keep suggestions async via worker only to keep Results snappy
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
        try {
          const snapshot = (window as any).__saveJourneySnapshot;
          if (typeof snapshot === 'function') await snapshot();
          else await saveJourney({ step: 'forecast', weeklyAllowanceA: currentState.weeklyAllowanceA ?? 0, weeklyAllowanceB: currentState.weeklyAllowanceB ?? 0, pots: currentState.pots ?? [] });
        } catch {}
        try { track('forecast_run'); announce('Forecast calculated'); } catch {}
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

  // Ensure viewport is reset to top on step changes
  useEffect(() => {
    try { window.scrollTo({ top: 0, left: 0, behavior: 'auto' }); } catch { window.scrollTo(0,0); }
  }, [state.step]);

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
      try { saveJourney({ step: 'bill-edited', id: billEditing.id, patch: { name: values.name, amount: values.amount, dueDate: values.dueDate } }).catch(()=>{}); } catch {}
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
    try { saveJourney({ step: 'bills-added', bills: newBills }).catch(()=>{}); } catch {}


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
      if (!payA) {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
      }
      const pays = calculatePayDates(payA.frequency, payA.anchorDate, 18);
      const before = pays.filter(p => p <= earliest);
      return before.length ? before[before.length - 1] : pays[0];
    })();

    const allBills = updatedState.bills.filter(b => updatedState.includedBillIds.includes(b.id!));
    if (updatedState.mode === 'single') {
      const baseline = 150;
      const dep = findDepositSingle(startDate, state.userA.paySchedule!, allBills, baseline);
      toast({ description: `From ${formatDate(startDate)}, set your deposit to ${formatCurrency(dep)} to stay above zero.` });
    } else if (state.userB?.paySchedule) {
      const baseline = 800;
      const fairness = 0.55;
      const { depositA, depositB } = findDepositJoint(startDate, state.userA.paySchedule!, state.userB.paySchedule!, allBills, fairness, baseline);
      toast({ description: `From ${formatDate(startDate)}, set deposits to ${formatCurrency(depositA)} (A) and ${formatCurrency(depositB)} (B).` });
    }

    // Re-run forecast with updated bills
    runForecast(updatedState);
  };

  function handleAddPot(potName: string, monthlyAmount: number, owner: 'A'|'B'|'JOINT', target?: number) {
    const potId = (globalThis.crypto && 'randomUUID' in globalThis.crypto)
      ? (globalThis.crypto as any).randomUUID()
      : `pot_${Date.now()}`;
    setState(prev => ({
      ...prev,
      pots: [...prev.pots, { id: potId, name: potName, monthly: monthlyAmount, owner, target }]
    }));
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-secondary/20">
      <div className="container mx-auto px-4 py-8 max-w-6xl">

        {/* Success banner after migration */}
        {householdBannerId && (
          <div className="mb-4 rounded-md border bg-green-50 text-green-800 px-4 py-3 flex items-center justify-between">
            <div>
              <strong>Success:</strong> Your data has been migrated to household <code>{householdBannerId}</code>.
            </div>
            <Button size="sm" variant="outline" onClick={() => { try { sessionStorage.setItem('household_banner_dismissed', '1'); } catch {}; setHouseholdBannerId(null); }}>Dismiss</Button>
          </div>
        )}

        {/* Header with auth/journey states */}
        <HeaderActions
          onTryGuest={async () => { await ensureGuestJourney(); }}
          onSignIn={async () => {
            const email = window.prompt('Enter your email to sign in');
            if (!email) return;
            await supabase.auth.signInWithOtp({ email });
            alert('Check your email for the sign-in link.');
          }}
          onSignUp={async () => {
            const email = window.prompt('Enter your email to save your progress');
            if (!email) return;
            await supabase.auth.signInWithOtp({ email });
            alert('Check your email to complete sign up.');
          }}
        />

        <Stepper current={state.step} onNavigate={(k)=> setState(prev => ({ ...prev, step: k }))} />

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
                  <span className="font-medium">Household</span>
                  <span className="text-xs text-muted-foreground">Household forecasting</span>
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
                Pick how you want to set up you household forecast
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
              {/* Link banks (A & B) – mobile‑first tiles */}
              <div className="rounded-xl border p-4">
                <LinkBankTiles
                  linkedA={state.linkedA}
                  linkedB={state.linkedB}
                  bankA={bankInfoA}
                  bankB={bankInfoB}
                  summaryA={(() => {
                    const s = detected?.salaries?.[0];
                    const perOcc = s?.amount;
                    const unit = s?.freq === 'weekly' ? 'week' : s?.freq === 'fortnightly' ? 'fortnight' : s?.freq === 'four_weekly' ? '4 weeks' : 'month';
                    const stale = s?.firstSeen ? ((Date.now() - new Date(s.firstSeen).getTime())/(1000*60*60*24) > 60) : false;
                    const wages = categorizeBankTransactions(state.userA.transactions).wages;
                    const lastDate = wages.length ? [...wages].map(w=>w.date).sort().slice(-1)[0] : (s?.firstSeen);
                    return { perOcc, unit, needsConfirm: state.linkedA && !state.wageConfirmedA, stale: state.wageConfirmedA && stale, lastDate };
                  })()}
                  summaryB={(() => {
                    const s: any = (detected as any)?.salariesB?.[0];
                    const perOcc = s?.amount;
                    const unit = s?.freq === 'weekly' ? 'week' : s?.freq === 'fortnightly' ? 'fortnight' : s?.freq === 'four_weekly' ? '4 weeks' : 'month';
                    const stale = s?.firstSeen ? ((Date.now() - new Date(s.firstSeen).getTime())/(1000*60*60*24) > 60) : false;
                    const wagesB = state.userB?.transactions ? categorizeBankTransactions(state.userB.transactions).wages : [];
                    const lastDate = wagesB.length ? [...wagesB].map(w=>w.date).sort().slice(-1)[0] : (s?.firstSeen);
                    return { perOcc, unit, needsConfirm: state.linkedB && !state.wageConfirmedB, stale: !!state.wageConfirmedB && stale, lastDate };
                  })()}
                  onLink={(p) => {
                    const isLinked = p === 'A' ? state.linkedA : state.linkedB;
                    if (isLinked) {
                      setOpenSheetFor(p);
                      track('wages_sheet_opened', { person: p });
                      return;
                    }
                    // analytics
                    track('bank_link_started', { person: p });
                    if (useMock) return link(p);
                    // live: require institution selection
                    if (p === 'A') {
                      if (!instA) { toast({ description: 'Choose a bank for Person A first.' }); return; }
                      return link('A', instA.id);
                    } else {
                      if (!instB) { toast({ description: 'Choose a bank for Person B first.' }); return; }
                      return link('B', instB.id);
                    }
                  }}
                  pulseB={state.linkedA && !state.linkedB}
                  showB={state.mode === 'joint'}
                />

                {/* Live mode: small bank chooser inputs under tiles */}
                {!useMock && (
                  <div className="mt-3 grid grid-cols-1 min-[360px]:grid-cols-2 gap-3">
                    {!state.linkedA && (
                      <div>
                        <Input
                          list="instListA"
                          placeholder="Choose bank for A…"
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
                      </div>
                    )}
                    {state.mode === 'joint' && !state.linkedB && (
                      <div>
                        <Input
                          list="instListB"
                          placeholder="Choose bank for B…"
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
                      </div>
                    )}
                  </div>
                )}

                {/* No explicit Continue CTA here; users proceed to bills below */}

              </div>
              {/* Inline wages cards removed per request; bottom sheet remains primary */}
                {!useMock && (
                  <p className="text-xs text-muted mt-2">
                    You’ll authenticate with your bank in a new tab. Return here when finished.
                  </p>
                )}
              {/* Removed transaction counts for A/B */}

              {/* Inline wages cards appear in place of link boxes after linking */}

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
                              {' '}• Next Deposit date: {(() => {
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
                    <div className="hidden"></div>

                    <div className="space-y-3">
                      <p className="text-sm font-medium">Include in forecast</p>
                      
                      {(() => {
                        const rows = state.bills
                          .filter(b => (b as any).source === 'detected' || String(b.id || '').startsWith('det-'))
                          .map(b => {
                            const meta = (recurringMeta as any)[b.id!];
                            const dayOfWeek = meta?.dayOfWeek as number | undefined;
                            const dueDay = meta?.dueDay as number | undefined;
                            const freq = meta?.freq ? String(meta.freq).toLowerCase() : undefined;
                            return ({
                              id: b.id!,
                              dateISO: (b as any).dueDate || (b as any).dueDateISO || (b.issueDate as any) || new Date().toISOString().slice(0,10),
                              description: b.name,
                              amount: b.amount,
                              owner: ((b as any).owner ?? (String(b.id).startsWith('det-b') ? 'B' : 'A')) as 'A'|'B'|'JOINT',
                              freq,
                              dueDay,
                              dayOfWeek,
                            });
                          });
                        return (
                          <BillsList
                            rows={rows}
                            initialSelected={new Set(state.includedBillIds)}
                            onChangeSelected={(ids)=> setState(prev => ({ ...prev, includedBillIds: ids }))}
                            onRename={(id, name)=> setState(prev => ({ ...prev, bills: prev.bills.map(b => b.id===id ? { ...b, name } : b) }))}
                            onAmount={(id, amount)=> setState(prev => ({ ...prev, bills: prev.bills.map(b => b.id===id ? { ...b, amount } : b) }))}
                            onEditRow={(id, patch)=> setState(prev => ({
                              ...prev,
                              bills: prev.bills.map(b => b.id===id ? { ...b, ...(patch.name !== undefined ? { name: patch.name } : {}), ...(typeof patch.amount === 'number' ? { amount: patch.amount } : {}) } : b)
                            }))}
                            groupBy={billGroupBy}
                            onChangeGroupBy={(g)=> setBillGroupBy(g)}
                          />
                        );
                      })()}
                      <div className="rounded-md border overflow-hidden hidden">
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
                <TableCell className="text-sm">{formatDate(b.dueDate)}</TableCell>
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

                    {/* New virtualized list-driven CTA */}
                    <div className="h-20" />
                    <div className="sticky bottom-0 inset-x-0">
                      <div className="safe-area-bottom bg-background/95 backdrop-blur border-t shadow-md px-4 py-3">
                        {(() => {
                          const rows = state.bills
                            .filter(b => (b as any).source === 'detected' || String(b.id || '').startsWith('det-'))
                            .map(b => b.id);
                          const count = state.includedBillIds.filter(id => rows.includes(id)).length;
                          return (
                            <Button className="w-full" onClick={() => setState(prev => ({ ...prev, step: 'energy' }))}>
                              Continue ({count} selected)
                            </Button>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        )}

        {state.step === 'energy' && (
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="rounded-md border p-4">
              <p className="text-sm font-medium mb-2">Electricity forecast</p>
              <p className="text-xs text-muted-foreground mb-3">We use your smart‑meter data (usage) and a recent bill (rates) to predict your electricity costs.</p>
              <div className="flex flex-wrap gap-4 text-sm">
                {([
                  { key: 'csv', label: 'Smart-meter CSV + last bill' },
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
              <div className="mt-4">
                <ElectricityUpload
                  onDone={({ readings, tariff }) => setState(prev => ({ ...prev, electricityReadings: readings as any, tariffRates: tariff || prev.tariffRates }))}
                  onBusyChange={(busy)=> setState(prev => ({ ...prev, isLoading: busy }))}
                />
              </div>
            </div>

            <div className="h-20" />
            <div className="sticky bottom-0 inset-x-0">
              <div className="safe-area-bottom bg-background/95 backdrop-blur border-t shadow-md px-4 py-3">
                {(() => {
                  const ready = (state.electricityReadings.length > 0) && !!state.tariffRates;
                  const busy = !!state.isLoading;
                  return (
                    <Button className="w-full" disabled={busy || !ready} onClick={() => setState(prev => ({ ...prev, step: 'forecast' }))}>
                      {busy ? 'Processing electricity data…' : (ready ? 'Continue to Forecast' : 'Upload CSV + bill to continue')}
                    </Button>
                  );
                })()}
              </div>
            </div>
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
              {(() => {
                const todayISO = new Date().toISOString().slice(0,10);
                const endISO = addMonthsClampISO(todayISO, 1);
                // Prefer worker/store entries for precise upcoming items
                const storeEntries = (usePlanStore.getState().result as any)?.entries as Array<{ dateISO?: string; date?: string; label: string; delta: number }> | undefined;
                let upcoming: Array<{ dateISO: string; name: string; amount: number }> = [];
                if (storeEntries && storeEntries.length) {
                  upcoming = storeEntries
                    .map(e => ({ dateISO: (e.dateISO || e.date || '').slice(0,10), name: e.label, amount: Math.abs(e.delta), delta: e.delta }))
                    .filter(e => e.dateISO && e.dateISO >= todayISO && e.dateISO <= endISO && e.delta < 0)
                    .sort((a,b)=>a.dateISO.localeCompare(b.dateISO))
                    .slice(0,10)
                    .map(e => ({ dateISO: e.dateISO, name: e.name || 'Bill', amount: e.amount }));
                }
                if (!upcoming.length || upcoming.length < 2) {
                  // Fallback to bills if store entries not available
                  const isIncluded = (b: Bill) => b.source === 'predicted-electricity' || state.includedBillIds.includes(b.id!);
                  const nextDueForMonthly = (dueDay?: number): string | null => {
                    if (!dueDay) return null;
                    const [y,m] = todayISO.split('-').map(Number);
                    const lastDayThisMonth = new Date(y, m, 0).getDate();
                    const day = Math.min(dueDay, lastDayThisMonth);
                    const thisMonth = `${y}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
                    if (thisMonth >= todayISO) return thisMonth;
                    return addMonthsClampISO(thisMonth, 1);
                  };
                  const nextDueForWeeklyLike = (anchorISO?: string, stepDays: number = 7, dayOfWeek?: number): string | null => {
                    if (typeof dayOfWeek === 'number') {
                      const d = new Date(todayISO + 'T00:00:00');
                      while (d.getUTCDay() !== dayOfWeek) d.setUTCDate(d.getUTCDate() + 1);
                      const iso = d.toISOString().slice(0,10);
                      return iso <= endISO ? iso : null;
                    }
                    if (!anchorISO) return null;
                    let cur = anchorISO;
                    while (cur < todayISO) cur = addDaysISO(cur, stepDays);
                    return cur <= endISO ? cur : null;
                  };
                  upcoming = (state.bills || [])
                    .filter(b => isIncluded(b))
                    .map(b => {
                      const any: any = b as any;
                      let dueISO: string | null = (b.dueDate || any.dueDateISO) || null;
                      if (!dueISO) dueISO = nextDueForMonthly(any.dueDay);
                      if (!dueISO && typeof any.dayOfWeek === 'number') dueISO = nextDueForWeeklyLike(undefined, 7, any.dayOfWeek);
                      if (!dueISO && any.issueDate) dueISO = nextDueForWeeklyLike(any.issueDate, 14);
                      return dueISO ? { dateISO: dueISO, name: b.name, amount: b.amount } : null;
                    })
                    .filter(Boolean)
                    .map(x => x as { dateISO: string; name: string; amount: number })
                    .filter(u => u.dateISO >= todayISO && u.dateISO <= endISO)
                    .sort((a,b)=>a.dateISO.localeCompare(b.dateISO))
                    .slice(0,10);
                }
                // Last-resort: roll-forward past bills to compute next occurrences
                if (!upcoming.length || upcoming.length < 2) {
                  try {
                    const rolled = rollForwardPastBills(
                      (state.bills || []).map(b => ({
                        id: b.id || '',
                        name: b.name,
                        amount: b.amount,
                        issueDate: (b.issueDate || (b as any).dueDateISO || b.dueDate || todayISO) as string,
                        dueDate: (b.dueDate || (b as any).dueDateISO || todayISO) as string,
                        source: (b.source === 'predicted-electricity' ? 'predicted-electricity' : b.source) as any,
                        movable: b.movable,
                      })),
                      todayISO
                    ).filter(b => !b.dueDate || (b.dueDate >= todayISO && b.dueDate <= endISO));
                    const includedIds = new Set(state.includedBillIds);
                    const rolledUpcoming = rolled
                      .filter(b => b.source === 'predicted-electricity' || includedIds.has(b.id))
                      .map(b => ({ dateISO: (b.dueDate || b.issueDate) as string, name: b.name, amount: b.amount }))
                      .sort((a,b)=>a.dateISO.localeCompare(b.dateISO))
                      .slice(0,10);
                    if (rolledUpcoming.length) upcoming = rolledUpcoming;
                  } catch {}
                }
                return (
                  <ForecastForm
                    mode={state.mode}
                    weeklyA={state.weeklyAllowanceA}
                    weeklyB={state.mode==='joint' ? state.weeklyAllowanceB : undefined}
                    availableA={budgetPreview.availableA}
                    availableB={budgetPreview.availableB}
                    pots={state.pots}
                    onChangeAllowance={(a,b)=> { setState(prev=>({ ...prev, weeklyAllowanceA: a, weeklyAllowanceB: typeof b==='number'? b : prev.weeklyAllowanceB })); try { saveJourney({ step: 'forecast-allowances', weeklyAllowanceA: a, weeklyAllowanceB: b }).catch(()=>{}); } catch {} }}
                    onAddPot={(name, monthly, owner, target)=> { handleAddPot(name, monthly, owner, target); try { saveJourney({ step: 'forecast-pots', action: 'add', pot: { name, monthly, owner, target } }).catch(()=>{}); } catch {} }}
                    onUpdatePot={(id, patch)=> { setState(prev => ({ ...prev, pots: prev.pots.map(p => p.id === id ? { ...p, ...patch } : p) })); try { saveJourney({ step: 'forecast-pots', action: 'update', id, patch }).catch(()=>{}); } catch {} }}
                    onRemovePot={(id)=> { setState(prev => ({ ...prev, pots: prev.pots.filter(p => p.id !== id) })); try { saveJourney({ step: 'forecast-pots', action: 'remove', id }).catch(()=>{}); } catch {} }}
                    upcoming={upcoming}
                  />
                );
              })()}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <p className="text-sm font-medium">Predicted Electricity Bills</p>
                  <Badge variant="secondary">
                    {state.bills.filter(b => b.source === 'predicted-electricity').length} over next year
                  </Badge>
                </div>
              </div>

              <Card className="mb-4 hidden">
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

              <Card className="mb-4 hidden">
                <CardContent>
                  <h4 className="text-sm font-medium mb-2">Savings Pots</h4>
                  {state.mode === 'joint' ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-2">
                      <div className="flex flex-wrap gap-2 items-end">
                        <Input placeholder="A Pot name" value={newPotNameA} onChange={e => setNewPotNameA(e.target.value)} />
                        <Input type="number" placeholder="Monthly amount" className="w-32" value={newPotAmountA} onChange={e => setNewPotAmountA(parseFloat(e.target.value) || 0)} />
                        <Input type="number" placeholder="Target (optional)" className="w-36" value={newPotTargetA}
                          onChange={e => setNewPotTargetA(e.target.value === '' ? '' : (parseFloat(e.target.value) || 0))} />
                        <Button onClick={() => { handleAddPot(newPotNameA, newPotAmountA, 'A', typeof newPotTargetA === 'number' ? newPotTargetA : undefined); setNewPotNameA(''); setNewPotAmountA(0); setNewPotTargetA(''); }}>Add</Button>
                      </div>
                      <div className="flex flex-wrap gap-2 items-end">
                        <Input placeholder="B Pot name" value={newPotNameB} onChange={e => setNewPotNameB(e.target.value)} />
                        <Input type="number" placeholder="Monthly amount" className="w-32" value={newPotAmountB} onChange={e => setNewPotAmountB(parseFloat(e.target.value) || 0)} />
                        <Input type="number" placeholder="Target (optional)" className="w-36" value={newPotTargetB}
                          onChange={e => setNewPotTargetB(e.target.value === '' ? '' : (parseFloat(e.target.value) || 0))} />
                        <Button onClick={() => { handleAddPot(newPotNameB, newPotAmountB, 'B', typeof newPotTargetB === 'number' ? newPotTargetB : undefined); setNewPotNameB(''); setNewPotAmountB(0); setNewPotTargetB(''); }}>Add</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2 items-end mb-2">
                      <Input placeholder="Pot name" value={newPotName} onChange={e => setNewPotName(e.target.value)} />
                      <Input type="number" placeholder="Monthly amount" className="w-32" value={newPotAmount} onChange={e => setNewPotAmount(parseFloat(e.target.value) || 0)} />
                      <Input type="number" placeholder="Target (optional)" className="w-36" value={newPotTarget}
                        onChange={e => setNewPotTarget(e.target.value === '' ? '' : (parseFloat(e.target.value) || 0))} />
                      <Button onClick={() => { handleAddPot(newPotName, newPotAmount, 'A', typeof newPotTarget === 'number' ? newPotTarget : undefined); setNewPotName(''); setNewPotAmount(0); setNewPotTarget(''); }}>Add</Button>
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
            <TableCell>{formatDate(b.dueDate)}</TableCell>
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
            {(() => {
              const aPerPay = state.forecastResult!.depositA || 0;
              const aPerMonth = aPerPay * cyclesPerMonth(state.userA.paySchedule?.frequency);
              const bPerPay = typeof state.forecastResult!.depositB === 'number' ? (state.forecastResult!.depositB || 0) : undefined;
              const bPerMonth = bPerPay && state.userB?.paySchedule ? bPerPay * cyclesPerMonth(state.userB.paySchedule.frequency) : undefined;
              const minBal = state.forecastResult!.minBalance;
              const t = [...state.forecastResult!.timeline].sort((a,b)=>a.date.localeCompare(b.date));
              const minEntry = t.find(x => Math.abs(x.balance - minBal) < 0.01) || t[0];
              return (
                <ResultsHero
                  aPerPay={aPerPay}
                  aPerMonth={aPerMonth}
                  aStart={(usePlanStore.getState().result as any)?.startISO || t[0]?.date || new Date().toISOString().slice(0,10)}
                  bPerPay={bPerPay}
                  bPerMonth={bPerMonth}
                  bStart={(usePlanStore.getState().result as any)?.startISO || t[0]?.date || new Date().toISOString().slice(0,10)}
                  fairness={inputs?.fairnessRatio as any}
                  minBalance={minBal}
                  minDate={minEntry?.date || new Date().toISOString().slice(0,10)}
                  startISO={(usePlanStore.getState().result as any)?.startISO}
                />
              );
            })()}
            <Card className="deposit-highlight hidden">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PiggyBank className="w-6 h-6" />
                  Optimized Deposit{state.mode === 'joint' ? 's' : ''}
                </CardTitle>
                <CardDescription className="text-foreground">
                  These amounts are calculated using advanced optimization to minimize deposits while maintaining positive balance.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <p className="text-sm font-medium">
                      {state.mode === 'joint' ? 'Person A' : 'Your'} Deposit
                    </p>
                    <p className="text-3xl font-bold text-foreground">
                      {formatCurrency(state.forecastResult.depositA)}
                    </p>
                    <p className="text-sm text-foreground">per pay period</p>
                    <p className="text-xs text-foreground">
                      ≈ {formatCurrency((state.forecastResult.depositA || 0) * cyclesPerMonth(state.userA.paySchedule?.frequency))} per month
                    </p>
                  </div>

                  {state.mode === 'joint' && typeof state.forecastResult.depositB === 'number' && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Person B Deposit</p>
                      <p className="text-3xl font-bold text-foreground">
                        {formatCurrency(state.forecastResult.depositB)}
                      </p>
                      <p className="text-sm text-foreground">per pay period</p>
                      <p className="text-xs text-foreground">
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
                      {(() => {
                        // Find the first timeline entry where balance equals minBalance (±0.01)
                        try {
                          const tl: any[] = state.forecastResult.timeline || [];
                          const m = state.forecastResult.minBalance ?? 0;
                          const match = tl.find(t => Math.abs((t.balance ?? 0) - m) < 0.01);
                          const iso = match?.dateISO || match?.date;
                          return iso ? ` on ${iso}` : '';
                        } catch { return ''; }
                      })()}
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
                      <p className="text-xs text-foreground">
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
              const toISODateLocal = (d: Date) => {
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                return `${y}-${m}-${day}`;
              };
              const getBalanceForDate = (d: Date) => {
                const iso = toISODateLocal(d);
                let bal = timeline[0]?.balance ?? 0;
                for (const t of timeline) {
                  if (t.date <= iso) bal = t.balance; else break;
                }
                return bal;
              };

              const CustomDayContent = (props: any) => {
                const date: Date = props.date;
                const iso = toISODateLocal(date);
                const hasEvents = eventsByDate.has(iso);
                const bal = getBalanceForDate(date);
                const isNeg = bal < 0;
                return (
                  <div className="flex flex-col items-center justify-center">
                    <span className="leading-none">{date.getDate()}</span>
                    <span className={`text-[10px] leading-none ${isNeg ? 'text-destructive' : 'text-muted-foreground'}`}>
                      €{Math.round(bal)}
                    </span>
                    {hasEvents && <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />}
                  </div>
                );
              };

              const allEventDates = Array.from(eventsByDate.keys()).sort();
              const selectedDate = state.selectedDate ?? allEventDates[0] ?? null;
              const handleSelect = (d?: Date) => {
                const iso = d ? toISODateLocal(d) : null;
                setState(prev => ({ ...prev, selectedDate: iso }));
              };
              const selectedEvents = selectedDate ? (eventsByDate.get(selectedDate) || []) : [];

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
                        defaultMonth={selectedDate ? new Date(selectedDate + 'T00:00:00') : (allEventDates[0] ? new Date(allEventDates[0] + 'T00:00:00') : new Date())}
                        selected={selectedDate ? new Date(selectedDate + 'T00:00:00') : undefined}
                         onSelect={handleSelect as any}
                         components={{ DayContent: CustomDayContent }}
                       />
                    </div>
                    <div className="rounded-md border p-4 space-y-4">
                      <Tabs defaultValue="transactions" className="w-full">
                        <TabsList className="mb-2">
                          <TabsTrigger value="transactions">Transactions</TabsTrigger>
                          <TabsTrigger value="savings">Savings</TabsTrigger>
                        </TabsList>
                        <TabsContent value="transactions" className="space-y-4">
                          <div>
                            <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium">{selectedDate ? `Transactions on ${formatDate(selectedDate)}` : 'Transactions'}</p>
                              <Button size="sm" onClick={() => setBillDialogOpen(true)} disabled={!selectedDate}>Add New Bill</Button>
                            </div>
                            {selectedDate ? (
                              selectedEvents.length ? (
                                <ul className="list-disc pl-5 space-y-2">
                                  {selectedEvents.map((e, i) => {
                                    const sumAB = (s: string): number | null => {
                                      let total = 0;
                                      let found = false;
                                      const re = /(?:^|[,(])\s*(A|B)\s*:\s*€?\s*([0-9]+(?:[.,][0-9]{1,2})?)/gi;
                                      let m: RegExpExecArray | null;
                                      while ((m = re.exec(s)) !== null) {
                                        const n = parseFloat((m[2] || '').replace(',', '.'));
                                        if (!Number.isNaN(n)) { total += n; found = true; }
                                      }
                                      return found ? total : null;
                                    };

                                    const cleaned = e
                                      .replace(/\s*\((?=[^)]*(?:A\s*:|B\s*:))[^)]*\)/g, (match) => {
                                        const total = sumAB(match);
                                        return total != null ? ` (€${total.toFixed(2)})` : '';
                                      })
                                      .replace(/\s{2,}/g, ' ')
                                      .trim();

                                    return <li key={i}>{cleaned}</li>;
                                  })}
                                </ul>
                              ) : (
          <p className="text-sm text-muted-foreground">No transactions on {formatDate(selectedDate)}.</p>
                              )
                            ) : (
                              <p className="text-sm text-muted-foreground">Pick a date to view transactions.</p>
                            )}
                          </div>
                        </TabsContent>
                        <TabsContent value="savings">
                          {(() => {
                            const startISO = (usePlanStore.getState().result as any)?.startISO || timeline[0]?.date || selectedDate;
                            const toISO = (d: Date) => {
                              const y = d.getFullYear();
                              const m = String(d.getMonth() + 1).padStart(2, '0');
                              const day = String(d.getDate()).padStart(2, '0');
                              return `${y}-${m}-${day}`;
                            };
                            const parseISO = (s: string) => new Date(s + 'T00:00:00');
                            const monthsBetween = (aISO: string, bISO: string) => {
                              const a = parseISO(aISO); const b = parseISO(bISO);
                              return (b.getFullYear()-a.getFullYear())*12 + (b.getMonth()-a.getMonth());
                            };
                            const daysInMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
                            const selected = selectedDate ? parseISO(selectedDate) : (timeline[0] ? parseISO(timeline[0].date) : new Date());

                            // Compute pot balance approximation
                            const balanceForPot = (p: SavingsPot): number => {
                              const months = Math.max(0, monthsBetween(startISO, toISO(selected)));
                              const frac = (selected.getDate()) / daysInMonth(selected);
                              return (p.monthly * months) + (p.monthly * frac);
                            };

                            const prelimRatioA = (() => {
                              const monthsToMonthly = (ps?: PaySchedule) => {
                                if (!ps || !ps.averageAmount) return 0; switch(ps.frequency){
                                  case 'WEEKLY': return (ps.averageAmount*52)/12;
                                  case 'FORTNIGHTLY':
                                  case 'BIWEEKLY': return (ps.averageAmount*26)/12;
                                  case 'FOUR_WEEKLY': return (ps.averageAmount*13)/12; default: return ps.averageAmount;
                                }
                              };
                              const mA = monthsToMonthly(state.userA.paySchedule);
                              const mB = state.userB?.paySchedule ? monthsToMonthly(state.userB?.paySchedule) : 0;
                              const total = mA + mB; return total > 0 ? (mA/total) : 0.5;
                            })();

                            const pots = state.pots || [];
                            const potSlices = pots.map((p, idx) => ({
                              name: p.name,
                              value: Math.max(0, balanceForPot(p)),
                              id: p.id,
                              owner: p.owner,
                              target: p.target
                            })).filter(d => d.value > 0.01);
                            const totalPot = potSlices.reduce((s,d)=>s+d.value,0) || 1;
                            const abTotals = potSlices.reduce((acc, s) => {
                              const aShare = s.owner === 'A' ? s.value : (s.owner === 'B' ? 0 : s.value * prelimRatioA);
                              const bShare = s.owner === 'B' ? s.value : (s.owner === 'A' ? 0 : s.value * (1-prelimRatioA));
                              acc.a += aShare; acc.b += bShare; return acc;
                            }, { a: 0, b: 0 });

                            const AMBER_TINTS = [
                              'hsl(43 96% 40%)','hsl(43 96% 45%)','hsl(43 96% 50%)','hsl(43 96% 55%)','hsl(43 96% 60%)','hsl(43 96% 65%)'
                            ];
                            const colorForIndex = (i: number) => AMBER_TINTS[i % AMBER_TINTS.length];

                            // Build months scrubber
                            const uniqueMonths = Array.from(new Set(timeline.map(t => t.date.slice(0,7))));
                            const monthIndex = uniqueMonths.findIndex(m => (selectedDate||'').startsWith(m));
                            const setMonthByIndex = (i: number) => {
                              const m = uniqueMonths[i] || uniqueMonths[0]; if (!m) return; const day = String(Math.min(15, new Date(m+'-01').getDate())).padStart(2,'0');
                              setState(prev => ({ ...prev, selectedDate: `${m}-${day}` }));
                            };

                            const customTooltip = ({ active, payload }: any) => {
                              if (!active || !payload || !payload.length) return null;
                              const p = payload[0];
                              const percent = p.percent != null ? (p.percent*100).toFixed(0)+'%' : ((p.value/totalPot)*100).toFixed(0)+'%';
                              const item = p.payload;
                              const aShare = item.owner === 'A' ? item.value : (item.owner === 'B' ? 0 : item.value * prelimRatioA);
                              const bShare = item.owner === 'B' ? item.value : (item.owner === 'A' ? 0 : item.value * (1-prelimRatioA));
                              const lastMonthVal = Math.max(0, item.value - (pots.find(q=>q.id===item.id)?.monthly || 0));
                              const delta = item.value - lastMonthVal;
                              const pctTarget = item.target ? Math.min(100, Math.round((item.value / item.target)*100)) : undefined;
                              return (
                                <div className="text-xs p-2 rounded border bg-card">
                                  <div className="font-medium">{item.name}</div>
                                  <div>Balance: <strong>{formatCurrency(item.value)}</strong> ({percent})</div>
                                  <div>A/B: {formatCurrency(aShare)} / {formatCurrency(bShare)}</div>
                                  {pctTarget != null && <div>% of target: <strong>{pctTarget}%</strong></div>}
                                  <div>Δ vs last month: {formatCurrency(delta)}</div>
                                </div>
                              );
                            };

                            const sparkFor = (p: SavingsPot) => {
                              const days = 60; const now = selected; const rows: { d: string; v: number }[] = [];
                              for (let i = days - 1; i >= 0; i--) {
                                const t = new Date(now); t.setDate(t.getDate() - i);
                                const monthStartISO = toISO(new Date(t.getFullYear(), t.getMonth(), 1));
                                const months = Math.max(0, monthsBetween(startISO, monthStartISO));
                                const frac = t.getDate() / daysInMonth(t);
                                const v = (p.monthly * months) + (p.monthly * frac);
                                rows.push({ d: toISO(t), v });
                              }
                              return rows;
                            };

                            const nextDepositFor = (p: SavingsPot) => {
                              const ownerPs = p.owner==='A' ? state.userA.paySchedule : state.userB?.paySchedule;
                              if (!ownerPs) return null; const months = 12; const dates = calculatePayDates(ownerPs.frequency, ownerPs.anchorDate, months);
                              const next = dates.find(d => d >= toISO(selected));
                              const cycles = ownerPs.frequency==='WEEKLY'?52/12: (ownerPs.frequency==='FORTNIGHTLY'||ownerPs.frequency==='BIWEEKLY'?26/12: ownerPs.frequency==='FOUR_WEEKLY'?13/12:1);
                              const perPay = p.monthly / cycles; return { date: next, perPay };
                            };

                            return (
                              <div>
                                <div className="h-64 relative">
                                  <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                      <Pie data={potSlices} dataKey="value" nameKey="name" innerRadius={60} outerRadius={90} labelLine={false}>
                                        {potSlices.map((entry, i) => (<Cell key={`ps-${i}`} fill={colorForIndex(i)} />))}
                                      </Pie>
                                      {/* Inner ring A vs B */}
                                      <Pie data={[{name:'A', value: abTotals.a},{name:'B', value: abTotals.b}]} dataKey="value" nameKey="name" innerRadius={45} outerRadius={55} labelLine={false}>
                                        <Cell fill="hsl(var(--accent))" />
                                        <Cell fill="hsl(var(--primary))" />
                                      </Pie>
                                      <Tooltip content={customTooltip} />
                                    </PieChart>
                                  </ResponsiveContainer>
                                </div>
                                {/* Month scrubber */}
                                <div className="mt-2 flex items-center gap-3">
                                  <input type="range" min={0} max={Math.max(0, uniqueMonths.length-1)} value={Math.max(0, monthIndex)} onChange={(e)=>setMonthByIndex(parseInt((e.target as any).value))} className="w-full" />
                                  <span className="text-xs text-muted-foreground">{(selectedDate||'').slice(0,7)}</span>
                                </div>
                                {/* Pot list summary */}
                                <div className="mt-3 space-y-2">
                                  {(state.pots || []).map((p) => {
                                    const bal = Math.max(0, balanceForPot(p));
                                    const n = nextDepositFor(p);
                                    const tgtPct = p.target ? Math.min(100, Math.round((bal / p.target)*100)) : undefined;
                                    return (
                                      <div key={p.id} className="flex items-center justify-between gap-3 border rounded p-2">
                                        <div className="min-w-0">
                                          <div className="text-sm truncate">{p.name}</div>
                                          <div className="text-xs text-muted-foreground">{formatCurrency(bal)}{tgtPct!=null && ` • ${tgtPct}% of target`}</div>
                                        </div>
                                        <div className="hidden sm:flex items-center w-32 h-10">
                                          <ResponsiveContainer width={120} height={36}>
                                            <LineChart data={sparkFor(p)} margin={{ left: 0, right: 0, top: 8, bottom: 0 }}>
                                              <Line type="monotone" dataKey="v" stroke="hsl(var(--warning))" strokeWidth={2} dot={false} />
                                            </LineChart>
                                          </ResponsiveContainer>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          {p.target != null && <Badge variant="secondary">Target {formatCurrency(p.target)}</Badge>}
                                          {n?.date && <Badge variant="secondary">Next {formatCurrency(n.perPay)} on {n.date}</Badge>}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })()}
                        </TabsContent>
                      </Tabs>
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

            {/* Cash Flow Summary (Per Person) */}
            {(() => {
              // Helper: cycles per month for a PaySchedule frequency
              const cyclesPerMonthLocal = (freq?: PaySchedule["frequency"]) => {
                switch (freq) {
                  case 'WEEKLY': return 52 / 12;
                  case 'FORTNIGHTLY':
                  case 'BIWEEKLY': return 26 / 12;
                  case 'FOUR_WEEKLY': return 13 / 12;
                  case 'MONTHLY':
                  default: return 1;
                }
              };

              // Pull frozen monthly incomes and deposits if available
              const frozen = (usePlanStore.getState().result as any)?.frozenBudget as
                | { monthlyIncomeA: number; monthlyIncomeB: number; monthlyDepositA: number; monthlyDepositB: number }
                | undefined;

              const monthlyIncomeA = (
                state.userA.paySchedule?.averageAmount ? state.userA.paySchedule.averageAmount * cyclesPerMonthLocal(state.userA.paySchedule.frequency) : 0
              );
              const monthlyIncomeB = state.mode === 'joint'
                ? (state.userB?.paySchedule?.averageAmount ? (state.userB.paySchedule.averageAmount * cyclesPerMonthLocal(state.userB.paySchedule.frequency)) : 0)
                : 0;

              // Prefer the final Results deposits; fall back to frozen only if not available
              const monthlyDepositA = ((state.forecastResult?.depositA || 0) * cyclesPerMonthLocal(state.userA.paySchedule?.frequency))
                || (frozen?.monthlyDepositA ?? 0);
              const monthlyDepositB = state.mode === 'joint' ? (
                ((state.forecastResult?.depositB || 0) * cyclesPerMonthLocal(state.userB?.paySchedule?.frequency))
                || (frozen?.monthlyDepositB ?? 0)
              ) : 0;

              const allowanceMonthlyA = (state.weeklyAllowanceA ?? 0) * 52 / 12;
              const allowanceMonthlyB = (state.weeklyAllowanceB ?? 0) * 52 / 12;

              const potsA = (state.pots || []).filter(p => p.owner === 'A');
              const potsB = (state.pots || []).filter(p => p.owner === 'B');
              const potsJ = (state.pots || []).filter(p => p.owner === 'JOINT');
              const sumA = potsA.reduce((s, p) => s + p.monthly, 0);
              const sumB = potsB.reduce((s, p) => s + p.monthly, 0);
              const sumJ = potsJ.reduce((s, p) => s + p.monthly, 0);

              // Split joint pots by income share (same as elsewhere)
              const totalIncome = (monthlyIncomeA || 0) + (monthlyIncomeB || 0);
              const prelimRatioA = totalIncome > 0 ? (monthlyIncomeA / totalIncome) : 0.5;
              const jointShareA = sumJ * prelimRatioA;
              const jointShareB = sumJ * (1 - prelimRatioA);

              const savingsMonthlyA = sumA + jointShareA;
              const savingsMonthlyB = sumB + jointShareB;

              const leftoverA = Math.max(0, (monthlyIncomeA || 0) - allowanceMonthlyA - monthlyDepositA - savingsMonthlyA);
              const leftoverB = Math.max(0, (monthlyIncomeB || 0) - (state.mode === 'joint' ? (allowanceMonthlyB + monthlyDepositB) : 0) - savingsMonthlyB);

              // Pie data builders
              const makePieData = (labelPrefix: 'A' | 'B') => {
                const isA = labelPrefix === 'A';
                const data = [
                  { name: 'Bills deposit', value: isA ? monthlyDepositA : monthlyDepositB, key: 'deposit' },
                  { name: 'Weekly allowance', value: isA ? allowanceMonthlyA : allowanceMonthlyB, key: 'allowance' },
                  { name: 'Savings pots', value: isA ? savingsMonthlyA : savingsMonthlyB, key: 'savings' },
                  { name: 'Leftover', value: isA ? leftoverA : leftoverB, key: 'leftover' }
                ].filter(d => d.value > 0.01);
                return data;
              };

              const COLORS: Record<string, string> = {
                deposit: 'hsl(var(--chart-deposit))',
                allowance: 'hsl(270 80% 70%)',
                savings: 'hsl(var(--warning))',
                leftover: 'hsl(var(--success))'
              };

              // No slice labels: show details only on hover
              const renderCustomizedLabel = undefined as unknown as any;

              const LegendFmt = (value: any) => <span className="text-sm">{value}</span>;
              const fairnessRatioA = (monthlyDepositA + monthlyDepositB) > 0 ? (monthlyDepositA / (monthlyDepositA + monthlyDepositB)) : 1;
              const fmt = (n: number) => formatCurrency(+n.toFixed(2));

              return (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <TrendingUp className="w-5 h-5" />
                      Cash Flow Summary
                    </CardTitle>
                    <CardDescription>
                      Where each person’s money goes per month. Split is based on income after allowances and savings.
                    </CardDescription>
                    {state.mode === 'joint' && (
                      <div className="mt-2">
                        <div className="inline-flex rounded-md border p-1">
                          <button
                            className={`px-3 py-1 rounded ${summaryView==='household' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
                            onClick={() => setSummaryView('household')}
                          >Household</button>
                          <button
                            className={`px-3 py-1 rounded ${summaryView==='person' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
                            onClick={() => setSummaryView('person')}
                          >Per-person</button>
                        </div>
                      </div>
                    )}
                  </CardHeader>
                  <CardContent>
                    {/* Household view (joint mode) */}
                    {state.mode === 'joint' && summaryView === 'household' ? (
                      (() => {
                        const combinedIncome = (monthlyIncomeA || 0) + (monthlyIncomeB || 0);
                        // Show average monthly bills (normalized recurring + electricity average)
                        const toMonthlyNorm = (amt: number, freq?: string) => {
                          switch ((freq || '').toLowerCase()) {
                            case 'weekly': return (amt * 52) / 12;
                            case 'fortnightly': return (amt * 26) / 12;
                            case 'four_weekly': return (amt * 13) / 12;
                            case 'monthly':
                            default: return amt;
                          }
                        };
                        // Rebuild merged bills with include + edit overrides and compute 12‑mo monthly avg
                        const detectedState: any = usePlanStore.getState().detected || {};
                        const elecPred = (state.bills || []).filter(b => b.source === 'predicted-electricity');
                        const elecMonthly = elecPred.reduce((s, b) => s + (Number(b.amount) || 0), 0) / 12;
                        // Determine a stable start for horizon (prefer worker’s start)
                        const startISO = (usePlanStore.getState().result as any)?.startISO || (() => {
                          try {
                            const manual = (state.bills || []).filter(b => b.source === 'manual');
                            const firstAnchor = state.userB?.paySchedule
                              ? (state.userA.paySchedule!.anchorDate < state.userB.paySchedule!.anchorDate ? state.userA.paySchedule!.anchorDate : state.userB.paySchedule!.anchorDate)
                              : state.userA.paySchedule!.anchorDate;
                            const allBillsProvisional = rollForwardPastBills([...manual, ...elecPred].map(b => ({
                              id: b.id || '', name: b.name, amount: b.amount,
                              issueDate: b.issueDate || (b as any).dueDateISO || b.dueDate || firstAnchor,
                              dueDate: b.dueDate || (b as any).dueDateISO || firstAnchor,
                              source: (b.source === 'predicted-electricity' ? 'predicted-electricity' : b.source) as any,
                              movable: b.movable
                            })), firstAnchor);
                            const startDateA = getStartDate(state.userA.paySchedule!, allBillsProvisional);
                            const startDateB = (state.mode === 'joint' && state.userB?.paySchedule) ? getStartDate(state.userB.paySchedule!, allBillsProvisional) : '';
                            return startDateB && startDateA > startDateB ? startDateB : startDateA;
                          } catch { return new Date().toISOString().slice(0,10); }
                        })();
                        // Expand recurring from store
                        let importedA = expandRecurring(detectedState.recurring || [], startISO, 12, 'imp-a-');
                        let importedB = expandRecurring(detectedState.recurringB || [], startISO, 12, 'imp-b-');
                        // Apply include + edits captured on detected series from Bank screen
                        try {
                          const detectedSeries = (state.bills || []).filter(b => (b as any).source === 'detected');
                          const includeA = new Set<string>();
                          const includeB = new Set<string>();
                          const editsA = new Map<string, { name: string; amount: number }>();
                          const editsB = new Map<string, { name: string; amount: number }>();
                          for (const b of detectedSeries) {
                            const owner = (b as any).owner as 'A'|'B'|'JOINT'|undefined;
                            const key = (b as any).seriesKey || `${owner || 'A'}::${b.name}`;
                            const included = (state.includedBillIds || []).includes(b.id!);
                            const patch = { name: b.name, amount: b.amount };
                            if (owner === 'B') { editsB.set(key, patch); if (included) includeB.add(key); }
                            else { editsA.set(key, patch); if (included) includeA.add(key); }
                          }
                          const hasA = editsA.size > 0; const hasB = editsB.size > 0;
                          importedA = importedA
                            .filter(b => (!hasA || includeA.size === 0) ? true : includeA.has((b as any).seriesKey || `A::${b.name}`))
                            .map(b => { const over = editsA.get((b as any).seriesKey || `A::${b.name}`); return over ? { ...b, name: over.name, amount: over.amount } : b; });
                          importedB = importedB
                            .filter(b => (!hasB || includeB.size === 0) ? true : includeB.has((b as any).seriesKey || `B::${b.name}`))
                            .map(b => { const over = editsB.get((b as any).seriesKey || `B::${b.name}`); return over ? { ...b, name: over.name, amount: over.amount } : b; });
                        } catch {}
                        const manual = (state.bills || []).filter(b => b.source === 'manual');
                        const mergedBills = [...manual, ...importedA, ...importedB, ...elecPred];
                        const endISO = (() => { const d = new Date(startISO + 'T00:00:00'); d.setMonth(d.getMonth()+12); return d.toISOString().slice(0,10); })();
                        const rolled = rollForwardPastBills(
                          mergedBills.map(b => ({ id: b.id || '', name: b.name, amount: b.amount,
                            issueDate: b.issueDate || (b as any).dueDateISO || b.dueDate || startISO,
                            dueDate: b.dueDate || (b as any).dueDateISO || startISO,
                            source: (b.source === 'electricity' ? 'predicted-electricity' : b.source) as any,
                            movable: b.movable })), startISO)
                        .filter(b => !b.dueDate || (b.dueDate >= startISO && b.dueDate <= endISO));
                        const totalBills12mo = rolled.reduce((s,b)=> s + (Number(b.amount) || 0), 0);
                        const combinedBills = (totalBills12mo / 12);
                        const combinedAllowance = allowanceMonthlyA + allowanceMonthlyB;
                        const combinedSavings = (sumA + sumB + sumJ);
                        const combinedLeftover = Math.max(0, combinedIncome - combinedBills - combinedAllowance - combinedSavings);
                        const data = [
                          { name: 'Bills', value: combinedBills, key: 'deposit' },
                          { name: 'Weekly allowance', value: combinedAllowance, key: 'allowance' },
                          { name: 'Savings', value: combinedSavings, key: 'savings' },
                          { name: 'Leftover', value: combinedLeftover, key: 'leftover' }
                        ];
                        const COLORS: Record<string,string> = {
                          deposit: 'hsl(var(--chart-deposit))',
                          allowance: 'hsl(270 80% 70%)',
                          savings: 'hsl(var(--warning))',
                          leftover: 'hsl(var(--success))'
                        };
                        const total = data.reduce((s,d)=>s+d.value,0) || 1;
                        // Build inner split ring data: A/B for each category in order
                        const innerData = [
                          { cat: 'Bills', who: 'A', value: monthlyDepositA },
                          { cat: 'Bills', who: 'B', value: monthlyDepositB },
                          { cat: 'Weekly allowance', who: 'A', value: allowanceMonthlyA },
                          { cat: 'Weekly allowance', who: 'B', value: allowanceMonthlyB },
                          { cat: 'Savings', who: 'A', value: savingsMonthlyA },
                          { cat: 'Savings', who: 'B', value: savingsMonthlyB },
                          { cat: 'Leftover', who: 'A', value: leftoverA },
                          { cat: 'Leftover', who: 'B', value: leftoverB }
                        ];
                        // Tooltip: show only inner ring (A/B split). Suppress outer ring tooltip box.
                        const tooltip = ({ active, payload }: any) => {
                          if (!active || !payload || !payload.length) return null;
                          const p = payload[0];
                          const d: any = p.payload || {};
                          if (d && (d.who === 'A' || d.who === 'B')) {
                            const sumCat = innerData.filter(x => x.cat === d.cat).reduce((s, x) => s + x.value, 0) || 1;
                            const ratio = Math.round((d.value / sumCat) * 100) + '%';
                            return <div className="text-xs p-2 rounded border bg-card">{d.who}: <strong>{ratio}</strong></div>;
                          } else {
                            // Outer ring hover: no tooltip
                            return null;
                          }
                        };
                        const focusedName = householdFocus;
                        const selectedItem = focusedName ? data.find(d => d.name === focusedName) : undefined;
                        const selectedValue = selectedItem?.value ?? 0;
                        const selectedPct = selectedItem ? Math.round((selectedValue / total) * 100) : null;

                        return (
                          <div className="grid grid-cols-1">
                            <div ref={houseDonutRef} className="h-96 relative" onMouseLeave={() => setHouseholdFocus(null)}>
                              {houseDonutInView && (
                              <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                  <Pie
                                    data={data}
                                    dataKey="value"
                                    nameKey="name"
                                    innerRadius={120}
                                    outerRadius={160}
                                    labelLine={false}
                                    label={false}
                                    onMouseEnter={(d: any) => setHouseholdFocus(d?.name)}
                                    onMouseLeave={() => setHouseholdFocus(null)}
                                    onClick={(d: any) => setHouseholdFocus(prev => prev === d?.name ? null : d?.name)}
                                  >
                                    {data.map((d,i)=>(<Cell key={i} fill={COLORS[d.key]} />))}
                                  </Pie>
                                  {/* Inner A/B split ring with category-aligned sections */}
                                  <Pie
                                    data={innerData}
                                    dataKey="value"
                                    nameKey="cat"
                                    innerRadius={108}
                                    outerRadius={116}
                                    label={false}
                                    isAnimationActive={false}
                                    stroke="none"
                                    onMouseEnter={(d: any) => setHouseholdFocus(d?.cat)}
                                    onMouseLeave={() => setHouseholdFocus(null)}
                                    onClick={(d: any) => setHouseholdFocus(prev => prev === d?.cat ? null : d?.cat)}
                                  >
                                    {innerData.map((d, i) => {
                                      const fill = d.cat === 'Bills'
                                        ? (d.who === 'A' ? 'hsl(var(--chart-deposit))' : 'hsl(var(--chart-deposit) / 0.35)')
                                        : d.cat === 'Weekly allowance'
                                          ? (d.who === 'A' ? 'hsl(270 80% 70%)' : 'hsl(270 80% 70% / 0.35)')
                                          : d.cat === 'Savings'
                                            ? (d.who === 'A' ? 'hsl(var(--warning))' : 'hsl(var(--warning) / 0.35)')
                                            : (d.who === 'A' ? 'hsl(var(--success))' : 'hsl(var(--success) / 0.35)');
                                      return <Cell key={`inner-${i}`} fill={fill} />;
                                    })}
                                  </Pie>
                                  <Tooltip content={tooltip} />
                                </PieChart>
                              </ResponsiveContainer>
                              )}
                              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none space-y-1 text-center">
                                {focusedName && selectedItem ? (
                                  <>
                                    <div className="text-base font-semibold">{selectedItem.name}</div>
                                    <div className="text-lg font-semibold">{formatCurrency(selectedValue)}/mo</div>
                                    {selectedPct !== null && (
                                      <div className="text-xs text-muted-foreground">{selectedPct}%</div>
                                    )}
                                    {selectedItem.name === 'Bills' && (
                                      (() => {
                                        const incSum = (monthlyIncomeA || 0) + (monthlyIncomeB || 0) || 1;
                                        const incomeRatioA = Math.round(((monthlyIncomeA || 0) / incSum) * 100);
                                        return <div className="text-xs text-muted-foreground">A {incomeRatioA}% / B {100 - incomeRatioA}%</div>;
                                      })()
                                    )}
                                    {selectedItem.name === 'Weekly allowance' && (
                                      <div className="text-xs text-muted-foreground">A {formatCurrency(allowanceMonthlyA)} / B {formatCurrency(allowanceMonthlyB)}</div>
                                    )}
                                  </>
                                ) : (
                                  <>
                                    <div className="text-sm font-medium">Combined income</div>
                                    <div className="text-xl font-semibold">{formatCurrency(combinedIncome)}/mo</div>
                                    <div className="text-xs text-muted-foreground">Bills {formatCurrency(combinedBills)}/mo</div>
                                  </>
                                )}
                              </div>
                            </div>
                            {/* Compact legend chips */}
                            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                              {data.map((d) => {
                                const active = householdFocus === d.name;
                                return (
                                  <button
                                    key={d.name}
                                    type="button"
                                    className={`px-2 py-1 rounded-full border text-xs transition ${active ? 'bg-secondary' : 'bg-background'}`}
                                    onMouseEnter={() => setHouseholdFocus(d.name)}
                                    onMouseLeave={() => setHouseholdFocus(null)}
                                    onFocus={() => setHouseholdFocus(d.name)}
                                    onBlur={() => setHouseholdFocus(null)}
                                    onClick={() => setHouseholdFocus(prev => prev === d.name ? null : d.name)}
                                    aria-pressed={active}
                                  >
                                    <span className="inline-block w-2.5 h-2.5 rounded-full mr-1 align-middle" style={{ background: COLORS[d.key] }} />
                                    <span className="align-middle">{d.name}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()
                    ) : (
                    <div className={`grid gap-6 ${state.mode === 'joint' ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
                      {/* Person A */}
                      <div className="rounded-md border p-4">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-sm font-medium">{state.mode === 'joint' ? 'Person A' : 'You'}</p>
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary">Income: {fmt(monthlyIncomeA)}</Badge>
                          </div>
                        </div>
                      <div ref={personADonutRef} className="h-64">
                        {personADonutInView && (
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={makePieData('A')} dataKey="value" nameKey="name" outerRadius={90} labelLine={false} label={false}>
                              {makePieData('A').map((entry, index) => (
                                <Cell key={`cell-a-${index}`} fill={COLORS[entry.key]} />
                              ))}
                            </Pie>
                            <Tooltip formatter={(v: any, n: any) => [fmt(v as number), n as string]} />
                            <Legend verticalAlign="bottom" height={36} formatter={LegendFmt} />
                          </PieChart>
                        </ResponsiveContainer>
                        )}
                      </div>
                        <div className="mt-3 text-xs text-muted-foreground">
                          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setShowPotsA(s => !s)}>
                            {showPotsA ? 'Hide details' : 'View details'}
                          </Button>
                          {showPotsA && (
                            <div className="mt-2 space-y-2">
                              <div>
                                {(() => { const ps = state.userA.paySchedule; const freq = ps?.frequency; const perPay = (state.forecastResult?.depositA || 0); const label = freq==='WEEKLY'?'week': (freq==='FORTNIGHTLY'||freq==='BIWEEKLY'?'2 weeks': (freq==='FOUR_WEEKLY'?'4 weeks':'month')); return (
                                  <>Bills deposit: <strong>{fmt(monthlyDepositA)}/mo</strong> (<span>{formatCurrency(perPay)} per {label}</span>)</>
                                ); })()}
                              </div>
                              <div>Allowance: <strong>{fmt(allowanceMonthlyA)}/mo</strong> (<span>{formatCurrency(state.weeklyAllowanceA || 0)}/wk</span>)</div>
                              <div>
                                {(() => { const ps = state.userA.paySchedule; const freq = ps?.frequency; const label = freq==='WEEKLY'?'week': (freq==='FORTNIGHTLY'||freq==='BIWEEKLY'?'2 weeks': (freq==='FOUR_WEEKLY'?'4 weeks':'month')); const perPay = savingsMonthlyA / cyclesPerMonthLocal(ps?.frequency); return (
                                  <>Savings: <strong>{fmt(savingsMonthlyA)}/mo</strong> (<span>{formatCurrency(perPay)} per {label}</span>)</>
                                ); })()}
                              </div>
                              <ul className="list-disc ml-5">
                                {potsA.map(p => (
                                  <li key={p.id}>{p.name}: {fmt(p.monthly)}</li>
                                ))}
                                {potsJ.length > 0 && (
                                  <li>Joint share: {fmt(jointShareA)}</li>
                                )}
                              </ul>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Person B (joint only) */}
                      {state.mode === 'joint' && (
                        <div className="rounded-md border p-4">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-sm font-medium">Person B</p>
                          <div className="flex items-center gap-2">
                              <Badge variant="secondary">Income: {fmt(monthlyIncomeB)}</Badge>
                            </div>
                          </div>
                      <div ref={personBDonutRef} className="h-64">
                        {personBDonutInView && (
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={makePieData('B')} dataKey="value" nameKey="name" outerRadius={90} labelLine={false} label={false}>
                              {makePieData('B').map((entry, index) => (
                                <Cell key={`cell-b-${index}`} fill={COLORS[entry.key]} />
                              ))}
                            </Pie>
                            <Tooltip formatter={(v: any, n: any) => [fmt(v as number), n as string]} />
                            <Legend verticalAlign="bottom" height={36} formatter={LegendFmt} />
                          </PieChart>
                        </ResponsiveContainer>
                        )}
                      </div>
                          <div className="mt-3 text-xs text-muted-foreground">
                            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setShowPotsB(s => !s)}>
                              {showPotsB ? 'Hide details' : 'View details'}
                            </Button>
                            {showPotsB && (
                              <div className="mt-2 space-y-2">
                                <div>
                                  {(() => { const ps = state.userB?.paySchedule; const freq = ps?.frequency; const perPay = (state.forecastResult?.depositB || 0); const label = freq==='WEEKLY'?'week': (freq==='FORTNIGHTLY'||freq==='BIWEEKLY'?'2 weeks': (freq==='FOUR_WEEKLY'?'4 weeks':'month')); return (
                                    <>Bills deposit: <strong>{fmt(monthlyDepositB)}/mo</strong> (<span>{formatCurrency(perPay)} per {label}</span>)</>
                                  ); })()}
                                </div>
                                <div>Allowance: <strong>{fmt(allowanceMonthlyB)}/mo</strong> (<span>{formatCurrency(state.weeklyAllowanceB || 0)}/wk</span>)</div>
                                <div>
                                  {(() => { const ps = state.userB?.paySchedule; const freq = ps?.frequency; const label = freq==='WEEKLY'?'week': (freq==='FORTNIGHTLY'||freq==='BIWEEKLY'?'2 weeks': (freq==='FOUR_WEEKLY'?'4 weeks':'month')); const perPay = savingsMonthlyB / cyclesPerMonthLocal(ps?.frequency); return (
                                    <>Savings: <strong>{fmt(savingsMonthlyB)}/mo</strong> (<span>{formatCurrency(perPay)} per {label}</span>)</>
                                  ); })()}
                                </div>
                                <ul className="list-disc ml-5">
                                  {potsB.map(p => (
                                    <li key={p.id}>{p.name}: {fmt(p.monthly)}</li>
                                  ))}
                                  {potsJ.length > 0 && (
                                    <li>Joint share: {fmt(jointShareB)}</li>
                                  )}
                                </ul>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    )}

                    {/* Fairness summary removed per request */}
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
            <div className="h-16" />
            <StickySummaryBar
              aLabel={state.mode === 'joint' ? `A ${formatCurrency(state.forecastResult.depositA)}` : undefined}
              bLabel={state.mode === 'joint' && typeof state.forecastResult.depositB === 'number' ? `B ${formatCurrency(state.forecastResult.depositB!)}` : undefined}
              minLabel={`Min ${formatCurrency(state.forecastResult.minBalance)}`}
              cta="Set up standing orders"
              onCta={() => {
                track('standing_orders_exported');
                announce('Standing order setup opened');
              }}
            />
          </div>
        )}
      </div>

      {/* Wages bottom sheet (primary confirm path) */}
      {(() => {
        if (!openSheetFor) return null;
        const who = openSheetFor;
        const pay = who === 'A' ? state.userA?.paySchedule : state.userB?.paySchedule || null;
        let next: string | undefined;
        if (pay) {
          const dates = calculatePayDates(pay.frequency, pay.anchorDate, 3);
          const today = new Date().toISOString().slice(0,10);
          next = dates.find(d => d >= today) ?? dates[0];
        }
        const salaries = (who === 'A')
          ? ((detected?.salaries && detected.salaries.length) ? detected.salaries as any : (pay ? [{ amount: pay.averageAmount ?? 0, freq: (pay.frequency === 'WEEKLY' ? 'weekly' : pay.frequency === 'FORTNIGHTLY' || pay.frequency === 'BIWEEKLY' ? 'fortnightly' : pay.frequency === 'FOUR_WEEKLY' ? 'four_weekly' : 'monthly') as any, description: 'Detected salary', firstSeen: pay.anchorDate }] : []))
          : (((detected as any)?.salariesB && (detected as any).salariesB.length) ? (detected as any).salariesB as any : (pay ? [{ amount: pay.averageAmount ?? 0, freq: (pay.frequency === 'WEEKLY' ? 'weekly' : pay.frequency === 'FORTNIGHTLY' || pay.frequency === 'BIWEEKLY' ? 'fortnightly' : pay.frequency === 'FOUR_WEEKLY' ? 'four_weekly' : 'monthly') as any, description: 'Detected salary', firstSeen: pay.anchorDate }] : []));
        const confirmed = who === 'A' ? state.wageConfirmedA : !!state.wageConfirmedB;
        const lastPaidISO = (() => {
          try {
            const cat = who === 'A' ? categorizeBankTransactions(state.userA.transactions) : categorizeBankTransactions(state.userB?.transactions || []);
            const wages = cat.wages || [];
            return wages.length ? [...wages].map(w=>w.date).sort().slice(-1)[0] : undefined;
          } catch { return undefined; }
        })();
        return (
          <WagesBottomSheet
            open={!!openSheetFor}
            onOpenChange={(v) => {
              if (!v) setOpenSheetFor(null);
            }}
            person={who}
            salaries={salaries}
            nextPayISO={next}
            lastPaidISO={lastPaidISO}
            confirmed={confirmed}
            onConfirm={() => {
              if (who === 'A') setState(prev => ({ ...prev, wageConfirmedA: true }));
              else setState(prev => ({ ...prev, wageConfirmedB: true }));
              setOpenSheetFor(null);
              announce(`Person ${who} wages confirmed`);
              // if both done, emit completion event
              const isDoneA = who === 'A' ? true : state.wageConfirmedA;
              const isDoneB = state.mode === 'joint' ? (who === 'B' ? true : !!state.wageConfirmedB) : true;
              if (isDoneA && isDoneB) track('link_flow_completed');
            }}
            onEdit={(edited) => {
              try {
                const cur: any = usePlanStore.getState().detected || {};
                if (who === 'A') {
                  const next = {
                    salaries: [edited, ...(cur.salaries || []).slice(1)],
                    recurring: cur.recurring || [],
                    salariesB: cur.salariesB || [],
                    recurringB: cur.recurringB || [],
                  };
                  usePlanStore.getState().setDetected(next);
                } else {
                  const next = {
                    salaries: cur.salaries || [],
                    recurring: cur.recurring || [],
                    salariesB: [edited, ...(cur.salariesB || []).slice(1)],
                    recurringB: cur.recurringB || [],
                  };
                  usePlanStore.getState().setDetected(next);
                }
              } catch (e) {
                console.warn('Failed to persist edited wages', e);
              }
            }}
          />
        );
      })()}

      {/* Review & Apply: Bill Date Suggestions */}
      {state.step === 'results' && showBillWizard && (
        <BillDateWizard
          open={showBillWizard}
          suggestions={(storeResult?.billSuggestions || []).map(s => {
            // Resolve to the actual bill in state for stable id + amount
            const exactById = state.bills.find(b => b.id === s.billId);
            const byNameAndDate = state.bills.find(b => (b.name === (s as any).name) && ((b.dueDate || (b as any).dueDateISO) === s.currentDate));
            const resolved = exactById || byNameAndDate;
            return {
              billId: resolved?.id || s.billId,
              name: resolved?.name || (s as any).name || s.billId,
              amount: resolved?.amount,
              currentDate: s.currentDate,
              suggestedDate: s.suggestedDate
            };
          })}
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
                const previewBillsWithDefaults = previewBills.map(b => ({ 
                  ...b, 
                  dueDate: b.dueDate || b.issueDate, 
                  issueDate: b.issueDate || b.dueDate,
                  source: (b.source === "electricity" ? "predicted-electricity" : b.source) as "manual" | "predicted-electricity" | "imported"
                }));
                const { depositA, depositB } = findDepositJoint(startDate, payScheduleA, payScheduleB, previewBillsWithDefaults, fairness, 0);
                return { a: depositA * cyclesPerMonth(payScheduleA.frequency), b: depositB * cyclesPerMonth(payScheduleB.frequency) } as any;
              }
            } catch {}
            return undefined;
          }}
          onApply={(selected) => {
            const moves = selected.map(s => ({
              id: s.billId,
              name: (s as any).name || s.billId,
              fromISO: s.currentDate,
              toISO: s.suggestedDate
            }));
            if (moves.length === 0) { setShowBillWizard(false); return; }
            try { saveJourney({ step: 'bills-moved', moves }).catch(()=>{}); } catch {}
            // Clear suggestions while recomputing to avoid flicker of stale entries
            try {
              const cur = usePlanStore.getState().result;
              usePlanStore.getState().setResult({ ...(cur || {} as any), billSuggestions: [] } as any);
            } catch {}
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


