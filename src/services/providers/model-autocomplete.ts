/** Discord permits at most 25 choices; prioritize prefixes over loose matches. */
export function modelAutocompleteChoices(models: readonly string[], query: string): string[] {
  const normalized = query.trim().toLowerCase();
  const matches = models.filter(
    (model) => model.length <= 100 && model.toLowerCase().includes(normalized),
  );
  matches.sort((left, right) => {
    const a = left.toLowerCase().startsWith(normalized) ? 0 : 1;
    const b = right.toLowerCase().startsWith(normalized) ? 0 : 1;
    return a - b || left.localeCompare(right);
  });
  return matches.slice(0, 25);
}
