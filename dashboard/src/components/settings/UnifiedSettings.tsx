import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useConfig } from '../../hooks/useConfig';
import GlobalSettings from './GlobalSettings';
import ChannelSettings from './ChannelSettings';
import SessionSettingsPanel from './SessionSettingsPanel';

type Tab = 'global' | 'channels' | 'sessions';

export default function UnifiedSettings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as Tab) || 'global';
  const initialSessionId = searchParams.get('session') || undefined;
  const [tab, setTab] = useState<Tab>(initialTab);
  const { config, loading, error, saving, saved, updateConfig } = useConfig();

  const switchTab = (newTab: Tab) => {
    setTab(newTab);
    const params = new URLSearchParams();
    if (newTab !== 'global') params.set('tab', newTab);
    setSearchParams(params, { replace: true });
  };

  if (loading) {
    return <div className="flex flex-col pb-8 text-neutral-400 p-4">Loading...</div>;
  }

  if (error || !config) {
    return <div className="p-4 text-red-400">Error: {error || 'Failed to load config'}</div>;
  }

  return (
    <div className="flex flex-col pb-8">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-800 sticky top-0 md:top-0 bg-black/95 backdrop-blur z-10">
        <h2 className="text-lg font-semibold text-white">Settings</h2>
        <div className="flex-1" />
        {saving && <span className="text-xs text-neutral-500">Saving...</span>}
        {saved && <span className="text-xs text-green-400 animate-[fadeIn_0.2s]">\u2713 Saved</span>}
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-neutral-800 px-4 sticky top-[52px] md:top-[52px] bg-[#0a0a0a] z-[9]">
        {(['global', 'channels', 'sessions'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => switchTab(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === t
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-neutral-500 hover:text-neutral-300'
            }`}
          >
            {t === 'global' ? 'Global' : t === 'channels' ? 'Channels' : 'Sessions'}
            {t === 'channels' && config.channels && (
              <span className="ml-1.5 text-xs text-neutral-600">({Object.keys(config.channels).length})</span>
            )}
            {t === 'sessions' && config.sessions && Object.keys(config.sessions).length > 0 && (
              <span className="ml-1.5 text-xs text-neutral-600">({Object.keys(config.sessions).length})</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-4 max-w-2xl">
        {tab === 'global' && <GlobalSettings config={config} onSave={updateConfig} />}
        {tab === 'channels' && <ChannelSettings config={config} onSave={updateConfig} />}
        {tab === 'sessions' && (
          <SessionSettingsPanel
            config={config}
            onSave={updateConfig}
            initialSessionId={initialSessionId}
          />
        )}
      </div>
    </div>
  );
}
