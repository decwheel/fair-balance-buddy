import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { ensureGuestJourney } from '@/lib/journey';
import { buildMagicLinkRedirect } from '@/lib/env';
import NavBar from '@/components/NavBar';
import hero from '@/assets/hero-image.png';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Shield, Zap, Calculator, TrendingUp } from 'lucide-react';
import { Carousel, CarouselContent, CarouselItem, CarouselDots } from '@/components/ui/carousel';

export default function Landing() {
  const navigate = useNavigate();

  useEffect(() => {
    // If already signed in, keep it simple—show the landing but with an Open App CTA (NavBar handles)
    // If a guest journey exists, user can also jump straight in.
  }, []);

  const startGuest = async () => {
    await ensureGuestJourney();
    try {
      sessionStorage.setItem('show_guest_hint', '1');
      sessionStorage.setItem('start_at_setup', '1');
    } catch {}
    navigate('/app');
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <NavBar onTry={startGuest} />

      {/* Hero */}
      <section className="container mx-auto px-4 pt-8 pb-8 grid md:grid-cols-2 gap-8 items-center">
        <div>
          <h1 className="text-3xl sm:text-5xl font-semibold leading-tight">Fair splits. No surprises.</h1>
          <p className="mt-4 text-muted-foreground text-lg">Forecast cash‑flow, pick fair deposits, avoid surprises — secure and private.</p>
        </div>
        <div className="rounded-xl overflow-hidden border shadow-sm">
          <img src={hero} alt="A couple reviewing finances together with a laptop" className="w-full h-auto object-cover" />
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="container mx-auto px-4 pt-6 pb-6">
        <h2 className="text-2xl font-semibold mb-3">How it works</h2>
        <Carousel className="relative">
          <CarouselContent>
            <CarouselItem>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Choose your mode</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  Plan for yourself or a household (separate or joint accounts).
                </CardContent>
              </Card>
            </CarouselItem>
            <CarouselItem>
              <Card>
                <CardHeader className="flex flex-row items-center gap-2">
                  <Zap className="h-5 w-5 text-primary" />
                  <CardTitle className="text-base">Link your bank securely</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">Connect via our partner. We identify wages and recurring bills to build your plan.</CardContent>
              </Card>
            </CarouselItem>
            <CarouselItem>
              <Card>
                <CardHeader className="flex flex-row items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-primary" />
                  <CardTitle className="text-base">Predict irregular bills</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">Upload a CSV or last bill to forecast energy costs for the year.</CardContent>
              </Card>
            </CarouselItem>
            <CarouselItem>
              <Card>
                <CardHeader className="flex flex-row items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-primary" />
                  <CardTitle className="text-base">Add one‑off surprises</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">Car tax, lessons, insurance—add them so nothing catches you off guard.</CardContent>
              </Card>
            </CarouselItem>
            <CarouselItem>
              <Card>
                <CardHeader className="flex flex-row items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-primary" />
                  <CardTitle className="text-base">Forecast & split fairly</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">See deposits, buffers, and timeline so both partners contribute fairly.</CardContent>
              </Card>
            </CarouselItem>
          </CarouselContent>
          <div className="mt-2 flex justify-center">
            <CarouselDots />
          </div>
        </Carousel>
        
      </section>

      {/* Features */}
      <section id="features" className="container mx-auto px-4 pt-6 pb-8">
        <h2 className="text-2xl font-semibold mb-3">Why people use it</h2>
        <Carousel className="relative">
          <CarouselContent>
            <CarouselItem>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Transparent deposits</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">See exactly how deposit amounts are calculated based on income and bills.</CardContent>
              </Card>
            </CarouselItem>
            <CarouselItem>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Energy‑aware planning</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">Upload electricity data and understand expected costs across the year.</CardContent>
              </Card>
            </CarouselItem>
            <CarouselItem>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">No surprises</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">Forecasts help prevent mid‑month dips and build healthy buffers.</CardContent>
              </Card>
            </CarouselItem>
            <CarouselItem>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Your finance co‑pilot</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">Edit or add bills as life changes—deposits auto‑recalculate. Clearly see what’s left to live on and save each month.</CardContent>
              </Card>
            </CarouselItem>
          </CarouselContent>
          <div className="mt-2 flex justify-center">
            <CarouselDots />
          </div>
        </Carousel>
      </section>

      {/* Security */}
      <section id="security" className="container mx-auto px-4 py-10">
        <div className="flex items-start gap-3 text-xs text-muted-foreground">
          <Shield className="h-4 w-4 text-primary mt-0.5" />
          <p>
            Security & privacy: Bank linking is provided by our trusted partner. We never store your bank credentials. Guest mode lets you try the app without creating an account.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-6 text-center text-xs text-muted-foreground">© {new Date().getFullYear()} FairSplit</footer>
    </div>
  );
}
