// Plays operator mode with a simple automatic policy, to check the mechanics and give a baseline score.
//   npx tsx scripts/operator-bot.ts [preset] [rate]
import { readFileSync } from "node:fs";
import { callsForDay, markIncomplete } from "../src/sim/data";
import { eligibilityTest } from "../src/sim/scenario";
import { autoPolicy, createOperator, score, step } from "../src/sim/operator";
import { presetById } from "../src/sim/presets";
import type { CallsMonthFile } from "../src/sim/types";

const loadMonth = (month: string) => JSON.parse(readFileSync(`public/data/calls-${month}.json`, "utf8")) as CallsMonthFile;

const preset = presetById(process.argv[2] ?? "soma")!;
const rate = Number(process.argv[3] ?? 1);
const sc = preset.build();
const manifest = JSON.parse(readFileSync("public/data/manifest.json", "utf8")) as { months: { month: string; days: { date: string; calls: number }[] }[] };
const incomplete = markIncomplete(manifest.months.flatMap((m) => m.days));
const eligible = eligibilityTest(sc);
const pool = manifest.months.flatMap(({ month }) => {
  const f = loadMonth(month);
  return f.days.filter((d) => !incomplete.has(d)).flatMap((d) => callsForDay(f, d).filter(eligible));
});
const poolDays = manifest.months.flatMap((m) => m.days).filter((d) => !incomplete.has(d.date)).length;

const s = createOperator({ scenario: sc, pool, poolDays, startT: 15 * 3600, durationS: 3 * 3600, rateMultiplier: rate, seed: 42 });
while (!s.finished) {
  step(s, 5);
  autoPolicy(s);
}
console.log(`${preset.name}, 15:00-18:00, rate x${rate}, pool ${pool.length} calls over ${poolDays} days`);
console.log(score(s));
console.log(s.events.slice(0, 12).map((e) => `${(e.t / 3600).toFixed(2)}h ${e.kind}: ${e.text}`).join("\n"));
