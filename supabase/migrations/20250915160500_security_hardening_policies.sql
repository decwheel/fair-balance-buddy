-- Idempotent hardening of plans RLS, audit logging, journeys expiry/rls

-- PLANS: enable RLS and remove allow-all policies
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='plans' AND policyname='read all') THEN
    EXECUTE 'DROP POLICY "read all" ON public.plans';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='plans' AND policyname='insert all') THEN
    EXECUTE 'DROP POLICY "insert all" ON public.plans';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='plans' AND policyname='update all') THEN
    EXECUTE 'DROP POLICY "update all" ON public.plans';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='plans' AND policyname='delete all') THEN
    EXECUTE 'DROP POLICY "delete all" ON public.plans';
  END IF;
END $$;

-- Owner-scoped policies
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='plans' AND policyname='Users can view their own plans') THEN
    EXECUTE $$CREATE POLICY "Users can view their own plans"
      ON public.plans FOR SELECT
      USING (auth.uid()::text = client_id OR auth.role() = 'service_role')$$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='plans' AND policyname='Users can create their own plans') THEN
    EXECUTE $$CREATE POLICY "Users can create their own plans"
      ON public.plans FOR INSERT
      WITH CHECK (auth.uid()::text = client_id)$$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='plans' AND policyname='Users can update their own plans') THEN
    EXECUTE $$CREATE POLICY "Users can update their own plans"
      ON public.plans FOR UPDATE
      USING (auth.uid()::text = client_id)
      WITH CHECK (auth.uid()::text = client_id)$$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='plans' AND policyname='Users can delete their own plans') THEN
    EXECUTE $$CREATE POLICY "Users can delete their own plans"
      ON public.plans FOR DELETE
      USING (auth.uid()::text = client_id)$$;
  END IF;
END $$;

-- Audit log table + policy + trigger
CREATE TABLE IF NOT EXISTS public.plan_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid REFERENCES public.plans(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  action text NOT NULL,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.plan_audit_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='plan_audit_log' AND policyname='Users can view their own plan audit logs') THEN
    EXECUTE $$CREATE POLICY "Users can view their own plan audit logs"
      ON public.plan_audit_log FOR SELECT
      USING (user_id = auth.uid())$$;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.audit_plan_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.plan_audit_log (plan_id, user_id, action, old_data)
    VALUES (OLD.id, auth.uid(), 'DELETE', to_jsonb(OLD));
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.plan_audit_log (plan_id, user_id, action, old_data, new_data)
    VALUES (NEW.id, auth.uid(), 'UPDATE', to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO public.plan_audit_log (plan_id, user_id, action, new_data)
    VALUES (NEW.id, auth.uid(), 'INSERT', to_jsonb(NEW));
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='plans') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS plan_audit_trigger ON public.plans';
    EXECUTE $tg$
      CREATE TRIGGER plan_audit_trigger
      AFTER INSERT OR UPDATE OR DELETE ON public.plans
      FOR EACH ROW EXECUTE FUNCTION public.audit_plan_changes()
    $tg$;
  END IF;
END $$;

-- JOURNEYS: expiry + index + function + RLS
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='journeys' AND column_name='secret_expires_at'
  ) THEN
    ALTER TABLE public.journeys
      ADD COLUMN secret_expires_at timestamptz DEFAULT (now() + interval '24 hours');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_journeys_secret_expires_at ON public.journeys(secret_expires_at);

CREATE OR REPLACE FUNCTION public.is_journey_secret_valid(journey_id uuid, secret text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.journeys j
    WHERE j.id = journey_id
      AND j.secret = secret
      AND j.secret_expires_at > now()
  );
$$;

ALTER TABLE public.journeys ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='journeys' AND policyname='no_client_access') THEN
    EXECUTE 'DROP POLICY "no_client_access" ON public.journeys';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='journeys' AND policyname='Users can view their upgraded journeys') THEN
    EXECUTE $$CREATE POLICY "Users can view their upgraded journeys"
      ON public.journeys FOR SELECT
      USING (upgraded = true AND upgraded_user = auth.uid())$$;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='journeys' AND policyname='Service role can manage journeys') THEN
    EXECUTE $$CREATE POLICY "Service role can manage journeys"
      ON public.journeys FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role')$$;
  END IF;
END $$;

