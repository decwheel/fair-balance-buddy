import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { formatCurrency } from '@/utils/dateUtils';

type Suggestion = {
  billId: string;
  name?: string;
  currentDate: string;      // ISO yyyy-mm-dd
  suggestedDate: string;    // ISO yyyy-mm-dd
  // Optional legacy fields; ignored by this UI
  savingsAmount?: number;    // €/month (not shown)
  reason?: string;
};

export function BillDateWizard({
  open,
  suggestions,
  onApply,
  onClose,
  currentMonthlyA,
  currentMonthlyB,
  freqALabel = '/month',
  freqBLabel = '/month',
  onPreview,
}: {
  open: boolean;
  suggestions: Suggestion[];
  onApply: (selected: Suggestion[]) => void;
  onClose: () => void;
  currentMonthlyA?: number;
  currentMonthlyB?: number;
  freqALabel?: string;
  freqBLabel?: string;
  // Return preview monthly deposits for A/B given selected IDs
  onPreview?: (selectedIds: string[]) => Promise<{ monthlyA: number; monthlyB?: number } | { a: number; b?: number } | undefined>;
}) {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<{ a?: number; b?: number }>({});

  useEffect(() => {
    if (!open) return;
    // Default to no preselection; user can opt-in per suggestion
    setSelected({});
    setPreview({});
  }, [open, suggestions]);

  // Update preview whenever selection changes
  useEffect(() => {
    if (!onPreview) return;
    const ids = Object.entries(selected).filter(([, v]) => !!v).map(([k]) => k);
    onPreview(ids).then((res) => {
      if (!res) return;
      const a = (res as any).monthlyA ?? (res as any).a;
      const b = (res as any).monthlyB ?? (res as any).b;
      setPreview({ a, b });
    }).catch(() => {});
  }, [selected, onPreview]);

  const apply = () => {
    const chosen = (suggestions || []).filter(s => selected[s.billId]);
    onApply(chosen);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Suggested Bill Date Adjustments</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            We found {suggestions?.length || 0} potential changes that could reduce monthly deposits. Select the ones to apply.
          </p>
          <div className="rounded-md bg-muted/40 p-3 text-sm">
            <div>
              <span className="text-muted-foreground">Current:</span>{' '}
              A <strong>{formatCurrency(currentMonthlyA ?? 0)}</strong> {freqALabel}
              {typeof currentMonthlyB === 'number' && (
                <>
                  {' '}| B <strong>{formatCurrency(currentMonthlyB)}</strong> {freqBLabel}
                </>
              )}
            </div>
            {Object.values(selected).some(Boolean) && (
              <div>
                <span className="text-muted-foreground">After apply (selected):</span>{' '}
                A <strong>{formatCurrency(preview.a ?? (currentMonthlyA ?? 0))}</strong> {freqALabel}
                {typeof currentMonthlyB === 'number' && (
                  <>
                    {' '}| B <strong>{formatCurrency(preview.b ?? currentMonthlyB)}</strong> {freqBLabel}
                  </>
                )}
              </div>
            )}
          </div>
          <div className="max-h-72 overflow-auto border rounded">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40 text-left">
                  <th className="p-2">Apply</th>
                  <th className="p-2">Bill</th>
                  <th className="p-2">Current</th>
                  <th className="p-2">Suggested</th>
                </tr>
              </thead>
              <tbody>
                {(suggestions || []).map((s) => (
                  <tr key={s.billId} className="border-t">
                    <td className="p-2">
                      <Checkbox
                        checked={!!selected[s.billId]}
                        onCheckedChange={(v) => setSelected(prev => ({ ...prev, [s.billId]: !!v }))}
                      />
                    </td>
                    <td className="p-2 whitespace-nowrap max-w-[10rem] truncate" title={s.name || s.billId}>{s.name || s.billId}</td>
                    <td className="p-2">{s.currentDate}</td>
                    <td className="p-2 font-medium">{s.suggestedDate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={onClose}>Close</Button>
            <Button onClick={apply} disabled={!Object.values(selected).some(Boolean)}>Apply selected</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

