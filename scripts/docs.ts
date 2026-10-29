// Renders config/assumptions.json as docs/assumptions.md, so the table can never drift from the code.
//   npm run docs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

type Entry = { value: unknown; unit?: string; source?: string; note?: string };
const cfg = JSON.parse(readFileSync("config/assumptions.json", "utf8")) as Record<string, unknown>;
const isEntry = (x: unknown): x is Entry => typeof x === "object" && x !== null && "value" in x;
const cell = (s: unknown) =>
  String(s ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ")
    .replace(/(https?:\/\/[^\s,;)]+)/g, "<$1>");
const fmt = (v: unknown) => (Array.isArray(v) ? (v.length > 6 ? `${v.length} items: ${v.join(", ")}` : v.join(", ")) : String(v));

const lines = [
  "# Assumptions",
  "",
  "Generated from `config/assumptions.json` by `npm run docs`. Every number the model uses lives in that file with its source;",
  "the app's info tooltips show the same source text. \"Assumption.\" marks a judgement call with no external source.",
  "",
];
for (const [section, body] of Object.entries(cfg)) {
  if (section.startsWith("_")) continue;
  lines.push(`## ${section}`, "", "| Parameter | Value | Unit | Source | Note |", "|---|---|---|---|---|");
  const walk = (obj: Record<string, unknown>, prefix: string) => {
    for (const [k, v] of Object.entries(obj)) {
      if (isEntry(v)) lines.push(`| ${prefix}${k} | ${cell(fmt(v.value))} | ${cell(v.unit)} | ${cell(v.source)} | ${cell(v.note)} |`);
      else if (typeof v === "object" && v) walk(v as Record<string, unknown>, `${prefix}${k}.`);
    }
  };
  walk(body as Record<string, unknown>, "");
  lines.push("");
}
mkdirSync("docs", { recursive: true });
writeFileSync("docs/assumptions.md", lines.join("\n"));
console.log(`docs/assumptions.md: ${lines.filter((l) => l.startsWith("| ") && !l.startsWith("| Parameter")).length} parameters`);
