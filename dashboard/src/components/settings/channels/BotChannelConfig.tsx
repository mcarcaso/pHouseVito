import { useState } from "react";
import { Link } from "react-router-dom";
import {
  useAutoAliasChannel,
  useRegisterChannelCommands,
} from "../../../hooks/useChannelManagement";
import { errorMessage } from "../../../lib/api-client";
import type { ChannelIdField } from ".";

type BotChannelName = "discord" | "telegram";

interface IdListConfig {
  field: ChannelIdField;
  label: string;
  emptyText: string;
  placeholder: string;
}

interface BotChannelConfigProps {
  channel: BotChannelName;
  tokenEnvironmentVariable: string;
  commandsLabel: string;
  commandsButtonLabel: string;
  commandsDescription: string;
  aliasDescription: string;
  idLists: IdListConfig[];
  renderIdList: (
    field: ChannelIdField,
    label: string,
    emptyText: string,
    placeholder: string,
  ) => React.ReactNode;
}

interface ActionResult {
  success: boolean;
  message: string;
}

export default function BotChannelConfig({
  channel,
  tokenEnvironmentVariable,
  commandsLabel,
  commandsButtonLabel,
  commandsDescription,
  aliasDescription,
  idLists,
  renderIdList,
}: BotChannelConfigProps) {
  const registerCommands = useRegisterChannelCommands();
  const autoAlias = useAutoAliasChannel();
  const [commandsResult, setCommandsResult] = useState<ActionResult | null>(null);
  const [aliasResult, setAliasResult] = useState<ActionResult | null>(null);

  const runCommandRegistration = async () => {
    setCommandsResult(null);
    try {
      const data = await registerCommands.mutateAsync(channel);
      setCommandsResult(
        data.success
          ? { success: true, message: `Registered ${data.count ?? 0} command(s)` }
          : { success: false, message: data.error || "Failed" },
      );
    } catch (error: unknown) {
      setCommandsResult({ success: false, message: errorMessage(error, "Failed") });
    }
    setTimeout(() => setCommandsResult(null), 5_000);
  };

  const runAutoAlias = async () => {
    setAliasResult(null);
    try {
      const data = await autoAlias.mutateAsync(channel);
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
    setTimeout(() => setAliasResult(null), 5_000);
  };

  return (
    <>
      <div className="py-2.5 border-b border-neutral-800/50">
        <div className="flex items-center gap-2 text-sm text-neutral-500">
          <span>🔑</span>
          <span>
            Bot Token via{" "}
            <code className="bg-neutral-900 text-purple-400 px-1.5 py-0.5 rounded text-xs">
              {tokenEnvironmentVariable}
            </code>{" "}
            in{" "}
            <Link to="/secrets" className="text-blue-400 hover:underline">
              Secrets
            </Link>
          </span>
        </div>
      </div>

      <ManagementAction
        label={commandsLabel}
        buttonLabel={commandsButtonLabel}
        pendingLabel="Registering..."
        description={commandsDescription}
        pending={registerCommands.isPending}
        result={commandsResult}
        tone="green"
        onClick={() => void runCommandRegistration()}
      />

      <ManagementAction
        label="Auto-Generate Aliases"
        buttonLabel="Set Default Aliases"
        pendingLabel="Generating..."
        description={aliasDescription}
        pending={autoAlias.isPending}
        result={aliasResult}
        tone="purple"
        onClick={() => void runAutoAlias()}
      />

      {idLists.map(({ field, label, emptyText, placeholder }) => (
        <div key={field}>{renderIdList(field, label, emptyText, placeholder)}</div>
      ))}
    </>
  );
}

function ManagementAction({
  label,
  buttonLabel,
  pendingLabel,
  description,
  pending,
  result,
  tone,
  onClick,
}: {
  label: string;
  buttonLabel: string;
  pendingLabel: string;
  description: string;
  pending: boolean;
  result: ActionResult | null;
  tone: "green" | "purple";
  onClick: () => void;
}) {
  const buttonClass =
    tone === "green"
      ? "bg-green-950/40 text-green-400 border-green-800/40 hover:bg-green-900/40"
      : "bg-purple-950/40 text-purple-400 border-purple-800/40 hover:bg-purple-900/40";
  return (
    <div className="flex flex-col gap-2 py-2.5 border-b border-neutral-800/50">
      <label className="text-sm text-neutral-300">{label}</label>
      <div className="flex items-center gap-3">
        <button
          className={`${buttonClass} border rounded-md px-3 py-1.5 text-sm cursor-pointer disabled:opacity-40`}
          disabled={pending}
          onClick={onClick}
        >
          {pending ? pendingLabel : buttonLabel}
        </button>
        {result && (
          <span className={`text-sm ${result.success ? "text-green-400" : "text-red-400"}`}>
            {result.success ? "✓" : "✗"} {result.message}
          </span>
        )}
      </div>
      <span className="text-xs text-neutral-600">{description}</span>
    </div>
  );
}
