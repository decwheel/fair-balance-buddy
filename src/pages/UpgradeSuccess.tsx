import { useEffect } from 'react';
import { getAccountStatus } from '@/lib/account';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function UpgradeSuccess() {
  useEffect(() => {
    // Attempt to refresh status on load
    getAccountStatus().catch(() => {});
  }, []);

  return (
    <div className="max-w-md mx-auto p-4">
      <Card>
        <CardHeader>
          <CardTitle>Thanks for upgrading!</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-sm text-muted-foreground">
            Your subscription is now active. You can return to your dashboard.
          </div>
          <Button onClick={() => { try { window.location.href = '/'; } catch {} }}>Go to dashboard</Button>
        </CardContent>
      </Card>
    </div>
  );
}

