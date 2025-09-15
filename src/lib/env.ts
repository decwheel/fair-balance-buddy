export function getPublicRedirectBase(): string {
  // 1) Prefer explicit Vite env if present
  try {
    const envBase = (import.meta as any)?.env?.VITE_PUBLIC_REDIRECT_BASE as string | undefined;
    if (envBase && typeof envBase === 'string' && envBase.startsWith('http')) return envBase.replace(/\/$/, '');
  } catch {}
  // 2) If running on localhost, keep localhost so dev flow remains local
  try {
    const origin = window.location.origin;
    if (/^https?:\/\/localhost(?::\d+)?$/i.test(origin) || /^https?:\/\/127\.0\.0\.1(?::\d+)?$/i.test(origin)) {
      return `${origin}${window.location.pathname}`.replace(/\/$/, '');
    }
  } catch {}
  // 3) Fallback to canonical hosted domain for production/preview
  return 'https://fair-balance-buddy.lovable.app';
}

export function buildMagicLinkRedirect(journey?: { journey_id?: string; journey_secret?: string }): string {
  const base = getPublicRedirectBase();
  const sp = new URLSearchParams();
  try {
    const id = journey?.journey_id || (localStorage.getItem('journey_id') || '');
    const sec = journey?.journey_secret || (localStorage.getItem('journey_secret') || '');
    if (id && sec) {
      sp.set('journey_id', id);
      sp.set('journey_secret', sec);
    }
  } catch {}
  return sp.toString() ? `${base}?${sp.toString()}` : base;
}
