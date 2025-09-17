import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { getAccountStatus } from '@/lib/account';
import { createCheckoutSession } from '@/lib/stripe';
import { supabase } from '@/integrations/supabase/client';

export function PaywallModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data?.session) return; // guest mode not paywalled
      const s = await getAccountStatus();
      if (!s) return;
      const expired = !s.isSubscribed && !!s.trialEndsAt && new Date(s.trialEndsAt) <= new Date();
      if (expired) setOpen(true);
    })();
  }, []);

  if (!open) return null;

  return (
    <Dialog open={open}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Continue with FairSplit</DialogTitle>
          <DialogDescription>
            Your free trial has ended. Upgrade to keep your data and access all features.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button
            onClick={async () => {
              const url = await createCheckoutSession();
              if (url) window.location.href = url;
            }}
          >
            Upgrade
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default PaywallModal;
