import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  useSkillFile,
  useSkillFiles,
  useSkills,
  type Skill,
  type SkillFile,
} from "../hooks/useSkills";

function stripFrontmatter(content: string) {
  return content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "");
}

function Skills() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedSkillName = searchParams.get("name");

  const skillsQuery = useSkills();
  const skills = skillsQuery.data ?? [];
  const selectedSkill = skills.find((skill) => skill.name === selectedSkillName) ?? null;
  const filesQuery = useSkillFiles(selectedSkillName);
  const files = filesQuery.data ?? [];
  const [selectedFile, setSelectedFile] = useState<SkillFile | null>(null);
  const fileQuery = useSkillFile(selectedSkillName, selectedFile?.name ?? null);
  const fileContent = fileQuery.data?.content ?? "";
  const loading = skillsQuery.isPending;

  useEffect(() => {
    setSelectedFile(files[0] ?? null);
  }, [selectedSkillName, files]);

  const renderFileContent = () => {
    if (!selectedFile) return null;
    const extension = selectedFile.name.split(".").pop()?.toLowerCase();
    const isMarkdown = extension === "md";
    if (isMarkdown) {
      return (
        <div className="max-w-4xl mx-auto text-neutral-200 leading-relaxed [&_h1]:text-white [&_h1]:text-2xl [&_h1]:sm:text-3xl [&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:border-b-2 [&_h1]:border-neutral-700 [&_h1]:pb-2 [&_h2]:text-white [&_h2]:text-xl [&_h2]:mt-6 [&_h2]:mb-3 [&_h2]:border-b [&_h2]:border-neutral-800 [&_h2]:pb-2 [&_h3]:text-white [&_h3]:text-lg [&_h3]:mt-4 [&_h3]:mb-2 [&_p]:my-3 [&_ul]:my-3 [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:pl-6 [&_li]:my-2 [&_code]:bg-neutral-800 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:font-mono [&_code]:text-cyan-400 [&_code]:text-[0.9em] [&_pre]:bg-neutral-900 [&_pre]:p-4 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:my-4 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-neutral-200 [&_blockquote]:border-l-4 [&_blockquote]:border-blue-600 [&_blockquote]:my-4 [&_blockquote]:pl-4 [&_blockquote]:text-neutral-400 [&_blockquote]:italic [&_a]:text-cyan-400 [&_a]:no-underline hover:[&_a]:underline [&_table]:w-full [&_table]:border-collapse [&_table]:my-4 [&_th]:border [&_th]:border-neutral-700 [&_th]:p-2 [&_th]:text-left [&_th]:bg-neutral-800 [&_th]:font-semibold [&_td]:border [&_td]:border-neutral-700 [&_td]:p-2">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{stripFrontmatter(fileContent)}</ReactMarkdown>
        </div>
      );
    }
    return (
      <pre className="max-w-4xl mx-auto bg-neutral-900 p-4 sm:p-5 rounded-lg overflow-x-auto whitespace-pre-wrap break-words text-neutral-200 font-mono text-sm leading-relaxed">
        <code>{fileContent}</code>
      </pre>
    );
  };

  if (loading) {
    return <div className="flex flex-col pb-8 text-neutral-400 p-4">Loading skills...</div>;
  }

  // Detail view
  if (selectedSkill) {
    return (
      <div className="flex flex-col pb-8">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-800 sticky top-0 bg-black/95 backdrop-blur z-10">
          <button
            className="bg-transparent border-none text-blue-500 text-2xl cursor-pointer px-2 py-1 leading-none hover:text-blue-400"
            onClick={() => setSearchParams({})}
          >
            ‹
          </button>
          <h2 className="text-lg font-semibold text-white">{selectedSkill.name}</h2>
        </div>

        <div className="flex flex-col flex-1 overflow-hidden">
          {/* File tabs */}
          <div className="flex gap-2 px-4 py-3 flex-wrap shrink-0">
            {files.map((file) => (
              <button
                key={file.name}
                className={`px-3 py-2 rounded-md text-sm cursor-pointer transition-all whitespace-nowrap shrink-0 ${
                  selectedFile?.name === file.name
                    ? "bg-blue-600 text-white border border-blue-600"
                    : "bg-neutral-900 text-neutral-400 border border-neutral-800 hover:bg-neutral-800 hover:text-white hover:border-neutral-700"
                }`}
                onClick={() => setSelectedFile(file)}
              >
                {file.name}
              </button>
            ))}
          </div>

          {/* File content */}
          <div className="px-4 pb-4">
            {selectedFile ? (
              renderFileContent()
            ) : (
              <div className="text-center text-neutral-500 py-12">No files</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Separate builtin vs user skills
  const builtinSkills = skills.filter((s) => s.source === "builtin");
  const userSkills = skills.filter((s) => s.source === "user");

  const renderSkillItem = (skill: Skill) => (
    <div
      key={skill.name}
      className="flex items-center gap-4 p-4 bg-neutral-900 border border-neutral-800 rounded-xl mb-2 cursor-pointer transition-all hover:bg-neutral-850 hover:border-neutral-700 active:scale-[0.99]"
      onClick={() => setSearchParams({ name: skill.name })}
    >
      <span className="text-2xl shrink-0">🛠️</span>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-white mb-0.5">{skill.name}</div>
        <div className="text-sm text-neutral-500 line-clamp-2">{skill.description}</div>
      </div>
      <span className="text-2xl text-neutral-600 shrink-0 font-light">›</span>
    </div>
  );

  // List view
  return (
    <div className="flex flex-col pb-8">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-800 sticky top-0 bg-black/95 backdrop-blur z-10">
        <h2 className="text-lg font-semibold text-white">Skills ({skills.length})</h2>
      </div>

      <div>
        {userSkills.length > 0 && (
          <>
            <div className="px-5 pt-4 pb-2 text-xs font-semibold uppercase tracking-wider text-neutral-600">
              User Skills ({userSkills.length})
            </div>
            <div className="px-4 pb-4">{userSkills.map(renderSkillItem)}</div>
          </>
        )}

        {builtinSkills.length > 0 && (
          <>
            <div className="px-5 pt-2 pb-2 text-xs font-semibold uppercase tracking-wider text-neutral-600">
              System Skills ({builtinSkills.length})
            </div>
            <div className="px-4 pb-4">{builtinSkills.map(renderSkillItem)}</div>
          </>
        )}

        {skills.length === 0 && (
          <div className="flex flex-col items-center justify-center text-neutral-500 text-center py-12 px-6">
            <p>No skills installed yet</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default Skills;
