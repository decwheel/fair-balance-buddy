-- Idempotent RLS policies for household-scoped tables so signed-in members
-- can read their own data and edge functions (service_role) can write.

-- Households: members can view; service role can manage
DO $body$
BEGIN
  -- Enable RLS
  EXECUTE 'ALTER TABLE public.households ENABLE ROW LEVEL SECURITY';

  -- View households you are a member of
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'households' AND policyname = 'Members can view households'
  ) THEN
    EXECUTE 'CREATE POLICY "Members can view households"
             ON public.households
             FOR SELECT
             USING (
               EXISTS (
                 SELECT 1 FROM public.household_members m
                 WHERE m.household_id = households.id AND m.user_id = auth.uid()
               )
             )';
  END IF;

  -- Service role full access
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'households' AND policyname = 'Service role can manage households'
  ) THEN
    EXECUTE 'CREATE POLICY "Service role can manage households"
             ON public.households
             FOR ALL
             USING (auth.role() = ''service_role'')
             WITH CHECK (auth.role() = ''service_role'')';
  END IF;
END
$body$;

-- Household members: members can view membership
DO $body$
BEGIN
  EXECUTE 'ALTER TABLE public.household_members ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'household_members' AND policyname = 'Members can view household members'
  ) THEN
    EXECUTE 'CREATE POLICY "Members can view household members"
             ON public.household_members
             FOR SELECT
             USING (
               EXISTS (
                 SELECT 1 FROM public.household_members x
                 WHERE x.household_id = household_members.household_id
                   AND x.user_id = auth.uid()
               )
             )';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'household_members' AND policyname = 'Service role can manage household members'
  ) THEN
    EXECUTE 'CREATE POLICY "Service role can manage household members"
             ON public.household_members
             FOR ALL
             USING (auth.role() = ''service_role'')
             WITH CHECK (auth.role() = ''service_role'')';
  END IF;
END
$body$;

-- Persons: members can view; service role can manage
DO $body$
BEGIN
  EXECUTE 'ALTER TABLE public.persons ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'persons' AND policyname = 'Members can view persons'
  ) THEN
    EXECUTE 'CREATE POLICY "Members can view persons"
             ON public.persons
             FOR SELECT
             USING (public.is_member(persons.household_id))';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'persons' AND policyname = 'Service role can manage persons'
  ) THEN
    EXECUTE 'CREATE POLICY "Service role can manage persons"
             ON public.persons
             FOR ALL
             USING (auth.role() = ''service_role'')
             WITH CHECK (auth.role() = ''service_role'')';
  END IF;
END
$body$;

-- Wages detected: members can view via person -> household; service role can manage
DO $body$
BEGIN
  EXECUTE 'ALTER TABLE public.wages_detected ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'wages_detected' AND policyname = 'Members can view wages'
  ) THEN
    EXECUTE 'CREATE POLICY "Members can view wages"
             ON public.wages_detected
             FOR SELECT
             USING (
               EXISTS (
                 SELECT 1
                 FROM public.persons p
                 WHERE p.id = wages_detected.person_id AND public.is_member(p.household_id)
               )
             )';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'wages_detected' AND policyname = 'Service role can manage wages'
  ) THEN
    EXECUTE 'CREATE POLICY "Service role can manage wages"
             ON public.wages_detected
             FOR ALL
             USING (auth.role() = ''service_role'')
             WITH CHECK (auth.role() = ''service_role'')';
  END IF;
END
$body$;

-- Recurring bills: members can view; service role can manage
DO $$
BEGIN
  EXECUTE 'ALTER TABLE public.recurring_bills ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'recurring_bills' AND policyname = 'Members can view recurring bills'
  ) THEN
    EXECUTE 'CREATE POLICY "Members can view recurring bills"
             ON public.recurring_bills
             FOR SELECT
             USING (public.is_member(recurring_bills.household_id))';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'recurring_bills' AND policyname = 'Service role can manage recurring bills'
  ) THEN
    EXECUTE 'CREATE POLICY "Service role can manage recurring bills"
             ON public.recurring_bills
             FOR ALL
             USING (auth.role() = ''service_role'')
             WITH CHECK (auth.role() = ''service_role'')';
  END IF;
END
$body$;

-- Electricity readings: members can view; service role can manage
DO $body$
BEGIN
  EXECUTE 'ALTER TABLE public.electricity_readings ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'electricity_readings' AND policyname = 'Members can view electricity readings'
  ) THEN
    EXECUTE 'CREATE POLICY "Members can view electricity readings"
             ON public.electricity_readings
             FOR SELECT
             USING (public.is_member(electricity_readings.household_id))';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'electricity_readings' AND policyname = 'Service role can manage electricity readings'
  ) THEN
    EXECUTE 'CREATE POLICY "Service role can manage electricity readings"
             ON public.electricity_readings
             FOR ALL
             USING (auth.role() = ''service_role'')
             WITH CHECK (auth.role() = ''service_role'')';
  END IF;
END
$body$;

-- Electricity bills: members can view; service role can manage
DO $body$
BEGIN
  EXECUTE 'ALTER TABLE public.electricity_bills ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'electricity_bills' AND policyname = 'Members can view electricity bills'
  ) THEN
    EXECUTE 'CREATE POLICY "Members can view electricity bills"
             ON public.electricity_bills
             FOR SELECT
             USING (public.is_member(electricity_bills.household_id))';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'electricity_bills' AND policyname = 'Service role can manage electricity bills'
  ) THEN
    EXECUTE 'CREATE POLICY "Service role can manage electricity bills"
             ON public.electricity_bills
             FOR ALL
             USING (auth.role() = ''service_role'')
             WITH CHECK (auth.role() = ''service_role'')';
  END IF;
END
$body$;

-- Forecasts: members can view; service role can manage
DO $body$
BEGIN
  EXECUTE 'ALTER TABLE public.forecasts ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'forecasts' AND policyname = 'Members can view forecasts'
  ) THEN
    EXECUTE 'CREATE POLICY "Members can view forecasts"
             ON public.forecasts
             FOR SELECT
             USING (public.is_member(forecasts.household_id))';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'forecasts' AND policyname = 'Service role can manage forecasts'
  ) THEN
    EXECUTE 'CREATE POLICY "Service role can manage forecasts"
             ON public.forecasts
             FOR ALL
             USING (auth.role() = ''service_role'')
             WITH CHECK (auth.role() = ''service_role'')';
  END IF;
END
$body$;

-- Forecast items: members can view via parent forecast; service role can manage
DO $body$
BEGIN
  EXECUTE 'ALTER TABLE public.forecast_items ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'forecast_items' AND policyname = 'Members can view forecast items'
  ) THEN
    EXECUTE 'CREATE POLICY "Members can view forecast items"
             ON public.forecast_items
             FOR SELECT
             USING (
               EXISTS (
                 SELECT 1 FROM public.forecasts f
                 WHERE f.id = forecast_items.forecast_id AND public.is_member(f.household_id)
               )
             )';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'forecast_items' AND policyname = 'Service role can manage forecast items'
  ) THEN
    EXECUTE 'CREATE POLICY "Service role can manage forecast items"
             ON public.forecast_items
             FOR ALL
             USING (auth.role() = ''service_role'')
             WITH CHECK (auth.role() = ''service_role'')';
  END IF;
END
$body$;
