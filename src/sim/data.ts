import type { Call, CallsMonthFile } from "./types";

/** Expand the columnar month file into Call objects for one date. */
export function callsForDay(file: CallsMonthFile, date: string): Call[] {
  const dayIdx = file.days.indexOf(date);
  if (dayIdx < 0) return [];
  const c = file.cols;
  const out: Call[] = [];
  for (let i = 0; i < c.t.length; i++) {
    if (c.day[i] !== dayIdx) continue;
    const [typeO, typeODesc] = file.types[c.type[i]];
    const dist = c.dist[i];
    out.push({
      id: i,
      date,
      t: c.t[i],
      entry: c.entry[i],
      disp: c.disp[i],
      onscene: c.onscene[i],
      close: c.close[i],
      lon: c.lon[i],
      lat: c.lat[i],
      typeO,
      typeODesc,
      prioO: c.prio[i],
      district: dist == null ? null : file.districts[dist],
      dispo: file.dispositions[c.dispo[i]],
      dup: c.dup[i] === 1,
    });
  }
  return out;
}

/** Days with under half the typical call count (the data ends partway through them). */
export function markIncomplete(counts: { date: string; calls: number }[]): Set<string> {
  const sorted = counts.map((c) => c.calls).sort((a, b) => a - b);
  const typical = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return new Set(counts.filter((c) => c.calls < typical * 0.5).map((c) => c.date));
}
