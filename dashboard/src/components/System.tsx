import { useState, useEffect } from 'react';
import './System.css';

type Tab = 'soul' | 'system';

function System() {
  const [tab, setTab] = useState<Tab>('soul');
  const [soulContent, setSoulContent] = useState('');
  const [systemContent, setSystemContent] = useState('');
  const [soulOriginal, setSoulOriginal] = useState('');
  const [systemOriginal, setSystemOriginal] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/soul')
      .then((res) => res.json())
      .then((data) => {
        setSoulContent(data.content);
        setSoulOriginal(data.content);
      })
      .catch((err) => console.error('Failed to load soul:', err));

    fetch('/api/system-prompt')
      .then((res) => res.json())
      .then((data) => {
        setSystemContent(data.content);
        setSystemOriginal(data.content);
      })
      .catch((err) => console.error('Failed to load system prompt:', err));
  }, []);

  const currentContent = tab === 'soul' ? soulContent : systemContent;
  const originalContent = tab === 'soul' ? soulOriginal : systemOriginal;
  const hasChanges = currentContent !== originalContent;

  const save = async () => {
    setSaving(true);
    try {
      const endpoint = tab === 'soul' ? '/api/soul' : '/api/system-prompt';
      const res = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: currentContent }),
      });
      const data = await res.json();
      if (tab === 'soul') {
        setSoulContent(data.content);
        setSoulOriginal(data.content);
      } else {
        setSystemContent(data.content);
        setSystemOriginal(data.content);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save:', err);
    }
    setSaving(false);
  };

  const discard = () => {
    if (tab === 'soul') {
      setSoulContent(soulOriginal);
    } else {
      setSystemContent(systemOriginal);
    }
  };

  return (
    <div className="system-container">
      <div className="system-header">
        <div className="system-tabs">
          <button
            className={`system-tab ${tab === 'soul' ? 'active' : ''}`}
            onClick={() => setTab('soul')}
          >
            Soul
          </button>
          <button
            className={`system-tab ${tab === 'system' ? 'active' : ''}`}
            onClick={() => setTab('system')}
          >
            System Prompt
          </button>
        </div>
        <div className="system-actions">
          {hasChanges && (
            <button className="discard-btn" onClick={discard}>
              Discard
            </button>
          )}
          <button
            className="save-btn"
            onClick={save}
            disabled={saving || !hasChanges}
          >
            {saving ? 'Saving...' : saved ? 'Saved ✓' : 'Save'}
          </button>
        </div>
      </div>

      <p className="system-desc">
        {tab === 'soul'
          ? 'The soul defines your assistant\'s personality, values, and boundaries. Loaded from user/SOUL.md.'
          : 'The system prompt provides architecture context and instructions. Loaded from system.md.'}
      </p>

      <textarea
        className="system-editor"
        value={currentContent}
        onChange={(e) =>
          tab === 'soul'
            ? setSoulContent(e.target.value)
            : setSystemContent(e.target.value)
        }
        spellCheck={false}
        placeholder={tab === 'soul' ? 'Define your assistant\'s personality...' : 'System architecture context...'}
      />
    </div>
  );
}

export default System;
