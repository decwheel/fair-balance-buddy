import { useEffect } from 'react';

export default function BankCallback() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reference = params.get('reference') || '';
    // partner is the first char before the dash
    const partner = /^[AB]/.test(reference) ? reference[0] : 'A';
    const payload = { type: 'GC_LINK_DONE', partner, requisitionId: reference };
    try {
      if (window.opener) {
        window.opener.postMessage(payload, window.location.origin);
      } else {
        // fallback broadcast
        const ch = new BroadcastChannel('fair-balance-buddy');
        ch.postMessage(payload);
        ch.close();
      }
    } catch {}
    setTimeout(() => window.close(), 200);
  }, []);

  return (
    <div style={{ padding: 24 }}>
      <h1>Bank linked</h1>
      <p>You can close this tab now.</p>
    </div>
  );
}
