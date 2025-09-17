import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { buildMagicLinkRedirect } from '@/lib/env';
import { createBillingPortalSession } from '@/lib/stripe';

export default function NavBar({ onTry }: { onTry: () => void }) {

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto pr-4 pl-16 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3 select-none">
          <div className="text-lg font-semibold">FairSplit</div>
        </div>
        <nav className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
          <a href="#how-it-works" className="hover:text-foreground">How it works</a>
          <a href="#features" className="hover:text-foreground">Features</a>
          <a href="#security" className="hover:text-foreground">Security</a>
        </nav>
        <div className="flex items-center gap-2">
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
        </div>
      </div>
    </header>
  );
}
