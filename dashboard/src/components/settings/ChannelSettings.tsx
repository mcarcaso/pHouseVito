import { useEffect, useState } from "react";
import type { VitoConfig } from "../../utils/settingsResolution";
import ChannelConfigEditor from "./ChannelConfigEditor";

interface ChannelSettingsProps {
  config: VitoConfig;
  onSave: (updates: Partial<VitoConfig>) => Promise<void>;
}

export default function ChannelSettings({ config, onSave }: ChannelSettingsProps) {
  const channelNames = Object.keys(config.channels || {});
  const [selectedChannel, setSelectedChannel] = useState(channelNames[0] ?? "");

  useEffect(() => {
    if (!selectedChannel || !config.channels[selectedChannel]) {
      setSelectedChannel(channelNames[0] ?? "");
    }
  }, [channelNames, config.channels, selectedChannel]);

  if (channelNames.length === 0) {
    return <div className="text-neutral-500 text-sm p-4">No channels configured.</div>;
  }

  const channelConfig = config.channels[selectedChannel];

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">
          Channel
        </label>
        <select
          value={selectedChannel}
          onChange={(event) => setSelectedChannel(event.target.value)}
          className="w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2.5 text-neutral-200 text-sm focus:outline-none focus:border-blue-600"
        >
          {channelNames.map((name) => (
            <option key={name} value={name}>
              {name.charAt(0).toUpperCase() + name.slice(1).replace("-", " ")}
            </option>
          ))}
        </select>
      </div>

      {channelConfig && (
        <ChannelConfigEditor
          key={selectedChannel}
          name={selectedChannel}
          channelConfig={channelConfig}
          config={config}
          onSave={onSave}
        />
      )}
    </div>
  );
}
