import { useState, useEffect, useRef } from "react";
import type { Attachment, DbMessage, FilterState, ParsedMessage } from "./chat/chat-message";
export { parseDbMessage } from "./chat/chat-message";
import ChatMessages from "./chat/ChatMessages";

interface ChatViewProps {
  messages: ParsedMessage[];
  isTyping?: boolean;
  autoScroll?: boolean;
  showFilters?: boolean;
  hasMoreOnServer?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  totalMessages?: number;
  static?: boolean; // No scroll container, let page scroll naturally
  filterOffsetTop?: number; // Fixed position offset from top for filters (when static)
  // External filter control - when provided, filters are controlled externally
  filterState?: FilterState;
  onFilterStateChange?: (state: FilterState) => void;
  // When true, filtering is done server-side; skip client-side filtering
  serverSideFiltering?: boolean;
}

function ChatView({
  messages,
  isTyping = false,
  autoScroll = true,
  showFilters = true,
  hasMoreOnServer = false,
  loadingMore = false,
  onLoadMore,
  totalMessages,
  static: isStatic = false,
  filterState: externalFilterState,
  onFilterStateChange,
  serverSideFiltering = false,
}: ChatViewProps) {
  // Removed displayCount - we now show ALL messages in memory
  const [internalFilterState, setInternalFilterState] = useState<FilterState>({
    showThoughts: true,
    showTools: true,
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Use external state if provided, otherwise use internal state
  const filterState = externalFilterState ?? internalFilterState;

  const toggleThoughts = () => {
    const newState = { ...filterState, showThoughts: !filterState.showThoughts };
    if (onFilterStateChange) {
      onFilterStateChange(newState);
    } else {
      setInternalFilterState(newState);
    }
  };

  const toggleTools = () => {
    const newState = { ...filterState, showTools: !filterState.showTools };
    if (onFilterStateChange) {
      onFilterStateChange(newState);
    } else {
      setInternalFilterState(newState);
    }
  };

  // Derive filter booleans - skip if server already filtered
  const hideThoughts = serverSideFiltering ? false : !filterState.showThoughts;
  const hideToolCalls = serverSideFiltering ? false : !filterState.showTools;

  // Determine if filters are controlled externally (parent will render them)
  const filtersControlledExternally = onFilterStateChange !== undefined;

  useEffect(() => {
    if (autoScroll) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, autoScroll]);

  // Show ALL messages in memory - no client-side pagination
  // "Load More" only fetches from server
  const visibleMessages = messages;

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Only render filters internally if showFilters is true AND filters are not controlled externally */}
      {showFilters && !filtersControlledExternally && (
        <div className="flex gap-2 p-2 flex-wrap bg-neutral-900 border-b border-neutral-700">
          <button
            className={`bg-neutral-800 text-neutral-200 border border-neutral-700 rounded-md px-3 py-1.5 cursor-pointer text-sm transition-all whitespace-nowrap hover:bg-neutral-700 hover:border-neutral-600 ${
              !filterState.showThoughts
                ? "opacity-40 line-through text-neutral-500 hover:opacity-60"
                : ""
            }`}
            onClick={toggleThoughts}
            title={filterState.showThoughts ? "Hide thoughts" : "Show thoughts"}
          >
            💭 {filterState.showThoughts ? "" : "(hidden)"}
          </button>
          <button
            className={`bg-neutral-800 text-neutral-200 border border-neutral-700 rounded-md px-3 py-1.5 cursor-pointer text-sm transition-all whitespace-nowrap hover:bg-neutral-700 hover:border-neutral-600 ${
              !filterState.showTools
                ? "opacity-40 line-through text-neutral-500 hover:opacity-60"
                : ""
            }`}
            onClick={toggleTools}
            title={filterState.showTools ? "Hide tools" : "Show tools"}
          >
            🔧 {filterState.showTools ? "" : "(hidden)"}
          </button>
        </div>
      )}

      <div
        className={`p-4 bg-neutral-900 rounded-lg flex flex-col flex-1 min-h-0 ${
          isStatic ? "overflow-visible" : "overflow-y-auto"
        }`}
      >
        {hasMoreOnServer && onLoadMore && (
          <div className="text-center mb-6">
            <button
              className="bg-neutral-800 text-neutral-400 border border-neutral-700 rounded-md px-4 py-2 cursor-pointer text-sm transition-all hover:bg-neutral-700 hover:border-neutral-600 hover:text-neutral-200 disabled:opacity-50"
              onClick={onLoadMore}
              disabled={loadingMore}
            >
              {loadingMore
                ? "Loading..."
                : `Load Earlier (${messages.length}${totalMessages ? ` of ${totalMessages}` : ""} loaded)`}
            </button>
          </div>
        )}
        <ChatMessages
          messages={visibleMessages.filter(
            (message) =>
              !(hideThoughts && message.isThought) && !(hideToolCalls && message.role === "tool"),
          )}
        />
        {isTyping && (
          <div className="mb-6 p-4 rounded-lg bg-neutral-800 mr-0 md:mr-[10%]">
            <div className="flex justify-between mb-2 text-sm opacity-70">
              <span className="font-semibold capitalize">assistant</span>
            </div>
            <div className="leading-relaxed">
              <span className="inline-block animate-pulse">...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}

export default ChatView;
export type { ParsedMessage, DbMessage, Attachment, FilterState };
