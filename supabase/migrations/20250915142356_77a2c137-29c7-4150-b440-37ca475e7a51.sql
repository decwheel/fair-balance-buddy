-- Fix CRITICAL security issue: Plans table has overly permissive RLS policies
-- Current policies allow ANY authenticated user to read/write ALL business plans
-- This exposes sensitive business data, configurations, and pricing strategies

-- Drop the existing dangerous "allow all" policies
DROP POLICY IF EXISTS "read all" ON public.plans;
DROP POLICY IF EXISTS "insert all" ON public.plans;
DROP POLICY IF EXISTS "update all" ON public.plans;
DROP POLICY IF EXISTS "delete all" ON public.plans;

-- Create secure RLS policies that restrict access based on client ownership
-- Plans should only be accessible to their owners (based on client_id matching user context)
CREATE POLICY "Users can view their own plans" 
ON public.plans 
FOR SELECT 
USING (auth.uid()::text = client_id OR auth.role() = 'service_role');

CREATE POLICY "Users can create their own plans" 
ON public.plans 
FOR INSERT 
WITH CHECK (auth.uid()::text = client_id);

CREATE POLICY "Users can update their own plans" 
ON public.plans 
FOR UPDATE 
USING (auth.uid()::text = client_id)
WITH CHECK (auth.uid()::text = client_id);

CREATE POLICY "Users can delete their own plans" 
ON public.plans 
FOR DELETE 
USING (auth.uid()::text = client_id);

-- Fix Journey Data Access: Currently all client access is blocked (USING false)
-- This prevents legitimate users from accessing their own journey data
-- Update to allow users to access journeys they own or are upgraded to

-- Drop the overly restrictive policy that blocks all access
DROP POLICY IF EXISTS "no_client_access" ON public.journeys;

-- Create proper RLS policies for journey access
CREATE POLICY "Users can view their upgraded journeys" 
ON public.journeys 
FOR SELECT 
USING (
  upgraded = true 
  AND upgraded_user = auth.uid()
);

-- Only service role can create/update journeys (edge functions)
CREATE POLICY "Service role can manage journeys" 
ON public.journeys 
FOR ALL 
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- Improve Household Management: Add policies to allow household owners to manage membership
-- Currently users can only view their own membership but can't manage household access

-- Allow household members to invite/manage other members (owners only)
CREATE POLICY "Household owners can manage members" 
ON public.household_members 
FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.household_members existing 
    WHERE existing.household_id = household_members.household_id 
    AND existing.user_id = auth.uid() 
    AND existing.role = 'owner'
  )
);

CREATE POLICY "Household owners can update member roles" 
ON public.household_members 
FOR UPDATE 
USING (
  EXISTS (
    SELECT 1 FROM public.household_members existing 
    WHERE existing.household_id = household_members.household_id 
    AND existing.user_id = auth.uid() 
    AND existing.role = 'owner'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.household_members existing 
    WHERE existing.household_id = household_members.household_id 
    AND existing.user_id = auth.uid() 
    AND existing.role = 'owner'
  )
);

CREATE POLICY "Users can leave households" 
ON public.household_members 
FOR DELETE 
USING (user_id = auth.uid());

-- Add journey secret expiration and security enhancements
-- Add expiry tracking for journey secrets
ALTER TABLE public.journeys 
ADD COLUMN IF NOT EXISTS secret_expires_at TIMESTAMP WITH TIME ZONE DEFAULT (now() + interval '24 hours'),
ADD COLUMN IF NOT EXISTS created_by_ip INET,
ADD COLUMN IF NOT EXISTS access_count INTEGER DEFAULT 0;

-- Create function to check if journey secret is expired
CREATE OR REPLACE FUNCTION public.is_journey_secret_valid(journey_id uuid, secret text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM journeys j
    WHERE j.id = journey_id 
    AND j.secret = secret 
    AND j.secret_expires_at > now()
  );
$$;

-- Create trigger to update access count and detect suspicious activity
CREATE OR REPLACE FUNCTION public.track_journey_access()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Update access count for monitoring
  UPDATE journeys 
  SET access_count = access_count + 1 
  WHERE id = NEW.id;
  
  -- Log if access count is suspiciously high (potential abuse)
  IF (SELECT access_count FROM journeys WHERE id = NEW.id) > 1000 THEN
    RAISE LOG 'High journey access count detected for journey_id: %', NEW.id;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create audit log table for plan modifications (security monitoring)
CREATE TABLE IF NOT EXISTS public.plan_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid REFERENCES public.plans(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  action text NOT NULL, -- 'INSERT', 'UPDATE', 'DELETE'
  old_data jsonb,
  new_data jsonb,
  created_at timestamp with time zone DEFAULT now(),
  ip_address inet,
  user_agent text
);

-- Enable RLS on audit log
ALTER TABLE public.plan_audit_log ENABLE ROW LEVEL SECURITY;

-- Only allow users to view their own audit logs
CREATE POLICY "Users can view their own plan audit logs" 
ON public.plan_audit_log 
FOR SELECT 
USING (user_id = auth.uid());

-- Create audit trigger function
CREATE OR REPLACE FUNCTION public.audit_plan_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO plan_audit_log (plan_id, user_id, action, old_data)
    VALUES (OLD.id, auth.uid(), TG_OP, to_jsonb(OLD));
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO plan_audit_log (plan_id, user_id, action, old_data, new_data)
    VALUES (NEW.id, auth.uid(), TG_OP, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO plan_audit_log (plan_id, user_id, action, new_data)
    VALUES (NEW.id, auth.uid(), TG_OP, to_jsonb(NEW));
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;

-- Create audit triggers
DROP TRIGGER IF EXISTS plan_audit_trigger ON public.plans;
CREATE TRIGGER plan_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.audit_plan_changes();