import { useState, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useDriveCommand, useDriveListing } from "../hooks/useDrive";
import { errorMessage } from "../lib/api-client";
import FilePreview from "./drive/FilePreview";
import DriveUploadForm from "./drive/DriveUploadForm";

import {
  formatBytes,
  getFileType,
  sortFiles,
  type SortDir,
  type SortField,
} from "./drive/drive-utils";

export default function Drive() {
  const navigate = useNavigate();
  const location = useLocation();

  // Extract path from URL: /drive/foo/bar -> foo/bar
  const getPathFromUrl = () => {
    const match = location.pathname.match(/^\/drive\/?(.*)$/);
    return match?.[1] || "";
  };

  const currentPath = getPathFromUrl();
  const listingQuery = useDriveListing(currentPath);
  const driveCommand = useDriveCommand();
  const listing = listingQuery.data ?? null;
  const loading = listingQuery.isPending;
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const command = driveCommand.variables;
  const actionLoading = driveCommand.isPending
    ? command?.type === "delete"
      ? `delete-${command.path.split("/").pop()}`
      : command?.type === "file-meta"
        ? `toggle-${command.path.split("/").pop()}`
        : command?.type === "directory-meta"
          ? "toggle"
          : null
    : null;
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Sort
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const sortArrow = (field: SortField) =>
    sortField === field ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  // Upload
  const [showUpload, setShowUpload] = useState(false);
  const [uploadType, setUploadType] = useState<"file" | "site">("file");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const uploading = driveCommand.isPending && command?.type === "upload";
  const [siteFolderName, setSiteFolderName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // New folder
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const navigateTo = (folder: string) => {
    setSelectedFile(null);
    setDeleteConfirm(null);
    navigate(folder ? `/drive/${folder}` : "/drive");
  };

  const navigateUp = () => {
    if (!currentPath) return;
    const parts = currentPath.split("/");
    parts.pop();
    navigateTo(parts.join("/"));
  };

  const navigateInto = (dirName: string) => {
    navigateTo(currentPath ? `${currentPath}/${dirName}` : dirName);
  };

  const togglePublic = async () => {
    if (!listing) return;
    try {
      await driveCommand.mutateAsync({
        type: "directory-meta",
        path: currentPath,
        isPublic: !listing.isPublic,
      });
      showToast(listing.isPublic ? "Made private" : "Made public", "success");
    } catch (error: unknown) {
      showToast(errorMessage(error, "Failed"), "error");
    }
  };

  const toggleFilePublic = async (fileName: string, currentlyPublic: boolean) => {
    const filePath = currentPath ? `${currentPath}/${fileName}` : fileName;
    try {
      await driveCommand.mutateAsync({
        type: "file-meta",
        path: filePath,
        isPublic: !currentlyPublic,
      });
      showToast(
        currentlyPublic ? `${fileName} made private` : `${fileName} made public`,
        "success",
      );
    } catch (error: unknown) {
      showToast(errorMessage(error, "Failed"), "error");
    }
  };

  const handleDelete = async (name: string, _isDir: boolean) => {
    const targetPath = currentPath ? `${currentPath}/${name}` : name;
    try {
      await driveCommand.mutateAsync({ type: "delete", path: targetPath });
      showToast(`Deleted ${name}`, "success");
      setDeleteConfirm(null);
      if (selectedFile === name) setSelectedFile(null);
    } catch (error: unknown) {
      showToast(errorMessage(error, "Delete failed"), "error");
    }
  };

  const handleUpload = async () => {
    if (!uploadFile) return;

    if (uploadType === "site") {
      if (!uploadFile.name.endsWith(".zip")) {
        showToast("Sites require a .zip file", "error");
        return;
      }
      if (!siteFolderName.trim()) {
        showToast("Enter a folder name for the site", "error");
        return;
      }
    }

    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsDataURL(uploadFile);
      });

      const body =
        uploadType === "site"
          ? {
              data: dataUrl,
              folder: currentPath
                ? `${currentPath}/${siteFolderName.trim()}`
                : siteFolderName.trim(),
            }
          : { data: dataUrl, filename: uploadFile.name, folder: currentPath || undefined };

      await driveCommand.mutateAsync({ type: "upload", site: uploadType === "site", body });
      showToast("Uploaded", "success");
      setShowUpload(false);
      setUploadFile(null);
      setUploadType("file");
      setSiteFolderName("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (error: unknown) {
      showToast(errorMessage(error, "Upload failed"), "error");
    }
  };

  const handleNewFolder = async () => {
    if (!newFolderName.trim()) return;
    const folderPath = currentPath
      ? `${currentPath}/${newFolderName.trim()}`
      : newFolderName.trim();
    // Creating a .meta.json in the folder will create the folder
    try {
      await driveCommand.mutateAsync({ type: "directory-meta", path: folderPath, isPublic: false });
      showToast("Folder created", "success");
      setShowNewFolder(false);
      setNewFolderName("");
    } catch {
      showToast("Failed to create folder", "error");
    }
  };

  const copyPublicUrl = () => {
    const base = window.location.origin;
    const url = `${base}/d/${currentPath}/`;
    navigator.clipboard.writeText(url);
    showToast("URL copied", "success");
  };

  const fileUrl = (name: string) => {
    const p = currentPath ? `${currentPath}/${name}` : name;
    return `/api/drive/file/${p}`;
  };

  const publicFileUrl = (name: string) => {
    const p = currentPath ? `${currentPath}/${name}` : name;
    return `${window.location.origin}/d/${p}`;
  };

  return (
    <div className="flex flex-col pb-8">
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-sm font-medium animate-[slideIn_0.2s_ease-out] ${
            toast.type === "success" ? "bg-green-600 text-white" : "bg-red-600 text-white"
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-800 sticky top-0 bg-black/95 backdrop-blur z-10">
        <h2 className="text-lg font-semibold text-white">Drive</h2>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => {
              setShowNewFolder(!showNewFolder);
              setShowUpload(false);
            }}
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-neutral-700 hover:bg-neutral-600 text-white transition-colors"
          >
            + Folder
          </button>
          <button
            onClick={() => {
              setShowUpload(!showUpload);
              setShowNewFolder(false);
            }}
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
          >
            {showUpload ? "Cancel" : "+ Upload"}
          </button>
        </div>
      </div>

      <div className="p-4 sm:p-6">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1 mb-3 text-sm">
          <button
            onClick={() => navigateTo("")}
            className={currentPath ? "text-blue-400 hover:underline" : "text-white font-medium"}
          >
            drive
          </button>
          {currentPath &&
            currentPath.split("/").map((part, i, arr) => {
              const folderPath = arr.slice(0, i + 1).join("/");
              const isLast = i === arr.length - 1;
              return (
                <span key={folderPath} className="flex items-center gap-1">
                  <span className="text-neutral-600">/</span>
                  {isLast ? (
                    <span className="text-white font-medium">{part}</span>
                  ) : (
                    <button
                      onClick={() => navigateTo(folderPath)}
                      className="text-blue-400 hover:underline"
                    >
                      {part}
                    </button>
                  )}
                </span>
              );
            })}

          {/* Public indicator + toggle */}
          {listing && (
            <span className="ml-3 flex items-center gap-2">
              <span
                className={`text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-md ${
                  listing.isPublic
                    ? "text-green-400 bg-green-400/10"
                    : "text-neutral-500 bg-neutral-500/10"
                }`}
              >
                {listing.isPublic ? "Public" : "Private"}
              </span>
              <button
                onClick={togglePublic}
                disabled={actionLoading === "toggle"}
                className="text-xs text-neutral-500 hover:text-white transition-colors"
              >
                {actionLoading === "toggle"
                  ? "..."
                  : listing.isPublic
                    ? "make private"
                    : "make public"}
              </button>
              {listing.isPublic && currentPath && (
                <button onClick={copyPublicUrl} className="text-xs text-blue-400 hover:underline">
                  copy url
                </button>
              )}
            </span>
          )}
        </div>

        {/* New folder form */}
        {showNewFolder && (
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              placeholder="Folder name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleNewFolder()}
              className="flex-1 px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700 text-white text-sm placeholder:text-neutral-500 focus:outline-none focus:border-blue-500"
              autoFocus
            />
            <button
              onClick={handleNewFolder}
              disabled={!newFolderName.trim()}
              className="px-3 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 transition-colors"
            >
              Create
            </button>
          </div>
        )}

        {showUpload && (
          <DriveUploadForm
            uploadType={uploadType}
            onUploadTypeChange={setUploadType}
            siteFolderName={siteFolderName}
            onSiteFolderNameChange={setSiteFolderName}
            fileInputRef={fileInputRef}
            onFileChange={setUploadFile}
            onUpload={() => void handleUpload()}
            uploading={uploading}
            hasFile={uploadFile !== null}
          />
        )}

        {/* Main content: file list + preview */}
        <div className="flex gap-4">
          {/* Directory listing - left side (hidden on mobile/tablet when file selected) */}
          <div
            className={`${selectedFile ? "hidden xl:block xl:w-1/2" : "w-full max-w-[700px]"} transition-all`}
          >
            {loading ? (
              <div className="text-center text-neutral-500 py-12">Loading...</div>
            ) : !listing ? (
              <div className="text-center text-neutral-500 py-12">Failed to load</div>
            ) : (
              <div className="flex flex-col gap-1">
                {/* Back */}
                {currentPath && (
                  <button
                    onClick={navigateUp}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-neutral-400 hover:bg-neutral-800 hover:text-white transition-colors"
                  >
                    <span className="w-5 text-center">..</span>
                  </button>
                )}

                {/* Folders */}
                {listing.dirs.map((dir) => (
                  <div
                    key={dir.name}
                    className="group flex items-center rounded-lg hover:bg-neutral-800 transition-colors"
                  >
                    <button
                      onClick={() => navigateInto(dir.name)}
                      className="flex-1 flex items-center gap-3 px-3 py-2.5 text-left text-sm"
                    >
                      <span className="w-5 text-center text-neutral-500">&#x1F4C1;</span>
                      <span className="text-white font-medium">{dir.name}</span>
                      {dir.meta?.isPublic && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded text-green-400 bg-green-400/10">
                          public
                        </span>
                      )}
                    </button>
                    {deleteConfirm === dir.name ? (
                      <div className="flex items-center gap-1 pr-2">
                        <button
                          onClick={() => handleDelete(dir.name, true)}
                          disabled={actionLoading === `delete-${dir.name}`}
                          className="text-xs px-2 py-1 rounded bg-red-600 text-white hover:bg-red-500 disabled:opacity-50"
                        >
                          {actionLoading === `delete-${dir.name}` ? "..." : "Delete"}
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(null)}
                          className="text-xs px-2 py-1 rounded bg-neutral-700 text-white hover:bg-neutral-600"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirm(dir.name)}
                        className="text-neutral-700 hover:text-red-400 px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                      >
                        &#x2715;
                      </button>
                    )}
                  </div>
                ))}

                {/* Files table */}
                {listing.files.length > 0 && (
                  <>
                    {/* Column headers */}
                    <div className="flex items-center px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500 border-b border-neutral-800 select-none">
                      <div className="w-5 shrink-0" />
                      <button
                        onClick={() => handleSort("name")}
                        className="flex-1 text-left hover:text-white transition-colors ml-3"
                      >
                        Name{sortArrow("name")}
                      </button>
                      <button
                        onClick={() => handleSort("type")}
                        className="w-20 text-left hover:text-white transition-colors shrink-0"
                      >
                        Type{sortArrow("type")}
                      </button>
                      <button
                        onClick={() => handleSort("size")}
                        className="w-20 text-right hover:text-white transition-colors shrink-0"
                      >
                        Size{sortArrow("size")}
                      </button>
                      <button
                        onClick={() => handleSort("createdAt")}
                        className="w-32 text-right hover:text-white transition-colors shrink-0 hidden sm:block"
                      >
                        Created{sortArrow("createdAt")}
                      </button>
                      <div className="w-24 shrink-0" />
                    </div>

                    {sortFiles(listing.files, sortField, sortDir).map((file) => (
                      <div
                        key={file.name}
                        className="group flex items-center rounded-lg hover:bg-neutral-800 transition-colors"
                      >
                        <button
                          onClick={() =>
                            setSelectedFile(selectedFile === file.name ? null : file.name)
                          }
                          className={`flex-1 flex items-center px-3 py-2.5 text-left text-sm min-w-0 ${
                            selectedFile === file.name ? "bg-blue-600/20" : ""
                          }`}
                        >
                          <span className="w-5 text-center text-neutral-600 shrink-0">
                            &#x1F4C4;
                          </span>
                          <span className="text-neutral-200 truncate ml-3 flex-1">{file.name}</span>
                          <span className="w-20 text-xs text-neutral-500 shrink-0">
                            {getFileType(file.name)}
                          </span>
                          <span className="w-20 text-xs text-neutral-600 text-right shrink-0">
                            {formatBytes(file.size)}
                          </span>
                          <span className="w-32 text-xs text-neutral-600 text-right shrink-0 hidden sm:block">
                            {file.createdAt
                              ? new Date(file.createdAt).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                })
                              : "—"}
                          </span>
                        </button>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            onClick={() => toggleFilePublic(file.name, file.isPublic)}
                            disabled={actionLoading === `toggle-${file.name}`}
                            className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded cursor-pointer transition-colors shrink-0 ${
                              file.isPublic
                                ? "text-green-400 bg-green-400/10 hover:bg-green-400/20"
                                : "text-neutral-600 bg-neutral-600/10 hover:bg-neutral-600/20"
                            }`}
                            title={file.isPublic ? "Click to make private" : "Click to make public"}
                          >
                            {actionLoading === `toggle-${file.name}`
                              ? "..."
                              : file.isPublic
                                ? "public"
                                : "private"}
                          </button>
                          {file.isPublic && (
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(publicFileUrl(file.name));
                                showToast("URL copied", "success");
                              }}
                              className="text-xs text-neutral-600 hover:text-blue-400 px-2 opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Copy public URL"
                            >
                              link
                            </button>
                          )}
                          {deleteConfirm === file.name ? (
                            <div className="flex items-center gap-1 pr-2">
                              <button
                                onClick={() => handleDelete(file.name, false)}
                                disabled={actionLoading === `delete-${file.name}`}
                                className="text-xs px-2 py-1 rounded bg-red-600 text-white hover:bg-red-500 disabled:opacity-50"
                              >
                                {actionLoading === `delete-${file.name}` ? "..." : "Delete"}
                              </button>
                              <button
                                onClick={() => setDeleteConfirm(null)}
                                className="text-xs px-2 py-1 rounded bg-neutral-700 text-white hover:bg-neutral-600"
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setDeleteConfirm(file.name)}
                              className="text-neutral-700 hover:text-red-400 px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                            >
                              &#x2715;
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </>
                )}

                {listing.dirs.length === 0 && listing.files.length === 0 && !currentPath && (
                  <div className="text-center text-neutral-500 py-12">
                    Drive is empty. Upload a file or create a folder.
                  </div>
                )}
                {listing.dirs.length === 0 && listing.files.length === 0 && currentPath && (
                  <div className="text-center text-neutral-500 py-8">Empty folder</div>
                )}
              </div>
            )}
          </div>

          {/* File preview - side panel on desktop only (1280px+) */}
          {selectedFile && (
            <div className="hidden xl:block xl:w-1/2 sticky top-20">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-neutral-400 truncate">{selectedFile}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => window.open(publicFileUrl(selectedFile), "_blank")}
                    className="text-xs px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-300 hover:text-white transition-colors"
                    title="Open in new tab"
                  >
                    Open ↗
                  </button>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(publicFileUrl(selectedFile));
                      showToast("Link copied", "success");
                    }}
                    className="text-xs px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-300 hover:text-white transition-colors"
                    title="Copy link"
                  >
                    Copy link
                  </button>
                  <button
                    onClick={() => setSelectedFile(null)}
                    className="text-neutral-500 hover:text-white text-sm px-2"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <FilePreview url={fileUrl(selectedFile)} filePath={selectedFile} />
            </div>
          )}
        </div>
      </div>

      {/* Fullscreen preview overlay - mobile/tablet only (under 1280px) */}
      {selectedFile && (
        <div className="xl:hidden fixed inset-0 z-[250] bg-black flex flex-col">
          {/* Overlay header with close button */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-neutral-800 bg-black shrink-0">
            <span className="text-sm text-neutral-300 truncate min-w-0 flex-1">{selectedFile}</span>
            <button
              onClick={() => window.open(publicFileUrl(selectedFile), "_blank")}
              className="px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white text-sm font-medium transition-colors flex-none"
            >
              Open ↗
            </button>
            <button
              onClick={() => {
                navigator.clipboard.writeText(publicFileUrl(selectedFile));
                showToast("Link copied", "success");
              }}
              className="px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white text-sm font-medium transition-colors flex-none"
            >
              Link
            </button>
            <button
              onClick={() => setSelectedFile(null)}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-neutral-800 hover:bg-neutral-700 text-white text-xl font-bold transition-colors flex-none"
              aria-label="Close preview"
            >
              ✕
            </button>
          </div>
          {/* Preview content */}
          <div className="flex-1 overflow-auto p-4">
            <FilePreview url={fileUrl(selectedFile)} filePath={selectedFile} fullscreen />
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
