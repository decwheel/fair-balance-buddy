import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { getAccountStatus } from '@/lib/account';
import { createCheckoutSession } from '@/lib/stripe';

function daysLeft(trialEndsAt: string | null): number | null {
  if (!trialEndsAt) return null;
  const end = new Date(trialEndsAt).getTime();
  const now = Date.now();
  const diff = Math.ceil((end - now) / 86400000);
  return diff > 0 ? diff : 0;
}

export function TrialBanner() {
  const [dismissed, setDismissed] = useState(false);
  const [status, setStatus] = useState<{ days: number; endsAt: string } | null>(null);

  useEffect(() => {
    try { setDismissed(sessionStorage.getItem('trial_banner_dismissed') === '1'); } catch {}
    (async () => {
      const s = await getAccountStatus();
      if (!s || s.isSubscribed || !s.isTrialing) return;
      const d = daysLeft(s.trialEndsAt);
      if (d == null || d <= 0) return;
      setStatus({ days: d, endsAt: s.trialEndsAt! });
    })();
  }, []);

  if (dismissed || !status) return null;

  return (
    <div className="px-3 sm:px-0">
      <Alert className="flex items-center justify-between">
        <AlertDescription className="text-sm">
          {status.days} days left in your free trial. Upgrade to keep your data and features.
        </AlertDescription>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => { try { sessionStorage.setItem('trial_banner_dismissed', '1'); } catch {}; setDismissed(true); }}
          >
            Dismiss
          </Button>
          <Button
            size="sm"
            onClick={async () => {
              const url = await createCheckoutSession();
              if (url) window.location.href = url;
            }}
          >
            Upgrade
          </Button>
        </div>
      </Alert>
    </div>
  );
}

export default TrialBanner;

