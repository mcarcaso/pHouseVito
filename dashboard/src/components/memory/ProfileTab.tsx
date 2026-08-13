import React from "react";
import { useMemoryProfile } from "../../hooks/useMemory";

export default function ProfileTab() {
  const profileQuery = useMemoryProfile();
  const content = profileQuery.data?.content ?? null;
  const loading = profileQuery.isPending;
  const error = profileQuery.error?.message ?? null;

  if (loading) return <div className="p-4 text-neutral-400">Loading profile...</div>;
  if (error) return <div className="p-4 text-red-400">Error: {error}</div>;
  if (!content) return <div className="p-4 text-neutral-500">No profile found.</div>;

  return (
    <div className="p-4 max-w-3xl">
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm">📄</span>
            <span className="text-sm font-medium text-neutral-300">profile.md</span>
          </div>
          <span className="text-xs text-neutral-500 font-mono">
            {content.length.toLocaleString()} chars
          </span>
        </div>
        {/* Markdown Content */}
        <div className="p-4">
          <MarkdownRenderer content={content} />
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MARKDOWN RENDERER — Simple markdown to styled HTML
// ══════════════════════════════════════════════════════════════════════════════

function MarkdownRenderer({ content }: { content: string }) {
  // Parse markdown into sections
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let currentList: string[] = [];
  let listKey = 0;

  const flushList = () => {
    if (currentList.length > 0) {
      elements.push(
        <ul key={`list-${listKey++}`} className="space-y-1 my-2">
          {currentList.map((item, i) => (
            <li
              key={i}
              className="text-sm text-neutral-300 pl-4 relative before:content-['•'] before:absolute before:left-0 before:text-neutral-600"
            >
              <InlineMarkdown text={item} />
            </li>
          ))}
        </ul>,
      );
      currentList = [];
    }
  };

  lines.forEach((line, i) => {
    // H1
    if (line.startsWith("# ")) {
      flushList();
      elements.push(
        <h1 key={i} className="text-xl font-bold text-white mb-3 pb-2 border-b border-neutral-800">
          {line.slice(2)}
        </h1>,
      );
    }
    // H2
    else if (line.startsWith("## ")) {
      flushList();
      elements.push(
        <h2
          key={i}
          className="text-lg font-semibold text-neutral-100 mt-6 mb-2 flex items-center gap-2"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
          {line.slice(3)}
        </h2>,
      );
    }
    // H3
    else if (line.startsWith("### ")) {
      flushList();
      elements.push(
        <h3
          key={i}
          className="text-sm font-semibold text-neutral-200 mt-4 mb-1.5 bg-neutral-800/50 px-3 py-1.5 rounded-lg inline-block"
        >
          {line.slice(4)}
        </h3>,
      );
    }
    // List item
    else if (line.match(/^[-*] /)) {
      currentList.push(line.slice(2));
    }
    // Empty line
    else if (line.trim() === "") {
      flushList();
    }
    // Regular paragraph
    else if (line.trim()) {
      flushList();
      elements.push(
        <p key={i} className="text-sm text-neutral-400 my-1.5">
          <InlineMarkdown text={line} />
        </p>,
      );
    }
  });

  flushList();

  return <div className="markdown-content">{elements}</div>;
}

// Handle **bold**, inline formatting
function InlineMarkdown({ text }: { text: string }) {
  // Parse **bold** patterns
  const parts = text.split(/(\*\*[^*]+\*\*)/g);

  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={i} className="text-neutral-100 font-semibold">
              {part.slice(2, -2)}
            </strong>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// EMBEDDINGS TAB
// ══════════════════════════════════════════════════════════════════════════════
