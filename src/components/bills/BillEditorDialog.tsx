import React, { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type BillFrequency =
  | "one-off"
  | "weekly"
  | "fortnightly"
  | "four-weekly"
  | "monthly"
  | "quarterly"
  | "yearly";

export interface BillEditorValues {
  name: string;
  amount: number;
  dueDate: string; // ISO yyyy-mm-dd
  frequency: BillFrequency;
}

interface BillEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDate?: string | null;
  initialValues?: Partial<BillEditorValues>;
  onSubmit: (values: BillEditorValues) => void;
}

export const BillEditorDialog: React.FC<BillEditorDialogProps> = ({
  open,
  onOpenChange,
  initialDate,
  initialValues,
  onSubmit,
}) => {
  const [name, setName] = useState(initialValues?.name ?? "");
  const [amount, setAmount] = useState<string>(
    initialValues?.amount !== undefined ? String(initialValues.amount) : ""
  );
  const [dueDate, setDueDate] = useState(
    initialValues?.dueDate ?? initialDate ?? new Date().toISOString().slice(0, 10)
  );
  const [frequency, setFrequency] = useState<BillFrequency>(
    (initialValues?.frequency as BillFrequency) ?? "one-off"
  );

  // Reset when dialog opens with different defaults
  React.useEffect(() => {
    if (open) {
      setName(initialValues?.name ?? "");
      setAmount(initialValues?.amount !== undefined ? String(initialValues.amount) : "");
      setDueDate(initialValues?.dueDate ?? initialDate ?? new Date().toISOString().slice(0, 10));
      setFrequency((initialValues?.frequency as BillFrequency) ?? "one-off");
    }
  }, [open, initialValues, initialDate]);

  const isValid = useMemo(() => {
    const a = parseFloat(amount);
    return name.trim().length > 0 && !Number.isNaN(a) && a > 0 && /\d{4}-\d{2}-\d{2}/.test(dueDate);
  }, [name, amount, dueDate]);

  const handleSubmit = () => {
    if (!isValid) return;
    onSubmit({ name: name.trim(), amount: parseFloat(amount), dueDate, frequency });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initialValues ? "Edit Bill" : "Add Bill"}</DialogTitle>
          <DialogDescription>Set the bill details and frequency.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="bill-name">Name</Label>
            <Input id="bill-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Broadband" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="bill-amount">Amount (€)</Label>
              <Input id="bill-amount" type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="bill-date">Due date</Label>
              <Input id="bill-date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Frequency</Label>
            <Select value={frequency} onValueChange={(v) => setFrequency(v as BillFrequency)}>
              <SelectTrigger>
                <SelectValue placeholder="Select frequency" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="one-off">One-off</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="fortnightly">Fortnightly</SelectItem>
                <SelectItem value="four-weekly">Four-weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="quarterly">Quarterly</SelectItem>
                <SelectItem value="yearly">Yearly</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!isValid}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
