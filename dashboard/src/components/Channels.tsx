import { useState, useEffect } from 'react';
import './Channels.css';

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
      // Update initial state to match saved state
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

  if (!config) return <div className="channels-page">Loading...</div>;

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
      <div className="setting-row chat-ids-row">
        <label>{label}</label>
        <div className="chat-ids-section">
          <div className="chat-ids-list">
            {ids.length === 0 && (
              <span className="chat-ids-empty">{emptyText}</span>
            )}
            {ids.map((id: string) => (
              <span key={id} className="chat-id-tag">
                {id}
                <button
                  className="chat-id-remove"
                  onClick={() => removeId(channelName, field, id)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="chat-id-input-row">
            <input
              type="text"
              value={getNewIdValue(channelName, field)}
              onChange={(e) => setNewIdValue(channelName, field, e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addId(channelName, field)}
              placeholder={placeholder}
            />
            <button
              className="chat-id-add-btn"
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
    <div className="channels-page">
      <div className="page-header">
        <h2>Channels</h2>
        <button className="header-save-btn" onClick={save} disabled={saving}>
          {saving ? 'Saving...' : saved ? 'Saved ✓' : 'Save'}
        </button>
      </div>

      {enabledChanged && !needsRestart && (
        <div className="channels-banner channels-banner-warning">
          <span className="banner-icon">⚠️</span>
          <span>You've toggled a channel. <strong>Save and restart the server</strong> for changes to take effect.</span>
        </div>
      )}

      {needsRestart && (
        <div className="channels-banner channels-banner-restart">
          <span className="banner-icon">🔄</span>
          <span>Channel config saved. <strong>Restart the server</strong> to apply changes.</span>
        </div>
      )}

      <div className="channels-content">
        {channelNames.map((name) => {
          const ch = config.channels[name];
          const isTelegram = name === 'telegram';
          const isDiscord = name === 'discord';

          return (
            <section key={name} className="channel-card">
              <div className="channel-header">
                <div className="channel-name-row">
                  <span className="channel-icon">
                    {CHANNEL_ICONS[name] || '📡'}
                  </span>
                  <h3>{name.charAt(0).toUpperCase() + name.slice(1)}</h3>
                </div>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={ch.enabled}
                    onChange={(e) => updateChannel(name, 'enabled', e.target.checked)}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>

              <div className="channel-settings">
                <div className="setting-row">
                  <label>Stream Mode</label>
                  <div className="stream-mode-group">
                    {STREAM_MODES.map((mode) => (
                      <button
                        key={mode.value}
                        className={`stream-mode-btn ${ch.streamMode === mode.value ? 'active' : ''}`}
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
                  <div className="setting-row token-note-row">
                    <label>Bot Token</label>
                    <div className="token-note">
                      <span className="token-note-icon">🔑</span>
                      <span>
                        Configured via <code>TELEGRAM_BOT_TOKEN</code> in{' '}
                        <a href="/secrets" className="token-note-link">Secrets</a>.
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
                  <div className="setting-row token-note-row">
                    <label>Bot Token</label>
                    <div className="token-note">
                      <span className="token-note-icon">🔑</span>
                      <span>
                        Configured via <code>DISCORD_BOT_TOKEN</code> in{' '}
                        <a href="/secrets" className="token-note-link">Secrets</a>.
                        Create at{' '}
                        <a
                          href="https://discord.com/developers/applications"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="token-note-link"
                        >
                          Discord Developer Portal
                        </a>.
                      </span>
                    </div>
                  </div>
                )}

                {isDiscord && (
                  <div className="setting-row">
                    <label>Require @Mention</label>
                    <div className="toggle-with-desc">
                      <label className="toggle-switch">
                        <input
                          type="checkbox"
                          checked={ch.requireMention !== false}
                          onChange={(e) => updateChannel(name, 'requireMention', e.target.checked)}
                        />
                        <span className="toggle-slider" />
                      </label>
                      <span className="toggle-desc">
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
