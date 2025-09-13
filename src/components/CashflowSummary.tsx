import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

export function CashflowSummary({
  household,
  perPerson,
}: {
  household: { income: number; bills: number; allowance: number; savings: number; leftover: number };
  perPerson: Array<{ who: 'A'|'B'; bills: number; allowance: number; savings: number; leftover: number }>;
}) {
  const pills = [
    { key:'Bills', color:'#334155' },
    { key:'Allowance', color:'#0891b2' },
    { key:'Savings', color:'#16a34a' },
    { key:'Leftover', color:'#d97706' },
  ];
  const data = perPerson.map(p=>({ name: p.who, Bills:p.bills, Allowance:p.allowance, Savings:p.savings, Leftover:p.leftover }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Cash-flow summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-center">
          <div>Combined income {household.income.toFixed(2)}/mo</div>
          <div className="text-sm text-muted-foreground">Bills {household.bills.toFixed(2)}/mo</div>
        </div>
        <div className="flex justify-center gap-2 text-xs">
          {pills.map(p=> <span key={p.key} className="px-2 py-1 rounded-full border" style={{ borderColor: p.color, color:p.color }}>{p.key}</span>)}
        </div>
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} stackOffset="expand">
              <XAxis dataKey="name" />
              <YAxis hide />
              <Tooltip />
              {pills.map(p=> <Bar key={p.key} dataKey={p.key} stackId="a" fill={p.color} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

