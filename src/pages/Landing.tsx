import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { ensureGuestJourney } from '@/lib/journey';
import { buildMagicLinkRedirect } from '@/lib/env';
import NavBar from '@/components/NavBar';
import hero from '@/assets/hero-image.jpg';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Shield, Zap, Calculator, TrendingUp } from 'lucide-react';

export default function Landing() {
  const navigate = useNavigate();

  useEffect(() => {
    // If already signed in, keep it simple—show the landing but with an Open App CTA (NavBar handles)
    // If a guest journey exists, user can also jump straight in.
  }, []);

  const startGuest = async () => {
    await ensureGuestJourney();
    navigate('/app');
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <NavBar onTry={startGuest} />

      {/* Hero */}
      <section className="container mx-auto px-4 pt-10 pb-16 grid md:grid-cols-2 gap-8 items-center">
        <div>
          <h1 className="text-4xl sm:text-5xl font-bold leading-tight">Split expenses fairly. Stay ahead of bills.</h1>
          <p className="mt-4 text-muted-foreground text-lg">Fair Balance Buddy helps households forecast cashflow, pick fair deposits, and avoid surprises—securely and privately.</p>
          <div className="mt-6 flex gap-3">
            <Button size="lg" onClick={startGuest}>Try it free</Button>
            <Button size="lg" variant="outline" onClick={async () => {
              const email = window.prompt('Your email to sign up');
              if (!email) return;
              try {
                const redirectTo = buildMagicLinkRedirect();
                await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: redirectTo } });
                alert('Magic link sent. Check your email.');
              } catch (e) { console.warn(e); }
            }}>Sign up</Button>
          </div>
          <div className="mt-2 text-xs text-muted-foreground">Guest mode lasts 24 hours. Save progress by signing up.</div>
        </div>
        <div className="rounded-xl overflow-hidden border shadow-sm">
          <img src={hero} alt="A couple reviewing finances together with a laptop" className="w-full h-auto object-cover" />
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="container mx-auto px-4 py-10">
        <h2 className="text-2xl font-semibold mb-4">How it works</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Link bank or use mock</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">Connect via our partner or use built-in sample data. We never see your credentials.</CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <Calculator className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Detect wages & bills</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">We identify pay days and recurring bills, then build a monthly plan.</CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Forecast & split fairly</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">See deposits, buffers, and timeline so both partners contribute fairly.</CardContent>
          </Card>
        </div>
        <div className="mt-6">
          <Button onClick={startGuest}>Try it free</Button>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="container mx-auto px-4 py-10">
        <h2 className="text-2xl font-semibold mb-4">Why people use it</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Transparent deposits</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">See exactly how deposit amounts are calculated based on income and bills.</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Energy-aware planning</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">Upload electricity data and understand expected costs across the year.</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">No surprises</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">Forecasts help prevent mid-month dips and build healthy buffers.</CardContent>
          </Card>
        </div>
      </section>

      {/* Security */}
      <section id="security" className="container mx-auto px-4 py-10">
        <div className="flex items-start gap-3">
          <Shield className="h-5 w-5 text-primary mt-1" />
          <div>
            <h2 className="text-2xl font-semibold mb-2">Security & privacy</h2>
            <p className="text-sm text-muted-foreground">Bank linking is handled by our trusted partner. We never store your bank credentials. Guest mode lets you try the app without creating an account. You’re always in control.</p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-6 text-center text-xs text-muted-foreground">© {new Date().getFullYear()} Fair Balance Buddy</footer>
    </div>
  );
}
