const STOP_WORDS = new Set([
  "about",
  "after",
  "approximately",
  "are",
  "before",
  "could",
  "current",
  "currently",
  "did",
  "does",
  "from",
  "generally",
  "has",
  "have",
  "how",
  "into",
  "is",
  "it",
  "latest",
  "mike",
  "name",
  "names",
  "now",
  "should",
  "still",
  "that",
  "their",
  "there",
  "these",
  "they",
  "this",
  "use",
  "uses",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "with",
  "would",
]);

export function getSearchTerms(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
        .split(/\s+/)
        .map((term) => term.replace(/'s$/, ""))
        .filter((term) => term.length >= 3 && !STOP_WORDS.has(term)),
    ),
  ];
}

function lineScore(line: string, terms: string[], currentStateQuery: boolean): number {
  const normalized = line.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (normalized.includes(term)) score += 2;
  }
  // Prefer direct user evidence when relevance is otherwise comparable.
  if (/\buser:|\] user:/.test(normalized)) score += 1;
  if (
    currentStateQuery &&
    /\b(current|currently|latest|final|no longer|replaced|retired|instead|corrected)\b/.test(
      normalized,
    )
  ) {
    score += 1;
  }
  return score;
}

/**
 * Return a compact evidence window around the most query-relevant line rather
 * than blindly returning the start of a potentially multi-topic chunk.
 */
export function extractRelevantExcerpt(text: string, query: string, maxChars = 900): string {
  if (text.length <= maxChars) return text;
  const lines = text.split("\n");
  const terms = getSearchTerms(query);
  const currentStateQuery = /\b(current|currently|latest|final|now|still|today|present)\b/i.test(
    query,
  );

  let bestIndex = 0;
  let bestScore = 0;
  for (let index = 0; index < lines.length; index++) {
    const score = lineScore(lines[index], terms, currentStateQuery);
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  }
  if (bestScore === 0) return `${text.slice(0, maxChars).trimEnd()}…`;

  let start = bestIndex;
  let end = bestIndex + 1;
  let excerpt = lines[bestIndex];
  while (excerpt.length < maxChars && (start > 0 || end < lines.length)) {
    const previous = start > 0 ? lines[start - 1] : null;
    const next = end < lines.length ? lines[end] : null;
    const leftDistance = bestIndex - start;
    const rightDistance = end - bestIndex - 1;
    const preferPrevious = previous !== null && (next === null || leftDistance <= rightDistance);
    if (preferPrevious && previous !== null && excerpt.length + previous.length + 1 <= maxChars) {
      start -= 1;
    } else if (next !== null && excerpt.length + next.length + 1 <= maxChars) {
      end += 1;
    } else if (previous !== null && excerpt.length + previous.length + 1 <= maxChars) {
      start -= 1;
    } else {
      break;
    }
    excerpt = lines.slice(start, end).join("\n");
  }

  const prefix = start > 0 ? "…\n" : "";
  const suffix = end < lines.length ? "\n…" : "";
  return `${prefix}${excerpt.trim()}${suffix}`;
}
