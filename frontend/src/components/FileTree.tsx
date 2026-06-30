import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronRight, ChevronDown, Folder, FolderOpen, File as FileIcon, X, Upload, Download } from 'lucide-react';
import { listFiles, readFile, fetchRawFile, uploadFile, UploadError } from '../lib/api';
import type { FileEntry } from '../lib/api';
import { watchDir } from '../lib/fileWatch';
import { useMobileDragSource } from '../lib/mobileDrag';

type MediaKind = 'image' | 'video' | 'audio' | 'pdf' | 'text';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg', 'apng']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv', 'mkv']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'oga', 'm4a', 'flac', 'aac', 'opus']);

function detectKind(filePath: string): MediaKind {
  const ext = (filePath.split('/').pop() || '').split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (ext === 'pdf') return 'pdf';
  return 'text';
}

// Dotfiles that stay visible even when "show hidden" is off — env files are
// load-bearing config the user actively manages from the UI.
const ALWAYS_VISIBLE_DOTFILE = /^\.env(\..+)?$|^\.envrc$/;

export function isHiddenFile(name: string): boolean {
  return name.startsWith('.') && !ALWAYS_VISIBLE_DOTFILE.test(name);
}

interface Props {
  rootPath: string;
  showHidden?: boolean;
  onCdFolder?: (path: string) => void;
}

export default function FileTree({ rootPath, showHidden = false, onCdFolder }: Props) {
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  return (
    <>
      <div className="pb-3 font-mono text-sm">
        <DirNode
          path={rootPath}
          name={rootPath.split('/').pop() || rootPath}
          depth={0}
          openByDefault
          showHidden={showHidden}
          onOpenFile={setPreviewPath}
          onCdFolder={onCdFolder}
        />
      </div>
      {previewPath && <FilePreview path={previewPath} onClose={() => setPreviewPath(null)} />}
    </>
  );
}

interface NodeProps {
  path: string;
  name: string;
  depth: number;
  openByDefault?: boolean;
  showHidden?: boolean;
  onOpenFile: (path: string) => void;
  onCdFolder?: (path: string) => void;
}

// Window for treating two rapid clicks/taps on a folder as a "cd here" gesture.
const DOUBLE_TAP_MS = 350;

function DirNode({ path, name, depth, openByDefault, showHidden, onOpenFile, onCdFolder }: NodeProps) {
  const [open, setOpen] = useState(!!openByDefault);
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const lastTapRef = useRef(0);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    listFiles(path)
      .then(setEntries)
      .catch((err) => setError(err instanceof Error ? err.message : 'failed'))
      .finally(() => setLoading(false));
  }, [path]);

  useEffect(() => {
    if (!open || entries) return;
    refresh();
  }, [open, entries, refresh]);

  // Subscribe to backend fs.watch events for this directory while it's open.
  // Server-side debouncing + auto-throttling keeps noisy dirs from drowning
  // the UI — a folder under heavy write churn (e.g. an agent CLI rewriting
  // files) silently downshifts to ~1 refresh per 30s on the server side.
  useEffect(() => {
    if (!open) return;
    return watchDir(path, (ev) => {
      if (ev.type === 'change') refresh();
    });
  }, [open, path, refresh]);

  const indent = { paddingLeft: `${depth * 12 + 8}px` };

  // Mobile touch-drag source — long-press starts a drag, mirroring the
  // desktop draggable+onDragStart pair. Additive: desktop drag is unchanged.
  const { touchHandlers } = useMobileDragSource({
    accepts: 'path',
    getPayload: () => path,
    getLabel: () => name,
  });

  const handleClick = () => {
    const now = Date.now();
    const isDoubleTap = onCdFolder && now - lastTapRef.current < DOUBLE_TAP_MS;
    if (isDoubleTap) {
      // Second tap: revert the toggle from this click and cd instead.
      lastTapRef.current = 0;
      setOpen((v) => !v);
      onCdFolder!(path);
    } else {
      lastTapRef.current = now;
      setOpen((v) => !v);
    }
  };

  return (
    <div>
      <div
        className="group flex items-center py-0.5 text-panel-muted hover:bg-panel-bg/50"
        style={indent}
      >
        <button
          onClick={handleClick}
          draggable
          onDragStart={(e) => startPathDrag(e, path)}
          {...touchHandlers}
          className="flex-1 min-w-0 flex items-center gap-1 hover:text-panel-text text-left touch-manipulation select-none"
          title={onCdFolder ? 'Tap to toggle · double-tap (or use cd) to cd here · drag onto a terminal to paste path' : `Drag onto a terminal to paste path · ${path}`}
        >
          {open ? <ChevronDown className="w-3 h-3 flex-shrink-0" /> : <ChevronRight className="w-3 h-3 flex-shrink-0" />}
          {open ? <FolderOpen className="w-3.5 h-3.5 flex-shrink-0 text-panel-text" /> : <Folder className="w-3.5 h-3.5 flex-shrink-0 text-panel-text" />}
          {/* Folder names are brand-orange in light mode so they remain
              readable against the gray dither shader in the mobile drawer
              (and to carry the brand colour the drawer lost when its dither
              was retuned). Dark mode inherits the muted/hover behaviour from
              the parent button — unchanged. */}
          <span className="truncate text-orange-500 dark:text-inherit">{name}</span>
        </button>
        {onCdFolder && (
          <button
            onClick={(e) => { e.stopPropagation(); onCdFolder(path); }}
            className="px-1 mr-0.5 flex-shrink-0 font-mono text-[10px] leading-none uppercase tracking-wider text-panel-muted hover:text-panel-text opacity-60 hover:opacity-100"
            aria-label={`cd into ${name}`}
            title="cd into this folder"
          >
            cd
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); setUploadOpen(true); }}
          className="p-1 mr-1 flex-shrink-0 text-panel-muted hover:text-panel-text opacity-50 hover:opacity-100"
          aria-label={`Upload file to ${name}`}
          title="Upload file here"
        >
          <Upload className="w-3 h-3" />
        </button>
      </div>
      {open && (
        <div>
          {loading && <div className="py-0.5 text-xs text-panel-muted" style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}>loading…</div>}
          {error && <div className="py-0.5 text-xs text-red-400" style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}>{error}</div>}
          {entries
            ?.filter((entry) => showHidden || !isHiddenFile(entry.name))
            .map((entry) =>
              entry.type === 'dir' ? (
                <DirNode
                  key={entry.path}
                  path={entry.path}
                  name={entry.name}
                  depth={depth + 1}
                  showHidden={showHidden}
                  onOpenFile={onOpenFile}
                  onCdFolder={onCdFolder}
                />
              ) : (
                <FileNode key={entry.path} path={entry.path} name={entry.name} depth={depth + 1} onOpenFile={onOpenFile} />
              ),
            )}
        </div>
      )}
      {uploadOpen && (
        <UploadModal
          dirPath={path}
          onClose={() => setUploadOpen(false)}
          onDone={() => { setUploadOpen(false); setOpen(true); refresh(); }}
        />
      )}
    </div>
  );
}

// MIME used to carry an in-app file/folder path on the dataTransfer of a
// drag from the tree. The terminal's drop target only accepts this type, so
// drags of OS files (which arrive as `Files` / `application/octet-stream`)
// don't accidentally insert their name and OS-internal paths.
const PATH_MIME = 'application/x-voidbunny-path';

function startPathDrag(e: React.DragEvent, path: string) {
  e.dataTransfer.setData(PATH_MIME, path);
  // `text/plain` fallback so dragging into an external editor / textarea
  // still inserts the path as readable text.
  e.dataTransfer.setData('text/plain', path);
  e.dataTransfer.effectAllowed = 'copy';
}

function FileNode({ path, name, depth, onOpenFile }: NodeProps) {
  const indent = { paddingLeft: `${depth * 12 + 8 + 12}px` };
  const { touchHandlers } = useMobileDragSource({
    accepts: 'path',
    getPayload: () => path,
    getLabel: () => name,
  });
  return (
    <button
      onClick={() => onOpenFile(path)}
      draggable
      onDragStart={(e) => startPathDrag(e, path)}
      {...touchHandlers}
      className="w-full flex items-center gap-1 py-0.5 text-panel-muted hover:text-panel-text hover:bg-panel-bg/50 text-left touch-manipulation select-none"
      style={indent}
      title={`Drag onto a terminal to paste this path · ${path}`}
    >
      <FileIcon className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="truncate">{name}</span>
    </button>
  );
}

function UploadModal({
  dirPath,
  onClose,
  onDone,
}: {
  dirPath: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<'file' | 'paste'>('file');
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [filename, setFilename] = useState('.env');
  const [overwrite, setOverwrite] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const accept = useCallback((f: File) => {
    setPickedFile(f);
    setFilename(f.name);
    setError(null);
  }, []);

  const handleBackdrop = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  const handleSubmit = async () => {
    const trimmed = filename.trim();
    if (!trimmed) { setError('filename required'); return; }
    const body: Blob | string | null = mode === 'file' ? pickedFile : pasteText;
    if (!body || (typeof body === 'string' && !body.length)) {
      setError(mode === 'file' ? 'choose a file or drop one in' : 'paste contents first');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      await uploadFile(dirPath, trimmed, body, { force: overwrite });
      onDone();
    } catch (err) {
      if (err instanceof UploadError && err.status === 409) {
        setError('file already exists — tick "overwrite" to replace');
      } else {
        setError(err instanceof Error ? err.message : 'upload failed');
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3 sm:p-6"
      onClick={handleBackdrop}
      style={{
        paddingTop: 'max(0.75rem, env(safe-area-inset-top))',
        paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
      }}
    >
      <div className="w-full max-w-md max-h-[85dvh] flex flex-col bg-panel-surface border border-panel-border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-3 sm:px-4 h-10 border-b border-panel-border flex-shrink-0">
          <div className="flex flex-col min-w-0 pr-2">
            <span className="font-mono text-[10px] uppercase tracking-wide text-panel-muted">Upload to</span>
            <span className="font-mono text-xs text-panel-text truncate">{dirPath}</span>
          </div>
          <button onClick={onClose} className="p-1 text-panel-muted hover:text-panel-text flex-shrink-0" aria-label="Close upload">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 space-y-3">
          <div className="flex gap-1 font-mono text-xs">
            <button
              type="button"
              onClick={() => setMode('file')}
              className={`px-2.5 py-1 rounded ${mode === 'file' ? 'bg-panel-text text-panel-bg' : 'bg-panel-bg text-panel-text border border-panel-border'}`}
            >
              File
            </button>
            <button
              type="button"
              onClick={() => setMode('paste')}
              className={`px-2.5 py-1 rounded ${mode === 'paste' ? 'bg-panel-text text-panel-bg' : 'bg-panel-bg text-panel-text border border-panel-border'}`}
            >
              Paste contents
            </button>
          </div>

          {mode === 'file' && (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) accept(f);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-md p-4 text-center cursor-pointer transition-colors ${
                dragOver ? 'border-panel-text bg-panel-bg' : 'border-panel-border hover:border-panel-muted'
              }`}
            >
              {pickedFile ? (
                <div className="font-mono text-xs text-panel-text break-all">
                  {pickedFile.name}
                  <span className="text-panel-muted"> · {pickedFile.size} bytes</span>
                </div>
              ) : (
                <div className="text-xs text-panel-muted space-y-1">
                  <div>Drag a file here, or click to choose</div>
                  <div className="text-[10px]">
                    Tip: on macOS press <kbd className="font-mono">⌘⇧.</kbd> in the file dialog to reveal hidden files like <code>.env</code>
                  </div>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) accept(f);
                  e.target.value = '';
                }}
              />
            </div>
          )}

          {mode === 'paste' && (
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="paste file contents here…"
              rows={8}
              className="w-full font-mono text-xs bg-panel-bg border border-panel-border rounded p-2 text-panel-text resize-y focus:outline-none focus:border-panel-muted"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
            />
          )}

          <label className="block">
            <span className="text-[10px] font-mono uppercase tracking-wide text-panel-muted">filename</span>
            <input
              type="text"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              className="mt-1 w-full font-mono text-xs bg-panel-bg border border-panel-border rounded p-2 text-panel-text focus:outline-none focus:border-panel-muted"
              placeholder=".env"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
            />
          </label>

          <label className="flex items-center gap-2 text-xs font-mono text-panel-muted cursor-pointer">
            <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
            overwrite if exists
          </label>

          {error && <div className="text-xs text-red-400 font-mono">{error}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 px-3 sm:px-4 py-2 border-t border-panel-border flex-shrink-0">
          <button
            onClick={onClose}
            disabled={uploading}
            className="px-3 py-1.5 text-xs font-mono text-panel-muted hover:text-panel-text disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={uploading}
            className="px-3 py-1.5 text-xs font-mono bg-panel-text text-panel-bg rounded disabled:opacity-50"
          >
            {uploading ? 'uploading…' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function FilePreview({ path, onClose }: { path: string; onClose: () => void }) {
  const kind = detectKind(path);
  const [content, setContent] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setContent(null);
    setBlobUrl(null);
    setError(null);

    if (kind === 'text') {
      let cancelled = false;
      readFile(path)
        .then((res) => { if (!cancelled) setContent(res.content); })
        .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'failed'); });
      return () => { cancelled = true; };
    }

    let cancelled = false;
    let createdUrl: string | null = null;
    fetchRawFile(path)
      .then((blob) => {
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'failed'); });
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [path, kind]);

  const handleBackdrop = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  const downloadHref = `/api/file/raw?path=${encodeURIComponent(path)}`;
  const downloadName = path.split('/').pop() || 'file';

  const handleDownload = useCallback(async (e: React.MouseEvent) => {
    // <a download> can't carry an Authorization header — fetch via the API
    // helper (which attaches the bearer token) and trigger the download from
    // the resulting blob.
    e.preventDefault();
    try {
      const blob = await fetchRawFile(path);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'download failed');
    }
  }, [path, downloadName]);

  const isMedia = kind !== 'text';

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3 sm:p-6"
      onClick={handleBackdrop}
      style={{
        paddingTop: 'max(0.75rem, env(safe-area-inset-top))',
        paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
      }}
    >
      <div className="w-full max-w-3xl max-h-[85dvh] flex flex-col bg-panel-surface border border-panel-border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-3 sm:px-4 h-10 border-b border-panel-border flex-shrink-0">
          <span className="font-mono text-xs text-panel-muted truncate flex-1">{path}</span>
          <a
            href={downloadHref}
            onClick={handleDownload}
            className="p-1 text-panel-muted hover:text-panel-text flex-shrink-0"
            aria-label="Download file"
            title="Download"
          >
            <Download className="w-4 h-4" />
          </a>
          <button onClick={onClose} className="p-1 text-panel-muted hover:text-panel-text flex-shrink-0" aria-label="Close preview">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div
          className={`flex-1 min-h-0 bg-panel-bg ${
            isMedia
              ? 'flex items-center justify-center overflow-hidden'
              : 'overflow-y-auto scrollbar-thin scroll-touch overscroll-contain'
          }`}
          style={isMedia ? undefined : { touchAction: 'pan-y' }}
        >
          {error && <div className="p-4 text-sm text-red-400 font-mono">{error}</div>}

          {!error && kind === 'text' && content === null && (
            <div className="p-4 text-sm text-panel-muted font-mono">loading…</div>
          )}
          {!error && kind === 'text' && content !== null && (
            <pre className="p-3 sm:p-4 font-mono text-xs sm:text-sm text-panel-text whitespace-pre-wrap break-all">
              {content}
            </pre>
          )}

          {!error && isMedia && !blobUrl && (
            <div className="p-4 text-sm text-panel-muted font-mono">loading…</div>
          )}

          {!error && blobUrl && kind === 'image' && (
            <img
              src={blobUrl}
              alt={downloadName}
              className="max-w-full max-h-full object-contain select-none"
              draggable={false}
            />
          )}
          {!error && blobUrl && kind === 'video' && (
            <video
              src={blobUrl}
              controls
              playsInline
              className="max-w-full max-h-full"
            />
          )}
          {!error && blobUrl && kind === 'audio' && (
            <audio src={blobUrl} controls className="w-[90%] max-w-md" />
          )}
          {!error && blobUrl && kind === 'pdf' && (
            <iframe
              src={blobUrl}
              title={downloadName}
              className="w-full h-full bg-white"
            />
          )}
        </div>
      </div>
    </div>
  );
}
