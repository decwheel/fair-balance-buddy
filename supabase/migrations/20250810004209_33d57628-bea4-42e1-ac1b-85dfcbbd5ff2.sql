-- Create helper function for updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create bills table
CREATE TABLE IF NOT EXISTS public.bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  due_date DATE NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'one-off', -- 'one-off','weekly','fortnightly','four-weekly','monthly','quarterly','yearly'
  recurrence_anchor DATE NULL,
  recurrence_interval INTEGER NOT NULL DEFAULT 1,
  series_id UUID NULL,
  movable BOOLEAN NOT NULL DEFAULT TRUE,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view their own bills"
ON public.bills FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own bills"
ON public.bills FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own bills"
ON public.bills FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own bills"
ON public.bills FOR DELETE
USING (auth.uid() = user_id);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS trg_update_bills_updated_at ON public.bills;
CREATE TRIGGER trg_update_bills_updated_at
BEFORE UPDATE ON public.bills
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_bills_user_id ON public.bills(user_id);
CREATE INDEX IF NOT EXISTS idx_bills_due_date ON public.bills(due_date);
CREATE INDEX IF NOT EXISTS idx_bills_series_id ON public.bills(series_id);