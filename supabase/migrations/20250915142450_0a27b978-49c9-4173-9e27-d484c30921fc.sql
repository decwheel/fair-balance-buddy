-- Fix Function Search Path Mutable security warning
-- Update functions to have immutable search_path for security

-- Update the is_journey_secret_valid function with proper search_path
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

-- Update the track_journey_access function with proper search_path
CREATE OR REPLACE FUNCTION public.track_journey_access()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Update access count for monitoring
  UPDATE public.journeys 
  SET access_count = access_count + 1 
  WHERE id = NEW.id;
  
  -- Log if access count is suspiciously high (potential abuse)
  IF (SELECT access_count FROM public.journeys WHERE id = NEW.id) > 1000 THEN
    RAISE LOG 'High journey access count detected for journey_id: %', NEW.id;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Update the audit_plan_changes function with proper search_path
CREATE OR REPLACE FUNCTION public.audit_plan_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.plan_audit_log (plan_id, user_id, action, old_data)
    VALUES (OLD.id, auth.uid(), TG_OP, to_jsonb(OLD));
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.plan_audit_log (plan_id, user_id, action, old_data, new_data)
    VALUES (NEW.id, auth.uid(), TG_OP, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO public.plan_audit_log (plan_id, user_id, action, new_data)
    VALUES (NEW.id, auth.uid(), TG_OP, to_jsonb(NEW));
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;

-- Update existing is_member function with proper search_path (if it doesn't already have it)
CREATE OR REPLACE FUNCTION public.is_member(hh uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.household_members m
    WHERE m.household_id = hh
      AND m.user_id = auth.uid()
  );
$$;

-- Update existing update_updated_at_column function with proper search_path
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;