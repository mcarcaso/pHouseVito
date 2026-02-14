import { useState, useEffect } from 'react';
import './Memories.css';

interface Memory {
  id: number;
  timestamp: number;
  title: string;
  content: string;
}

function Memories() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    fetchMemories();
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

  const filteredMemories = memories.filter((memory) => {
    const term = searchTerm.toLowerCase();
    return (
      memory.title.toLowerCase().includes(term) ||
      memory.content.toLowerCase().includes(term)
    );
  });

  if (loading) {
    return <div className="memories-page">Loading memories...</div>;
  }

  return (
    <div className="memories-page">
      <div className="page-header">
        <h2>Memories ({memories.length})</h2>
      </div>

      <div className="memories-search">
        <input
          type="text"
          placeholder="Search memories..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="search-input"
        />
      </div>

      <div className="memories-list">
        {filteredMemories.map((memory) => (
          <div
            key={memory.id}
            className={`memory-item ${expandedId === memory.id ? 'expanded' : ''}`}
            onClick={() => setExpandedId(expandedId === memory.id ? null : memory.id)}
          >
            <div className="memory-header-row">
              <span className="memory-title">{memory.title || 'UNTITLED.md'}</span>
              <div className="memory-badges">
                <span className="memory-time">
                  {new Date(memory.timestamp).toLocaleDateString()}
                </span>
              </div>
            </div>
            {expandedId === memory.id && (
              <div className="memory-body">
                <pre>{memory.content}</pre>
              </div>
            )}
          </div>
        ))}
        {filteredMemories.length === 0 && (
          <div className="empty-state">
            {searchTerm ? 'No memories match your search' : 'No long-term memories yet'}
          </div>
        )}
      </div>
    </div>
  );
}

export default Memories;
