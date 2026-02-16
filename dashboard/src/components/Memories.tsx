import { useState, useEffect } from 'react';

interface Memory {
  id: number;
  timestamp: number;
  title: string;
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
              {expandedId === memory.id && (
                <div className="mt-4 pt-4 border-t border-neutral-800">
                  <pre className="text-neutral-400 text-sm sm:text-base leading-relaxed whitespace-pre-wrap break-words font-sans">
                    {memory.content}
                  </pre>
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
