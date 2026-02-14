import { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import './Chat.css';

interface Attachment {
  type: 'image' | 'file';
  data?: string;     // base64 data URL (used for local preview before upload)
  path?: string;     // absolute fs path (set after upload)
  url?: string;      // serving URL like /attachments/... (set after upload)
  filename?: string;
  mimeType?: string;
}

interface DbMessage {
  role: string;
  content: string;
  timestamp: number;
}

interface Message {
  role: string;        // 'user' | 'assistant' | 'tool'
  content: string;
  timestamp: number;
  attachments?: Attachment[];
  // tool-specific fields
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

function playNotificationSound() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch {
    // Audio not available
  }
}

function parseDbMessage(msg: DbMessage): Message {
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

function Chat() {
  const [allMessages, setAllMessages] = useState<Message[]>([]);
  const [displayCount, setDisplayCount] = useState(50);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [hideToolCalls, setHideToolCalls] = useState(false);
  const [collapseIntermediate, setCollapseIntermediate] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastAssistantTsRef = useRef<number | null>(null);
  const initialLoadRef = useRef(true);

  const fetchMessages = useCallback(() => {
    fetch('/api/sessions/dashboard:default/messages')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          const messages = data.map(parseDbMessage);

          // Find the latest assistant message timestamp
          let latestAssistantTs: number | null = null;
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'assistant') {
              latestAssistantTs = messages[i].timestamp;
              break;
            }
          }

          // Play sound if a new assistant message appeared (skip initial load)
          if (
            !initialLoadRef.current &&
            latestAssistantTs !== null &&
            latestAssistantTs !== lastAssistantTsRef.current
          ) {
            playNotificationSound();
          }

          initialLoadRef.current = false;
          lastAssistantTsRef.current = latestAssistantTs;
          setAllMessages(messages);
          setIsTyping(false);
        }
      })
      .catch((err) => console.error('Failed to load messages:', err));
  }, []);

  useEffect(() => {
    fetchMessages();

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let unmounted = false;

    const connect = () => {
      if (unmounted) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${protocol}//${window.location.host}`);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'refresh') {
          fetchMessages();
        } else if (msg.type === 'typing') {
          setIsTyping(true);
        } else if (msg.type === 'done') {
          fetchMessages();
          setIsTyping(false);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        wsRef.current = null;
        if (!unmounted) {
          reconnectTimer = setTimeout(connect, 3000);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        ws?.close();
      };
    };

    connect();

    return () => {
      unmounted = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [fetchMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [allMessages]);

  const messages = allMessages.slice(-displayCount);
  const hasMoreMessages = allMessages.length > displayCount;

  const loadMoreMessages = () => {
    setDisplayCount((prev) => prev + 50);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newAttachments: Attachment[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isImageFile = file.type.startsWith('image/');
      const reader = new FileReader();
      await new Promise<void>((resolve) => {
        reader.onload = () => {
          newAttachments.push({
            type: isImageFile ? 'image' : 'file',
            data: reader.result as string,
            filename: file.name,
            mimeType: file.type,
          });
          resolve();
        };
        reader.readAsDataURL(file);
      });
    }
    setAttachments((prev) => [...prev, ...newAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const sendMessage = async () => {
    if ((!input.trim() && attachments.length === 0) || !wsRef.current) return;

    const text = input;
    const currentAttachments = [...attachments];
    setInput('');
    setAttachments([]);

    const uploaded: Attachment[] = [];
    for (const att of currentAttachments) {
      if (att.data) {
        try {
          const res = await fetch('/api/attachments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: att.data, filename: att.filename }),
          });
          const result = await res.json();
          uploaded.push({
            type: att.type,
            path: result.path,
            url: result.url,
            filename: result.filename,
            mimeType: result.mimeType || att.mimeType,
          });
        } catch (err) {
          console.error('Failed to upload attachment:', err);
        }
      }
    }

    wsRef.current.send(
      JSON.stringify({
        type: 'chat',
        content: text,
        attachments: uploaded.length > 0 ? uploaded : undefined,
        sessionId: 'dashboard:default',
      })
    );

    // Refresh messages to show the sent user message
    setTimeout(() => fetchMessages(), 100);

    // Typing indicator while waiting for response
    setIsTyping(true);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const newAttachments: Attachment[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (!file) continue;
        const isImageFile = file.type.startsWith('image/');
        const reader = new FileReader();
        await new Promise<void>((resolve) => {
          reader.onload = () => {
            newAttachments.push({
              type: isImageFile ? 'image' : 'file',
              data: reader.result as string,
              filename: file.name || `pasted-${Date.now()}.${file.type.split('/')[1] || 'bin'}`,
              mimeType: file.type,
            });
            resolve();
          };
          reader.readAsDataURL(file);
        });
        e.preventDefault();
      }
    }
    if (newAttachments.length > 0) {
      setAttachments((prev) => [...prev, ...newAttachments]);
    }
  };

  // Group consecutive tool messages into blocks
  const renderMessages = () => {
    // "Latest Only" filter: compute which messages to hide
    // For each group of consecutive non-user messages, only show the last assistant message
    const hiddenByLatestOnly = new Set<number>();
    if (collapseIntermediate) {
      // Walk through messages and find groups between user messages
      let groupStart = 0;
      for (let idx = 0; idx <= messages.length; idx++) {
        // Group boundary: user message or end of messages
        if (idx === messages.length || messages[idx].role === 'user') {
          // Find the last assistant message in this group [groupStart, idx)
          let lastAssistantInGroup = -1;
          for (let j = groupStart; j < idx; j++) {
            if (messages[j].role === 'assistant') {
              lastAssistantInGroup = j;
            }
          }
          // Hide everything in this group except the last assistant message
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
    while (i < messages.length) {
      const msg = messages[i];

      // Skip messages hidden by "Latest Only" filter
      if (hiddenByLatestOnly.has(i)) {
        i++;
        continue;
      }

      if (msg.role === 'tool') {
        // Skip tool blocks if hideToolCalls is enabled
        if (hideToolCalls) {
          while (i < messages.length && messages[i].role === 'tool') {
            i++;
          }
          continue;
        }

        // Collect consecutive tool messages
        const toolBlock: Message[] = [];
        while (i < messages.length && messages[i].role === 'tool') {
          toolBlock.push(messages[i]);
          i++;
        }
        elements.push(
          <div key={`tool-${toolBlock[0].timestamp}`} className="message tool">
            <div className="message-header">
              <span className="message-author">tool activity</span>
              <span className="message-time">
                {new Date(toolBlock[0].timestamp).toLocaleTimeString()}
              </span>
            </div>
            <div className="message-content activity-log">
              {toolBlock.map((t, idx) => (
                <div key={idx} className={`activity-item ${t.toolPhase || ''} ${t.isError ? 'error' : ''}`}>
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
          <div key={`${msg.role}-${msg.timestamp}-${i}`} className={`message ${msg.role}`}>
            <div className="message-header">
              <span className="message-author">{msg.role}</span>
              <span className="message-time">
                {new Date(msg.timestamp).toLocaleTimeString()}
              </span>
            </div>
            {msg.attachments && msg.attachments.length > 0 && (
              <div className="message-attachments">
                {msg.attachments.map((att, idx) => (
                  <div key={idx} className="attachment">
                    {att.type === 'image' ? (
                      <img src={att.data || att.url} alt={att.filename || 'Image'} className="attachment-image" />
                    ) : (
                      <div className="attachment-file">{att.filename || 'File'}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="message-content">
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
    <div className="chat-container">
      <div className="chat-status">
        <span className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`} />
        {isConnected ? 'Connected' : 'Disconnected'}
      </div>

      <div className="chat-filters">
        <button
          className={`filter-btn ${hideToolCalls ? 'active' : ''}`}
          onClick={() => setHideToolCalls(!hideToolCalls)}
          title="Toggle tool call visibility"
        >
          {hideToolCalls ? '👁️ Show Tools' : '🔧 Hide Tools'}
        </button>
        <button
          className={`filter-btn ${collapseIntermediate ? 'active' : ''}`}
          onClick={() => setCollapseIntermediate(!collapseIntermediate)}
          title="Show only the most recent assistant response"
        >
          {collapseIntermediate ? '📖 Show All' : '📑 Latest Only'}
        </button>
      </div>

      <div className="messages">
        {hasMoreMessages && (
          <div className="load-more-container">
            <button className="load-more-btn" onClick={loadMoreMessages}>
              Load More Messages ({allMessages.length - displayCount} older)
            </button>
          </div>
        )}
        {renderMessages()}
        {isTyping && (
          <div className="message assistant typing">
            <div className="message-header">
              <span className="message-author">assistant</span>
            </div>
            <div className="message-content">
              <span className="typing-indicator">...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          multiple
          style={{ display: 'none' }}
        />
        {attachments.length > 0 && (
          <div className="attachment-preview">
            {attachments.map((att, idx) => (
              <div key={idx} className="preview-item">
                {att.type === 'image' ? (
                  <img src={att.data || att.url} alt={att.filename || 'Preview'} className="preview-image" />
                ) : (
                  <div className="preview-file">{att.filename}</div>
                )}
                <button
                  className="remove-attachment"
                  onClick={() => removeAttachment(idx)}
                  title="Remove"
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="input-row">
          <button
            className="attach-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={!isConnected}
            title="Attach files or images"
          >
            +
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            onPaste={handlePaste}
            placeholder="Type a message..."
            rows={3}
            disabled={!isConnected}
          />
          <button onClick={sendMessage} disabled={(!input.trim() && attachments.length === 0) || !isConnected}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

export default Chat;
