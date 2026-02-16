import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import ChatView, { parseDbMessage, type ParsedMessage, type Attachment, type FilterState } from './ChatView';
import FilterButton from './FilterButton';

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

function Chat() {
  const [allMessages, setAllMessages] = useState<ParsedMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [filterState, setFilterState] = useState<FilterState>({ showThoughts: true, showTools: true });
  const wsRef = useRef<WebSocket | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastAssistantTsRef = useRef<number | null>(null);
  const initialLoadRef = useRef(true);

  const fetchMessages = useCallback((filter?: FilterState) => {
    const params = new URLSearchParams();
    if (filter) {
      if (!filter.showThoughts) params.set('hideThoughts', 'true');
      if (!filter.showTools) params.set('hideTools', 'true');
    }
    const url = `/api/sessions/dashboard:default/messages${params.toString() ? '?' + params.toString() : ''}`;
    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        // Handle both old format (array) and new format ({messages, total})
        const rawMessages = Array.isArray(data) ? data : data.messages;
        if (Array.isArray(rawMessages)) {
          const messages = rawMessages.map(parseDbMessage);

          let latestAssistantTs: number | null = null;
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'assistant') {
              latestAssistantTs = messages[i].timestamp;
              break;
            }
          }

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
    fetchMessages(filterState);

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
          fetchMessages(filterState);
        } else if (msg.type === 'typing') {
          setIsTyping(true);
        } else if (msg.type === 'done') {
          fetchMessages(filterState);
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
  }, [fetchMessages, filterState]);

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

    setTimeout(() => fetchMessages(filterState), 100);
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
          <div className="flex items-center gap-2 bg-neutral-800 rounded-lg px-3 py-2 text-sm">
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : 'bg-neutral-500'}`} />
            {isConnected ? 'Connected' : 'Disconnected'}
          </div>
          <div className="flex gap-2">
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
          </div>
        </div>
      </div>

      {/* Messages scroll naturally */}
      <div className="pt-[55px] md:pt-[60px] pb-[160px] md:pb-[180px] px-2 md:px-3">
        <ChatView
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
            className="flex-1 bg-neutral-950 border border-neutral-700 rounded-md p-2.5 md:p-3 text-neutral-200 resize-none text-base focus:outline-none focus:border-neutral-500 disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <button
            onClick={sendMessage}
            disabled={(!input.trim() && attachments.length === 0) || !isConnected}
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
