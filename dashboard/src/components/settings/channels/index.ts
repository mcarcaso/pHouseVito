import type { ComponentType } from 'react';
import type { ChannelConfig, VitoConfig } from '../../../utils/settingsResolution';
import DiscordConfig from './DiscordConfig';
import TelegramConfig from './TelegramConfig';

export interface ChannelSpecificConfigProps {
  channelConfig: ChannelConfig;
  config: VitoConfig;
  onSave: (updates: Partial<VitoConfig>) => Promise<void>;
  renderIdList: (field: string, label: string, emptyText: string, placeholder: string) => React.ReactNode;
}

// Registry of channel-specific config components
// Channels not in this registry will just show the generic cascading settings
export const channelConfigComponents: Record<string, ComponentType<ChannelSpecificConfigProps>> = {
  discord: DiscordConfig,
  telegram: TelegramConfig,
};

// Channel icons — add new ones here
export const CHANNEL_ICONS: Record<string, string> = {
  dashboard: '🖥️',
  telegram: '📱',
  discord: '🎮',
  cli: '⌨️',
};
