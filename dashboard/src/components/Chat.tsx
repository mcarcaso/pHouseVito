import { useState, useEffect, useRef, useCallback, useLayoutEffect, useMemo } from 'react';
import ChatView, { parseDbMessage, type ParsedMessage, type Attachment, type FilterState } from './ChatView';
import FilterButton from './FilterButton';
import React from 'react';

// Memoize ChatView to prevent re-renders when typing in the input
const MemoizedChatView = React.memo(ChatView);

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

const POLL_INTERVAL = 5000; // 5 seconds

interface DashboardMessage {
  id: number;
  type: string;
  content: string;
  timestamp: number;
  author?: string | null;
}

interface DashboardSession {
  id: string;
  channel: string;
  channel_target: string;
  last_active_at: number;
  alias?: string | null;
}

const DEFAULT_SESSION_ID = 'dashboard:default';
const CHAT_SESSION_STORAGE_KEY = 'chat-selected-session-id';

function Chat() {
  const [allMessages, setAllMessages] = useState<ParsedMessage[]>([]);
  const [sessions, setSessions] = useState<DashboardSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>(() => {
    try {
      return localStorage.getItem(CHAT_SESSION_STORAGE_KEY) || DEFAULT_SESSION_ID;
    } catch {
      return DEFAULT_SESSION_ID;
    }
  });
  const [input, setInput] = useState('');
  const [isTyping] = useState(false); // Unused but kept for ChatView prop
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [filterState, setFilterState] = useState<FilterState>(() => {
    try {
      const saved = localStorage.getItem('chat-filter');
      if (saved) return JSON.parse(saved);
    } catch {}
    return { showThoughts: true, showTools: true };
  });
  useEffect(() => {
    try { localStorage.setItem('chat-filter', JSON.stringify(filterState)); } catch {}
  }, [filterState]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastAssistantTsRef = useRef<number | null>(null);
  const lastMessageIdRef = useRef<number | null>(null);
  const initialLoadRef = useRef(true);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const formatSessionLabel = useCallback((session: DashboardSession) => {
    const name = session.alias || session.id;
    return name === session.id ? session.id : `${name} — ${session.id}`;
  }, []);

  const fetchSessions = useCallback(() => {
    fetch('/api/sessions')
      .then((res) => res.json())
      .then((data) => {
        if (!Array.isArray(data)) return;
        setSessions(data as DashboardSession[]);
      })
      .catch((err) => console.error('Failed to load sessions:', err));
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  useEffect(() => {
    try { localStorage.setItem(CHAT_SESSION_STORAGE_KEY, selectedSessionId); } catch {}
    initialLoadRef.current = true;
    lastAssistantTsRef.current = null;
    lastMessageIdRef.current = null;
    setAllMessages([]);
  }, [selectedSessionId]);

  const applyMessages = useCallback((rawMessages: DashboardMessage[], mode: 'replace' | 'append') => {
    if (!Array.isArray(rawMessages) || rawMessages.length === 0) return;

    const messages = rawMessages.map((msg) => parseDbMessage({
      type: msg.type,
      content: msg.content,
      timestamp: msg.timestamp,
      author: msg.author,
    }));

    const latestAssistant = [...messages].reverse().find((msg) => msg.role === 'assistant') ?? null;

    if (
      !initialLoadRef.current &&
      latestAssistant &&
      latestAssistant.timestamp !== lastAssistantTsRef.current
    ) {
      playNotificationSound();
    }

    initialLoadRef.current = false;
    if (latestAssistant) {
      lastAssistantTsRef.current = latestAssistant.timestamp;
    }
    lastMessageIdRef.current = rawMessages[rawMessages.length - 1]?.id ?? lastMessageIdRef.current;

    setAllMessages((prev) => (mode === 'append' ? [...prev, ...messages] : messages));
  }, []);

  const fetchMessages = useCallback((filter?: FilterState, mode: 'replace' | 'append' = 'replace') => {
    const params = new URLSearchParams();
    if (filter) {
      if (!filter.showThoughts) params.set('hideThoughts', 'true');
      if (!filter.showTools) params.set('hideTools', 'true');
    }
    if (mode === 'append' && lastMessageIdRef.current) {
      params.set('after', String(lastMessageIdRef.current));
    }
    const url = `/api/sessions/${encodeURIComponent(selectedSessionId)}/messages${params.toString() ? '?' + params.toString() : ''}`;
    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        const rawMessages = Array.isArray(data) ? data : data.messages;
        if (!Array.isArray(rawMessages)) return;

        if (mode === 'append') {
          applyMessages(rawMessages as DashboardMessage[], 'append');
          return;
        }

        if (rawMessages.length === 0) {
          initialLoadRef.current = false;
          lastAssistantTsRef.current = null;
          lastMessageIdRef.current = null;
          setAllMessages([]);
          return;
        }

        applyMessages(rawMessages as DashboardMessage[], 'replace');
      })
      .catch((err) => console.error('Failed to load messages:', err));
  }, [applyMessages, selectedSessionId]);

  // Polling — initial full load, then incremental append every 5s
  useEffect(() => {
    fetchMessages(filterState, 'replace');

    pollTimerRef.current = setInterval(() => {
      fetchMessages(filterState, 'append');
    }, POLL_INTERVAL);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [fetchMessages, filterState]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newAttachments: Attachment[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isImageFile = file.type.startsWith('image/');
      const isAudioFile = file.type.startsWith('audio/');
      const reader = new FileReader();
      await new Promise<void>((resolve) => {
        reader.onload = () => {
          newAttachments.push({
            type: isImageFile ? 'image' : (isAudioFile ? 'audio' : 'file'),
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
    if (!input.trim() && attachments.length === 0) return;

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

    const payload = {
      type: 'chat' as const,
      content: text,
      attachments: uploaded.length > 0 ? uploaded : undefined,
      sessionId: selectedSessionId,
    };

    // Send via HTTP POST
    try {
      await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      console.error('Failed to send message:', err);
    }

    // Fetch immediately to show our sent message, and refresh sessions in case this created/updated one
    setTimeout(() => {
      fetchMessages(filterState, 'append');
      fetchSessions();
    }, 200);
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
        const isAudioFile = file.type.startsWith('audio/');
        const reader = new FileReader();
        await new Promise<void>((resolve) => {
          reader.onload = () => {
            newAttachments.push({
              type: isImageFile ? 'image' : (isAudioFile ? 'audio' : 'file'),
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

  // Auto-scroll to bottom on initial load
  useLayoutEffect(() => {
    if (allMessages.length > 0) {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });
    }
  }, [allMessages.length === 0]); // Only on first load when messages arrive

  return (
    <div className="flex flex-col min-h-full max-w-[1200px] mx-auto w-full">
      {/* Fixed status bar */}
      <div className="fixed top-[52px] md:top-0 left-0 right-0 md:left-[200px] bg-neutral-900 z-[90] px-2 py-2 md:px-3 border-b border-neutral-700">
        <div className="flex items-center justify-between max-w-[1200px] mx-auto">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex items-center gap-2 bg-neutral-800 rounded-lg px-3 py-2 text-sm shrink-0">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              Polling
            </div>
            <select
              value={selectedSessionId}
              onChange={(e) => setSelectedSessionId(e.target.value)}
              className="bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-200 min-w-[220px] max-w-[520px] truncate focus:outline-none focus:border-neutral-500"
              title="Chat session"
            >
              {!sessions.some((s) => s.id === selectedSessionId) && (
                <option value={selectedSessionId}>{selectedSessionId}</option>
              )}
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {formatSessionLabel(session)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 shrink-0">
            <FilterButton
              active={!filterState.showThoughts}
              onClick={() => setFilterState(prev => ({ ...prev, showThoughts: !prev.showThoughts }))}
              title={filterState.showThoughts ? 'Hide thoughts' : 'Show thoughts'}
              emoji="💭"
            />
            <FilterButton
              active={!filterState.showTools}
              onClick={() => setFilterState(prev => ({ ...prev, showTools: !prev.showTools }))}
              title={filterState.showTools ? 'Hide tools' : 'Show tools'}
              emoji="🔧"
            />
            <button
              onClick={async () => {
                if (!confirm('Clear all messages in this chat?')) return;
                try {
                  await fetch(`/api/sessions/${encodeURIComponent(selectedSessionId)}/messages`, { method: 'DELETE' });
                  initialLoadRef.current = false;
                  lastAssistantTsRef.current = null;
                  lastMessageIdRef.current = null;
                  setAllMessages([]);
                } catch (err) {
                  console.error('Failed to clear messages:', err);
                }
              }}
              className="p-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-red-400 transition-colors"
              title="Clear messages"
            >
              🗑️
            </button>
          </div>
        </div>
      </div>

      {/* Messages scroll naturally */}
      <div className="pt-[55px] md:pt-[60px] pb-[160px] md:pb-[180px] px-2 md:px-3">
        <MemoizedChatView
          messages={allMessages}
          isTyping={isTyping}
          autoScroll={false}
          showFilters={true}
          static={true}
          filterState={filterState}
          onFilterStateChange={setFilterState}
          serverSideFiltering={true}
        />
      </div>

      {/* Fixed input bar */}
      <div className="fixed bottom-0 left-0 right-0 md:left-[200px] bg-neutral-900 p-2 md:p-3 border-t border-neutral-700 z-[90]">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          multiple
          style={{ display: 'none' }}
        />

        {attachments.length > 0 && (
          <div className="flex gap-2 mb-3 flex-wrap max-w-[1200px] mx-auto">
            {attachments.map((att, idx) => (
              <div key={idx} className="relative bg-neutral-800 border border-neutral-700 rounded-md p-2 max-w-[150px]">
                {att.type === 'image' ? (
                  <img src={att.data || att.url} alt={att.filename || 'Preview'} className="w-full h-[100px] object-cover rounded block" />
                ) : att.type === 'audio' ? (
                  <div className="p-2 text-sm text-center text-blue-400">🎵 {att.filename}</div>
                ) : (
                  <div className="p-2 text-sm text-center text-neutral-400">{att.filename}</div>
                )}
                <button
                  className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-600 text-white border-2 border-neutral-900 cursor-pointer text-lg leading-none flex items-center justify-center hover:bg-red-700 transition-colors"
                  onClick={() => removeAttachment(idx)}
                  title="Remove"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-1.5 md:gap-2 items-end max-w-[1200px] mx-auto">
          <button
            className="bg-neutral-800 text-neutral-400 border border-neutral-700 rounded-md p-2.5 md:p-3 cursor-pointer text-lg md:text-xl transition-colors hover:bg-neutral-700 hover:border-neutral-600 disabled:opacity-50 disabled:cursor-not-allowed h-fit"
            onClick={() => fileInputRef.current?.click()}
            title="Attach files or images"
          >
            +
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            onPaste={handlePaste}
            placeholder={`Message ${selectedSessionId}...`}
            rows={3}
            className="flex-1 bg-neutral-950 border border-neutral-700 rounded-md p-2.5 md:p-3 text-neutral-200 resize-none text-base focus:outline-none focus:border-neutral-500 disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() && attachments.length === 0}
            className="bg-blue-600 text-white border-none rounded-md px-4 md:px-6 py-2.5 md:py-3 cursor-pointer font-semibold text-sm md:text-base transition-colors hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

export default Chat;
