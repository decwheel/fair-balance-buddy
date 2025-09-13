import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { formatDate } from '@/utils/dateUtils';

export function ResultsHero({
  aPerPay,
  aPerMonth,
  aStart,
  bPerPay,
  bPerMonth,
  bStart,
  fairness,
  minBalance,
  minDate,
  startISO,
}: {
  aPerPay: number; aPerMonth: number; aStart: string;
  bPerPay?: number; bPerMonth?: number; bStart?: string;
  fairness?: { a: number; b: number };
  minBalance: number; minDate: string;
  startISO?: string;
}) {
  return (
    <Card className="deposit-highlight">
      <CardHeader>
        <CardTitle>Optimized deposits</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl bg-secondary/50 p-4">
            <div className="text-xs text-muted-foreground mb-1">Person A</div>
            <div className="text-2xl font-bold">€{aPerPay.toFixed(0)} / pay</div>
            <div className="text-sm text-foreground">€{aPerMonth.toFixed(0)}/mo starts {formatDate(startISO || aStart)}</div>
          </div>
          {typeof bPerPay === 'number' && (
            <div className="rounded-xl bg-secondary/50 p-4">
              <div className="text-xs text-muted-foreground mb-1">Person B</div>
              <div className="text-2xl font-bold">€{bPerPay.toFixed(0)} / pay</div>
              <div className="text-sm text-foreground">€{(bPerMonth||0).toFixed(0)}/mo starts {bStart ? formatDate(startISO || bStart) : ''}</div>
            </div>
          )}
        </div>
        {fairness && (
          <div>
            <Badge variant="outline" className="rounded-full">Fairness A {Math.round(fairness.a*100)}% B {Math.round(fairness.b*100)}%</Badge>
          </div>
        )}
        <Alert className="border-success">
          <CheckCircle className="w-4 h-4 text-success" />
          <AlertDescription>
            Min balance €{minBalance.toFixed(2)} on {formatDate(minDate)}.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
