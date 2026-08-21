import { useCallback, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { z } from "zod";
import { useDeleteTrace, useTraceDetail, useTraces } from "../hooks/useTraces";
import TraceDetail from "./traces/TraceDetail";
import TraceList from "./traces/TraceList";
import type { LogDetail, LogFile } from "./traces/trace-types";

export default function Traces() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedLog = searchParams.get("file");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [showRaw, setShowRaw] = useState(false);
  const logSchema = z.custom<LogFile>(
    (value) => typeof value === "object" && value !== null && "filename" in value,
  );
  const detailSchema = z.custom<LogDetail>(
    (value) => typeof value === "object" && value !== null && "lines" in value,
  );
  const logsQuery = useTraces(logSchema, autoRefresh);
  const detailQuery = useTraceDetail(selectedLog, detailSchema, autoRefresh);
  const deleteTrace = useDeleteTrace();
  const logs = logsQuery.data ?? [];
  const logDetail = detailQuery.data ?? null;

  const deleteLog = useCallback(
    async (filename: string) => {
      if (!confirm(`Delete trace "${filename}"?`)) return;
      await deleteTrace.mutateAsync(filename);
      if (selectedLog === filename) setSearchParams({});
    },
    [deleteTrace, selectedLog, setSearchParams],
  );

  const deleteAllLogs = useCallback(async () => {
    if (!confirm(`Delete ALL ${logs.length} traces? This cannot be undone.`)) return;
    await deleteTrace.mutateAsync(null);
  }, [deleteTrace, logs.length]);

  const toggleSection = (key: string) => {
    setExpandedSections((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (selectedLog && logDetail) {
    return (
      <div className="flex flex-col pb-8">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-800 sticky top-0 bg-black/95 backdrop-blur z-10">
          <button
            className="bg-transparent border-none text-blue-500 text-2xl cursor-pointer px-2 py-1 leading-none hover:text-blue-400"
            onClick={() => {
              setSearchParams({});
              setExpandedSections(new Set());
            }}
          >
            ‹
          </button>
          <h2 className="text-lg font-semibold text-white truncate flex-1">{logDetail.filename}</h2>
          <label className="flex items-center gap-1.5 text-sm text-neutral-500 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(event) => setAutoRefresh(event.target.checked)}
              className="accent-blue-600 cursor-pointer w-3.5 h-3.5"
            />
            Live
          </label>
          <button
            className="w-8 h-8 rounded-md border bg-neutral-900 border-neutral-800 text-red-400 hover:bg-red-950"
            onClick={() => void deleteLog(logDetail.filename)}
            title="Delete trace"
          >
            ✕
          </button>
        </div>

        <TraceDetail
          detail={logDetail}
          showRaw={showRaw}
          onShowRawChange={setShowRaw}
          expandedSections={expandedSections}
          toggleSection={toggleSection}
          openTrace={(filename) => setSearchParams({ file: filename })}
        />
      </div>
    );
  }

  if (selectedLog) {
    return <div className="flex flex-col pb-8 text-neutral-400 p-4">Loading trace...</div>;
  }

  return (
    <TraceList
      logs={logs}
      loading={logsQuery.isPending}
      autoRefresh={autoRefresh}
      onAutoRefreshChange={setAutoRefresh}
      onRefresh={() => void logsQuery.refetch()}
      onOpen={(filename) => setSearchParams({ file: filename })}
      onDelete={(filename) => void deleteLog(filename)}
      onDeleteAll={() => void deleteAllLogs()}
    />
  );
}
