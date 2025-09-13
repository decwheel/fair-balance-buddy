import React, { useMemo, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { SalaryCandidate, PayFrequency } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { track } from '@/lib/analytics';
import { formatDate } from '@/utils/dateUtils';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

function toMonthly(amount: number, freq: PayFrequency): number {
  const cycles = freq === 'weekly' ? 52/12 : freq === 'fortnightly' ? 26/12 : freq === 'four_weekly' ? 13/12 : 1;
  return amount * cycles;
}

export function WagesBottomSheet({
  open,
  onOpenChange,
  person,
  salaries,
  nextPayISO,
  lastPaidISO,
  confirmed,
  onConfirm,
  onEdit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  person: 'A' | 'B';
  salaries: SalaryCandidate[];
  nextPayISO?: string;
  lastPaidISO?: string;
  confirmed?: boolean;
  onConfirm: () => void;
  onEdit?: (s: SalaryCandidate)=>void;
}) {
  const top = salaries?.[0];
  const [editing, setEditing] = useState(false);
  const [amt, setAmt] = useState<number>(top?.amount || 0);
  const [freq, setFreq] = useState<PayFrequency>(top?.freq || 'monthly');
  const lastSeenISO = lastPaidISO || top?.firstSeen;
  const lastDate = lastSeenISO ? new Date(lastSeenISO) : undefined;
  const stale = lastDate ? ((Date.now() - lastDate.getTime())/(1000*60*60*24) > 60) : false;
  const curAmount = editing ? amt : (top?.amount || 0);
  const curFreq: PayFrequency = editing ? freq : (top?.freq || 'monthly');
  const monthly = toMonthly(curAmount, curFreq);
  const freqLabel = (curFreq || 'monthly').toUpperCase();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-6 pt-4">
        {/* Warning banner */}
        {stale && (
          <div className="w-full bg-amber-100 text-amber-800 text-xs px-3 py-2 rounded-t-2xl flex items-center justify-center gap-2" role="status" aria-live="polite">
            <AlertTriangle className="w-4 h-4" />
            <span>Salary data may be outdated</span>
          </div>
        )}
        <SheetHeader className="mt-2">
          <SheetTitle id="wages-title" className="text-base font-semibold">Detected wages</SheetTitle>
          <div className="text-sm text-muted-foreground -mt-1">Person {person}</div>
        </SheetHeader>

        {/* Summary */}
        <div className="mt-4 text-center">
          <div className="text-2xl font-bold tabular-nums">
            {new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(monthly)}
            <span className="text-base font-normal text-muted-foreground"> / month</span>
          </div>
          <div className="mt-2 flex items-center justify-center gap-2">
            <span className="text-[11px] bg-muted/60 px-2 py-0.5 rounded-full">{freqLabel}</span>
            {lastSeenISO && (
              <span className="text-[11px] bg-muted/60 px-2 py-0.5 rounded-full">Last paid: {formatDate(lastSeenISO)}</span>
            )}
          </div>
          {editing && (
            <div className="mt-3 flex items-center justify-center gap-2">
              <select
                className="h-11 px-2 border rounded-md text-sm"
                value={freq}
                onChange={(e)=> setFreq(e.target.value as PayFrequency)}
                aria-label="Select frequency"
              >
                <option value="weekly">WEEKLY</option>
                <option value="fortnightly">FORTNIGHTLY</option>
                <option value="four_weekly">FOUR_WEEKLY</option>
                <option value="monthly">MONTHLY</option>
              </select>
              <input
                type="number"
                className="h-11 w-28 px-2 border rounded-md text-sm text-right"
                aria-label="Amount per pay occurrence"
                value={amt}
                onChange={(e)=> setAmt(parseFloat(e.target.value)||0)}
              />
            </div>
          )}
          {nextPayISO && (
            <div className="mt-2 text-xs text-muted-foreground">Next expected: {formatDate(nextPayISO)}</div>
          )}
        </div>

        {/* Actions */}
        <div className="mt-5 flex gap-3 sm:flex-row flex-col">
          {!editing ? (
            <>
              <Button
                variant="outline"
                className="flex-1 h-11"
                aria-label="Change detected wages"
                onClick={() => { setEditing(true); track('wages_edited', { person }); }}
              >
                Change
              </Button>
              <Button
                className="flex-1 h-11"
                aria-label="Confirm detected wages"
                onClick={() => {
                  onConfirm();
                  track('wages_confirmed', { person, monthly, stale });
                  toast.success(`Wages confirmed for Person ${person}`);
                }}
              >
                Confirm
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                className="flex-1 h-11"
                aria-label="Cancel changes"
                onClick={() => { setEditing(false); setAmt(top?.amount || 0); setFreq(top?.freq || 'monthly'); }}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 h-11"
                aria-label="Save changes"
                onClick={() => {
                  const edited: SalaryCandidate = { amount: amt, freq, description: top?.description || 'Salary', firstSeen: top?.firstSeen || new Date().toISOString().slice(0,10) };
                  onEdit?.(edited);
                  toast.success('Wages updated');
                  setEditing(false);
                }}
              >
                Save
              </Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
