/** Clock time from seconds since midnight, e.g. "17:45" (or "00:30 +1d" past midnight). */
export function fmtClock(t: number): string {
  const day = Math.floor(t / 86400);
  const s = Math.floor(t % 86400);
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  return `${hh}:${mm}${day > 0 ? " +1d" : ""}`;
}
