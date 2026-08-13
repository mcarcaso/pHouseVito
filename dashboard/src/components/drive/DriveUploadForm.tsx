import type { RefObject } from "react";

export default function DriveUploadForm({
  uploadType,
  onUploadTypeChange,
  siteFolderName,
  onSiteFolderNameChange,
  fileInputRef,
  onFileChange,
  onUpload,
  uploading,
  hasFile,
}: {
  uploadType: "file" | "site";
  onUploadTypeChange: (type: "file" | "site") => void;
  siteFolderName: string;
  onSiteFolderNameChange: (name: string) => void;
  fileInputRef: RefObject<HTMLInputElement>;
  onFileChange: (file: File | null) => void;
  onUpload: () => void;
  uploading: boolean;
  hasFile: boolean;
}) {
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 mb-4">
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          {(["file", "site"] as const).map((type) => (
            <button
              key={type}
              onClick={() => onUploadTypeChange(type)}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                uploadType === type
                  ? "bg-blue-600 text-white"
                  : "bg-neutral-800 text-neutral-400 hover:text-white"
              }`}
            >
              {type === "file" ? "File" : "Site (.zip)"}
            </button>
          ))}
        </div>
        {uploadType === "site" && (
          <input
            type="text"
            placeholder="Folder name for site"
            value={siteFolderName}
            onChange={(event) => onSiteFolderNameChange(event.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700 text-white text-sm placeholder:text-neutral-500 focus:outline-none focus:border-blue-500"
          />
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept={uploadType === "site" ? ".zip" : undefined}
          onChange={(event) => onFileChange(event.target.files?.[0] || null)}
          className="w-full text-sm text-neutral-400 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-neutral-800 file:text-neutral-300 file:text-sm file:font-medium file:cursor-pointer hover:file:bg-neutral-700"
        />
        <button
          onClick={onUpload}
          disabled={uploading || !hasFile || (uploadType === "site" && !siteFolderName.trim())}
          className="w-full px-3 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {uploading ? "Uploading..." : "Upload"}
        </button>
      </div>
    </div>
  );
}
