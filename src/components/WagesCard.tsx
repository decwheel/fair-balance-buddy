import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { SalaryCandidate, PayFrequency } from '@/types';
import { formatDate } from '@/utils/dateUtils';

function toMonthly(amount: number, freq: PayFrequency): number {
  const cycles = freq === 'weekly' ? 52/12 : freq === 'fortnightly' ? 26/12 : freq === 'four_weekly' ? 13/12 : 1;
  return amount * cycles;
}

export function WagesCard({ person, salaries, onEdit, onConfirm, confirmed, nextPayISO }: { person: 'A'|'B'; salaries: SalaryCandidate[]; onEdit?: (s: SalaryCandidate)=>void; onConfirm?: () => void; confirmed?: boolean; nextPayISO?: string }) {
  const top = salaries?.[0];
  const [editing, setEditing] = useState(false);
  const [freq, setFreq] = useState<PayFrequency>(top?.freq || 'monthly');
  const [amount, setAmount] = useState<number>(top?.amount || 0);

  const monthly = useMemo(()=> toMonthly(amount || (top?.amount||0), freq || (top?.freq||'monthly')), [amount, freq, top]);
  const lastSeenISO = top?.firstSeen;
  const lastDate = lastSeenISO ? new Date(lastSeenISO) : undefined;
  const stale = lastDate ? ((Date.now() - lastDate.getTime())/(1000*60*60*24) > 60) : false;

  const perLabel = freq === 'weekly' ? 'week' : freq === 'fortnightly' ? 'fortnight' : freq === 'four_weekly' ? '4 weeks' : 'month';
  const currency = (v: number) => Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(v);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Person {person}
          <Badge variant="secondary" className="rounded-full">{(top?.freq || 'monthly').toUpperCase()}</Badge>
          <Badge variant="outline" className="rounded-full">{formatDate(lastSeenISO || new Date().toISOString().slice(0,10))}</Badge>
          {stale && <Badge variant="outline" className="rounded-full text-warning border-warning">Check salary</Badge>}
          {confirmed && <Badge variant="secondary" className="rounded-full">Confirmed</Badge>}
        </CardTitle>
        <CardDescription>{currency(amount)} / {perLabel}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {nextPayISO && (
          <div className="text-xs text-muted-foreground">Next: {formatDate(nextPayISO)}</div>
        )}
        {!editing ? (
          <Button variant="link" className="px-0" onClick={()=>setEditing(true)}>Change</Button>
        ) : (
          <div className="flex items-center gap-2">
            <select className="border rounded-md h-11 px-2" value={freq} onChange={e=>setFreq(e.target.value as PayFrequency)}>
              <option value="weekly">WEEKLY</option>
              <option value="fortnightly">FORTNIGHTLY</option>
              <option value="four_weekly">FOUR_WEEKLY</option>
              <option value="monthly">MONTHLY</option>
            </select>
            <input className="border rounded-md h-11 px-2 w-32" type="number" value={amount} onChange={e=>setAmount(parseFloat(e.target.value)||0)} />
            <Button onClick={()=>{ onEdit?.({ amount, freq, description: top?.description || 'Salary', firstSeen: lastSeenISO || new Date().toISOString().slice(0,10) }); setEditing(false); }}>Save</Button>
          </div>
        )}
        {!confirmed && (
          <div>
            <Button onClick={() => { onConfirm?.(); toast.success(`Person ${person} salary confirmed`); }}>Yes confirm</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
