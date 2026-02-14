import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import './Skills.css';

interface Skill {
  name: string;
  description: string;
  path: string;
}

interface SkillFile {
  name: string;
  path: string;
}

function Skills() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [files, setFiles] = useState<SkillFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<SkillFile | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('list');

  useEffect(() => {
    fetchSkills();
  }, []);

  useEffect(() => {
    if (selectedSkill) {
      fetchFiles(selectedSkill.name);
    }
  }, [selectedSkill]);

  useEffect(() => {
    if (selectedFile) {
      fetchFileContent(selectedFile.path);
    }
  }, [selectedFile]);

  const fetchSkills = async () => {
    try {
      const res = await fetch('/api/skills');
      const data = await res.json();
      setSkills(data);
      if (data.length > 0) {
        setSelectedSkill(data[0]);
      }
      setLoading(false);
    } catch (err) {
      console.error('Failed to fetch skills:', err);
      setLoading(false);
    }
  };

  const fetchFiles = async (skillName: string) => {
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(skillName)}/files`);
      const data = await res.json();
      setFiles(data);
      if (data.length > 0) {
        setSelectedFile(data[0]);
      }
    } catch (err) {
      console.error('Failed to fetch skill files:', err);
      setFiles([]);
    }
  };

  const fetchFileContent = async (filePath: string) => {
    try {
      const res = await fetch(`/api/file?path=${encodeURIComponent(filePath)}`);
      const text = await res.text();
      setFileContent(text);
    } catch (err) {
      console.error('Failed to fetch file content:', err);
      setFileContent('Error loading file');
    }
  };

  const renderFileContent = () => {
    if (!selectedFile) return null;

    const extension = selectedFile.name.split('.').pop()?.toLowerCase();
    const isMarkdown = extension === 'md';

    if (isMarkdown) {
      return (
        <div className="file-content markdown-content">
          <ReactMarkdown>{fileContent}</ReactMarkdown>
        </div>
      );
    }

    // For other files, show as code
    return (
      <pre className="file-content code-content">
        <code>{fileContent}</code>
      </pre>
    );
  };

  if (loading) {
    return <div className="skills-container">Loading skills...</div>;
  }

  if (skills.length === 0) {
    return (
      <div className="skills-container">
        <div className="empty-state">
          <p>No skills installed yet</p>
          <p className="help-text">
            Add skills to the <code>skills/</code> directory
          </p>
        </div>
      </div>
    );
  }

  const handleSkillSelect = (skill: Skill) => {
    setSelectedSkill(skill);
    setMobileView('detail');
  };

  const handleBackToList = () => {
    setMobileView('list');
  };

  return (
    <div className="skills-layout">
      <div className={`skills-sidebar ${mobileView === 'list' ? 'mobile-show' : 'mobile-hide'}`}>
        <div className="sidebar-header">
          <h3>Skills ({skills.length})</h3>
        </div>
        <div className="skills-list">
          {skills.map((skill) => (
            <div
              key={skill.name}
              className={`skill-item ${selectedSkill?.name === skill.name ? 'active' : ''}`}
              onClick={() => handleSkillSelect(skill)}
            >
              <div className="skill-icon">🛠️</div>
              <div className="skill-info">
                <div className="skill-name">{skill.name}</div>
                <div className="skill-description">{skill.description}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={`skills-main ${mobileView === 'detail' ? 'mobile-show' : 'mobile-hide'}`}>
        {selectedSkill && (
          <>
            <div className="mobile-back-button" onClick={handleBackToList}>
              ← Back to Skills
            </div>
            <div className="files-header">
              <h3>{selectedSkill.name}</h3>
              <div className="files-tabs">
                {files.map((file) => (
                  <button
                    key={file.name}
                    className={`file-tab ${selectedFile?.name === file.name ? 'active' : ''}`}
                    onClick={() => setSelectedFile(file)}
                  >
                    {file.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="file-viewer">
              {selectedFile ? (
                renderFileContent()
              ) : (
                <div className="empty-state">No files to display</div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default Skills;
