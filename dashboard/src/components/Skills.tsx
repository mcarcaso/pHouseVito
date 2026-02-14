import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedSkillName = searchParams.get('name');

  const [skills, setSkills] = useState<Skill[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [files, setFiles] = useState<SkillFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<SkillFile | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSkills();
  }, []);

  useEffect(() => {
    if (selectedSkillName && skills.length > 0) {
      const skill = skills.find(s => s.name === selectedSkillName);
      if (skill) {
        setSelectedSkill(skill);
        fetchFiles(skill.name);
      }
    }
  }, [selectedSkillName, skills]);

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
    } catch (err) {
      console.error('Failed to fetch skills:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchFiles = async (skillName: string) => {
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(skillName)}/files`);
      const data = await res.json();
      setFiles(data);
      if (data.length > 0) setSelectedFile(data[0]);
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
    return (
      <pre className="file-content code-content">
        <code>{fileContent}</code>
      </pre>
    );
  };

  if (loading) {
    return <div className="skills-page">Loading skills...</div>;
  }

  // Detail view
  if (selectedSkill) {
    return (
      <div className="skills-page">
        <div className="page-header">
          <button className="back-link" onClick={() => setSearchParams({})}>‹ Skills</button>
          <h2>{selectedSkill.name}</h2>
        </div>

        <div className="skill-detail-content">
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
          <div className="file-viewer">
            {selectedFile ? renderFileContent() : <div className="empty-state">No files</div>}
          </div>
        </div>
      </div>
    );
  }

  // List view
  return (
    <div className="skills-page">
      <div className="page-header">
        <h2>Skills ({skills.length})</h2>
      </div>

      <div className="skills-list">
        {skills.map((skill) => (
          <div
            key={skill.name}
            className="skill-item"
            onClick={() => setSearchParams({ name: skill.name })}
          >
            <span className="skill-icon">🛠️</span>
            <div className="skill-info">
              <div className="skill-name">{skill.name}</div>
              <div className="skill-description">{skill.description}</div>
            </div>
            <span className="skill-arrow">›</span>
          </div>
        ))}
        {skills.length === 0 && (
          <div className="empty-state">
            <p>No skills installed yet</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default Skills;
