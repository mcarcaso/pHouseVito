export type MessageAttachment = {
  type: string;
  path: string;
  url?: string;
  filename?: string;
  mimeType?: string;
};

export type MessageBody = { text: string; attachments: MessageAttachment[] };

const imageMimeTypes: Record<string, string> = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function mediaAttachment(path: string): MessageAttachment {
  const filename = path.split("/").at(-1) || "Attachment";
  const extension = filename.split(".").at(-1)?.toLowerCase() ?? "";
  const mimeType = imageMimeTypes[extension];
  return {
    type: mimeType ? "image" : "file",
    path,
    filename,
    ...(mimeType ? { mimeType } : {}),
  };
}

function parseMediaReferences(body: MessageBody): MessageBody {
  const referenced: MessageAttachment[] = [];
  const text = body.text
    .replace(/^[\t ]*MEDIA:[\t ]*(\/[^\r\n]+?)[\t ]*$/gm, (_match, rawPath: string) => {
      const path = rawPath.trim();
      if (path) referenced.push(mediaAttachment(path));
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const seen = new Set<string>();
  const attachments = [...body.attachments, ...referenced].filter((attachment) => {
    if (seen.has(attachment.path)) return false;
    seen.add(attachment.path);
    return true;
  });

  return { text, attachments };
}

export function unpackMessageContent(content: string): MessageBody {
  let body: MessageBody;
  try {
    const parsed = JSON.parse(content) as unknown;
    if (typeof parsed === "string") {
      body = { text: parsed, attachments: [] };
    } else if (parsed && typeof parsed === "object") {
      const envelope = parsed as { text?: unknown; attachments?: unknown };
      if (typeof envelope.text === "string") {
        const attachments = Array.isArray(envelope.attachments)
          ? envelope.attachments.filter((item): item is MessageAttachment =>
              Boolean(
                item &&
                typeof item === "object" &&
                typeof (item as MessageAttachment).type === "string" &&
                typeof (item as MessageAttachment).path === "string",
              ),
            )
          : [];
        body = { text: envelope.text, attachments };
      } else {
        body = { text: JSON.stringify(parsed, null, 2), attachments: [] };
      }
    } else {
      body = { text: JSON.stringify(parsed, null, 2), attachments: [] };
    }
  } catch {
    body = { text: content, attachments: [] };
  }

  return parseMediaReferences(body);
}
