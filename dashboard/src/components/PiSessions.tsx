import { useCallback, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { z } from "zod";
import {
  useDeletePiSession,
  usePiSessionDetail,
  usePiSessions,
  type PiSessionListItem,
} from "../hooks/usePiSessions";

// ── Types mirroring pi's session-manager.d.ts ───────────────────────────────

import type { PiSessionDetail, SessionLine } from "./pi-sessions/pi-session-types";
import PiSessionDetailView from "./pi-sessions/PiSessionDetail";
import PiSessionList from "./pi-sessions/PiSessionList";

// ── Helpers ─────────────────────────────────────────────────────────────────

// ── Component ───────────────────────────────────────────────────────────────

function PiSessions() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedRel = searchParams.get("file");

  const [autoRefresh, setAutoRefresh] = useState(true);
  const listQuery = usePiSessions(autoRefresh);
  const lineSchema = z.custom<SessionLine>(
    (value) => typeof value === "object" && value !== null && "type" in value,
  );
  const detailQuery = usePiSessionDetail(selectedRel, lineSchema, autoRefresh);
  const deleteSession = useDeletePiSession();
  const list: PiSessionListItem[] = listQuery.data ?? [];
  const detail: PiSessionDetail | null = detailQuery.data ?? null;
  const loading = listQuery.isPending;
  const [showRaw, setShowRaw] = useState(false);

  const deleteFile = useCallback(
    async (rel: string) => {
      if (!confirm(`Delete pi session "${rel}"?`)) return;
      await deleteSession.mutateAsync(rel);
      if (selectedRel === rel) setSearchParams({});
    },
    [deleteSession, selectedRel, setSearchParams],
  );

  const deleteAll = useCallback(async () => {
    if (!confirm(`Delete ALL ${list.length} pi sessions? This cannot be undone.`)) return;
    await deleteSession.mutateAsync(null);
  }, [deleteSession, list.length]);

  // ── Render ──────────────────────────────────────────────────────────────

  if (selectedRel && detail) {
    return (
      <div className="flex flex-col pb-8">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-800 sticky top-0 bg-black/95 backdrop-blur z-10">
          <button
            className="bg-transparent border-none text-blue-500 text-2xl cursor-pointer px-2 py-1 leading-none hover:text-blue-400"
            onClick={() => {
              setSearchParams({});
            }}
          >
            ‹
          </button>
          <h2 className="text-lg font-semibold text-white truncate flex-1 font-mono">
            {detail.rel}
          </h2>
          <label className="flex items-center gap-1.5 text-sm text-neutral-500 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showRaw}
              onChange={(e) => setShowRaw(e.target.checked)}
              className="accent-blue-600 cursor-pointer w-3.5 h-3.5"
            />
            Show raw
          </label>
          <label className="flex items-center gap-1.5 text-sm text-neutral-500 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="accent-blue-600 cursor-pointer w-3.5 h-3.5"
            />
            Live
          </label>
          <button
            className="w-8 h-8 flex items-center justify-center rounded-md border bg-neutral-900 border-neutral-800 text-red-400 hover:bg-red-950 hover:border-red-800 text-sm cursor-pointer transition-all"
            onClick={() => deleteFile(detail.rel)}
            title="Delete pi session"
          >
            ✕
          </button>
        </div>
        <PiSessionDetailView key={detail.rel} detail={detail} showRaw={showRaw} />
      </div>
    );
  }

  if (selectedRel && !detail) {
    return <div className="flex flex-col pb-8 text-neutral-400 p-4">Loading pi session...</div>;
  }

  if (loading) {
    return <div className="flex flex-col pb-8 text-neutral-400 p-4">Loading pi sessions...</div>;
  }

  return (
    <PiSessionList
      list={list}
      autoRefresh={autoRefresh}
      onAutoRefreshChange={setAutoRefresh}
      onRefresh={() => void listQuery.refetch()}
      onOpen={(rel) => setSearchParams({ file: rel })}
      onDelete={(rel) => void deleteFile(rel)}
      onDeleteAll={() => void deleteAll()}
    />
  );
}

export default PiSessions;
