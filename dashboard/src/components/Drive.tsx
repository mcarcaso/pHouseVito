import { useState, useEffect, useRef } from 'react';

interface DriveItem {
  id: string;
  name: string;
  description: string;
  type: 'file' | 'site';
  isPublic: boolean;
  createdAt: string;
  mimeType?: string;
  filename?: string;
}

interface DriveFile {
  path: string;
  size: number;
  isDir: boolean;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function getPublicUrl(item: DriveItem): string {
  const base = window.location.origin;
  if (item.type === 'site') return `${base}/d/${item.id}/`;
  if (item.filename) return `${base}/d/${item.id}/${item.filename}`;
  return `${base}/d/${item.id}/`;
}

export default function Drive() {
  const [items, setItems] = useState<DriveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [itemFiles, setItemFiles] = useState<Record<string, DriveFile[]>>({});
  const [selectedFile, setSelectedFile] = useState<{ id: string; path: string; url: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Upload form state
  const [showUpload, setShowUpload] = useState(false);
  const [uploadName, setUploadName] = useState('');
  const [uploadType, setUploadType] = useState<'file' | 'site'>('file');
  const [uploadPublic, setUploadPublic] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchItems = () => {
    fetch('/api/drive')
      .then(r => r.json())
      .then(data => { setItems(data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { fetchItems(); }, []);

  const fetchFiles = async (id: string) => {
    if (itemFiles[id]) return;
    try {
      const res = await fetch(`/api/drive/${id}/files`);
      const files = await res.json();
      setItemFiles(prev => ({ ...prev, [id]: files }));
    } catch (e) {
      console.error('Failed to fetch files:', e);
    }
  };

  const toggleExpand = (id: string) => {
    if (expandedItem === id) {
      setExpandedItem(null);
    } else {
      setExpandedItem(id);
      fetchFiles(id);
    }
    setSelectedFile(null);
    setDeleteConfirm(null);
  };

  const handleTogglePublic = async (item: DriveItem) => {
    setActionLoading(`${item.id}-toggle`);
    try {
      const res = await fetch(`/api/drive/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublic: !item.isPublic }),
      });
      if (res.ok) {
        showToast(item.isPublic ? 'Made private' : 'Made public', 'success');
        fetchItems();
      } else {
        const data = await res.json();
        showToast(data.error || 'Failed', 'error');
      }
    } catch (e: any) {
      showToast(e.message || 'Failed', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (id: string) => {
    setActionLoading(`${id}-delete`);
    try {
      const res = await fetch(`/api/drive/${id}`, { method: 'DELETE' });
      if (res.ok) {
        showToast('Item deleted', 'success');
        setExpandedItem(null);
        setDeleteConfirm(null);
        fetchItems();
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

  const copyUrl = (item: DriveItem) => {
    navigator.clipboard.writeText(getPublicUrl(item));
    showToast('URL copied', 'success');
  };

  const handleUpload = async () => {
    if (!uploadFile || !uploadName.trim()) return;

    if (uploadType === 'site' && !uploadFile.name.endsWith('.zip')) {
      showToast('Sites require a .zip file', 'error');
      return;
    }

    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(uploadFile);
      });

      const res = await fetch('/api/drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: uploadName.trim(),
          type: uploadType,
          isPublic: uploadPublic,
          data: dataUrl,
          filename: uploadFile.name,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        showToast('Uploaded successfully', 'success');
        setShowUpload(false);
        setUploadName('');
        setUploadType('file');
        setUploadPublic(false);
        setUploadFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        fetchItems();
      } else {
        showToast(data.error || 'Upload failed', 'error');
      }
    } catch (e: any) {
      showToast(e.message || 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  const viewFileInDashboard = (id: string, filePath: string) => {
    setSelectedFile({ id, path: filePath, url: `/api/drive/${id}/content/${filePath}` });
  };

  return (
    <div className="flex flex-col pb-8">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-sm font-medium animate-[slideIn_0.2s_ease-out] ${
          toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-800 sticky top-0 bg-black/95 backdrop-blur z-10">
        <h2 className="text-lg font-semibold text-white">Drive ({items.length})</h2>
        <button
          onClick={() => setShowUpload(!showUpload)}
          className="ml-auto px-3 py-1.5 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
        >
          {showUpload ? 'Cancel' : '+ Upload'}
        </button>
      </div>

      <div className="p-4 sm:p-6 max-w-[700px] mx-auto w-full">
        {/* Upload form */}
        {showUpload && (
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 sm:p-5 mb-4">
            <h3 className="text-sm font-semibold text-white mb-3">Upload</h3>
            <div className="flex flex-col gap-3">
              <input
                type="text"
                placeholder="Name"
                value={uploadName}
                onChange={e => setUploadName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700 text-white text-sm placeholder:text-neutral-500 focus:outline-none focus:border-blue-500"
              />

              <div className="flex gap-2">
                <button
                  onClick={() => setUploadType('file')}
                  className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                    uploadType === 'file'
                      ? 'bg-blue-600 text-white'
                      : 'bg-neutral-800 text-neutral-400 hover:text-white'
                  }`}
                >
                  File
                </button>
                <button
                  onClick={() => setUploadType('site')}
                  className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                    uploadType === 'site'
                      ? 'bg-blue-600 text-white'
                      : 'bg-neutral-800 text-neutral-400 hover:text-white'
                  }`}
                >
                  Site (.zip)
                </button>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept={uploadType === 'site' ? '.zip' : undefined}
                onChange={e => setUploadFile(e.target.files?.[0] || null)}
                className="w-full text-sm text-neutral-400 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-neutral-800 file:text-neutral-300 file:text-sm file:font-medium file:cursor-pointer hover:file:bg-neutral-700"
              />

              <label className="flex items-center gap-2 text-sm text-neutral-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={uploadPublic}
                  onChange={e => setUploadPublic(e.target.checked)}
                  className="rounded bg-neutral-800 border-neutral-700 text-blue-600 focus:ring-blue-500"
                />
                Make public
              </label>

              <button
                onClick={handleUpload}
                disabled={uploading || !uploadFile || !uploadName.trim()}
                className="w-full px-3 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {uploading ? 'Uploading...' : 'Upload'}
              </button>
            </div>
          </div>
        )}

        {/* Items list */}
        {loading ? (
          <div className="text-center text-neutral-500 py-12">Loading...</div>
        ) : items.length === 0 ? (
          <div className="text-center text-neutral-500 py-12">No items yet. Upload a file or site to get started.</div>
        ) : (
          <div className="flex flex-col gap-3">
            {items.map(item => (
              <div
                key={item.id}
                className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden hover:border-neutral-700 transition-colors"
              >
                {/* Card header */}
                <div
                  className="p-4 sm:p-5 cursor-pointer"
                  onClick={() => toggleExpand(item.id)}
                >
                  <div className="flex justify-between items-center mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-semibold text-white">{item.name}</span>
                      <span className={`text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-md ${
                        item.type === 'site'
                          ? 'text-purple-400 bg-purple-400/10'
                          : 'text-sky-400 bg-sky-400/10'
                      }`}>
                        {item.type}
                      </span>
                      <span className={`ml-1 text-lg transition-transform ${expandedItem === item.id ? 'rotate-180' : ''}`}>&#x25BC;</span>
                    </div>
                    <span className={`text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-md ${
                      item.isPublic
                        ? 'text-green-400 bg-green-400/10'
                        : 'text-neutral-500 bg-neutral-500/10'
                    }`}>
                      {item.isPublic ? 'Public' : 'Private'}
                    </span>
                  </div>

                  {item.description && (
                    <p className="text-sm text-neutral-500 mb-2 leading-relaxed">{item.description}</p>
                  )}

                  {item.isPublic && (
                    <button
                      className="inline-block text-sm text-blue-400 hover:underline mb-2"
                      onClick={e => { e.stopPropagation(); copyUrl(item); }}
                      title="Click to copy"
                    >
                      {getPublicUrl(item).replace(/^https?:\/\//, '')} &#x2197;
                    </button>
                  )}

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600">
                    {item.filename && <span>{item.filename}</span>}
                    {item.createdAt && <span>{formatDate(item.createdAt)}</span>}
                  </div>
                </div>

                {/* Expanded panel */}
                {expandedItem === item.id && (
                  <div className="border-t border-neutral-800 bg-neutral-950">
                    {/* Actions */}
                    <div className="p-4 flex flex-wrap gap-2 border-b border-neutral-800">
                      <button
                        onClick={() => handleTogglePublic(item)}
                        disabled={actionLoading === `${item.id}-toggle`}
                        className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 ${
                          item.isPublic
                            ? 'bg-neutral-700 hover:bg-neutral-600 text-white'
                            : 'bg-green-600 hover:bg-green-500 text-white'
                        }`}
                      >
                        {actionLoading === `${item.id}-toggle` ? '...' : item.isPublic ? 'Make Private' : 'Make Public'}
                      </button>

                      {item.isPublic && (
                        <button
                          onClick={() => copyUrl(item)}
                          className="px-3 py-1.5 text-sm font-medium rounded-lg bg-neutral-700 hover:bg-neutral-600 text-white transition-colors"
                        >
                          Copy URL
                        </button>
                      )}

                      {item.isPublic && (
                        <a
                          href={getPublicUrl(item)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 text-sm font-medium rounded-lg bg-neutral-700 hover:bg-neutral-600 text-white transition-colors inline-flex items-center"
                        >
                          Open &#x2197;
                        </a>
                      )}

                      {deleteConfirm === item.id ? (
                        <div className="flex gap-2 ml-auto">
                          <span className="text-sm text-red-400 self-center">Delete forever?</span>
                          <button
                            onClick={() => handleDelete(item.id)}
                            disabled={actionLoading === `${item.id}-delete`}
                            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-red-600 hover:bg-red-500 text-white disabled:opacity-50 transition-colors"
                          >
                            {actionLoading === `${item.id}-delete` ? '...' : 'Yes, Delete'}
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-neutral-700 hover:bg-neutral-600 text-white transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirm(item.id)}
                          className="px-3 py-1.5 text-sm font-medium rounded-lg bg-red-900/50 hover:bg-red-800/50 text-red-400 ml-auto transition-colors"
                        >
                          Delete
                        </button>
                      )}
                    </div>

                    {/* Files section */}
                    <div className="p-4">
                      <h4 className="text-sm font-semibold text-neutral-400 mb-3">Files</h4>
                      {!itemFiles[item.id] ? (
                        <div className="text-sm text-neutral-600">Loading files...</div>
                      ) : (
                        <div className="flex flex-col sm:flex-row gap-4">
                          {/* File list */}
                          <div className="sm:w-56 shrink-0">
                            <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
                              {itemFiles[item.id]
                                .filter(f => !f.isDir)
                                .map(file => (
                                  <button
                                    key={file.path}
                                    onClick={() => viewFileInDashboard(item.id, file.path)}
                                    className={`text-left px-2 py-2 rounded text-sm transition-colors ${
                                      selectedFile?.id === item.id && selectedFile?.path === file.path
                                        ? 'bg-blue-600 text-white'
                                        : 'text-neutral-300 hover:bg-neutral-800 hover:text-white'
                                    }`}
                                  >
                                    <div className="font-medium">{file.path.split('/').pop()}</div>
                                    <div className="flex gap-2 text-xs opacity-50">
                                      {file.path.includes('/') && <span>{file.path.split('/').slice(0, -1).join('/')}/</span>}
                                      <span>{formatBytes(file.size)}</span>
                                    </div>
                                  </button>
                                ))}
                            </div>
                          </div>

                          {/* File preview */}
                          <div className="flex-1 min-w-0">
                            {selectedFile?.id === item.id ? (
                              <FilePreview url={selectedFile.url} filePath={selectedFile.path} />
                            ) : (
                              <div className="text-sm text-neutral-600 italic">
                                Click a file to preview
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
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

/** Preview a file served from the drive content API */
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

  // Fallback: download link
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4 text-sm text-neutral-400">
      <a href={url} download className="text-blue-400 hover:underline">Download {filePath.split('/').pop()}</a>
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
