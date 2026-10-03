/** Resolve local wall time in an IANA zone; reject DST gaps and ambiguities. */
export function resolveJobTime(at: string, timezone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(at);
  if (!match)
    throw new Error("One-time jobs require local YYYY-MM-DDTHH:mm[:ss], without an offset");
  const parts = match.slice(1).map((value) => (value === undefined ? 0 : Number(value)));
  const [year, month, day, hour, minute, second = 0] = parts;
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const candidates = new Set<number>();
  // Sample offsets across both sides of any nearby transition.
  for (let delta = -48; delta <= 48; delta += 6) {
    const sample = wall + delta * 3600000;
    const p = Object.fromEntries(format.formatToParts(sample).map((v) => [v.type, v.value]));
    const rendered = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    const candidate = wall - (rendered - sample);
    const q = Object.fromEntries(format.formatToParts(candidate).map((v) => [v.type, v.value]));
    if (
      +q.year === year &&
      +q.month === month &&
      +q.day === day &&
      +q.hour === hour &&
      +q.minute === minute &&
      +q.second === second
    )
      candidates.add(candidate);
  }
  if (candidates.size !== 1)
    throw new Error(
      candidates.size
        ? "Ambiguous local time during DST transition; choose another time"
        : "Invalid or nonexistent local time; choose another time",
    );
  return new Date([...candidates][0]).toISOString();
}

export function localJobTime(instant: string, timezone: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(instant))
      .map((v) => [v.type, v.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}
