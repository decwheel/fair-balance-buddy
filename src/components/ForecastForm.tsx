import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import type { SavingsPot } from '@/types';

export function ForecastForm({
  mode,
  weeklyA,
  weeklyB,
  availableA,
  availableB,
  pots,
  onChangeAllowance,
  onAddPot,
  onUpdatePot,
  onRemovePot,
  upcoming,
}: {
  mode: 'single'|'joint';
  weeklyA: number;
  weeklyB?: number;
  availableA?: number;
  availableB?: number;
  pots: SavingsPot[];
  onChangeAllowance: (a: number, b?: number) => void;
  onAddPot: (name: string, monthly: number, owner: 'A'|'B'|'JOINT', target?: number) => void;
  onUpdatePot: (id: string, patch: Partial<SavingsPot>) => void;
  onRemovePot: (id: string) => void;
  upcoming: Array<{ dateISO: string; name: string; amount: number }>
}) {
  const [potName, setPotName] = React.useState('');
  const [potAmt, setPotAmt] = React.useState(0);
  const [potTarget, setPotTarget] = React.useState<string>('');
  const [owner, setOwner] = React.useState<'A'|'B'|'JOINT'>(mode === 'joint' ? 'A' : 'A');
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Weekly allowance</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-sm">Person A</label>
            <Input type="number" value={weeklyA} onChange={(e)=>onChangeAllowance(parseFloat(e.target.value)||0, weeklyB)} />
            {typeof availableA === 'number' && (
              <p className="text-xs text-muted-foreground mt-1">Available for A savings this month: <strong>€{(availableA||0).toFixed(2)}</strong></p>
            )}
          </div>
          {typeof weeklyB === 'number' && (
            <div>
              <label className="text-sm">Person B</label>
              <Input type="number" value={weeklyB} onChange={(e)=>onChangeAllowance(weeklyA, parseFloat(e.target.value)||0)} />
              {typeof availableB === 'number' && (
                <p className="text-xs text-muted-foreground mt-1">Available for B savings this month: <strong>€{(availableB||0).toFixed(2)}</strong></p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Savings pots</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 items-end">
            <Input placeholder="Name" value={potName} onChange={(e)=>setPotName(e.target.value)} />
            <Input placeholder="Monthly" type="number" className="w-28" value={potAmt} onChange={(e)=>setPotAmt(parseFloat(e.target.value)||0)} />
            <Input placeholder="Target (optional)" type="number" className="w-32" value={potTarget} onChange={(e)=>setPotTarget(e.target.value)} />
            {mode === 'joint' && (
              <select className="border rounded-md h-11 px-2" value={owner} onChange={(e)=>setOwner(e.target.value as any)}>
                <option value="A">A</option>
                <option value="B">B</option>
                <option value="JOINT">JOINT</option>
              </select>
            )}
            <Button onClick={()=>{
              const t = potTarget === '' ? undefined : (parseFloat(potTarget) || 0);
              onAddPot(potName.trim(), potAmt || 0, owner, t);
              setPotName(''); setPotAmt(0); setPotTarget('');
            }}>Add</Button>
          </div>
          {/* Existing pots */}
          <div className="space-y-2">
            {pots.map(p => (
              <div key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="rounded-full bg-secondary px-2 py-1">{p.owner}</span>
                <span className="min-w-[6rem] truncate" title={p.name}>{p.name}</span>
                <Input type="number" className="w-24" value={p.monthly}
                  onChange={(e)=> onUpdatePot(p.id, { monthly: parseFloat(e.target.value)||0 })} />
                <Input placeholder="Target" type="number" className="w-28" value={typeof p.target==='number'? p.target : '' as any}
                  onChange={(e)=> onUpdatePot(p.id, { target: e.target.value==='' ? undefined : (parseFloat(e.target.value)||0) })} />
                <Button size="sm" variant="ghost" onClick={()=> onRemovePot(p.id)}>Remove</Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Upcoming bills</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {upcoming.map(u => (
              <div key={u.dateISO+u.name} className="flex justify-between items-baseline text-sm">
                <div className="mr-2">
                  <div className="font-medium">{new Date(u.dateISO).toLocaleDateString(undefined, { day:'2-digit', month:'short', timeZone:'UTC' })}</div>
                  <div className="text-muted-foreground">{u.name}</div>
                </div>
                <span className="font-medium">€{u.amount.toFixed(0)}</span>
              </div>
            ))}
          </div>
          <div className="h-16 mt-3">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={upcoming.map(u => ({ x: u.dateISO, y: u.amount }))}>
                <Line type="monotone" dataKey="y" stroke="hsl(var(--accent))" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}







