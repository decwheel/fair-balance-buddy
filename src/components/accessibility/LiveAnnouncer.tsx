import React, { createContext, useContext, useRef, useEffect, useState } from 'react';

type Ctx = { announce: (msg: string) => void };
const LiveCtx = createContext<Ctx>({ announce: () => {} });

export function LiveAnnouncer({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState("");
  const timeoutRef = useRef<number | null>(null);

  const announce = (msg: string) => {
    setMessage("");
    // ensure DOM update clears previous message for SRs
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => setMessage(msg), 20);
  };

  useEffect(() => () => { if (timeoutRef.current) window.clearTimeout(timeoutRef.current); }, []);

  return (
    <LiveCtx.Provider value={{ announce }}>
      {children}
      <div aria-live="polite" aria-atomic="true" className="sr-only" id="live-region">
        {message}
      </div>
    </LiveCtx.Provider>
  );
}

export function useAnnounce() {
  return useContext(LiveCtx);
}

