import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

export function SavingsPanel({
  pots
}: {
  pots: Array<{ name: string; monthly: number; target?: number; progress?: number }>
}) {
  const colors = ['#16a34a','#0891b2','#7c3aed','#e11d48','#ca8a04'];
  const total = pots.reduce((s,p)=>s+p.monthly,0) || 1;
  const data = pots.map((p,i)=>({ name: p.name, value: p.monthly, color: colors[i%colors.length] }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Savings</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" innerRadius={50} outerRadius={70}>
                {data.map((d,i)=> <Cell key={i} fill={d.color} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 text-center">
          <div className="text-lg font-medium">{total.toFixed(0)}/mo</div>
        </div>
      </CardContent>
    </Card>
  );
}

