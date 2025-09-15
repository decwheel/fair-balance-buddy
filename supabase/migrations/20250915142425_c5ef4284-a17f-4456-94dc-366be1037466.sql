-- Fix security issues with proper policy management
-- Check and update existing policies instead of assuming they don't exist

-- First check what policies currently exist and drop only the dangerous ones
DO $$
BEGIN
    -- Drop dangerous "allow all" policies if they exist
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'plans' AND policyname = 'read all') THEN
        DROP POLICY "read all" ON public.plans;
    END IF;
    
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'plans' AND policyname = 'insert all') THEN
        DROP POLICY "insert all" ON public.plans;
    END IF;
    
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'plans' AND policyname = 'update all') THEN
        DROP POLICY "update all" ON public.plans;
    END IF;
    
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'plans' AND policyname = 'delete all') THEN
        DROP POLICY "delete all" ON public.plans;
    END IF;

    -- Only create secure policies if they don't exist
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'plans' AND policyname = 'Users can view their own plans') THEN
        EXECUTE 'CREATE POLICY "Users can view their own plans" ON public.plans FOR SELECT USING (auth.uid()::text = client_id OR auth.role() = ''service_role'')';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'plans' AND policyname = 'Users can create their own plans') THEN
        EXECUTE 'CREATE POLICY "Users can create their own plans" ON public.plans FOR INSERT WITH CHECK (auth.uid()::text = client_id)';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'plans' AND policyname = 'Users can update their own plans') THEN
        EXECUTE 'CREATE POLICY "Users can update their own plans" ON public.plans FOR UPDATE USING (auth.uid()::text = client_id) WITH CHECK (auth.uid()::text = client_id)';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'plans' AND policyname = 'Users can delete their own plans') THEN
        EXECUTE 'CREATE POLICY "Users can delete their own plans" ON public.plans FOR DELETE USING (auth.uid()::text = client_id)';
    END IF;
END
$$;

-- Fix Journey Access - Drop restrictive policy and add proper ones
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'journeys' AND policyname = 'no_client_access') THEN
        DROP POLICY "no_client_access" ON public.journeys;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'journeys' AND policyname = 'Users can view their upgraded journeys') THEN
        EXECUTE 'CREATE POLICY "Users can view their upgraded journeys" ON public.journeys FOR SELECT USING (upgraded = true AND upgraded_user = auth.uid())';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'journeys' AND policyname = 'Service role can manage journeys') THEN
        EXECUTE 'CREATE POLICY "Service role can manage journeys" ON public.journeys FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')';
    END IF;
END
$$;

-- Add journey security columns
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'journeys' AND column_name = 'secret_expires_at') THEN
        ALTER TABLE public.journeys ADD COLUMN secret_expires_at TIMESTAMP WITH TIME ZONE DEFAULT (now() + interval '24 hours');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'journeys' AND column_name = 'created_by_ip') THEN
        ALTER TABLE public.journeys ADD COLUMN created_by_ip INET;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'journeys' AND column_name = 'access_count') THEN
        ALTER TABLE public.journeys ADD COLUMN access_count INTEGER DEFAULT 0;
    END IF;
END
$$;

-- Create security functions
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
    AND (j.secret_expires_at IS NULL OR j.secret_expires_at > now())
  );
$$;