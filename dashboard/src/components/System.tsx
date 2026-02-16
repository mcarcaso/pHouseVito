import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';

type Tab = 'soul' | 'system';

function System() {
  const [tab, setTab] = useState<Tab>('soul');
  const [soulContent, setSoulContent] = useState('');
  const [systemContent, setSystemContent] = useState('');

  useEffect(() => {
    fetch('/api/soul')
      .then((res) => res.json())
      .then((data) => setSoulContent(data.content))
      .catch((err) => console.error('Failed to load soul:', err));

    fetch('/api/system-prompt')
      .then((res) => res.json())
      .then((data) => setSystemContent(data.content))
      .catch((err) => console.error('Failed to load system prompt:', err));
  }, []);

  const currentContent = tab === 'soul' ? soulContent : systemContent;

  return (
    <div className="flex flex-col pb-8">
      {/* Header with tabs */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-800 sticky top-0 bg-black/95 backdrop-blur z-10">
        <div className="flex gap-2">
          <button
            className={`px-4 py-2 rounded-md text-sm cursor-pointer transition-all ${
              tab === 'soul'
                ? 'bg-green-700 border border-green-600 text-white'
                : 'bg-neutral-800 border border-neutral-700 text-neutral-400 hover:bg-neutral-700 hover:text-white'
            }`}
            onClick={() => setTab('soul')}
          >
            Soul
          </button>
          <button
            className={`px-4 py-2 rounded-md text-sm cursor-pointer transition-all ${
              tab === 'system'
                ? 'bg-green-700 border border-green-600 text-white'
                : 'bg-neutral-800 border border-neutral-700 text-neutral-400 hover:bg-neutral-700 hover:text-white'
            }`}
            onClick={() => setTab('system')}
          >
            System Prompt
          </button>
        </div>
      </div>

      <div className="p-4">
        <p className="text-neutral-500 text-sm mb-4">
          {tab === 'soul'
            ? "Personality, values, and boundaries. Loaded from user/SOUL.md."
            : "Architecture context and instructions. Loaded from SYSTEM.md."}
        </p>

        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5 text-neutral-300 leading-relaxed [&_h1]:text-white [&_h1]:text-xl [&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:first:mt-0 [&_h2]:text-white [&_h2]:text-lg [&_h2]:mt-6 [&_h2]:mb-3 [&_h2]:first:mt-0 [&_h3]:text-white [&_h3]:text-base [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:first:mt-0 [&_p]:mb-4 [&_ul]:mb-4 [&_ul]:pl-6 [&_ol]:mb-4 [&_ol]:pl-6 [&_li]:mb-1 [&_code]:bg-neutral-800 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:font-mono [&_code]:text-[0.85em] [&_pre]:bg-neutral-950 [&_pre]:border [&_pre]:border-neutral-800 [&_pre]:rounded-lg [&_pre]:p-4 [&_pre]:overflow-x-auto [&_pre]:mb-4 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_strong]:text-white [&_a]:text-blue-400">
          <ReactMarkdown>{currentContent}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

export default System;
