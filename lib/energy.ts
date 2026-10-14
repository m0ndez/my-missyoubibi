import { check } from "./check";
import fs from "node:fs";
import path from "node:path";

// Daily energy per unit. The unit only reports a per-run counter (0.25 kWh steps, reset at every power-on),
// so we add up its upward steps ourselves. Every run loses on average ~0.125 kWh to the step size: totals read a bit low.
// ponytail: JSON file rewritten on each 0.25 kWh step (rare). Move to SQLite if you want hourly history.
type Data = { last: Record<string, number>; days: Record<string, Record<string, number>> };
const FILE = path.join(process.env.DATA_DIR ?? "data", "energy.json");
const KEEP_DAYS = 400;

// Read per call, no module cache: Next bundles the scheduler and the API route separately, so a cache would go stale.
function load(): Data {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8")) as Data;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; // corrupt file: fail loudly, never overwrite history
    return { last: {}, days: {} };
  }
}

function save(d: Data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeFileSync(fd, JSON.stringify(d)); // loops until every byte is written
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, FILE);
}

export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Pure step: new counter reading -> kWh to add. First reading adds nothing; a lower reading means the unit restarted its run.
// Known limit: if the unit restarts its run while this app is down AND the new run already passes the old reading, the reset
// is never seen and that part is undercounted. Keep the app running (the bridge polls every 5 s) to avoid it.
export function energyDelta(last: number | undefined, now: number): number {
  if (last === undefined) return 0;
  return now >= last ? now - last : now;
}

export function recordEnergy(id: string, reading: number | null | undefined, at = new Date()) {
  if (reading == null || !Number.isFinite(reading)) return;
  const d = load();
  const delta = energyDelta(d.last[id], reading);
  if (d.last[id] === reading) return;
  d.last[id] = reading;
  if (delta > 0) {
    const k = dayKey(at);
    d.days[k] = { ...d.days[k], [id]: (d.days[k]?.[id] ?? 0) + delta };
    prune(d);
  }
  save(d);
}

function prune(d: Data) {
  const keys = Object.keys(d.days).sort();
  for (const old of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete d.days[old];
}

// Backfill: set whole past days for one unit (what the unit can't tell us). Replaces any value already stored for that day.
export function setDays(id: string, entries: { day: string; kwh: number }[]) {
  const d = load();
  for (const { day, kwh } of entries) d.days[day] = { ...d.days[day], [id]: kwh };
  prune(d);
  save(d);
}

// "2026-10-01 4.5" per line (space, comma, tab, ":" or "=" between; optional "kWh"). Past days only: today is still being counted live.
export function parseDays(text: string, now = new Date()): { entries: { day: string; kwh: number }[] } | { error: string } {
  const today = dayKey(now);
  const oldest = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - KEEP_DAYS));
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return { error: "Nothing to save." };
  if (lines.length > KEEP_DAYS) return { error: `At most ${KEEP_DAYS} days at a time.` };
  const seen = new Map<string, number>();
  for (const [i, line] of lines.entries()) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[\s,;:=]+(\d+(?:\.\d+)?)\s*(?:kwh)?$/i.exec(line);
    const at = `Line ${i + 1}`;
    if (!m) return { error: `${at}: use "2026-10-01 4.5" (date, then kWh).` };
    const day = `${m[1]}-${m[2]}-${m[3]}`;
    const kwh = Number(m[4]);
    if (dayKey(new Date(+m[1], +m[2] - 1, +m[3])) !== day) return { error: `${at}: ${day} is not a real date.` };
    if (day >= today) return { error: `${at}: past days only (today is counted live).` };
    if (day < oldest) return { error: `${at}: older than ${KEEP_DAYS} days.` };
    if (!(kwh < 500)) return { error: `${at}: ${kwh} kWh in one day is too high.` };
    seen.set(day, kwh); // a repeated date: the last line wins
  }
  return { entries: [...seen].map(([day, kwh]) => ({ day, kwh })) };
}

export const loadEnergy = () => load().days;

// Self-check: `npx tsx lib/energy.ts`
if (process.argv[1]?.endsWith("lib/energy.ts")) {
  check(energyDelta(undefined, 3) === 0, "first reading adds nothing");
  check(energyDelta(1, 1.75) === 0.75, "upward step");
  check(energyDelta(5, 0.25) === 0.25, "reset at power-on counts the new run");
  check(energyDelta(2, 2) === 0, "no change");
  check(dayKey(new Date(2026, 9, 5)) === "2026-10-05", "local day key");
  const now = new Date(2026, 9, 13);
  const ok = parseDays("2026-10-01 4.5\n2026-10-02, 6.25 kWh\r\n\n2026-10-01\t5", now);
  check("entries" in ok && ok.entries.length === 2 && ok.entries[0].kwh === 5, "parse: repeats, separators, blank lines");
  for (const bad of ["x", "2026-02-30 1", "2026-10-13 1", "2026-10-14 1", "2025-01-01 1", "2026-10-01 -1", "2026-10-01 900"]) {
    check("error" in parseDays(bad, now), `parse rejects ${bad}`);
  }
  console.log("energy.ts checks done");
}
