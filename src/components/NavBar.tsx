import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { buildMagicLinkRedirect } from '@/lib/env';
import { createBillingPortalSession } from '@/lib/stripe';

export default function NavBar({ onTry }: { onTry: () => void }) {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => { try { subscription.unsubscribe(); } catch {} };
  }, []);

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded bg-primary/10 flex items-center justify-center text-primary font-bold">F</div>
          <div className="font-semibold">Fair Balance Buddy</div>
        </div>
        <nav className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
          <a href="#how-it-works" className="hover:text-foreground">How it works</a>
          <a href="#features" className="hover:text-foreground">Features</a>
          <a href="#security" className="hover:text-foreground">Security</a>
        </nav>
        <div className="flex items-center gap-2">
          {!email && (
            <>
              <Button variant="ghost" onClick={async () => {
                const email = window.prompt('Your email to sign in');
                if (!email) return;
                try {
                  const redirectTo = buildMagicLinkRedirect();
                  await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: true } });
                  alert('Magic link sent. Check your email.');
                } catch (e) { console.warn(e); }
              }}>Sign in</Button>
              <Button onClick={onTry}>Try it</Button>
            </>
          )}
          {email && (
            <>
              <Button variant="outline" onClick={() => { try { window.location.href = '/app'; } catch {} }}>Open App</Button>
              <Button variant="ghost" onClick={() => { try { window.location.href = '/account'; } catch {} }}>Account</Button>
              <Button variant="ghost" onClick={async () => {
                const url = await createBillingPortalSession();
                if (url) window.location.href = url;
              }}>Manage Subscription</Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
