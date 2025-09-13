import React, { useMemo, useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { VirtualList } from '@/components/VirtualList';
import { formatDate } from '@/utils/dateUtils';
import { normalizeMerchant } from '@/lib/normalizeMerchant';
import { Pencil } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { track } from '@/lib/analytics';

type BillRow = {
  id: string;
  dateISO: string;
  description: string;
  amount: number;
  owner: 'A' | 'B' | 'JOINT';
  freq?: string; // monthly, weekly, etc
  dueDay?: number; // for monthly
  dayOfWeek?: number; // for weekly-like
  lowConfidence?: boolean;
};

type MonthGroup = { key: string; label: string; subtotal: number; rows: BillRow[] };

export function BillsList({
  rows,
  isLoading,
  initialSelected = new Set<string>(),
  onChangeSelected,
  onRename,
  onAmount,
  groupBy = 'month',
  onChangeGroupBy,
}: {
  rows: BillRow[];
  isLoading?: boolean;
  initialSelected?: Set<string>;
  onChangeSelected?: (ids: string[]) => void;
  onRename?: (id: string, name: string) => void;
  onAmount?: (id: string, amount: number) => void;
  groupBy?: 'month' | 'owner';
  onChangeGroupBy?: (g: 'month' | 'owner') => void;
}) {
  // Groups are always expanded; we removed the collapse toggle for simplicity
  const [openMonths] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelected));
  const [filters, setFilters] = useState({ owner: 'ALL' as 'ALL'|'A'|'B', hideSmall: true, showLow: false });
  const [bulkOpen, setBulkOpen] = useState(false);

  const groups = useMemo<MonthGroup[]>(() => {
    const acc: Record<string, BillRow[]> = {};
    for (const r of rows) {
      if (filters.owner !== 'ALL' && r.owner !== filters.owner) continue;
      if (filters.hideSmall && Math.abs(r.amount) < 2) continue;
      const lowConf = !r.freq; // heuristic: no frequency info => low confidence
      if (!filters.showLow && lowConf) continue;
      const key = groupBy === 'owner' ? r.owner : r.dateISO.slice(0,7);
      acc[key] ||= [];
      acc[key].push(r);
    }
    const keys = Object.keys(acc).sort();
    return keys.map(key => {
      const list = acc[key].sort((a,b)=>a.dateISO.localeCompare(b.dateISO));
      const subtotal = list.reduce((s,r)=>s+Math.abs(r.amount),0);
      let label = key;
      if (groupBy === 'month') {
        const [y,m] = key.split('-').map(Number);
        const d = new Date(Date.UTC(y,m-1,1));
        label = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
      } else {
        label = key === 'A' ? 'Person A' : key === 'B' ? 'Person B' : 'Joint';
      }
      return { key, label, subtotal, rows: list };
    });
  }, [rows, filters, groupBy]);

  const toggleMonth = (_key: string) => {
    // no-op (collapse removed)
  };

  const selectAllInView = () => {
    const ids = groups.flatMap(g => g.rows.map(r => r.id));
    const next = new Set(selected);
    ids.forEach(id => next.add(id));
    setSelected(next);
    onChangeSelected?.(Array.from(next));
    track('bulk_action_apply', { action: 'select_all_in_view' });
  };
  const clearAll = () => {
    setSelected(new Set());
    onChangeSelected?.([]);
    track('bulk_action_apply', { action: 'clear_all' });
  };

  const Row = (r: BillRow) => {
    const n = normalizeMerchant(r.description);
    const checked = selected.has(r.id);
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState(n.name);
    const [amt, setAmt] = useState(Math.abs(r.amount).toFixed(2));
    const lowConf = !r.freq;

    const amountStr = (() => {
      const num = Math.abs(parseFloat(amt) || 0);
      return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
    })();

    const freqChip = (() => {
      if (!r.freq) return '';
      const f = r.freq.toLowerCase();
      if (f === 'monthly') return 'monthly';
      if (f === 'fortnightly') {
        return 'fortnightly';
      }
      if (f === 'weekly') {
        return 'weekly';
      }
      if (f === 'four_weekly') return '4 weeks';
      return r.freq;
    })();
    const dayChip = (() => {
      // For monthly: use ordinal dueDay (e.g., 14th). For weekly/fortnightly: use weekday abbrev.
      const ord = (n: number) => {
        const s = ['th','st','nd','rd'];
        const v = n % 100; const suffix = s[(v-20)%10] || s[v] || s[0];
        return `${n}${suffix}`;
      };
      const f = (r.freq || '').toLowerCase();
      if (f === 'monthly' && typeof r.dueDay === 'number') return ord(r.dueDay);
      if ((f === 'weekly' || f === 'fortnightly') && typeof r.dayOfWeek === 'number') return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][r.dayOfWeek];
      if (typeof r.dueDay === 'number') return ord(r.dueDay);
      return '';
    })();

    return (
      <div
        className={"w-full px-2 py-2 cursor-pointer hover:bg-muted/40 border-l-2 " + (lowConf ? 'border-amber-300 border-dotted' : 'border-transparent')}
        role="checkbox" aria-checked={checked}
        onClick={() => { const next = new Set(selected); checked ? next.delete(r.id) : next.add(r.id); setSelected(next); onChangeSelected?.(Array.from(next)); }}
      >
        {/* Line 1 */}
        <div className="flex items-start gap-2">
          <div className="pt-0.5">
            <Checkbox checked={checked} onClick={(e)=>e.stopPropagation()} onCheckedChange={(v)=>{ const next = new Set(selected); v? next.add(r.id) : next.delete(r.id); setSelected(next); onChangeSelected?.(Array.from(next)); }} />
          </div>
          <div className="flex-1 min-w-0" onClick={(e)=>e.stopPropagation()}>
            {!editing ? (
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm sm:text-base truncate">{name}</span>
                <button aria-label={`Edit ${name}`} className="text-muted-foreground shrink-0 h-8 w-8 inline-flex items-center justify-center" onClick={()=>setEditing(true)}>
                  <Pencil className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <input className="h-8 w-36 sm:w-40 border rounded-md px-2 text-sm" value={name} onChange={(e)=>setName(e.target.value)} />
                <button className="text-xs underline" onClick={()=>{ setEditing(false); onRename?.(r.id, name.trim()); }}>Save</button>
              </div>
            )}
          </div>
          <div className="shrink-0 text-right font-semibold tabular-nums whitespace-nowrap" onClick={(e)=>e.stopPropagation()}>
            {!editing ? (
              <span>{amountStr}</span>
            ) : (
              <input className="h-8 w-20 border rounded-md px-2 text-sm text-right" value={amt} onChange={(e)=>setAmt(e.target.value)} onBlur={()=> onAmount?.(r.id, Math.abs(parseFloat(amt)) || 0)} />
            )}
          </div>
        </div>
        {/* Line 2 (meta chips) */}
        <div className="flex flex-nowrap items-center gap-1 mt-1 overflow-hidden min-w-0">
          {freqChip && (
            <span className="text-[11px] bg-muted/60 px-2 py-0.5 rounded-full shrink-0">{freqChip}</span>
          )}
          {dayChip && (
            <span className="text-[11px] bg-muted/60 px-2 py-0.5 rounded-full shrink-0">{dayChip}</span>
          )}
          <span className="text-[10px] bg-muted/60 px-2 py-0.5 rounded-full shrink-0">{r.owner}</span>
          {lowConf && (
            <span className="text-[10px] text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full shrink-0" aria-hidden="true">Low conf.</span>
          )}
        </div>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_,i)=> <Skeleton key={i} className="h-11 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Toolbar: Group by + Bulk */}
      <div className="flex items-center justify-between gap-2 text-sm">
        <div className="inline-flex items-center gap-3 flex-wrap">
          <span className="text-muted-foreground">Group by:</span>
          <div className="inline-flex rounded-md border overflow-hidden">
            <button className={`px-3 py-1.5 ${groupBy==='month'?'bg-secondary':''}`} onClick={()=>onChangeGroupBy?.('month')}>Month</button>
            <button className={`px-3 py-1.5 ${groupBy==='owner'?'bg-secondary':''}`} onClick={()=>onChangeGroupBy?.('owner')}>Owner</button>
          </div>
        </div>
        <button
          className="px-3 py-1.5 rounded-md border min-w-9 text-center"
          aria-label="Bulk actions"
          title="Bulk actions"
          onClick={()=>setBulkOpen(true)}
        >
          <span aria-hidden="true">…</span>
          <span className="sr-only">Bulk actions</span>
        </button>
      </div>

      {groups.map(g => {
        const open = openMonths[g.key] !== false; // default open
        return (
          <div key={g.key} className="border rounded-xl overflow-hidden">
            <div className="sticky top-0 z-10 w-full flex items-center justify-between p-3 bg-muted/40">
              <div className="font-medium">{g.label}</div>
              <div className="text-sm">Subtotal {g.subtotal.toFixed(2)}</div>
            </div>
            <VirtualList
              items={g.rows}
              itemHeight={64}
              className="max-h-80 overflow-auto"
              render={(row) => <Row {...row} />}
            />
          </div>
        );
      })}

      {/* Bulk Sheet */}
      <Sheet open={bulkOpen} onOpenChange={setBulkOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader>
            <SheetTitle>Bulk actions</SheetTitle>
          </SheetHeader>
          <div className="mt-3 space-y-2">
            <button className="w-full h-11 rounded-md border px-3 text-left" onClick={()=>{ selectAllInView(); setBulkOpen(false); }}>Select all in view</button>
            <button className="w-full h-11 rounded-md border px-3 text-left" onClick={()=>{ clearAll(); setBulkOpen(false); }}>Clear all</button>
            <label className="w-full h-11 rounded-md border px-3 inline-flex items-center justify-between">
              <span>Hide micro &lt; 2</span>
              <input type="checkbox" checked={filters.hideSmall} onChange={(e)=>setFilters(f=>({ ...f, hideSmall: e.target.checked }))} />
            </label>
            <label className="w-full h-11 rounded-md border px-3 inline-flex items-center justify-between">
              <span>Show low confidence</span>
              <input type="checkbox" checked={filters.showLow} onChange={(e)=>setFilters(f=>({ ...f, showLow: e.target.checked }))} />
            </label>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}









