import { useCallback, useState } from "react";
import type {
  BranchSummaryEntry,
  CompactionEntry,
  CustomEntry,
  CustomMessageEntry,
  LabelEntry,
  ModelChangeEntry,
  PiSessionDetail,
  SessionHeader,
  SessionInfoEntry,
  SessionLine,
  SessionMessageEntry,
  ThinkingLevelChangeEntry,
} from "./pi-session-types";
import PiSessionEntry from "./PiSessionEntry";

export default function PiSessionDetailView({
  detail,
  showRaw,
}: {
  detail: PiSessionDetail;
  showRaw: boolean;
}) {
  // Per-message expansion (line-index keyed). Messages render as a single
  // line by default; click to expand to the full content.
  const [expandedMessages, setExpandedMessages] = useState<Set<number>>(new Set());

  // Windowing for the message list. We always render the first FIRST_N and
  // last LAST_N messages; the middle is hidden behind an expandable placeholder.
  // topExpanded/bottomExpanded grow in increments of STEP as the user clicks
  // the buttons in the placeholder.
  const [topExpanded, setTopExpanded] = useState(0);
  const [bottomExpanded, setBottomExpanded] = useState(0);

  const toggleMessageExpanded = useCallback((idx: number) => {
    setExpandedMessages((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const renderDetail = (d: PiSessionDetail) => {
    const header = d.lines.find((l) => l.type === "session") as SessionHeader | undefined;

    // Categorize entries
    const messages: SessionMessageEntry[] = [];
    const modelChanges: ModelChangeEntry[] = [];
    const thinkingChanges: ThinkingLevelChangeEntry[] = [];
    const compactions: CompactionEntry[] = [];
    const branchSummaries: BranchSummaryEntry[] = [];
    const customEntries: CustomEntry[] = [];
    const customMessages: CustomMessageEntry[] = [];
    const sessionInfos: SessionInfoEntry[] = [];
    const labels: LabelEntry[] = [];
    const others: SessionLine[] = [];

    for (const line of d.lines) {
      switch (line.type) {
        case "session":
          break;
        case "message":
          messages.push(line as SessionMessageEntry);
          break;
        case "model_change":
          modelChanges.push(line as ModelChangeEntry);
          break;
        case "thinking_level_change":
          thinkingChanges.push(line as ThinkingLevelChangeEntry);
          break;
        case "compaction":
          compactions.push(line as CompactionEntry);
          break;
        case "branch_summary":
          branchSummaries.push(line as BranchSummaryEntry);
          break;
        case "custom":
          customEntries.push(line as CustomEntry);
          break;
        case "custom_message":
          customMessages.push(line as CustomMessageEntry);
          break;
        case "session_info":
          sessionInfos.push(line as SessionInfoEntry);
          break;
        case "label":
          labels.push(line as LabelEntry);
          break;
        default:
          if (line.type !== "parse_error") others.push(line);
      }
    }

    // Aggregate usage from assistant messages
    let totalIn = 0,
      totalOut = 0,
      totalCacheRead = 0,
      totalCacheWrite = 0,
      totalCost = 0;
    let assistantCount = 0;
    for (const m of messages) {
      if (m.message?.role === "assistant") assistantCount++;
      const u = m.message?.usage;
      if (u) {
        totalIn += u.input || 0;
        totalOut += u.output || 0;
        totalCacheRead += u.cacheRead || 0;
        totalCacheWrite += u.cacheWrite || 0;
        totalCost += u.cost?.total || 0;
      }
    }

    const sessionName =
      sessionInfos.length > 0 ? sessionInfos[sessionInfos.length - 1].name : undefined;
    const currentModel =
      modelChanges.length > 0
        ? `${modelChanges[modelChanges.length - 1].provider}/${modelChanges[modelChanges.length - 1].modelId}`
        : "";

    return (
      <div className="p-4 space-y-4">
        {/* Header card */}
        {header && (
          <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-neutral-500 bg-neutral-800 px-2 py-0.5 rounded text-xs font-mono">
                pi v{header.version ?? "?"}
              </span>
              {currentModel && (
                <span className="text-violet-400 bg-violet-500/10 px-2 py-0.5 rounded text-xs font-mono">
                  {currentModel}
                </span>
              )}
              {sessionName && (
                <span className="text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded text-xs">
                  {sessionName}
                </span>
              )}
              <span className="text-neutral-400 text-sm">
                {new Date(header.timestamp).toLocaleString()}
              </span>
            </div>
            <div className="text-neutral-300 font-mono text-sm mt-2 break-all">{header.id}</div>
            <div className="text-neutral-500 text-xs font-mono mt-1 break-all">
              cwd: {header.cwd}
            </div>
            <div className="flex items-center gap-4 mt-3 text-xs text-neutral-500 flex-wrap">
              <span>
                Messages: <span className="text-neutral-300">{messages.length}</span>
              </span>
              <span>
                Assistant turns: <span className="text-neutral-300">{assistantCount}</span>
              </span>
              <span>
                Model changes: <span className="text-neutral-300">{modelChanges.length}</span>
              </span>
              <span>
                Compactions: <span className="text-neutral-300">{compactions.length}</span>
              </span>
              {totalIn + totalOut > 0 && (
                <>
                  <span>
                    In: <span className="text-neutral-300">{totalIn.toLocaleString()}</span>
                  </span>
                  <span>
                    Out: <span className="text-neutral-300">{totalOut.toLocaleString()}</span>
                  </span>
                  <span>
                    CacheR:{" "}
                    <span className="text-emerald-300">{totalCacheRead.toLocaleString()}</span>
                  </span>
                  <span>
                    CacheW:{" "}
                    <span className="text-amber-300">{totalCacheWrite.toLocaleString()}</span>
                  </span>
                </>
              )}
              {totalCost > 0 && (
                <span>
                  Cost: <span className="text-neutral-300">${totalCost.toFixed(4)}</span>
                </span>
              )}
            </div>
          </div>
        )}

        {/* Conversation timeline. Messages are collapsed to a single line by
            default, and the middle is windowed: only the first FIRST_N and
            last LAST_N message entries render eagerly; the gap is hidden
            behind an expandable placeholder. Non-message entries (model_change,
            compaction, etc.) always render. */}
        <div className="space-y-3">{renderTimeline(d)}</div>

        {showRaw && others.length === 0 && customEntries.length === 0 && labels.length === 0
          ? null
          : null}
      </div>
    );
  };

  const FIRST_N = 10;
  const LAST_N = 10;
  const STEP = 10;

  const renderTimeline = (d: PiSessionDetail) => {
    // Map: index in d.lines → ordinal among message entries (0-based).
    // Used to decide whether each message falls in the visible top/bottom
    // window or in the hidden middle.
    const messageOrdinalByLineIndex = new Map<number, number>();
    let messageCount = 0;
    d.lines.forEach((line, i) => {
      if (line.type === "message") {
        messageOrdinalByLineIndex.set(i, messageCount);
        messageCount++;
      }
    });

    const showAll = messageCount <= FIRST_N + LAST_N;
    const visibleTop = FIRST_N + topExpanded;
    const visibleBottom = LAST_N + bottomExpanded;
    const hiddenStart = visibleTop;
    const hiddenEnd = messageCount - visibleBottom;
    const hiddenCount = showAll ? 0 : Math.max(0, hiddenEnd - hiddenStart);

    const items: React.ReactNode[] = [];
    let placeholderInserted = false;

    d.lines.forEach((line, i) => {
      if (line.type === "session") return;

      if (line.type === "message" && !showAll) {
        const ord = messageOrdinalByLineIndex.get(i)!;
        const inHiddenMiddle = ord >= hiddenStart && ord < hiddenEnd;
        if (inHiddenMiddle) {
          if (!placeholderInserted && hiddenCount > 0) {
            items.push(renderHiddenPlaceholder(hiddenCount));
            placeholderInserted = true;
          }
          return;
        }
      }

      items.push(
        <PiSessionEntry
          key={`${line.type}-${i}`}
          line={line}
          index={i}
          expanded={expandedMessages.has(i)}
          showRaw={showRaw}
          onToggle={() => toggleMessageExpanded(i)}
        />,
      );
    });

    return items;
  };

  const renderHiddenPlaceholder = (hiddenCount: number) => (
    <div
      key="hidden-placeholder"
      className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3 text-xs flex items-center gap-2 flex-wrap"
    >
      <span className="text-neutral-500">
        📦 {hiddenCount} message{hiddenCount === 1 ? "" : "s"} hidden
      </span>
      <div className="flex items-center gap-2 ml-auto">
        <button
          className="px-2 py-1 rounded border border-neutral-700 bg-neutral-800/50 text-neutral-300 hover:bg-neutral-800 hover:text-white text-xs cursor-pointer transition-colors"
          onClick={() => setTopExpanded((t) => t + STEP)}
        >
          Show {Math.min(STEP, hiddenCount)} from top ↓
        </button>
        <button
          className="px-2 py-1 rounded border border-neutral-700 bg-neutral-800/50 text-neutral-300 hover:bg-neutral-800 hover:text-white text-xs cursor-pointer transition-colors"
          onClick={() => setBottomExpanded((b) => b + STEP)}
        >
          Show {Math.min(STEP, hiddenCount)} from bottom ↑
        </button>
        <button
          className="px-2 py-1 rounded border border-neutral-700 bg-neutral-800/50 text-neutral-400 hover:bg-neutral-800 hover:text-white text-xs cursor-pointer transition-colors"
          onClick={() => {
            setTopExpanded(hiddenCount);
            setBottomExpanded(0);
          }}
        >
          Show all
        </button>
      </div>
    </div>
  );

  return renderDetail(detail);
}
