export interface DriveFile {
  name: string;
  size: number;
  isPublic: boolean;
  createdAt?: string;
}

export type SortField = "name" | "createdAt" | "type" | "size";
export type SortDir = "asc" | "desc";

export function getFileType(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    png: "Image",
    jpg: "Image",
    jpeg: "Image",
    gif: "Image",
    webp: "Image",
    svg: "Image",
    bmp: "Image",
    mp3: "Audio",
    wav: "Audio",
    ogg: "Audio",
    m4a: "Audio",
    aac: "Audio",
    flac: "Audio",
    mp4: "Video",
    webm: "Video",
    mov: "Video",
    avi: "Video",
    mkv: "Video",
    pdf: "PDF",
    html: "HTML",
    css: "CSS",
    js: "JS",
    ts: "TS",
    json: "JSON",
    txt: "Text",
    md: "Markdown",
    xml: "XML",
    csv: "CSV",
    yml: "YAML",
    yaml: "YAML",
    zip: "Archive",
    gz: "Archive",
    tar: "Archive",
  };
  return map[ext] || ext.toUpperCase() || "File";
}

export function sortFiles(files: DriveFile[], field: SortField, dir: SortDir): DriveFile[] {
  return [...files].sort((a, b) => {
    let cmp = 0;
    switch (field) {
      case "name":
        cmp = a.name.localeCompare(b.name);
        break;
      case "createdAt":
        cmp = (a.createdAt || "").localeCompare(b.createdAt || "");
        break;
      case "type":
        cmp = getFileType(a.name).localeCompare(getFileType(b.name));
        break;
      case "size":
        cmp = a.size - b.size;
        break;
    }
    return dir === "asc" ? cmp : -cmp;
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
