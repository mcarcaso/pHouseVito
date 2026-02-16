import { useState, useEffect } from 'react';

interface ChannelConfig {
  enabled: boolean;
  streamMode?: string;
  allowedChatIds?: string[];
  allowedGuildIds?: string[];
  allowedChannelIds?: string[];
  [key: string]: any;
}

interface Config {
  channels: Record<string, ChannelConfig>;
}

const STREAM_MODES = [
  { value: 'stream', label: 'Stream', desc: 'Token-by-token streaming' },
  { value: 'bundled', label: 'Bundled', desc: 'Chunks of tokens' },
  { value: 'final', label: 'Final', desc: 'Wait for complete response' },
];

const CHANNEL_ICONS: Record<string, string> = {
  dashboard: '🖥️',
  telegram: '📱',
  discord: '🎮',
};

function Channels() {
  const [config, setConfig] = useState<Config | null>(null);
  const [initialEnabled, setInitialEnabled] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [needsRestart, setNeedsRestart] = useState(false);
  const [newId, setNewId] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch('/api/config')
      .then((res) => res.json())
      .then((data) => {
        setConfig({ channels: data.channels || {} });
        const enabled: Record<string, boolean> = {};
        for (const [name, ch] of Object.entries(data.channels || {})) {
          enabled[name] = (ch as ChannelConfig).enabled;
        }
        setInitialEnabled(enabled);
      })
      .catch((err) => console.error('Failed to load config:', err));
  }, []);

  const enabledChanged = config
    ? Object.keys(config.channels).some(
        (name) => config.channels[name].enabled !== initialEnabled[name]
      )
    : false;

  const save = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const willNeedRestart = enabledChanged;
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channels: config.channels }),
      });
      const updated = await res.json();
      setConfig({ channels: updated.channels });
      const newInitial: Record<string, boolean> = {};
      for (const [name, ch] of Object.entries(updated.channels || {})) {
        newInitial[name] = (ch as ChannelConfig).enabled;
      }
      setInitialEnabled(newInitial);
      if (willNeedRestart) {
        setNeedsRestart(true);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save config:', err);
    }
    setSaving(false);
  };

  const updateChannel = (name: string, key: string, value: any) => {
    if (!config) return;
    setConfig({
      channels: {
        ...config.channels,
        [name]: { ...config.channels[name], [key]: value },
      },
    });
  };

  const addId = (channelName: string, field: string) => {
    const inputKey = `${channelName}-${field}`;
    const val = newId[inputKey]?.trim();
    if (!config || !val) return;
    const current = config.channels[channelName]?.[field] || [];
    if (current.includes(val)) return;
    updateChannel(channelName, field, [...current, val]);
    setNewId({ ...newId, [inputKey]: '' });
  };

  const removeId = (channelName: string, field: string, id: string) => {
    if (!config) return;
    const current = config.channels[channelName]?.[field] || [];
    updateChannel(channelName, field, current.filter((c: string) => c !== id));
  };

  const getNewIdValue = (channelName: string, field: string) =>
    newId[`${channelName}-${field}`] || '';

  const setNewIdValue = (channelName: string, field: string, value: string) =>
    setNewId({ ...newId, [`${channelName}-${field}`]: value });

  if (!config) return <div className="p-4">Loading...</div>;

  const channelNames = Object.keys(config.channels);

  const renderIdList = (
    channelName: string,
    field: string,
    label: string,
    emptyText: string,
    placeholder: string
  ) => {
    const ids: string[] = config!.channels[channelName]?.[field] || [];
    return (
      <div className="flex flex-col gap-2 py-2.5 border-t border-[#1a1a1a]">
        <label className="text-sm text-[#ccc]">{label}</label>
        <div className="w-full overflow-x-auto">
          <div className="flex flex-wrap gap-1.5 mb-2 min-h-[28px]">
            {ids.length === 0 && (
              <span className="text-xs text-[#555] italic">{emptyText}</span>
            )}
            {ids.map((id: string) => (
              <span
                key={id}
                className="inline-flex items-center gap-1.5 bg-[#1a1a2e] border border-[#2a2a4a] text-[#8b8bcc] rounded px-2 py-1 text-sm font-mono"
              >
                {id}
                <button
                  className="bg-transparent border-none text-[#666] cursor-pointer text-base leading-none p-0 ml-1 hover:text-red-500"
                  onClick={() => removeId(channelName, field, id)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={getNewIdValue(channelName, field)}
              onChange={(e) => setNewIdValue(channelName, field, e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addId(channelName, field)}
              placeholder={placeholder}
              className="bg-[#111] border border-[#333] rounded-md px-2.5 py-1.5 text-[#e0e0e0] text-sm font-mono w-40 outline-none transition-colors focus:border-blue-600"
            />
            <button
              className="bg-[#1e3a5f] text-blue-400 border border-[#2a4a7a] rounded-md px-3 py-1.5 text-sm cursor-pointer transition-all hover:bg-[#244a7a] disabled:opacity-40 disabled:cursor-default"
              onClick={() => addId(channelName, field)}
              disabled={!getNewIdValue(channelName, field).trim()}
            >
              Add
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="p-4">
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-lg font-semibold text-white m-0">Channels</h2>
        <button
          className="ml-auto bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
          onClick={save}
          disabled={saving}
        >
          {saving ? 'Saving...' : saved ? 'Saved ✓' : 'Save'}
        </button>
      </div>

      {enabledChanged && !needsRestart && (
        <div className="flex items-center gap-2.5 mb-3 px-4 py-3 rounded-lg text-sm bg-[#2a2000] border border-[#5a4a00] text-[#f0d060]">
          <span className="text-base flex-shrink-0">⚠️</span>
          <span>You've toggled a channel. <strong className="font-semibold">Save and restart the server</strong> for changes to take effect.</span>
        </div>
      )}

      {needsRestart && (
        <div className="flex items-center gap-2.5 mb-3 px-4 py-3 rounded-lg text-sm bg-[#1a1a30] border border-[#3a3a6a] text-[#8888dd]">
          <span className="text-base flex-shrink-0">🔄</span>
          <span>Channel config saved. <strong className="font-semibold">Restart the server</strong> to apply changes.</span>
        </div>
      )}

      <div className="max-w-[700px] overflow-x-hidden">
        {channelNames.map((name) => {
          const ch = config.channels[name];
          const isTelegram = name === 'telegram';
          const isDiscord = name === 'discord';

          return (
            <section key={name} className="bg-[#151515] border border-[#222] rounded-xl p-5 mb-3">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{CHANNEL_ICONS[name] || '📡'}</span>
                  <h3 className="text-base font-semibold text-white">{name.charAt(0).toUpperCase() + name.slice(1)}</h3>
                </div>
                <label className="relative inline-block w-11 h-6 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ch.enabled}
                    onChange={(e) => updateChannel(name, 'enabled', e.target.checked)}
                    className="opacity-0 w-0 h-0 peer"
                  />
                  <span className="absolute inset-0 bg-[#333] rounded-full transition-colors peer-checked:bg-blue-800" />
                  <span className="absolute left-[3px] top-[3px] w-[18px] h-[18px] bg-[#888] rounded-full transition-all peer-checked:translate-x-5 peer-checked:bg-blue-400" />
                </label>
              </div>

              <div>
                {/* Stream Mode */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-2.5 border-t border-[#1a1a1a]">
                  <label className="flex-none sm:w-40 text-sm text-[#ccc]">Stream Mode</label>
                  <div className="flex rounded-md overflow-hidden border border-[#333] w-full sm:w-auto">
                    {STREAM_MODES.map((mode) => (
                      <button
                        key={mode.value}
                        className={`flex-1 sm:flex-none bg-[#111] border-none px-3 py-1.5 text-sm cursor-pointer transition-all border-r border-[#333] last:border-r-0 ${
                          ch.streamMode === mode.value
                            ? 'bg-[#1e3a5f] text-blue-400'
                            : 'text-[#888] hover:text-[#ccc] hover:bg-[#1a1a1a]'
                        }`}
                        onClick={() => updateChannel(name, 'streamMode', mode.value)}
                        title={mode.desc}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Telegram-specific settings */}
                {isTelegram && (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-2.5 border-t border-[#1a1a1a]">
                    <label className="flex-none sm:w-40 text-sm text-[#ccc]">Bot Token</label>
                    <div className="flex items-center gap-2 bg-[#111] border border-[#222] rounded-md px-3 py-2 text-sm text-[#999] overflow-x-auto">
                      <span className="text-base flex-shrink-0">🔑</span>
                      <span>
                        Configured via <code className="bg-[#1a1a2e] text-[#8b8bcc] px-1.5 py-0.5 rounded text-xs">TELEGRAM_BOT_TOKEN</code> in{' '}
                        <a href="/secrets" className="text-blue-400 no-underline hover:underline">Secrets</a>.
                        Get one from <strong>@BotFather</strong> on Telegram.
                      </span>
                    </div>
                  </div>
                )}

                {isTelegram &&
                  renderIdList(
                    name,
                    'allowedChatIds',
                    'Allowed Chat IDs',
                    'No chat IDs — all chats allowed',
                    'Chat ID'
                  )}

                {/* Discord-specific settings */}
                {isDiscord && (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-2.5 border-t border-[#1a1a1a]">
                    <label className="flex-none sm:w-40 text-sm text-[#ccc]">Bot Token</label>
                    <div className="flex items-center gap-2 bg-[#111] border border-[#222] rounded-md px-3 py-2 text-sm text-[#999] overflow-x-auto">
                      <span className="text-base flex-shrink-0">🔑</span>
                      <span>
                        Configured via <code className="bg-[#1a1a2e] text-[#8b8bcc] px-1.5 py-0.5 rounded text-xs">DISCORD_BOT_TOKEN</code> in{' '}
                        <a href="/secrets" className="text-blue-400 no-underline hover:underline">Secrets</a>.
                        Create at{' '}
                        <a
                          href="https://discord.com/developers/applications"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 no-underline hover:underline"
                        >
                          Discord Developer Portal
                        </a>.
                      </span>
                    </div>
                  </div>
                )}

                {isDiscord && (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-2.5 border-t border-[#1a1a1a]">
                    <label className="flex-none sm:w-40 text-sm text-[#ccc]">Require @Mention</label>
                    <div className="flex items-center gap-3">
                      <label className="relative inline-block w-11 h-6 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={ch.requireMention !== false}
                          onChange={(e) => updateChannel(name, 'requireMention', e.target.checked)}
                          className="opacity-0 w-0 h-0 peer"
                        />
                        <span className="absolute inset-0 bg-[#333] rounded-full transition-colors peer-checked:bg-blue-800" />
                        <span className="absolute left-[3px] top-[3px] w-[18px] h-[18px] bg-[#888] rounded-full transition-all peer-checked:translate-x-5 peer-checked:bg-blue-400" />
                      </label>
                      <span className="text-sm text-[#888]">
                        {ch.requireMention !== false
                          ? 'Bot only responds when @mentioned in servers'
                          : 'Bot responds to all messages in allowed channels'}
                      </span>
                    </div>
                  </div>
                )}

                {isDiscord &&
                  renderIdList(
                    name,
                    'allowedGuildIds',
                    'Allowed Server IDs',
                    'No server IDs — all servers allowed',
                    'Server (Guild) ID'
                  )}

                {isDiscord &&
                  renderIdList(
                    name,
                    'allowedChannelIds',
                    'Allowed Channel IDs',
                    'No channel IDs — all channels allowed',
                    'Channel ID'
                  )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

export default Channels;
