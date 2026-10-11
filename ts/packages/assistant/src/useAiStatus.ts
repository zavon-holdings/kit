// The status a screen renders, loaded through the host. The package holds no
// address: the host's `load` asks its own backend, which asks the gateway.
import { useCallback, useEffect, useRef, useState } from "react";
import type { AiStatus } from "./types.js";

export interface UseAiStatusOptions {
  /** Loads the status through the host's own backend. */
  load: () => Promise<AiStatus>;
  /** Loads it again every this many milliseconds. Off when absent or 0. */
  refreshMs?: number;
}

export interface UseAiStatusResult {
  /** The status, or null while it loads and after a failed load: AI is then hidden. */
  status: AiStatus | null;
  loading: boolean;
  /** The last load's failure, or null. A failure is never thrown into render. */
  error: unknown;
  /** Loads the status again, for example after a run spent credits. */
  refresh: () => Promise<void>;
}

export function useAiStatus({ load, refreshMs }: UseAiStatusOptions): UseAiStatusResult {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const seq = useRef(0);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    let next: AiStatus | null = null;
    let failure: unknown = null;
    try {
      const got = await loadRef.current();
      if (got && typeof got === "object" && typeof got.state === "string") {
        next = { ...got, tools: Array.isArray(got.tools) ? got.tools : [] };
      } else {
        failure = new Error("The status has no state.");
      }
    } catch (e) {
      failure = e ?? new Error("The status did not load.");
    }
    // Only the latest load counts, and only while mounted.
    if (!mounted.current || mine !== seq.current) return;
    setStatus(next);
    setError(failure);
    setLoading(false);
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  useEffect(() => {
    if (!refreshMs || refreshMs <= 0) return;
    const id = setInterval(() => void refresh(), refreshMs);
    return () => clearInterval(id);
  }, [refresh, refreshMs]);

  return { status, loading, error, refresh };
}
