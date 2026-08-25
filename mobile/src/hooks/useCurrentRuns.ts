import { useEffect, useState } from "react";
import { api } from "../services/api/client";

export interface CurrentRun {
  sessionKey: string;
  channel: string;
  author: string;
  preview: string;
  status: "active" | "queued";
  timestamp: number;
}

export function useCurrentRuns(refetchInterval = 2_000) {
  const [runs, setRuns] = useState<CurrentRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const current = await api<CurrentRun[]>("/api/runs");
        if (mounted) setRuns(Array.isArray(current) ? current : []);
      } catch {
        // Runs are live process state; keep the last successful snapshot.
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void load();
    const timer = setInterval(() => void load(), refetchInterval);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [refetchInterval]);

  return { runs, loading };
}
