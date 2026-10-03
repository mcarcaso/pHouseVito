/** Split safely at natural boundaries while keeping fenced code blocks valid. */
export function splitMessage(text: string, maxLength = 2_000): string[] {
  if (text.length <= maxLength) return [text];
  const chunks: string[] = [];
  let remaining = text;
  let openFence: string | null = null;

  while (remaining.length > 0) {
    const prefix = openFence ? `${openFence}\n` : "";
    if (prefix.length + remaining.length <= maxLength) {
      chunks.push(prefix + remaining);
      break;
    }
    // Reserve room to close a fence that may begin inside this chunk.
    const available = maxLength - prefix.length - 4;
    if (available <= 0) {
      chunks.push(prefix.slice(0, maxLength));
      openFence = null;
      continue;
    }
    const splitAt = findSplitPoint(remaining, available);
    const body = remaining.slice(0, splitAt);
    const nextOpenFence = getOpenFenceAfter(prefix + body);
    chunks.push(prefix + body + (nextOpenFence ? "\n```" : ""));
    openFence = nextOpenFence;
    remaining = remaining.slice(splitAt).replace(/^\n+/, "");
  }
  return chunks;
}

function findSplitPoint(text: string, maxBodyLength: number): number {
  if (text.length <= maxBodyLength) return text.length;
  const fenceBoundary = findLastClosedFenceBoundary(text, maxBodyLength);
  if (fenceBoundary > 0) return fenceBoundary;
  const para = text.lastIndexOf("\n\n", maxBodyLength);
  if (para > 0) return para;
  const line = text.lastIndexOf("\n", maxBodyLength);
  if (line > 0) return line;
  const space = text.lastIndexOf(" ", maxBodyLength);
  return space > 0 ? space : maxBodyLength;
}

function findLastClosedFenceBoundary(text: string, limit: number): number {
  let inFence = false;
  let lastClosed = -1;
  const fence = /(^|\n)(```[^\n]*)/g;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(text)) !== null) {
    const start = match.index + match[1].length;
    if (start >= limit) break;
    const lineEnd = text.indexOf("\n", start);
    const boundary = lineEnd === -1 ? text.length : lineEnd + 1;
    inFence = !inFence;
    if (!inFence && boundary <= limit) lastClosed = boundary;
  }
  return lastClosed;
}

function getOpenFenceAfter(text: string): string | null {
  let open: string | null = null;
  const fence = /(^|\n)(```[^\n]*)/g;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(text)) !== null) open = open ? null : match[2];
  return open;
}
