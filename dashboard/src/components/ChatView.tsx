import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';

interface Attachment {
  type: 'image' | 'file';
  data?: string;
  path?: string;
  url?: string;
  filename?: string;
  mimeType?: string;
}

interface DbMessage {
  id?: number;
  type: string;  // 'user' | 'thought' | 'assistant' | 'tool_start' | 'tool_end'
  content: string;
  timestamp: number;
  compacted?: boolean;
}

interface ParsedMessage {
  role: string;
  content: string;
  timestamp: number;
  attachments?: Attachment[];
  toolName?: string;
  toolPhase?: 'start' | 'end';
  toolArgs?: any;
  toolResult?: any;
  isError?: boolean;
  isThought?: boolean;
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max) + '...' : s;
}

/** Map internal type to display role */
function typeToRole(type: string): string {
  switch (type) {
    case 'user': return 'user';
    case 'thought': return 'assistant';
    case 'assistant': return 'assistant';
    case 'tool_start': return 'tool';
    case 'tool_end': return 'tool';
    default: return type;
  }
}

export function parseDbMessage(msg: DbMessage): ParsedMessage {
  try {
    const parsed = JSON.parse(msg.content);
    const role = typeToRole(msg.type);
    const isThought = msg.type === 'thought';

    if (msg.type === 'tool_start' || msg.type === 'tool_end') {
      return {
        role: 'tool',
        content: '',
        timestamp: msg.timestamp,
        toolName: parsed.toolName,
        toolPhase: msg.type === 'tool_start' ? 'start' : 'end',
        toolArgs: parsed.args,
        toolResult: parsed.result,
        isError: parsed.isError,
      };
    }

    if (typeof parsed === 'string') {
      return { role, content: parsed, timestamp: msg.timestamp, isThought };
    }

    const attachments = parsed.attachments?.map((a: any) => ({
      ...a,
      url: a.url || (a.path ? `/attachments/${a.path.split('/').pop()}` : undefined),
    }));
    return {
      role,
      content: parsed.text || parsed.content || '',
      timestamp: msg.timestamp,
      attachments,
      isThought,
    };
  } catch {
    return { role: typeToRole(msg.type), content: msg.content, timestamp: msg.timestamp, isThought: msg.type === 'thought' };
  }
}

interface FilterState {
  showThoughts: boolean;
  showTools: boolean;
}

interface ChatViewProps {
  messages: ParsedMessage[];
  isTyping?: boolean;
  autoScroll?: boolean;
  showFilters?: boolean;
  reversed?: boolean;
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
  reversed = false,
  hasMoreOnServer = false,
  loadingMore = false,
  onLoadMore,
  totalMessages,
  static: isStatic = false,
  filterState: externalFilterState,
  onFilterStateChange,
  serverSideFiltering = false,
}: ChatViewProps) {
  const [displayCount, setDisplayCount] = useState(50);
  const [internalFilterState, setInternalFilterState] = useState<FilterState>({ showThoughts: true, showTools: true });
  const [expandedToolItems, setExpandedToolItems] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const toggleToolItem = (key: string) => {
    setExpandedToolItems(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const formatJson = (value: any): string => {
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return JSON.stringify(parsed, null, 2);
      } catch {
        return value;
      }
    }
    return JSON.stringify(value, null, 2);
  };

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
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, autoScroll]);

  const visibleMessages = messages.slice(-displayCount);
  const hasMoreMessages = messages.length > displayCount;

  const loadMoreMessages = () => {
    setDisplayCount((prev) => prev + 50);
  };

  const renderMessages = () => {
    const elements: JSX.Element[] = [];
    let i = 0;
    while (i < visibleMessages.length) {
      const msg = visibleMessages[i];

      // Skip thoughts if hidden
      if (hideThoughts && msg.isThought) {
        i++;
        continue;
      }

      if (msg.role === 'tool') {
        if (hideToolCalls) {
          while (i < visibleMessages.length && visibleMessages[i].role === 'tool') {
            i++;
          }
          continue;
        }

        const toolBlock: ParsedMessage[] = [];
        while (i < visibleMessages.length && visibleMessages[i].role === 'tool') {
          toolBlock.push(visibleMessages[i]);
          i++;
        }
        const toolKey = `tool-${toolBlock[0].timestamp}`;
        const toolNames = [...new Set(toolBlock.map(t => t.toolName).filter(Boolean))];
        const hasErrors = toolBlock.some(t => t.isError);
        
        elements.push(
          <div key={toolKey} className="mb-2 p-3 rounded-lg bg-[#0d1117] border border-blue-900/50 mr-0 md:mr-[10%]">
            <div className="flex justify-between mb-2 text-sm opacity-70">
              <span className="font-semibold capitalize">
                🔧 {toolNames.slice(0, 3).join(', ')}{toolNames.length > 3 ? ` +${toolNames.length - 3}` : ''}
                {hasErrors && <span className="text-red-400 ml-2">⚠</span>}
                <span className="font-normal opacity-50 ml-2 text-xs">({toolBlock.length})</span>
              </span>
              <span className="text-xs">
                {new Date(toolBlock[0].timestamp).toLocaleTimeString()}
              </span>
            </div>
            <div className="font-mono text-xs leading-relaxed">
              {toolBlock.map((t, idx) => {
                const itemKey = `${toolKey}-${idx}`;
                const isItemExpanded = expandedToolItems.has(itemKey);
                const content = t.toolPhase === 'start' 
                  ? t.toolArgs 
                  : t.toolResult;
                const contentStr = formatJson(content);
                const needsTruncation = contentStr.length > 200;
                
                return (
                  <div 
                    key={idx} 
                    className={`py-1 break-words ${
                      t.toolPhase === 'start' ? 'text-blue-400' : 
                      t.isError ? 'text-red-400' : 'text-green-400'
                    }`}
                  >
                    <div className="flex flex-col gap-1">
                      <span className="shrink-0">
                        {t.toolPhase === 'start' ? '▶' : t.isError ? '✗' : '✓'} <strong>{t.toolName}</strong>
                        {t.toolPhase === 'end' && ' →'}
                      </span>
                      {needsTruncation ? (
                        <div 
                          className="ml-4 bg-neutral-900 rounded p-2 overflow-x-auto cursor-pointer transition-colors hover:bg-neutral-800"
                          onClick={() => toggleToolItem(itemKey)}
                        >
                          <pre className="m-0 whitespace-pre-wrap break-words text-xs leading-snug text-neutral-300">
                            {isItemExpanded ? contentStr : truncate(contentStr, 200)}
                          </pre>
                          <span className="block text-right text-[10px] text-blue-400 mt-1 opacity-70 hover:opacity-100">
                            {isItemExpanded ? '▲ collapse' : '▼ expand'}
                          </span>
                        </div>
                      ) : (
                        <div className="ml-4 bg-neutral-900 rounded p-2 overflow-x-auto">
                          <pre className="m-0 whitespace-pre-wrap break-words text-xs leading-snug text-neutral-300">
                            {contentStr}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      } else {
        const isUser = msg.role === 'user';
        elements.push(
          <div 
            key={`${msg.role}-${msg.timestamp}-${i}`} 
            className={`mb-6 p-4 rounded-lg ${
              isUser 
                ? 'bg-blue-950/50 ml-0 md:ml-[10%]' 
                : 'bg-neutral-800 mr-0 md:mr-[10%]'
            }`}
          >
            <div className="flex justify-between mb-2 text-sm opacity-70">
              <span className="font-semibold capitalize">{msg.role}</span>
              <span className="text-xs">
                {new Date(msg.timestamp).toLocaleTimeString()}
              </span>
            </div>
            {msg.attachments && msg.attachments.length > 0 && (
              <div className="flex gap-3 mb-3 flex-wrap">
                {msg.attachments.map((att, idx) => (
                  <div key={idx} className="max-w-[300px]">
                    {att.type === 'image' ? (
                      <img 
                        src={att.data || att.url} 
                        alt={att.filename || 'Image'} 
                        className="w-full max-w-[300px] h-auto rounded-md block cursor-pointer transition-transform hover:scale-[1.02]" 
                      />
                    ) : (
                      <div className="bg-neutral-700 border border-neutral-600 rounded-md px-4 py-3 text-sm text-neutral-400">
                        {att.filename || 'File'}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="leading-relaxed break-words [word-break:break-word] [&_p]:my-1.5 [&_ul]:my-1.5 [&_ul]:pl-6 [&_ol]:my-1.5 [&_ol]:pl-6 [&_li]:my-0.5 [&_li_p]:m-0 [&_pre]:bg-neutral-700 [&_pre]:p-3 [&_pre]:rounded-md [&_pre]:my-2 [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_code]:bg-neutral-700 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[0.9em] [&_code]:break-all [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_img]:max-w-[500px] [&_img]:w-full [&_img]:h-auto [&_img]:rounded-lg [&_img]:my-2 [&_img]:block">
              <ReactMarkdown
                components={{
                  a: ({ node, ...props }) => (
                    <a {...props} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline" />
                  ),
                }}
              >
                {msg.content.replace(/MEDIA:(\/[^\s]+)/g, (_match, filePath) => {
                  const encodedPath = encodeURIComponent(filePath);
                  const extension = filePath.split('.').pop()?.toLowerCase();
                  const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'];
                  if (extension && imageExtensions.includes(extension)) {
                    return `![image](/api/file?path=${encodedPath})`;
                  } else {
                    const filename = filePath.split('/').pop() || 'file';
                    return `[\ud83d\udcce ${filename}](/api/file?path=${encodedPath})`;
                  }
                })}
              </ReactMarkdown>
            </div>
          </div>
        );
        i++;
      }
    }
    return elements;
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Only render filters internally if showFilters is true AND filters are not controlled externally */}
      {showFilters && !filtersControlledExternally && (
        <div className="flex gap-2 p-2 flex-wrap bg-neutral-900 border-b border-neutral-700">
          <button
            className={`bg-neutral-800 text-neutral-200 border border-neutral-700 rounded-md px-3 py-1.5 cursor-pointer text-sm transition-all whitespace-nowrap hover:bg-neutral-700 hover:border-neutral-600 ${
              !filterState.showThoughts ? 'opacity-40 line-through text-neutral-500 hover:opacity-60' : ''
            }`}
            onClick={toggleThoughts}
            title={filterState.showThoughts ? 'Hide thoughts' : 'Show thoughts'}
          >
            💭 {filterState.showThoughts ? '' : '(hidden)'}
          </button>
          <button
            className={`bg-neutral-800 text-neutral-200 border border-neutral-700 rounded-md px-3 py-1.5 cursor-pointer text-sm transition-all whitespace-nowrap hover:bg-neutral-700 hover:border-neutral-600 ${
              !filterState.showTools ? 'opacity-40 line-through text-neutral-500 hover:opacity-60' : ''
            }`}
            onClick={toggleTools}
            title={filterState.showTools ? 'Hide tools' : 'Show tools'}
          >
            🔧 {filterState.showTools ? '' : '(hidden)'}
          </button>
        </div>
      )}

      <div className={`p-4 bg-neutral-900 rounded-lg flex flex-col flex-1 min-h-0 ${
        reversed ? 'flex-col-reverse' : ''
      } ${isStatic ? 'overflow-visible' : 'overflow-y-auto'}`}>
        {reversed ? (
          <>
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
            {renderMessages().reverse()}
            {(hasMoreMessages || hasMoreOnServer) && (
              <div className="text-center mb-6">
                {hasMoreMessages ? (
                  <button 
                    className="bg-neutral-800 text-neutral-400 border border-neutral-700 rounded-md px-4 py-2 cursor-pointer text-sm transition-all hover:bg-neutral-700 hover:border-neutral-600 hover:text-neutral-200"
                    onClick={loadMoreMessages}
                  >
                    Load More ({messages.length - displayCount} in memory)
                  </button>
                ) : hasMoreOnServer && onLoadMore ? (
                  <button 
                    className="bg-neutral-800 text-neutral-400 border border-neutral-700 rounded-md px-4 py-2 cursor-pointer text-sm transition-all hover:bg-neutral-700 hover:border-neutral-600 hover:text-neutral-200 disabled:opacity-50"
                    onClick={onLoadMore}
                    disabled={loadingMore}
                  >
                    {loadingMore ? 'Loading...' : `Load Earlier (${messages.length}${totalMessages ? ` of ${totalMessages}` : ''} loaded)`}
                  </button>
                ) : null}
              </div>
            )}
          </>
        ) : (
          <>
            {(hasMoreMessages || hasMoreOnServer) && (
              <div className="text-center mb-6">
                {hasMoreOnServer && onLoadMore ? (
                  <button 
                    className="bg-neutral-800 text-neutral-400 border border-neutral-700 rounded-md px-4 py-2 cursor-pointer text-sm transition-all hover:bg-neutral-700 hover:border-neutral-600 hover:text-neutral-200 disabled:opacity-50"
                    onClick={onLoadMore}
                    disabled={loadingMore}
                  >
                    {loadingMore ? 'Loading...' : `Load Earlier (${messages.length}${totalMessages ? ` of ${totalMessages}` : ''} loaded)`}
                  </button>
                ) : hasMoreMessages ? (
                  <button 
                    className="bg-neutral-800 text-neutral-400 border border-neutral-700 rounded-md px-4 py-2 cursor-pointer text-sm transition-all hover:bg-neutral-700 hover:border-neutral-600 hover:text-neutral-200"
                    onClick={loadMoreMessages}
                  >
                    Load More ({messages.length - displayCount} in memory)
                  </button>
                ) : null}
              </div>
            )}
            {renderMessages()}
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
          </>
        )}
      </div>
    </div>
  );
}

export default ChatView;
export type { ParsedMessage, DbMessage, Attachment, FilterState };
