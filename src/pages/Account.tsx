import { useEffect, useState } from 'react';
import { getAccountStatus, type AccountStatus } from '@/lib/account';
import { createBillingPortalSession, createCheckoutSession } from '@/lib/stripe';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function Account() {
  const [email, setEmail] = useState<string | null>(null);
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        setEmail(data.user?.email ?? null);
      } catch {}
      const st = await getAccountStatus();
      setStatus(st);
      setLoading(false);
    })();
  }, []);

  const onUpgrade = async () => {
    const url = await createCheckoutSession();
    if (url) window.location.href = url;
  };
  const onManage = async () => {
    const url = await createBillingPortalSession();
    if (url) window.location.href = url;
  };

  return (
    <div className="max-w-2xl mx-auto p-4">
      <h1 className="text-2xl font-semibold mb-4">Account</h1>
      <Card>
        <CardHeader>
          <CardTitle>Plan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-sm text-muted-foreground">
            Signed in as {email ?? 'guest'}
          </div>
          {loading && <div className="text-sm">Loading status…</div>}
          {!loading && !status && (
            <div className="text-sm">Not signed in.</div>
          )}
          {!loading && status && (
            <>
              {status.isSubscribed ? (
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">Subscribed</div>
                    <div className="text-sm text-muted-foreground">Thanks for supporting Fair Balance Buddy.</div>
                  </div>
                  <Button onClick={onManage}>Manage billing</Button>
                </div>
              ) : status.isTrialing ? (
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">Free trial</div>
                    <div className="text-sm text-muted-foreground">
                      Ends {status.trialEndsAt ? new Date(status.trialEndsAt).toLocaleDateString() : 'soon'}
                    </div>
                  </div>
                  <Button onClick={onUpgrade}>Upgrade</Button>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">Plan inactive</div>
                    <div className="text-sm text-muted-foreground">Your trial has ended.</div>
                  </div>
                  <Button onClick={onUpgrade}>Upgrade</Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <div className="mt-6 flex gap-2">
        <Button variant="secondary" onClick={() => { try { window.location.href = '/'; } catch {} }}>Back to dashboard</Button>
        <Button variant="destructive" onClick={async () => { try { await supabase.auth.signOut(); window.location.href = '/'; } catch {} }}>Sign out</Button>
      </div>
    </div>
  );
}

