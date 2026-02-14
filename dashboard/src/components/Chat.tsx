import { useState, useEffect, useRef, useCallback } from 'react';
import ChatView, { parseDbMessage, type ParsedMessage, type Attachment } from './ChatView';
import './Chat.css';

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
  const wsRef = useRef<WebSocket | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastAssistantTsRef = useRef<number | null>(null);
  const initialLoadRef = useRef(true);

  const fetchMessages = useCallback(() => {
    fetch('/api/sessions/dashboard:default/messages')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          const messages = data.map(parseDbMessage);

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

    setTimeout(() => fetchMessages(), 100);
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

  return (
    <div className="chat-container">
      <div className="chat-status">
        <span className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`} />
        {isConnected ? 'Connected' : 'Disconnected'}
      </div>

      <ChatView
        messages={allMessages}
        isTyping={isTyping}
        autoScroll={true}
        showFilters={true}
      />

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
