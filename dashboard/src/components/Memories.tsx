import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Memory {
  id: number;
  timestamp: number;
  title: string;
  description: string | null;
  content: string;
}

interface CompactionStatus {
  uncompactedCount: number;
  threshold: number;
  progress: number;
  willTrigger: boolean;
}

function Memories() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [compactionStatus, setCompactionStatus] = useState<CompactionStatus | null>(null);

  useEffect(() => {
    fetchMemories();
    fetchCompactionStatus();
  }, []);

  const fetchMemories = async () => {
    try {
      const res = await fetch('/api/memories');
      const data = await res.json();
      setMemories(data);
    } catch (err) {
      console.error('Failed to fetch memories:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchCompactionStatus = async () => {
    try {
      const res = await fetch('/api/compaction/status');
      const data = await res.json();
      setCompactionStatus(data);
    } catch (err) {
      console.error('Failed to fetch compaction status:', err);
    }
  };

  const filteredMemories = memories.filter((memory) => {
    const term = searchTerm.toLowerCase();
    return (
      memory.title.toLowerCase().includes(term) ||
      memory.content.toLowerCase().includes(term)
    );
  });

  if (loading) {
    return <div className="flex flex-col pb-8 text-neutral-400 p-4">Loading memories...</div>;
  }

  return (
    <div className="flex flex-col pb-8">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-800 sticky top-0 bg-black/95 backdrop-blur z-10">
        <h2 className="text-lg font-semibold text-white">Memories ({memories.length})</h2>
      </div>

      <div className="p-4 space-y-4">
        {/* Compaction Status */}
        {compactionStatus && (
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
            <div className="flex justify-between items-center mb-3">
              <span className="font-semibold text-neutral-200 text-sm">Next Compaction</span>
              <span className="text-neutral-500 text-xs font-mono">
                {compactionStatus.uncompactedCount} / {compactionStatus.threshold} messages
              </span>
            </div>
            <div className="h-2 bg-neutral-800 rounded-full overflow-hidden">
              <div 
                className={`h-full rounded-full transition-all duration-300 ${
                  compactionStatus.willTrigger
                    ? 'bg-gradient-to-r from-amber-500 to-amber-400'
                    : 'bg-gradient-to-r from-blue-600 to-blue-500'
                }`}
                style={{ width: `${compactionStatus.progress * 100}%` }}
              />
            </div>
            {compactionStatus.willTrigger && (
              <div className="mt-2 text-center text-amber-500 text-xs">
                ⚡ Will compact on next message
              </div>
            )}
          </div>
        )}

        {/* Search */}
        <input
          type="text"
          placeholder="Search memories..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-4 py-3 text-neutral-200 text-base sm:text-sm focus:outline-none focus:border-blue-600 transition-colors"
        />

        {/* Memories List */}
        <div className="space-y-2">
          {filteredMemories.map((memory) => (
            <div
              key={memory.id}
              className={`bg-neutral-900 border rounded-xl p-4 cursor-pointer transition-all active:scale-[0.99] ${
                expandedId === memory.id
                  ? 'border-neutral-700 bg-neutral-850'
                  : 'border-neutral-800 hover:border-neutral-700 hover:bg-neutral-850'
              }`}
              onClick={() => setExpandedId(expandedId === memory.id ? null : memory.id)}
            >
              <div className="flex justify-between items-center gap-4">
                <span className="font-semibold text-blue-400 font-mono text-sm sm:text-base truncate">
                  {memory.title || 'UNTITLED.md'}
                </span>
                <span className="text-neutral-600 text-xs shrink-0">
                  {new Date(memory.timestamp).toLocaleDateString()}
                </span>
              </div>
              {memory.description && (
                <p className="text-neutral-500 text-sm mt-1 truncate">
                  {memory.description}
                </p>
              )}
              {expandedId === memory.id && (
                <div className="mt-4 pt-4 border-t border-neutral-800 text-neutral-300 leading-relaxed break-words [word-break:break-word] [&_p]:my-1.5 [&_ul]:my-1.5 [&_ul]:pl-6 [&_ol]:my-1.5 [&_ol]:pl-6 [&_li]:my-0.5 [&_li_p]:m-0 [&_pre]:bg-neutral-700 [&_pre]:p-3 [&_pre]:rounded-md [&_pre]:my-2 [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_code]:bg-neutral-700 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[0.9em] [&_code]:break-all [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_h1]:text-xl [&_h1]:font-bold [&_h1]:my-3 [&_h1]:text-neutral-200 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:my-2 [&_h2]:text-neutral-200 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:my-2 [&_h3]:text-neutral-200 [&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_th]:bg-neutral-700 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_th]:border [&_th]:border-neutral-600 [&_td]:px-3 [&_td]:py-1.5 [&_td]:border [&_td]:border-neutral-600 [&_tr:nth-child(even)]:bg-neutral-800/50 [&_hr]:border-neutral-700 [&_hr]:my-4 [&_strong]:text-neutral-200">
                  <ReactMarkdown 
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: ({ node, ...props }) => (
                        <a {...props} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline" />
                      ),
                    }}
                  >
                    {memory.content}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          ))}
          {filteredMemories.length === 0 && (
            <div className="text-center text-neutral-500 py-12">
              {searchTerm ? 'No memories match your search' : 'No long-term memories yet'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Memories;
