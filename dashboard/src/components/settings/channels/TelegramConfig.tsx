import { useState } from "react";
import type { ChannelConfig, VitoConfig } from "../../../utils/settingsResolution";
import {
  useAutoAliasChannel,
  useRegisterChannelCommands,
} from "../../../hooks/useChannelManagement";
import { errorMessage } from "../../../lib/api-client";

interface TelegramConfigProps {
  channelConfig: ChannelConfig;
  config: VitoConfig;
  onSave: (updates: Partial<VitoConfig>) => Promise<void>;
  renderIdList: (
    field: string,
    label: string,
    emptyText: string,
    placeholder: string,
  ) => React.ReactNode;
}

export default function TelegramConfig({ renderIdList }: TelegramConfigProps) {
  const registerCommands = useRegisterChannelCommands();
  const registeringCommands = registerCommands.isPending;
  const [commandsResult, setCommandsResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const autoAlias = useAutoAliasChannel();
  const autoAliasing = autoAlias.isPending;
  const [aliasResult, setAliasResult] = useState<{ success: boolean; message: string } | null>(
    null,
  );

  return (
    <>
      {/* Bot Token hint */}
      <div className="py-2.5 border-b border-neutral-800/50">
        <div className="flex items-center gap-2 text-sm text-neutral-500">
          <span>🔑</span>
          <span>
            Bot Token via{" "}
            <code className="bg-neutral-900 text-purple-400 px-1.5 py-0.5 rounded text-xs">
              TELEGRAM_BOT_TOKEN
            </code>{" "}
            in{" "}
            <a href="/secrets" className="text-blue-400 hover:underline">
              Secrets
            </a>
          </span>
        </div>
      </div>

      {/* Bot Commands */}
      <div className="flex flex-col gap-2 py-2.5 border-b border-neutral-800/50">
        <label className="text-sm text-neutral-300">Bot Commands</label>
        <div className="flex items-center gap-3">
          <button
            className="bg-green-950/40 text-green-400 border border-green-800/40 rounded-md px-3 py-1.5 text-sm cursor-pointer hover:bg-green-900/40 disabled:opacity-40"
            disabled={registeringCommands}
            onClick={async () => {
              setCommandsResult(null);
              try {
                const data = await registerCommands.mutateAsync("telegram");
                setCommandsResult(
                  data.success
                    ? { success: true, message: `Registered ${data.count} command(s)` }
                    : { success: false, message: data.error || "Failed" },
                );
              } catch (error: unknown) {
                setCommandsResult({ success: false, message: errorMessage(error, "Failed") });
              }
              setTimeout(() => setCommandsResult(null), 5000);
            }}
          >
            {registeringCommands ? "Registering..." : "Register Bot Commands"}
          </button>
          {commandsResult && (
            <span
              className={`text-sm ${commandsResult.success ? "text-green-400" : "text-red-400"}`}
            >
              {commandsResult.success ? "✓" : "✗"} {commandsResult.message}
            </span>
          )}
        </div>
        <span className="text-xs text-neutral-600">
          Sets /new and /stop in Telegram's command menu.
        </span>
      </div>

      {/* Auto-Generate Aliases */}
      <div className="flex flex-col gap-2 py-2.5 border-b border-neutral-800/50">
        <label className="text-sm text-neutral-300">Auto-Generate Aliases</label>
        <div className="flex items-center gap-3">
          <button
            className="bg-purple-950/40 text-purple-400 border border-purple-800/40 rounded-md px-3 py-1.5 text-sm cursor-pointer hover:bg-purple-900/40 disabled:opacity-40"
            disabled={autoAliasing}
            onClick={async () => {
              setAliasResult(null);
              try {
                const data = await autoAlias.mutateAsync("telegram");
                setAliasResult(
                  data.success
                    ? {
                        success: true,
                        message: `Updated ${data.updated ?? 0} session(s)${(data.failed ?? 0) > 0 ? `, ${data.failed} failed` : ""}`,
                      }
                    : { success: false, message: data.error || "Failed" },
                );
              } catch (error: unknown) {
                setAliasResult({ success: false, message: errorMessage(error, "Failed") });
              }
              setTimeout(() => setAliasResult(null), 5000);
            }}
          >
            {autoAliasing ? "Generating..." : "Set Default Aliases"}
          </button>
          {aliasResult && (
            <span className={`text-sm ${aliasResult.success ? "text-purple-400" : "text-red-400"}`}>
              {aliasResult.success ? "✓" : "✗"} {aliasResult.message}
            </span>
          )}
        </div>
        <span className="text-xs text-neutral-600">
          Sets chat name as alias for sessions without one.
        </span>
      </div>

      {/* Allowed Chat IDs */}
      {renderIdList(
        "allowedChatIds",
        "Allowed Chat IDs",
        "No chat IDs — all chats allowed",
        "Chat ID",
      )}
    </>
  );
}
