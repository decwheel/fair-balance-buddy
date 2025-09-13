import React, { useMemo } from 'react';
import { PiggyBank } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatDate } from '@/utils/dateUtils';

export type Person = 'A' | 'B';

export type BankInfo = { name: string; logoUrl?: string; linkedAtISO: string };

export function LinkBankTiles({
  linkedA,
  linkedB,
  bankA,
  bankB,
  summaryA,
  summaryB,
  onLink,
  pulseB,
}: {
  linkedA: boolean;
  linkedB: boolean;
  bankA?: BankInfo;
  bankB?: BankInfo;
  summaryA?: { perOcc?: number; unit?: string; needsConfirm?: boolean; stale?: boolean; lastDate?: string };
  summaryB?: { perOcc?: number; unit?: string; needsConfirm?: boolean; stale?: boolean; lastDate?: string };
  onLink: (p: Person) => void;
  pulseB?: boolean;
}) {
  const A = useMemo(() => ({ linked: linkedA, bank: bankA, summary: summaryA }), [linkedA, bankA, summaryA]);
  const B = useMemo(() => ({ linked: linkedB, bank: bankB, summary: summaryB }), [linkedB, bankB, summaryB]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold">Link banks</div>
          <div className="text-sm text-muted-foreground">Connect each person's main account.</div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <Tile person="A" data={A} onLink={onLink} pulse={false} />
        <Tile person="B" data={B} onLink={onLink} pulse={!!pulseB} />
      </div>
    </div>
  );
}

function Tile({ person, data, onLink, pulse }: { person: Person; data: { linked: boolean; bank?: BankInfo; summary?: { perOcc?: number; unit?: string; needsConfirm?: boolean; stale?: boolean; lastDate?: string } }; onLink: (p: Person)=>void; pulse?: boolean; }) {
  const logo = data.bank?.logoUrl;
  const perOcc = data.summary?.perOcc;
  const unit = data.summary?.unit;
  const needsConfirm = data.summary?.needsConfirm;
  const stale = data.summary?.stale;
  const lastDate = data.summary?.lastDate;
  const isLinked = data.linked;

  const aria = isLinked ? `Open Person ${person} wages` : `Link bank for person ${person}`;
  return (
    <button
      onClick={() => onLink(person)}
      className={cn('group text-left border rounded-xl p-3 sm:p-4 h-full min-h-24 sm:min-h-40 flex items-start gap-3 transition shadow-sm w-full', isLinked ? 'border-green-600/50 bg-green-600/5' : 'hover:bg-muted/50', pulse ? 'animate-pulse' : '')}
      aria-label={aria}
      data-person-tile={person}
    >
      <div className={cn('w-10 h-10 rounded-full border flex items-center justify-center shrink-0', isLinked ? 'bg-white' : 'bg-secondary')}>
        {logo ? (
          <img src={logo} alt="Bank logo" className="w-8 h-8 rounded-full object-cover" />
        ) : (
          <PiggyBank className="w-5 h-5" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!isLinked ? (
          <>
            <div className="flex items-start justify-between gap-2">
              <div className="font-medium text-base sm:text-lg">Link bank</div>
              <Badge className="rounded-full text-[10px]" variant={'secondary'} aria-hidden="true">{person}</Badge>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-start justify-between gap-2">
              <div className="font-medium text-base sm:text-lg truncate">{data.bank?.name || `Linked bank`}</div>
              <Badge className="rounded-full text-[10px]" variant={'default'} aria-hidden="true">{person}</Badge>
            </div>
            <div className="text-xs sm:text-sm text-muted-foreground mt-1">{`Linked ${relative(data.bank?.linkedAtISO || '')}`}</div>
            {perOcc != null && (
              <div className="text-xs sm:text-sm mt-1">Detected: {Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(perOcc)}/ {unit || 'month'}</div>
            )}
            {needsConfirm && (
              <div className="text-[11px] text-amber-700 bg-amber-100 inline-block px-2 py-0.5 rounded-full mt-1" aria-hidden="true">Needs confirmation</div>
            )}
            {lastDate && (
              <div className="text-[11px] sm:text-xs text-muted-foreground mt-1">Date: {safeDate(lastDate)}</div>
            )}
            {stale && (
              <div className="text-[11px] text-amber-700 bg-amber-100 inline-block px-2 py-0.5 rounded-full mt-1" aria-hidden="true">Outdated</div>
            )}
          </>
        )}
      </div>
    </button>
  );
}

function relative(iso: string) {
  try {
    const d = new Date(iso);
    const ms = Date.now() - d.getTime();
    const m = Math.max(1, Math.round(ms / 60000));
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    return `${h}h ago`;
  } catch { return 'recently'; }
}

function safeDate(iso: string) {
  try { return formatDate(iso); } catch { return iso; }
}


