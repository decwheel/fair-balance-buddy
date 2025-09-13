import React, { useMemo } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { SalaryCandidate, PayFrequency } from '@/types';
import { WagesCard } from '@/components/WagesCard';
import { Badge } from '@/components/ui/badge';
import { track } from '@/lib/analytics';

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
  confirmed,
  onConfirm,
  onEdit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  person: 'A' | 'B';
  salaries: SalaryCandidate[];
  nextPayISO?: string;
  confirmed?: boolean;
  onConfirm: () => void;
  onEdit?: (s: SalaryCandidate)=>void;
}) {
  const top = salaries?.[0];
  const lastSeenISO = top?.firstSeen;
  const lastDate = lastSeenISO ? new Date(lastSeenISO) : undefined;
  const stale = lastDate ? ((Date.now() - lastDate.getTime())/(1000*60*60*24) > 60) : false;
  const monthly = top ? toMonthly(top.amount, top.freq) : undefined;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-10">
        <SheetHeader>
          <SheetTitle>
            Person {person} · Detected wages
          </SheetTitle>
          {stale && (
            <div className="mt-1">
              <div className="inline-block rounded-full text-[11px] bg-amber-100 text-amber-700 px-2 py-0.5">Salary data may be outdated</div>
            </div>
          )}
        </SheetHeader>
        <div className="mt-3">
          <WagesCard
            person={person}
            salaries={salaries}
            nextPayISO={nextPayISO}
            confirmed={!!confirmed}
            onEdit={(s) => { onEdit?.(s); track('wages_edited', { person }); }}
            onConfirm={() => { onConfirm(); track('wages_confirmed', { person, monthly, stale }); }}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
