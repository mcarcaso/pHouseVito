/** Extract display text from a stored message, including attachment references.
 * Uses MEDIA: prefix for file references — consistent with the rest of the system. */
export function extractMessageText(raw: string): string {
  const content = JSON.parse(raw);
  if (typeof content === "string") return content;
  let text = content.text || "";
  if (Array.isArray(content.attachments)) {
    for (const a of content.attachments) {
      const ref = a.path || a.filename || a.url || "(attachment)";
      text += `\nMEDIA:${ref}`;
    }
  }
  return text;
}
