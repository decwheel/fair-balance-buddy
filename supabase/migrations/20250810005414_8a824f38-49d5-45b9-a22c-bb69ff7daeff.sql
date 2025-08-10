-- Pin search_path for trigger function to satisfy linter
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
SET search_path = public
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;