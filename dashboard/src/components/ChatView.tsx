import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import './ChatView.css';

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
  role: string;
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
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max) + '...' : s;
}

export function parseDbMessage(msg: DbMessage): ParsedMessage {
  try {
    const parsed = JSON.parse(msg.content);

    if (msg.role === 'tool') {
      return {
        role: 'tool',
        content: '',
        timestamp: msg.timestamp,
        toolName: parsed.toolName,
        toolPhase: parsed.phase,
        toolArgs: parsed.args,
        toolResult: parsed.result,
        isError: parsed.isError,
      };
    }

    if (typeof parsed === 'string') {
      return { role: msg.role, content: parsed, timestamp: msg.timestamp };
    }

    const attachments = parsed.attachments?.map((a: any) => ({
      ...a,
      url: a.url || (a.path ? `/attachments/${a.path.split('/').pop()}` : undefined),
    }));
    return {
      role: msg.role,
      content: parsed.text || parsed.content || '',
      timestamp: msg.timestamp,
      attachments,
    };
  } catch {
    return { role: msg.role, content: msg.content, timestamp: msg.timestamp };
  }
}

interface ChatViewProps {
  messages: ParsedMessage[];
  isTyping?: boolean;
  autoScroll?: boolean;
  showFilters?: boolean;
  reversed?: boolean;
}

function ChatView({ messages, isTyping = false, autoScroll = true, showFilters = true, reversed = false }: ChatViewProps) {
  const [displayCount, setDisplayCount] = useState(50);
  const [hideToolCalls, setHideToolCalls] = useState(false);
  const [collapseIntermediate, setCollapseIntermediate] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
    const hiddenByLatestOnly = new Set<number>();
    if (collapseIntermediate) {
      let groupStart = 0;
      for (let idx = 0; idx <= visibleMessages.length; idx++) {
        if (idx === visibleMessages.length || visibleMessages[idx].role === 'user') {
          let lastAssistantInGroup = -1;
          for (let j = groupStart; j < idx; j++) {
            if (visibleMessages[j].role === 'assistant') {
              lastAssistantInGroup = j;
            }
          }
          if (lastAssistantInGroup !== -1) {
            for (let j = groupStart; j < idx; j++) {
              if (j !== lastAssistantInGroup) {
                hiddenByLatestOnly.add(j);
              }
            }
          }
          groupStart = idx + 1;
        }
      }
    }

    const elements: JSX.Element[] = [];
    let i = 0;
    while (i < visibleMessages.length) {
      const msg = visibleMessages[i];

      if (hiddenByLatestOnly.has(i)) {
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
        elements.push(
          <div key={`tool-${toolBlock[0].timestamp}`} className="cv-message cv-tool">
            <div className="cv-message-header">
              <span className="cv-message-author">tool activity</span>
              <span className="cv-message-time">
                {new Date(toolBlock[0].timestamp).toLocaleTimeString()}
              </span>
            </div>
            <div className="cv-message-content cv-activity-log">
              {toolBlock.map((t, idx) => (
                <div key={idx} className={`cv-activity-item ${t.toolPhase || ''} ${t.isError ? 'error' : ''}`}>
                  {t.toolPhase === 'start' && (
                    <span>&#9654; <strong>{t.toolName}</strong>({truncate(JSON.stringify(t.toolArgs), 200)})</span>
                  )}
                  {t.toolPhase === 'end' && (
                    <span>{t.isError ? '\u2717' : '\u2713'} <strong>{t.toolName}</strong> &rarr; {truncate(typeof t.toolResult === 'string' ? t.toolResult : JSON.stringify(t.toolResult), 300)}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      } else {
        elements.push(
          <div key={`${msg.role}-${msg.timestamp}-${i}`} className={`cv-message cv-${msg.role}`}>
            <div className="cv-message-header">
              <span className="cv-message-author">{msg.role}</span>
              <span className="cv-message-time">
                {new Date(msg.timestamp).toLocaleTimeString()}
              </span>
            </div>
            {msg.attachments && msg.attachments.length > 0 && (
              <div className="cv-message-attachments">
                {msg.attachments.map((att, idx) => (
                  <div key={idx} className="cv-attachment">
                    {att.type === 'image' ? (
                      <img src={att.data || att.url} alt={att.filename || 'Image'} className="cv-attachment-image" />
                    ) : (
                      <div className="cv-attachment-file">{att.filename || 'File'}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="cv-message-content">
              <ReactMarkdown
                components={{
                  a: ({ node, ...props }) => (
                    <a {...props} target="_blank" rel="noopener noreferrer" />
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
    <div className="chatview-container">
      {showFilters && (
        <div className="cv-filters">
          <button
            className={`cv-filter-btn ${hideToolCalls ? 'active' : ''}`}
            onClick={() => setHideToolCalls(!hideToolCalls)}
            title="Toggle tool call visibility"
          >
            {hideToolCalls ? '👁️ Show Tools' : '🔧 Hide Tools'}
          </button>
          <button
            className={`cv-filter-btn ${collapseIntermediate ? 'active' : ''}`}
            onClick={() => setCollapseIntermediate(!collapseIntermediate)}
            title="Show only the most recent assistant response"
          >
            {collapseIntermediate ? '📖 Show All' : '📑 Latest Only'}
          </button>
        </div>
      )}

      <div className={`cv-messages ${reversed ? 'cv-messages-reversed' : ''}`}>
        {reversed ? (
          <>
            {isTyping && (
              <div className="cv-message cv-assistant cv-typing">
                <div className="cv-message-header">
                  <span className="cv-message-author">assistant</span>
                </div>
                <div className="cv-message-content">
                  <span className="cv-typing-indicator">...</span>
                </div>
              </div>
            )}
            {renderMessages().reverse()}
            {hasMoreMessages && (
              <div className="cv-load-more-container">
                <button className="cv-load-more-btn" onClick={loadMoreMessages}>
                  Load More Messages ({messages.length - displayCount} older)
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            {hasMoreMessages && (
              <div className="cv-load-more-container">
                <button className="cv-load-more-btn" onClick={loadMoreMessages}>
                  Load More Messages ({messages.length - displayCount} older)
                </button>
              </div>
            )}
            {renderMessages()}
            {isTyping && (
              <div className="cv-message cv-assistant cv-typing">
                <div className="cv-message-header">
                  <span className="cv-message-author">assistant</span>
                </div>
                <div className="cv-message-content">
                  <span className="cv-typing-indicator">...</span>
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
export type { ParsedMessage, DbMessage, Attachment };
