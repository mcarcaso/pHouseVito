import type { VitoConfig } from '../../utils/settingsResolution';
import ChannelConfigEditor from './ChannelConfigEditor';

interface ChannelSettingsProps {
  config: VitoConfig;
  onSave: (updates: Partial<VitoConfig>) => Promise<void>;
}

export default function ChannelSettings({ config, onSave }: ChannelSettingsProps) {
  const channelNames = Object.keys(config.channels || {});

  if (channelNames.length === 0) {
    return (
      <div className="text-neutral-500 text-sm p-4">
        No channels configured.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="mb-2">
        <p className="text-xs text-neutral-600">
          Per-channel config and setting overrides. Overrides inherit from Global defaults.
        </p>
      </div>

      {channelNames.map((name) => (
        <ChannelConfigEditor
          key={name}
          name={name}
          channelConfig={config.channels[name]}
          config={config}
          onSave={onSave}
        />
      ))}
    </div>
  );
}
