import React from 'react';

export function ProcessingIndicator({ busy, done, label }: { busy: boolean; done?: boolean; label?: string }) {
  if (!busy && !done) return null;
  return (
    <div className="flex flex-col items-center justify-center gap-2 select-none" aria-live="polite">
      {label && (
        <div className="text-xs text-muted-foreground text-center leading-none">{label}</div>
      )}
      {busy ? (
        <div className="relative w-12 h-12" role="status" aria-label="Processing">
          <div className="absolute inset-0 rounded-full" style={{ background: 'radial-gradient(circle at 50% 50%, hsl(var(--success)/0.12) 0%, transparent 70%)' }} />
          <div
            className="absolute inset-0 rounded-full border-4 animate-spin"
            style={{ borderColor: 'hsl(var(--success))', borderTopColor: 'transparent', animationDuration: '900ms' }}
          />
          <div className="absolute inset-1 rounded-full" style={{ boxShadow: 'inset 0 0 10px hsl(var(--success)/0.25)' }} />
        </div>
      ) : (
        <div className="relative w-12 h-12 ai-popin" aria-label="Done">
          <div className="absolute inset-0 rounded-full" style={{ background: 'hsl(var(--success))' }} />
          {/* Smiley face */}
          <svg viewBox="0 0 48 48" className="absolute inset-0">
            <circle cx="17" cy="19" r="2" fill="white" />
            <circle cx="31" cy="19" r="2" fill="white" />
            <path d="M16 28c2.5 3 6 5 8 5s5.5-2 8-5" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </div>
      )}
    </div>
  );
}
