"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { LoaderCircle } from "lucide-react";

type GlobalLoadingContextValue = {
  isLoading: boolean;
};

const GlobalLoadingContext = createContext<GlobalLoadingContextValue | null>(null);

export function GlobalLoadingProvider({ children }: { children: ReactNode }) {
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("Procesando la operación...");
  const activeRequests = useRef(0);
  const releaseTimers = useRef(new Set<number>());

  const beginLoading = useCallback((nextMessage = "Procesando la operación...") => {
    if (activeRequests.current === 0) setMessage(nextMessage);
    activeRequests.current += 1;
    setIsLoading(true);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      activeRequests.current = Math.max(0, activeRequests.current - 1);
      if (activeRequests.current === 0) setIsLoading(false);
    };
  }, []);

  useEffect(() => {
    const originalFetch = window.fetch;
    let mounted = true;

    const trackedFetch: typeof window.fetch = async (input, init) => {
      const request = input instanceof Request ? input : null;
      const url = new URL(request ? request.url : input.toString(), window.location.href);
      const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
      const isApiRequest =
        url.origin === window.location.origin && url.pathname.startsWith("/api/");
      const isWriteRequest = method !== "GET" && method !== "HEAD";

      if (
        !isApiRequest ||
        method === "HEAD" ||
        (!isWriteRequest && activeRequests.current === 0)
      ) {
        return originalFetch.call(window, input, init);
      }

      const release = beginLoading(
        isWriteRequest ? "Procesando la operación..." : "Actualizando la información...",
      );

      try {
        return await originalFetch.call(window, input, init);
      } finally {
        if (mounted) {
          let timer = 0;
          timer = window.setTimeout(() => {
            releaseTimers.current.delete(timer);
            release();
          }, 180);
          releaseTimers.current.add(timer);
        }
      }
    };

    window.fetch = trackedFetch;
    return () => {
      mounted = false;
      window.fetch = originalFetch;
      releaseTimers.current.forEach((timer) => window.clearTimeout(timer));
      releaseTimers.current.clear();
      activeRequests.current = 0;
    };
  }, [beginLoading]);

  return (
    <GlobalLoadingContext.Provider value={{ isLoading }}>
      {children}
      {isLoading && (
        <div className="global-loading-overlay" role="status" aria-live="polite" aria-busy="true">
          <div className="global-loading-card">
            <LoaderCircle className="global-loading-spinner spin" size={36} aria-hidden="true" />
            <strong>{message}</strong>
            <small>Espera un momento, por favor.</small>
          </div>
        </div>
      )}
    </GlobalLoadingContext.Provider>
  );
}

export function useGlobalLoading() {
  const context = useContext(GlobalLoadingContext);
  if (!context) throw new Error("useGlobalLoading debe usarse dentro de GlobalLoadingProvider.");
  return context;
}
