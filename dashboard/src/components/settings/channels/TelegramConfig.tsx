import type { ChannelConfig, VitoConfig } from '../../../utils/settingsResolution';

interface TelegramConfigProps {
  channelConfig: ChannelConfig;
  config: VitoConfig;
  onSave: (updates: Partial<VitoConfig>) => Promise<void>;
  renderIdList: (field: string, label: string, emptyText: string, placeholder: string) => React.ReactNode;
}

export default function TelegramConfig({ channelConfig, config, onSave, renderIdList }: TelegramConfigProps) {
  return (
    <>
      {/* Bot Token hint */}
      <div className="py-2.5 border-b border-neutral-800/50">
        <div className="flex items-center gap-2 text-sm text-neutral-500">
          <span>🔑</span>
          <span>Bot Token via <code className="bg-neutral-900 text-purple-400 px-1.5 py-0.5 rounded text-xs">TELEGRAM_BOT_TOKEN</code> in <a href="/secrets" className="text-blue-400 hover:underline">Secrets</a></span>
        </div>
      </div>

      {/* Allowed Chat IDs */}
      {renderIdList('allowedChatIds', 'Allowed Chat IDs', 'No chat IDs — all chats allowed', 'Chat ID')}
    </>
  );
}
