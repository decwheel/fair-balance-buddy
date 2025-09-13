import React, { useMemo, useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { VirtualList } from '@/components/VirtualList';
import { formatDate } from '@/utils/dateUtils';
import { normalizeMerchant } from '@/lib/normalizeMerchant';
import { Pencil } from 'lucide-react';
import { recurrenceConfidence } from '@/lib/recurrenceConfidence';
import { track } from '@/lib/analytics';

type BillRow = {
  id: string;
  dateISO: string;
  description: string;
  amount: number;
  owner: 'A' | 'B' | 'JOINT';
  freq?: string; // monthly, weekly, etc
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
}: {
  rows: BillRow[];
  isLoading?: boolean;
  initialSelected?: Set<string>;
  onChangeSelected?: (ids: string[]) => void;
  onRename?: (id: string, name: string) => void;
  onAmount?: (id: string, amount: number) => void;
  groupBy?: 'month' | 'owner';
}) {
  const [openMonths, setOpenMonths] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelected));
  const [filters, setFilters] = useState({ owner: 'ALL' as 'ALL'|'A'|'B', hideSmall: true, showLow: false });

  const groups = useMemo<MonthGroup[]>(() => {
    const acc: Record<string, BillRow[]> = {};
    for (const r of rows) {
      if (filters.owner !== 'ALL' && r.owner !== filters.owner) continue;
      if (filters.hideSmall && Math.abs(r.amount) < 2) continue;
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

  const toggleMonth = (key: string) => {
    setOpenMonths(prev => ({ ...prev, [key]: !prev[key] }));
    track('bills_group_toggle', { month: key });
  };

  const setAllOwner = (owner: 'A'|'B') => {
    const ids = rows.filter(r=>r.owner===owner).map(r=>r.id);
    const next = new Set(selected);
    ids.forEach(id=>next.add(id));
    setSelected(next);
    onChangeSelected?.(Array.from(next));
    track('bulk_action_apply', { action: 'select_all', owner });
  };

  const Row = (r: BillRow) => {
    const n = normalizeMerchant(r.description);
    const checked = selected.has(r.id);
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState(n.name);
    const [amt, setAmt] = useState(Math.abs(r.amount).toFixed(2));
    return (
      <div
        className="grid grid-cols-[1.5rem,7rem,1fr,5rem,6rem] items-center h-11 px-2 cursor-pointer hover:bg-muted/40"
        role="checkbox" aria-checked={checked}
        onClick={() => { const next = new Set(selected); checked ? next.delete(r.id) : next.add(r.id); setSelected(next); onChangeSelected?.(Array.from(next)); }}
      >
        <Checkbox checked={checked} onClick={(e)=>e.stopPropagation()} onCheckedChange={(v)=>{ const next = new Set(selected); v? next.add(r.id) : next.delete(r.id); setSelected(next); onChangeSelected?.(Array.from(next)); }} />
        <div className="font-semibold tabular-nums">{formatDate(r.dateISO)}</div>
        <div className="min-w-0" onClick={(e)=>e.stopPropagation()}>
          {!editing ? (
            <div className="truncate inline-flex items-center gap-2">
              <span className="font-medium">{name}</span>
              {n.category && (<Badge variant="secondary" className="rounded-full">{n.category}</Badge>)}
              <button aria-label="Edit bill" className="text-muted-foreground" onClick={()=>setEditing(true)}>
                <Pencil className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input className="h-8 w-40 border rounded-md px-2 text-sm" value={name} onChange={(e)=>setName(e.target.value)} />
              <button className="text-xs underline" onClick={()=>{ setEditing(false); onRename?.(r.id, name.trim()); }}>Save</button>
            </div>
          )}
        </div>
        <div className="text-center" onClick={(e)=>e.stopPropagation()}>
          <Badge variant="outline" className="rounded-full text-[10px] mx-auto">{r.owner}</Badge>
        </div>
        <div className="text-right font-medium flex items-center justify-end gap-2" onClick={(e)=>e.stopPropagation()}>
          {!editing ? (
            <span>{Math.abs(parseFloat(amt)).toFixed(2)}</span>
          ) : (
            <input className="h-8 w-20 border rounded-md px-2 text-sm text-right" value={amt} onChange={(e)=>setAmt(e.target.value)} onBlur={()=> onAmount?.(r.id, Math.abs(parseFloat(amt)) || 0)} />
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
      <div className="flex items-center gap-2 text-sm">
        <button className="underline" onClick={()=>{
          const allIds = groups.flatMap(g=>g.rows.map(r=>r.id));
          const next = new Set(selected);
          allIds.forEach(id=>next.add(id));
          setSelected(next);
          onChangeSelected?.(Array.from(next));
        }}>Select all</button>
        <button className="underline" onClick={()=>{ setSelected(new Set()); onChangeSelected?.([]); }}>Clear all</button>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={filters.hideSmall}
            onChange={(e)=>setFilters(f=>({ ...f, hideSmall: e.target.checked }))}
          />
          Hide &lt;2
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={filters.showLow}
            onChange={(e)=>setFilters(f=>({ ...f, showLow: e.target.checked }))}
          />
          Show low confidence
        </label>
      </div>

      {groups.map(g => {
        const open = openMonths[g.key] !== false; // default open
        return (
          <div key={g.key} className="border rounded-xl overflow-hidden">
            <button className="w-full flex items-center justify-between p-3 bg-muted/40" onClick={()=>toggleMonth(g.key)}>
              <div className="font-medium">{g.label}</div>
              <div className="text-sm">Subtotal {g.subtotal.toFixed(2)}</div>
            </button>
            {open && (
              <VirtualList
                items={g.rows}
                itemHeight={44}
                className="max-h-80 overflow-auto"
                render={(row) => <Row {...row} />}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}









