import { useState, useEffect, useRef } from 'react';

interface DirListing {
  path: string;
  meta: any | null;
  isPublic: boolean;
  dirs: { name: string; hasMeta: boolean; meta: any | null }[];
  files: { name: string; size: number; isPublic: boolean }[];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export default function Drive() {
  const [listing, setListing] = useState<DirListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentPath, setCurrentPath] = useState('');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Upload
  const [showUpload, setShowUpload] = useState(false);
  const [uploadType, setUploadType] = useState<'file' | 'site'>('file');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [siteFolderName, setSiteFolderName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // New folder
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchListing = (p?: string) => {
    const target = p !== undefined ? p : currentPath;
    setLoading(true);
    fetch(`/api/drive/ls?path=${encodeURIComponent(target)}`)
      .then(r => r.json())
      .then(data => { setListing(data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { fetchListing(); }, [currentPath]);

  const navigate = (folder: string) => {
    setCurrentPath(folder);
    setSelectedFile(null);
    setDeleteConfirm(null);
  };

  const navigateUp = () => {
    if (!currentPath) return;
    const parts = currentPath.split('/');
    parts.pop();
    navigate(parts.join('/'));
  };

  const navigateInto = (dirName: string) => {
    navigate(currentPath ? `${currentPath}/${dirName}` : dirName);
  };

  const togglePublic = async () => {
    if (!listing) return;
    setActionLoading('toggle');
    try {
      const res = await fetch(`/api/drive/meta?path=${encodeURIComponent(currentPath)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublic: !listing.isPublic }),
      });
      if (res.ok) {
        showToast(listing.isPublic ? 'Made private' : 'Made public', 'success');
        fetchListing();
      }
    } catch (e: any) {
      showToast(e.message || 'Failed', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const toggleFilePublic = async (fileName: string, currentlyPublic: boolean) => {
    const filePath = currentPath ? `${currentPath}/${fileName}` : fileName;
    setActionLoading(`toggle-${fileName}`);
    try {
      const res = await fetch(`/api/drive/file-meta?path=${encodeURIComponent(filePath)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublic: !currentlyPublic }),
      });
      if (res.ok) {
        showToast(currentlyPublic ? `${fileName} made private` : `${fileName} made public`, 'success');
        fetchListing();
      }
    } catch (e: any) {
      showToast(e.message || 'Failed', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (name: string, _isDir: boolean) => {
    const targetPath = currentPath ? `${currentPath}/${name}` : name;
    setActionLoading(`delete-${name}`);
    try {
      const res = await fetch(`/api/drive?path=${encodeURIComponent(targetPath)}`, { method: 'DELETE' });
      if (res.ok) {
        showToast(`Deleted ${name}`, 'success');
        setDeleteConfirm(null);
        if (selectedFile === name) setSelectedFile(null);
        fetchListing();
      } else {
        const data = await res.json();
        showToast(data.error || 'Delete failed', 'error');
      }
    } catch (e: any) {
      showToast(e.message || 'Delete failed', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleUpload = async () => {
    if (!uploadFile) return;

    if (uploadType === 'site') {
      if (!uploadFile.name.endsWith('.zip')) { showToast('Sites require a .zip file', 'error'); return; }
      if (!siteFolderName.trim()) { showToast('Enter a folder name for the site', 'error'); return; }
    }

    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(uploadFile);
      });

      const endpoint = uploadType === 'site' ? '/api/drive/upload-site' : '/api/drive/upload';
      const body = uploadType === 'site'
        ? { data: dataUrl, folder: currentPath ? `${currentPath}/${siteFolderName.trim()}` : siteFolderName.trim() }
        : { data: dataUrl, filename: uploadFile.name, folder: currentPath || undefined };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (res.ok) {
        showToast('Uploaded', 'success');
        setShowUpload(false);
        setUploadFile(null);
        setUploadType('file');
        setSiteFolderName('');
        if (fileInputRef.current) fileInputRef.current.value = '';
        fetchListing();
      } else {
        showToast(data.error || 'Upload failed', 'error');
      }
    } catch (e: any) {
      showToast(e.message || 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleNewFolder = async () => {
    if (!newFolderName.trim()) return;
    const folderPath = currentPath ? `${currentPath}/${newFolderName.trim()}` : newFolderName.trim();
    // Creating a .meta.json in the folder will create the folder
    try {
      const res = await fetch(`/api/drive/meta?path=${encodeURIComponent(folderPath)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublic: false }),
      });
      if (res.ok) {
        showToast('Folder created', 'success');
        setShowNewFolder(false);
        setNewFolderName('');
        fetchListing();
      } else {
        showToast('Failed to create folder', 'error');
      }
    } catch {
      showToast('Failed to create folder', 'error');
    }
  };

  const copyPublicUrl = () => {
    const base = window.location.origin;
    const url = `${base}/d/${currentPath}/`;
    navigator.clipboard.writeText(url);
    showToast('URL copied', 'success');
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
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-sm font-medium animate-[slideIn_0.2s_ease-out] ${
          toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-800 sticky top-0 bg-black/95 backdrop-blur z-10">
        <h2 className="text-lg font-semibold text-white">Drive</h2>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => { setShowNewFolder(!showNewFolder); setShowUpload(false); }}
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-neutral-700 hover:bg-neutral-600 text-white transition-colors"
          >
            + Folder
          </button>
          <button
            onClick={() => { setShowUpload(!showUpload); setShowNewFolder(false); }}
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
          >
            {showUpload ? 'Cancel' : '+ Upload'}
          </button>
        </div>
      </div>

      <div className="p-4 sm:p-6 max-w-[700px] mx-auto w-full">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1 mb-3 text-sm">
          <button
            onClick={() => navigate('')}
            className={currentPath ? 'text-blue-400 hover:underline' : 'text-white font-medium'}
          >
            drive
          </button>
          {currentPath && currentPath.split('/').map((part, i, arr) => {
            const folderPath = arr.slice(0, i + 1).join('/');
            const isLast = i === arr.length - 1;
            return (
              <span key={folderPath} className="flex items-center gap-1">
                <span className="text-neutral-600">/</span>
                {isLast ? (
                  <span className="text-white font-medium">{part}</span>
                ) : (
                  <button onClick={() => navigate(folderPath)} className="text-blue-400 hover:underline">{part}</button>
                )}
              </span>
            );
          })}

          {/* Public indicator + toggle */}
          {listing && (
            <span className="ml-3 flex items-center gap-2">
              <span className={`text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-md ${
                listing.isPublic ? 'text-green-400 bg-green-400/10' : 'text-neutral-500 bg-neutral-500/10'
              }`}>
                {listing.isPublic ? 'Public' : 'Private'}
              </span>
              <button
                onClick={togglePublic}
                disabled={actionLoading === 'toggle'}
                className="text-xs text-neutral-500 hover:text-white transition-colors"
              >
                {actionLoading === 'toggle' ? '...' : listing.isPublic ? 'make private' : 'make public'}
              </button>
              {listing.isPublic && currentPath && (
                <button onClick={copyPublicUrl} className="text-xs text-blue-400 hover:underline">copy url</button>
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
              onChange={e => setNewFolderName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleNewFolder()}
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

        {/* Upload form */}
        {showUpload && (
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 mb-4">
            <div className="flex flex-col gap-3">
              <div className="flex gap-2">
                <button
                  onClick={() => setUploadType('file')}
                  className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                    uploadType === 'file' ? 'bg-blue-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:text-white'
                  }`}
                >
                  File
                </button>
                <button
                  onClick={() => setUploadType('site')}
                  className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                    uploadType === 'site' ? 'bg-blue-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:text-white'
                  }`}
                >
                  Site (.zip)
                </button>
              </div>

              {uploadType === 'site' && (
                <input
                  type="text"
                  placeholder="Folder name for site"
                  value={siteFolderName}
                  onChange={e => setSiteFolderName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700 text-white text-sm placeholder:text-neutral-500 focus:outline-none focus:border-blue-500"
                />
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept={uploadType === 'site' ? '.zip' : undefined}
                onChange={e => setUploadFile(e.target.files?.[0] || null)}
                className="w-full text-sm text-neutral-400 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-neutral-800 file:text-neutral-300 file:text-sm file:font-medium file:cursor-pointer hover:file:bg-neutral-700"
              />

              <button
                onClick={handleUpload}
                disabled={uploading || !uploadFile || (uploadType === 'site' && !siteFolderName.trim())}
                className="w-full px-3 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {uploading ? 'Uploading...' : 'Upload'}
              </button>
            </div>
          </div>
        )}

        {/* Directory listing */}
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
            {listing.dirs.map(dir => (
              <div key={dir.name} className="group flex items-center rounded-lg hover:bg-neutral-800 transition-colors">
                <button
                  onClick={() => navigateInto(dir.name)}
                  className="flex-1 flex items-center gap-3 px-3 py-2.5 text-left text-sm"
                >
                  <span className="w-5 text-center text-neutral-500">&#x1F4C1;</span>
                  <span className="text-white font-medium">{dir.name}</span>
                  {dir.meta?.isPublic && (
                    <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded text-green-400 bg-green-400/10">public</span>
                  )}
                </button>
                {deleteConfirm === dir.name ? (
                  <div className="flex items-center gap-1 pr-2">
                    <button
                      onClick={() => handleDelete(dir.name, true)}
                      disabled={actionLoading === `delete-${dir.name}`}
                      className="text-xs px-2 py-1 rounded bg-red-600 text-white hover:bg-red-500 disabled:opacity-50"
                    >
                      {actionLoading === `delete-${dir.name}` ? '...' : 'Delete'}
                    </button>
                    <button onClick={() => setDeleteConfirm(null)} className="text-xs px-2 py-1 rounded bg-neutral-700 text-white hover:bg-neutral-600">No</button>
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

            {/* Files */}
            {listing.files.map(file => (
              <div key={file.name} className="group flex items-center rounded-lg hover:bg-neutral-800 transition-colors">
                <button
                  onClick={() => setSelectedFile(selectedFile === file.name ? null : file.name)}
                  className={`flex-1 flex items-center gap-3 px-3 py-2.5 text-left text-sm ${
                    selectedFile === file.name ? 'bg-blue-600/20' : ''
                  }`}
                >
                  <span className="w-5 text-center text-neutral-600">&#x1F4C4;</span>
                  <span className="text-neutral-200">{file.name}</span>
                  <span className="text-xs text-neutral-600">{formatBytes(file.size)}</span>
                </button>
                <button
                  onClick={() => toggleFilePublic(file.name, file.isPublic)}
                  disabled={actionLoading === `toggle-${file.name}`}
                  className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded cursor-pointer transition-colors shrink-0 ${
                    file.isPublic
                      ? 'text-green-400 bg-green-400/10 hover:bg-green-400/20'
                      : 'text-neutral-600 bg-neutral-600/10 hover:bg-neutral-600/20'
                  }`}
                  title={file.isPublic ? 'Click to make private' : 'Click to make public'}
                >
                  {actionLoading === `toggle-${file.name}` ? '...' : file.isPublic ? 'public' : 'private'}
                </button>
                {file.isPublic && (
                  <button
                    onClick={() => { navigator.clipboard.writeText(publicFileUrl(file.name)); showToast('URL copied', 'success'); }}
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
                      {actionLoading === `delete-${file.name}` ? '...' : 'Delete'}
                    </button>
                    <button onClick={() => setDeleteConfirm(null)} className="text-xs px-2 py-1 rounded bg-neutral-700 text-white hover:bg-neutral-600">No</button>
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
            ))}

            {listing.dirs.length === 0 && listing.files.length === 0 && !currentPath && (
              <div className="text-center text-neutral-500 py-12">Drive is empty. Upload a file or create a folder.</div>
            )}
            {listing.dirs.length === 0 && listing.files.length === 0 && currentPath && (
              <div className="text-center text-neutral-500 py-8">Empty folder</div>
            )}
          </div>
        )}

        {/* File preview */}
        {selectedFile && (
          <div className="mt-4">
            <FilePreview url={fileUrl(selectedFile)} filePath={selectedFile} />
          </div>
        )}
      </div>

      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}

function FilePreview({ url, filePath }: { url: string; filePath: string }) {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'];
  const textExts = ['html', 'css', 'js', 'ts', 'json', 'txt', 'md', 'xml', 'csv', 'yml', 'yaml'];

  if (imageExts.includes(ext)) {
    return (
      <div className="bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden p-2">
        <img src={url} alt={filePath} className="max-w-full max-h-64 object-contain mx-auto" />
      </div>
    );
  }

  if (ext === 'pdf') {
    return (
      <div className="bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden">
        <iframe src={url} className="w-full h-64 border-0" title={filePath} />
      </div>
    );
  }

  if (textExts.includes(ext)) {
    return <TextFilePreview url={url} filePath={filePath} />;
  }

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4 text-sm text-neutral-400">
      <a href={url} download className="text-blue-400 hover:underline">Download {filePath}</a>
    </div>
  );
}

function TextFilePreview({ url, filePath }: { url: string; filePath: string }) {
  const [content, setContent] = useState<string | null>(null);

  useEffect(() => {
    fetch(url)
      .then(r => r.text())
      .then(setContent)
      .catch(() => setContent('(failed to load)'));
  }, [url]);

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-neutral-800 text-xs text-neutral-400 font-mono">{filePath}</div>
      <pre className="p-3 text-xs text-neutral-300 font-mono overflow-x-auto max-h-64 whitespace-pre-wrap break-all">
        {content === null ? 'Loading...' : content}
      </pre>
    </div>
  );
}
