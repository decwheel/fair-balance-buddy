import React from 'react';
import { Button } from '@/components/ui/button';

export function StickySummaryBar({
  aLabel,
  bLabel,
  minLabel,
  cta,
  onCta,
}: {
  aLabel?: string;
  bLabel?: string;
  minLabel?: string;
  cta: string;
  onCta: () => void;
}) {
  return (
    <div className="sticky bottom-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-t shadow-md safe-area-bottom">
      <div className="container mx-auto max-w-6xl px-4 py-3 flex items-center gap-3">
        <div className="flex-1 min-w-0 text-sm flex items-center gap-2">
          {aLabel && <span className="rounded-full bg-secondary px-2 py-1">{aLabel}</span>}
          {bLabel && <span className="rounded-full bg-secondary px-2 py-1">{bLabel}</span>}
          {minLabel && <span className="rounded-full bg-secondary px-2 py-1">{minLabel}</span>}
        </div>
        <Button className="shadow-md" onClick={onCta}>{cta}</Button>
      </div>
    </div>
  );
}

