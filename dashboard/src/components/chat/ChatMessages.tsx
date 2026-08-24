import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ParsedMessage } from "./chat-message";
import { truncate } from "./chat-message";

export default function ChatMessages({ messages }: { messages: ParsedMessage[] }) {
  const visibleMessages = messages;
  const [expandedToolItems, setExpandedToolItems] = useState<Set<string>>(new Set());

  const toggleToolItem = (key: string) => {
    setExpandedToolItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const formatJson = (value: unknown): string => {
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        return JSON.stringify(parsed, null, 2);
      } catch {
        return value;
      }
    }
    return JSON.stringify(value, null, 2);
  };

  // Check if content is plain text (not JSON/structured data)
  // Extract plain text from various formats (including Claude content arrays)
  const extractPlainText = (value: unknown): string | null => {
    // Already a string
    if (typeof value === "string") {
      const trimmed = value.trim();
      // If it looks like JSON, try to parse and extract
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          const parsed = JSON.parse(trimmed);
          return extractPlainText(parsed);
        } catch {
          // Not valid JSON, it's plain text
          return trimmed;
        }
      }
      return trimmed;
    }

    // Object with content array (Claude style: { content: [{ type: "text", text: "..." }] })
    if (value && typeof value === "object") {
      // Check for { content: [...] } structure
      const content = Reflect.get(value, "content");
      if (Array.isArray(content)) {
        const textParts = content
          .filter(
            (item): item is { type: "text"; text: string } =>
              typeof item === "object" &&
              item !== null &&
              Reflect.get(item, "type") === "text" &&
              typeof Reflect.get(item, "text") === "string",
          )
          .map((item) => item.text);
        if (textParts.length > 0) {
          return textParts.join("\n");
        }
      }
      // Check for [{ type: "text", text: "..." }] array directly
      if (Array.isArray(value)) {
        const textParts = value
          .filter(
            (item): item is { type: "text"; text: string } =>
              typeof item === "object" &&
              item !== null &&
              Reflect.get(item, "type") === "text" &&
              typeof Reflect.get(item, "text") === "string",
          )
          .map((item) => item.text);
        if (textParts.length > 0) {
          return textParts.join("\n");
        }
      }
    }

    return null; // Can't extract plain text
  };

  const renderMessages = () => {
    const elements: JSX.Element[] = [];
    let i = 0;
    while (i < visibleMessages.length) {
      const msg = visibleMessages[i];

      if (msg.role === "tool") {
        const toolBlock: ParsedMessage[] = [];
        while (i < visibleMessages.length && visibleMessages[i].role === "tool") {
          toolBlock.push(visibleMessages[i]);
          i++;
        }
        const toolKey = `tool-${toolBlock[0].timestamp}`;
        const toolNames = [...new Set(toolBlock.map((t) => t.toolName).filter(Boolean))];
        const hasErrors = toolBlock.some((t) => t.isError);

        elements.push(
          <div
            key={toolKey}
            className="mb-2 p-3 rounded-lg bg-[#0d1117] border border-blue-900/50 mr-0 md:mr-[10%]"
          >
            <div className="flex justify-between mb-2 text-sm opacity-70">
              <span className="font-semibold capitalize">
                🔧 {toolNames.slice(0, 3).join(", ")}
                {toolNames.length > 3 ? ` +${toolNames.length - 3}` : ""}
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
                const content = t.toolPhase === "start" ? t.toolArgs : t.toolResult;

                // Try to extract plain text from the content
                const plainText = t.toolPhase === "end" ? extractPlainText(content) : null;
                const isPlainTextContent = plainText !== null;

                // Use extracted plain text if available, otherwise format as JSON
                const displayStr = isPlainTextContent ? plainText : formatJson(content);
                const needsTruncation = displayStr.length > 200;

                return (
                  <div
                    key={idx}
                    className={`py-1 break-words ${
                      t.toolPhase === "start"
                        ? "text-blue-400"
                        : t.isError
                          ? "text-red-400"
                          : "text-green-400"
                    }`}
                  >
                    <div className="flex flex-col gap-1">
                      <span className="shrink-0">
                        {t.toolPhase === "start" ? "▶" : t.isError ? "✗" : "✓"}{" "}
                        <strong>{t.toolName}</strong>
                        {t.toolPhase === "end" && " →"}
                      </span>
                      {isPlainTextContent ? (
                        // Plain text result - render as readable text, not code
                        <div className="ml-4 text-sm leading-relaxed text-neutral-200 whitespace-pre-wrap">
                          {needsTruncation ? (
                            <div className="cursor-pointer" onClick={() => toggleToolItem(itemKey)}>
                              {isItemExpanded ? displayStr : truncate(displayStr, 200)}
                              <span className="block text-right text-[10px] text-blue-400 mt-1 opacity-70 hover:opacity-100">
                                {isItemExpanded ? "▲ collapse" : "▼ expand"}
                              </span>
                            </div>
                          ) : (
                            displayStr
                          )}
                        </div>
                      ) : needsTruncation ? (
                        <div
                          className="ml-4 bg-neutral-900 rounded p-2 overflow-x-auto cursor-pointer transition-colors hover:bg-neutral-800"
                          onClick={() => toggleToolItem(itemKey)}
                        >
                          <pre className="m-0 whitespace-pre-wrap break-words text-xs leading-snug text-neutral-300">
                            {isItemExpanded ? displayStr : truncate(displayStr, 200)}
                          </pre>
                          <span className="block text-right text-[10px] text-blue-400 mt-1 opacity-70 hover:opacity-100">
                            {isItemExpanded ? "▲ collapse" : "▼ expand"}
                          </span>
                        </div>
                      ) : (
                        <div className="ml-4 bg-neutral-900 rounded p-2 overflow-x-auto">
                          <pre className="m-0 whitespace-pre-wrap break-words text-xs leading-snug text-neutral-300">
                            {displayStr}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>,
        );
      } else {
        const isUser = msg.role === "user";
        const roleLabel = isUser && msg.author ? msg.author : msg.role;
        elements.push(
          <div
            key={`${msg.role}-${msg.timestamp}-${i}`}
            className={`mb-6 p-4 rounded-lg ${
              isUser ? "bg-blue-950/50 ml-0 md:ml-[10%]" : "bg-neutral-800 mr-0 md:mr-[10%]"
            }`}
          >
            <div className="flex justify-between mb-2 text-sm opacity-70">
              <span className="font-semibold capitalize">{roleLabel}</span>
              <span className="text-xs">{new Date(msg.timestamp).toLocaleTimeString()}</span>
            </div>
            {msg.attachments && msg.attachments.length > 0 && (
              <div className="flex gap-3 mb-3 flex-wrap">
                {msg.attachments.map((att, idx) => (
                  <div key={idx} className="max-w-[400px] w-full md:w-auto">
                    {att.type === "image" ? (
                      <img
                        src={att.data || att.url}
                        alt={att.filename || "Image"}
                        className="w-full max-w-[300px] h-auto rounded-md block cursor-pointer transition-transform hover:scale-[1.02]"
                      />
                    ) : att.type === "audio" ? (
                      <div className="bg-neutral-700 border border-neutral-600 rounded-md px-4 py-3 flex items-center gap-3">
                        <span className="text-xl shrink-0">🎵</span>
                        <div className="flex flex-col min-w-0">
                          <span className="text-sm font-semibold text-blue-400 truncate">
                            {att.filename || "Audio"}
                          </span>
                          <audio controls className="h-8 mt-2 w-full max-w-[240px]">
                            <source src={att.url} type={att.mimeType || "audio/mpeg"} />
                          </audio>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-neutral-700 border border-neutral-600 rounded-md px-4 py-3 text-sm text-neutral-400">
                        {att.filename || "File"}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="leading-relaxed break-words [word-break:break-word] [&_p]:my-1.5 [&_ul]:my-1.5 [&_ul]:pl-6 [&_ol]:my-1.5 [&_ol]:pl-6 [&_li]:my-0.5 [&_li_p]:m-0 [&_pre]:bg-neutral-700 [&_pre]:p-3 [&_pre]:rounded-md [&_pre]:my-2 [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_code]:bg-neutral-700 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[0.9em] [&_code]:break-all [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_img]:max-w-[500px] [&_img]:w-full [&_img]:h-auto [&_img]:rounded-lg [&_img]:my-2 [&_img]:block [&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_th]:bg-neutral-700 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_th]:border [&_th]:border-neutral-600 [&_td]:px-3 [&_td]:py-1.5 [&_td]:border [&_td]:border-neutral-600 [&_tr:nth-child(even)]:bg-neutral-800/50">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ node, ...props }) => (
                    <a
                      {...props}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:underline"
                    />
                  ),
                }}
              >
                {msg.content.replace(/MEDIA:(\/[^\s]+)/g, (_match, filePath) => {
                  const encodedPath = encodeURIComponent(filePath);
                  const extension = filePath.split(".").pop()?.toLowerCase();
                  const imageExtensions = ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"];
                  if (extension && imageExtensions.includes(extension)) {
                    return `![image](/api/media?path=${encodedPath})`;
                  } else {
                    const filename = filePath.split("/").pop() || "file";
                    return `[\ud83d\udcce ${filename}](/api/media?path=${encodedPath})`;
                  }
                })}
              </ReactMarkdown>
            </div>
          </div>,
        );
        i++;
      }
    }
    return elements;
  };

  return <>{renderMessages()}</>;
}
