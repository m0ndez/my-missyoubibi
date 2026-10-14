import { check } from "./check";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parsePatch, type AcControl } from "./ac";
import { isDevice } from "./devices";

export type Timer = {
  id: string;
  device: string;
  days: number[]; // 0 = Sunday .. 6 = Saturday, server local time (set TZ); [] for a one-shot
  time: string; // "HH:MM"; "" for a one-shot
  at?: number; // one-shot only: epoch ms when it fires, once
  patch: Partial<AcControl>;
};

// ponytail: JSON file, read per call. Fine for a few timers; move to SQLite if it grows.
export const MAX_TIMERS = 50;
const FILE = path.join(process.env.DATA_DIR ?? "data", "timers.json");

// Missing file = no timers. Any other failure throws so callers never overwrite good data with [].
export function loadTimers(): Timer[] {
  let text: string;
  try {
    text = fs.readFileSync(FILE, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error(`${FILE}: expected an array`);
  // One bad entry must not stop every timer from firing: skip it (and say so).
  return data
    .filter((t): t is Timer => {
      const ok = isTimer(t);
      if (!ok) console.error("timers: skipping a malformed entry", JSON.stringify(t));
      return ok;
    })
    .map((t) => ({ ...t, patch: parsePatch(t.patch)! })); // only the validated fields go on to the broker, not whatever else the file holds
}

export function isTimer(x: unknown): x is Timer {
  if (typeof x !== "object" || x === null) return false;
  const t = x as Record<string, unknown>;
  return (
    typeof t.id === "string" &&
    isDevice(t.device) &&
    Array.isArray(t.days) &&
    t.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) &&
    typeof t.time === "string" &&
    (t.at === undefined || (typeof t.at === "number" && Number.isFinite(t.at))) &&
    parsePatch(t.patch) !== null
  );
}

function save(timers: Timer[]) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeFileSync(fd, JSON.stringify(timers, null, 1)); // loops until every byte is written
    fs.fsyncSync(fd); // data on disk before the rename, so power loss cannot leave an empty file
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, FILE); // atomic: no half-written file on crash
}

// Trust boundary: request body -> new Timer, or null when invalid.
export function addTimer(x: unknown): Timer | null {
  if (typeof x !== "object" || x === null) return null;
  const o = x as Record<string, unknown>;
  const patch = parsePatch(o.patch);
  const all = loadTimers();
  if (all.length >= MAX_TIMERS) return null;
  // One-shot ("in 2 hours"): `after` minutes from now. Like the remote's ON/OFF timers and SLEEP.
  if (o.after !== undefined) {
    if (!patch || !isDevice(o.device) || !Number.isInteger(o.after) || (o.after as number) < 1 || (o.after as number) > 1440) return null;
    const once: Timer = { id: randomUUID(), device: o.device as string, days: [], time: "", at: Date.now() + (o.after as number) * 60_000, patch };
    save([...all, once]);
    return once;
  }
  const okDays =
    Array.isArray(o.days) && o.days.length > 0 && o.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  if (
    !patch ||
    !okDays ||
    !isDevice(o.device) ||
    typeof o.time !== "string" ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(o.time)
  ) {
    return null;
  }
  const timer: Timer = {
    id: randomUUID(),
    device: o.device as string,
    days: [...new Set(o.days as number[])].sort(),
    time: o.time,
    patch,
  };
  save([...all, timer]);
  return timer;
}

export function removeTimer(id: string) {
  save(loadTimers().filter((t) => t.id !== id));
}

// A removed unit takes its timers with it.
export function removeTimersFor(device: string) {
  save(loadTimers().filter((t) => t.device !== device));
}

const pad = (n: number) => String(n).padStart(2, "0");

// Timers whose minute is now and that have not fired this minute yet.
// `fired` is caller-owned so the poll interval can be shorter than a minute.
// ponytail: a timer missed while the server was down is skipped, not replayed; a restart inside the
// firing minute can fire it twice. Matching is local wall-clock, so DST zones would skip/double a timer.
export function dueTimers(timers: Timer[], now: Date, fired: Set<string>): Timer[] {
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const stamp = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()} ${time}`;
  for (const k of fired) if (!k.endsWith(`@${stamp}`)) fired.delete(k);
  const due = timers.filter(
    (t) => t.time === time && t.days.includes(now.getDay()) && !fired.has(`${t.id}@${stamp}`),
  );
  due.forEach((t) => fired.add(`${t.id}@${stamp}`));
  return due;
}

const MISSED_AFTER_MS = 10 * 60_000;
// One-shot timers whose time has come. `missed` ones (server was down) are dropped without firing:
// an "off in 2 h" must not switch things off the next morning.
export function dueOnce(timers: Timer[], nowMs: number): (Timer & { missed: boolean })[] {
  return timers
    .filter((t) => t.at !== undefined && t.at <= nowMs)
    .map((t) => ({ ...t, missed: nowMs - t.at! > MISSED_AFTER_MS }));
}

// Self-check: `npx tsx lib/timers.ts`
if (process.argv[1]?.endsWith("lib/timers.ts")) {
  const t: Timer = { id: "a", device: "srk24", days: [1], time: "07:30", patch: { power: true } };
  const fired = new Set<string>();
  const mon0730 = new Date(2026, 9, 12, 7, 30, 5); // Monday
  check(dueTimers([t], mon0730, fired).length === 1, "fires on match");
  check(dueTimers([t], mon0730, fired).length === 0, "fires once per minute");
  check(dueTimers([t], new Date(2026, 9, 13, 7, 30), fired).length === 0, "wrong weekday skipped");
  check(dueTimers([t], new Date(2026, 9, 19, 7, 30), fired).length === 1, "next week fires again");
  check(dueTimers([t], new Date(2026, 9, 19, 7, 31), fired).length === 0, "wrong minute skipped");
  const once: Timer = { id: "o", device: "srk24", days: [], time: "", at: 1000, patch: { power: false } };
  check(dueOnce([once], 999).length === 0, "one-shot not due yet");
  check(dueOnce([once], 1000)[0]?.missed === false, "one-shot due");
  check(dueOnce([once], 1000 + MISSED_AFTER_MS + 1)[0]?.missed === true, "old one-shot is missed");
  check(dueTimers([once], mon0730, new Set()).length === 0, "one-shot never matches weekly rules");
  check(isTimer(t) && isTimer(once), "valid timers pass");
  check(!isTimer({ ...t, days: "mon" }) && !isTimer({ ...t, device: "nope" }) && !isTimer({ ...t, patch: {} }) && !isTimer(null), "malformed timers rejected");
  console.log("timers.ts checks done");
}
