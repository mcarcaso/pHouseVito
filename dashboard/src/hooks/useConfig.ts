import { useState, useEffect, useCallback, useRef } from 'react';
import type { VitoConfig } from '../utils/settingsResolution';

interface UseConfigReturn {
  config: VitoConfig | null;
  loading: boolean;
  error: string | null;
  saving: boolean;
  saved: boolean;
  /** Update specific fields via deep merge and save */
  updateConfig: (updates: Partial<VitoConfig>) => Promise<void>;
  /** Reload config from server */
  reload: () => Promise<void>;
}

export function useConfig(): UseConfigReturn {
  const [config, setConfig] = useState<VitoConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<number>();

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      setConfig(data);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load config');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, [load]);

  const updateConfig = useCallback(async (updates: Partial<VitoConfig>) => {
    setSaving(true);
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const updated = await res.json();
      setConfig(updated);
      setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      console.error('Failed to save config:', err);
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, []);

  return { config, loading, error, saving, saved, updateConfig, reload: load };
}
