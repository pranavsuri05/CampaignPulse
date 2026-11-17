"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";

export function useApi<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(loader, deps);
  const reload = useCallback(() => {
    const id = ++seq.current;
    setLoading(true);
    load()
      .then((d) => { if (id === seq.current) { setData(d); setError(null); } })
      .catch((e) => { if (id === seq.current) setError(e instanceof ApiError ? e : new ApiError(0, "error", String(e))); })
      .finally(() => { if (id === seq.current) setLoading(false); });
  }, [load]);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload };
}
