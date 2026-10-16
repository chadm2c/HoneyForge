/**
 * `<input type="datetime-local">` yields wall-clock time in the operator's
 * timezone, but every timestamp the control center stores is UTC. Convert
 * before sending, and drop an unparseable value instead of sending
 * "Invalid Date". Shared so the two filter pages cannot drift apart on it.
 */
export function localToIso(local: string): string | undefined {
  if (!local) return undefined;
  const parsed = new Date(local);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

/**
 * Compact UTC label (`"2026-10-15 13:00"`) for chart axes and bucket titles, so
 * a label stays on one line where the full ISO string would not.
 *
 * This deliberately diverges from `localToIso` on unparseable input: it is only
 * ever a display formatter, so it must always return a string a component can
 * render, and silently dropping text would leave a hole in an axis. It returns
 * an em dash rather than `undefined`, while `localToIso` — which feeds a
 * request — returns `undefined` so no value is sent at all.
 */
export function formatUtcMinute(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toISOString().slice(0, 16).replace("T", " ");
}
