import { useState } from "react";
import { useAppAction, useAppFile, useAppFiles, useApps } from "../hooks/useApps";
import { errorMessage } from "../lib/api-client";

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const statusDotClass: Record<string, string> = {
  online: "bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.4)]",
  stopped: "bg-neutral-500",
  errored: "bg-red-400",
  unknown: "bg-yellow-400",
};

const statusBadgeClass: Record<string, string> = {
  online: "text-green-400 bg-green-400/10",
  stopped: "text-neutral-500 bg-neutral-500/10",
  errored: "text-red-400 bg-red-400/10",
  unknown: "text-yellow-400 bg-yellow-400/10",
};

export default function Apps() {
  const appsQuery = useApps();
  const apps = appsQuery.data ?? [];
  const loading = appsQuery.isPending;
  const [expandedApp, setExpandedApp] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<{ app: string; path: string } | null>(null);
  const filesQuery = useAppFiles(expandedApp);
  const fileQuery = useAppFile(selectedFile?.app ?? null, selectedFile?.path ?? null);
  const appAction = useAppAction();
  const actionLoading = appAction.isPending
    ? `${appAction.variables.appName}-${appAction.variables.action}`
    : null;
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleAction = async (appName: string, action: "restart" | "stop" | "start" | "delete") => {
    try {
      const data = await appAction.mutateAsync({ appName, action });
      showToast(data.message || `${action} successful`, "success");
      if (action === "delete") {
        setExpandedApp(null);
        setDeleteConfirm(null);
      }
    } catch (error: unknown) {
      showToast(errorMessage(error, `${action} failed`), "error");
    }
  };

  const toggleExpand = (appName: string) => {
    if (expandedApp === appName) {
      setExpandedApp(null);
    } else {
      setExpandedApp(appName);
    }
    setSelectedFile(null);
    setDeleteConfirm(null);
  };

  return (
    <div className="flex flex-col pb-8">
      {/* Toast notification */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-sm font-medium animate-[slideIn_0.2s_ease-out] ${
            toast.type === "success" ? "bg-green-600 text-white" : "bg-red-600 text-white"
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-800 sticky top-0 bg-black/95 backdrop-blur z-10">
        <h2 className="text-lg font-semibold text-white">Apps ({apps.length})</h2>
      </div>

      <div className="p-4 sm:p-6 max-w-[700px] mx-auto w-full">
        {loading ? (
          <div className="text-center text-neutral-500 py-12">Loading...</div>
        ) : apps.length === 0 ? (
          <div className="text-center text-neutral-500 py-12">No apps deployed yet</div>
        ) : (
          <div className="flex flex-col gap-3">
            {apps.map((app) => (
              <div
                key={app.name}
                className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden hover:border-neutral-700 transition-colors"
              >
                {/* Main card - clickable */}
                <div className="p-4 sm:p-5 cursor-pointer" onClick={() => toggleExpand(app.name)}>
                  {/* Header row */}
                  <div className="flex justify-between items-center mb-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${statusDotClass[app.status] || statusDotClass.unknown}`}
                      />
                      <span className="text-base font-semibold text-white">{app.name}</span>
                      <span
                        className={`ml-1 text-lg transition-transform ${expandedApp === app.name ? "rotate-180" : ""}`}
                      >
                        ▼
                      </span>
                    </div>
                    <span
                      className={`text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-md ${statusBadgeClass[app.status] || statusBadgeClass.unknown}`}
                    >
                      {app.status}
                    </span>
                  </div>

                  {app.description && (
                    <p className="text-sm text-neutral-500 mb-2 leading-relaxed">
                      {app.description}
                    </p>
                  )}

                  <a
                    href={app.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block text-sm text-blue-400 hover:underline mb-3"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {app.url.replace("https://", "")} ↗
                  </a>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600">
                    <span>Port {app.port}</span>
                    {app.uptime !== null && <span>Up {formatUptime(app.uptime)}</span>}
                    {app.memory !== null && <span>{formatBytes(app.memory)}</span>}
                    {app.restarts > 0 && <span>{app.restarts} restarts</span>}
                    {app.createdAt && <span>{formatDate(app.createdAt)}</span>}
                  </div>
                </div>

                {/* Expanded panel */}
                {expandedApp === app.name && (
                  <div className="border-t border-neutral-800 bg-neutral-950">
                    {/* Action buttons */}
                    <div className="p-4 flex flex-wrap gap-2 border-b border-neutral-800">
                      {app.status === "online" ? (
                        <>
                          <button
                            onClick={() => handleAction(app.name, "restart")}
                            disabled={actionLoading === `${app.name}-restart`}
                            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 transition-colors"
                          >
                            {actionLoading === `${app.name}-restart` ? "..." : "↻ Restart"}
                          </button>
                          <button
                            onClick={() => handleAction(app.name, "stop")}
                            disabled={actionLoading === `${app.name}-stop`}
                            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-neutral-700 hover:bg-neutral-600 text-white disabled:opacity-50 transition-colors"
                          >
                            {actionLoading === `${app.name}-stop` ? "..." : "⏹ Stop"}
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => handleAction(app.name, "start")}
                          disabled={actionLoading === `${app.name}-start`}
                          className="px-3 py-1.5 text-sm font-medium rounded-lg bg-green-600 hover:bg-green-500 text-white disabled:opacity-50 transition-colors"
                        >
                          {actionLoading === `${app.name}-start` ? "..." : "▶ Start"}
                        </button>
                      )}

                      {deleteConfirm === app.name ? (
                        <div className="flex gap-2 ml-auto">
                          <span className="text-sm text-red-400 self-center">Delete forever?</span>
                          <button
                            onClick={() => handleAction(app.name, "delete")}
                            disabled={actionLoading === `${app.name}-delete`}
                            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-red-600 hover:bg-red-500 text-white disabled:opacity-50 transition-colors"
                          >
                            {actionLoading === `${app.name}-delete` ? "..." : "Yes, Delete"}
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-neutral-700 hover:bg-neutral-600 text-white transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirm(app.name)}
                          className="px-3 py-1.5 text-sm font-medium rounded-lg bg-red-900/50 hover:bg-red-800/50 text-red-400 ml-auto transition-colors"
                        >
                          🗑 Delete
                        </button>
                      )}
                    </div>

                    {/* Files section */}
                    <div className="p-4">
                      <h4 className="text-sm font-semibold text-neutral-400 mb-3">Files</h4>

                      {filesQuery.isPending ? (
                        <div className="text-sm text-neutral-600">Loading files...</div>
                      ) : (
                        <div className="flex flex-col sm:flex-row gap-4">
                          {/* File list */}
                          <div className="sm:w-56 shrink-0">
                            <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
                              {(filesQuery.data ?? [])
                                .filter((f) => !f.isDir)
                                .map((file) => (
                                  <button
                                    key={file.path}
                                    onClick={() =>
                                      setSelectedFile({ app: app.name, path: file.path })
                                    }
                                    className={`text-left px-2 py-2 rounded text-sm transition-colors ${
                                      selectedFile?.app === app.name &&
                                      selectedFile?.path === file.path
                                        ? "bg-blue-600 text-white"
                                        : "text-neutral-300 hover:bg-neutral-800 hover:text-white"
                                    }`}
                                  >
                                    <div className="font-medium">{file.path.split("/").pop()}</div>
                                    {file.path.includes("/") && (
                                      <div className="text-xs opacity-50">
                                        {file.path.split("/").slice(0, -1).join("/")}/
                                      </div>
                                    )}
                                  </button>
                                ))}
                            </div>
                          </div>

                          {/* File content */}
                          <div className="flex-1 min-w-0">
                            {selectedFile?.app === app.name ? (
                              <div className="bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden">
                                <div className="px-3 py-2 bg-neutral-800 text-xs text-neutral-400 font-mono">
                                  {selectedFile.path}
                                </div>
                                <pre className="p-3 text-xs text-neutral-300 font-mono overflow-x-auto max-h-64 whitespace-pre-wrap break-all">
                                  {fileQuery.data?.content ??
                                    (fileQuery.isPending ? "Loading..." : "")}
                                </pre>
                              </div>
                            ) : (
                              <div className="text-sm text-neutral-600 italic">
                                Click a file to view its contents
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
