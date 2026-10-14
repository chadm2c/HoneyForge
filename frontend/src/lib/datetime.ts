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
