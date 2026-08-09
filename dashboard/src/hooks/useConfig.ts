import { useState, useEffect, useCallback, useRef } from 'react';
import {
  vitoConfigSchema,
  type VitoConfig,
  type VitoConfigPatch,
} from '../../../src/shared/contracts/vito-config';

interface UseConfigReturn {
  config: VitoConfig | null;
  loading: boolean;
  error: string | null;
  saving: boolean;
  saved: boolean;
  /** Update specific fields via deep merge and save */
  updateConfig: (updates: VitoConfigPatch) => Promise<void>;
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
      const data = vitoConfigSchema.parse(await res.json());
      setConfig(data);
      setError(null);
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'Failed to load config');
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

  const updateConfig = useCallback(async (updates: VitoConfigPatch) => {
    setSaving(true);
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const updated = vitoConfigSchema.parse(await res.json());
      setConfig(updated);
      setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => setSaved(false), 2000);
    } catch (error: unknown) {
      console.error('Failed to save config:', error);
      setError(error instanceof Error ? error.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, []);

  return { config, loading, error, saving, saved, updateConfig, reload: load };
}
