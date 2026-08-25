import { useState } from "react";
import { useRestartServer, useServerStatus } from "../hooks/useServer";

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function formatSystemMemory(bytes: number): string {
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export default function Server() {
  const statusQuery = useServerStatus();
  const restartServer = useRestartServer();
  const status = statusQuery.data ?? null;
  const restarting = restartServer.isPending;
  const [confirmRestart, setConfirmRestart] = useState(false);

  const handleRestart = async () => {
    if (!confirmRestart) {
      setConfirmRestart(true);
      setTimeout(() => setConfirmRestart(false), 4000);
      return;
    }

    setConfirmRestart(false);
    await restartServer.mutateAsync().catch(() => undefined);
  };

  return (
    <div className="flex flex-col pb-8">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-800 sticky top-0 bg-black/95 backdrop-blur z-10">
        <h2 className="text-lg font-semibold text-white">Server</h2>
      </div>

      <div className="p-4 sm:p-6 max-w-[600px] sm:max-w-[700px] mx-auto w-full space-y-4">
        {/* Status Card */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5 sm:p-6">
          <h3 className="text-base font-semibold text-white mb-4">Status</h3>
          {status ? (
            <div className="flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-neutral-500">Status</span>
                <span className="text-sm text-green-400 font-mono">● Online</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-neutral-500">Uptime</span>
                <span className="text-sm text-neutral-300 font-mono">
                  {formatUptime(status.uptime)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-neutral-500">PID</span>
                <span className="text-sm text-neutral-300 font-mono">{status.pid}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-neutral-500">Node</span>
                <span className="text-sm text-neutral-300 font-mono">{status.nodeVersion}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-neutral-500">System CPU</span>
                <span className="text-sm text-neutral-300 font-mono">
                  {status.system.cpuUsage.toFixed(1)}%
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-neutral-500">System RAM</span>
                <span className="text-sm text-neutral-300 font-mono">
                  {formatSystemMemory(status.system.memoryUsed)} /{" "}
                  {formatSystemMemory(status.system.memoryTotal)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-neutral-500">Process Memory (RSS)</span>
                <span className="text-sm text-neutral-300 font-mono">
                  {formatBytes(status.memoryUsage.rss)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-neutral-500">Heap Used</span>
                <span className="text-sm text-neutral-300 font-mono">
                  {formatBytes(status.memoryUsage.heapUsed)} /{" "}
                  {formatBytes(status.memoryUsage.heapTotal)}
                </span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-neutral-500">Status</span>
                <span className="text-sm text-red-400 font-mono">● Offline</span>
              </div>
            </div>
          )}
        </div>

        {/* Restart Card */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5 sm:p-6">
          <h3 className="text-base font-semibold text-white mb-2">Restart</h3>
          <p className="text-sm text-neutral-500 mb-4 leading-relaxed">
            Rebuilds the dashboard and restarts the server via PM2. The server will be briefly
            unavailable.
          </p>

          {restarting ? (
            <div className="flex items-center gap-3 p-3.5 bg-blue-950/50 border border-blue-600 rounded-xl text-blue-400 text-sm font-medium">
              <div className="w-4.5 h-4.5 border-2 border-neutral-700 border-t-blue-400 rounded-full animate-spin shrink-0" />
              <span>Restarting server...</span>
            </div>
          ) : (
            <button
              className={`w-full p-3.5 rounded-xl text-sm font-semibold cursor-pointer transition-all ${
                confirmRestart
                  ? "bg-red-900 border border-red-400 text-white animate-pulse"
                  : "bg-neutral-800 border border-neutral-700 text-red-400 hover:bg-red-950/50 hover:border-red-400"
              }`}
              onClick={handleRestart}
            >
              {confirmRestart ? "Are you sure? Click again to confirm" : "Restart Server"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
