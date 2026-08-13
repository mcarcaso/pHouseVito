import { useDriveTextFile } from "../../hooks/useDrive";

export default function FilePreview({
  url,
  filePath,
  fullscreen = false,
}: {
  url: string;
  filePath: string;
  fullscreen?: boolean;
}) {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"];
  const audioExts = ["mp3", "wav", "ogg", "m4a", "aac", "flac", "webm"];
  const videoExts = ["mp4", "webm", "mov", "avi", "mkv"];
  const textExts = ["html", "css", "js", "ts", "json", "txt", "md", "xml", "csv", "yml", "yaml"];

  if (imageExts.includes(ext)) {
    return (
      <div
        className={`bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden p-2 ${fullscreen ? "h-full flex items-center justify-center" : ""}`}
      >
        <img
          src={url}
          alt={filePath}
          className={`max-w-full object-contain mx-auto ${fullscreen ? "max-h-full" : "max-h-64"}`}
        />
      </div>
    );
  }

  if (audioExts.includes(ext)) {
    return (
      <div className="bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden p-4">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-2xl">🎵</span>
          <span className="text-sm text-neutral-300 truncate">{filePath.split("/").pop()}</span>
        </div>
        <audio controls className="w-full" preload="metadata">
          <source src={url} type={`audio/${ext === "mp3" ? "mpeg" : ext}`} />
          Your browser does not support the audio element.
        </audio>
      </div>
    );
  }

  if (videoExts.includes(ext)) {
    return (
      <div
        className={`bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden p-2 ${fullscreen ? "h-full flex items-center" : ""}`}
      >
        <video
          controls
          className={`w-full ${fullscreen ? "max-h-full" : "max-h-64"}`}
          preload="metadata"
        >
          <source src={url} type={`video/${ext === "mov" ? "quicktime" : ext}`} />
          Your browser does not support the video element.
        </video>
      </div>
    );
  }

  if (ext === "pdf") {
    return (
      <div
        className={`bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden ${fullscreen ? "h-full" : ""}`}
      >
        <iframe
          src={url}
          className={`w-full border-0 ${fullscreen ? "h-full" : "h-64"}`}
          title={filePath}
        />
      </div>
    );
  }

  if (textExts.includes(ext)) {
    return <TextFilePreview url={url} filePath={filePath} fullscreen={fullscreen} />;
  }

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4 text-sm text-neutral-400">
      <a href={url} download className="text-blue-400 hover:underline">
        Download {filePath}
      </a>
    </div>
  );
}

function TextFilePreview({
  url,
  filePath,
  fullscreen = false,
}: {
  url: string;
  filePath: string;
  fullscreen?: boolean;
}) {
  const contentQuery = useDriveTextFile(url);
  const content = contentQuery.data ?? (contentQuery.error ? "(failed to load)" : null);

  return (
    <div
      className={`bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden ${fullscreen ? "h-full flex flex-col" : ""}`}
    >
      <div className="px-3 py-2 bg-neutral-800 text-xs text-neutral-400 font-mono shrink-0">
        {filePath}
      </div>
      <pre
        className={`p-3 text-xs text-neutral-300 font-mono overflow-auto whitespace-pre-wrap break-all ${fullscreen ? "flex-1" : "max-h-64"}`}
      >
        {content === null ? "Loading..." : content}
      </pre>
    </div>
  );
}
