-- Security events table + RLS + triggers for household role escalations

CREATE TABLE IF NOT EXISTS public.security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id),
  event_type text NOT NULL,
  severity text NOT NULL DEFAULT 'info', -- info|low|medium|high|critical
  detail jsonb,
  ip inet,
  user_agent text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to insert their own events; restrict reads
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='security_events' AND policyname='Users can insert own events'
  ) THEN
    EXECUTE $$CREATE POLICY "Users can insert own events"
      ON public.security_events
      FOR INSERT
      WITH CHECK (user_id = auth.uid())$$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='security_events' AND policyname='Service role can select events'
  ) THEN
    EXECUTE $$CREATE POLICY "Service role can select events"
      ON public.security_events
      FOR SELECT
      USING (auth.role() = 'service_role')$$;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_security_events_created_at ON public.security_events(created_at);
CREATE INDEX IF NOT EXISTS idx_security_events_type ON public.security_events(event_type);

-- Trigger to log household privilege escalation (role -> owner)
CREATE OR REPLACE FUNCTION public.audit_household_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
BEGIN
  actor := auth.uid();
  IF TG_OP = 'INSERT' THEN
    IF NEW.role = 'owner' THEN
      INSERT INTO public.security_events(user_id, event_type, severity, detail)
      VALUES (actor, 'household_role_set_owner', 'high', jsonb_build_object('household_id', NEW.household_id, 'target_user', NEW.user_id));
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF COALESCE(OLD.role, '') <> COALESCE(NEW.role, '') THEN
      INSERT INTO public.security_events(user_id, event_type, severity, detail)
      VALUES (
        actor,
        CASE WHEN NEW.role = 'owner' THEN 'household_role_escalation' ELSE 'household_role_change' END,
        CASE WHEN NEW.role = 'owner' THEN 'high' ELSE 'medium' END,
        jsonb_build_object('household_id', NEW.household_id, 'target_user', NEW.user_id, 'old_role', OLD.role, 'new_role', NEW.role)
      );
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.security_events(user_id, event_type, severity, detail)
    VALUES (actor, 'household_member_removed', 'medium', jsonb_build_object('household_id', OLD.household_id, 'target_user', OLD.user_id, 'old_role', OLD.role));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='household_members') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS household_members_audit ON public.household_members';
    EXECUTE $tg$
      CREATE TRIGGER household_members_audit
      AFTER INSERT OR UPDATE OR DELETE ON public.household_members
      FOR EACH ROW EXECUTE FUNCTION public.audit_household_role_change()
    $tg$;
  END IF;
END $$;

