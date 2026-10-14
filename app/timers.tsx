"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { FANS, MODES, TEMP_MAX, TEMP_MIN, type Fan, type Mode } from "@/lib/ac";
import type { Timer } from "@/lib/timers";
import { control, signedOut, type Unit } from "./control";
import { Trash } from "./icons";
import { Segmented } from "./segmented";

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS = [1, 2, 3, 4, 5];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const ACTIONS = [
  { value: "on", label: "Turn on" },
  { value: "off", label: "Turn off" },
] as const;

const WHEN = [
  { value: "weekly", label: "Weekly" },
  { value: "once", label: "Once, in…" },
] as const;
const AFTER = [30, 60, 90, 120, 180, 240, 360, 480, 720];
const afterLabel = (m: number) =>
  m < 60 ? `${m} min` : `${m / 60} h`.replace(".5", ":30");
const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

const cap = (x: string) => x[0].toUpperCase() + x.slice(1);

// "Turn on · Cool 24° · Fan 2" — what a timer does, in the order people read a remote.
function actionLabel(patch: Timer["patch"]) {
  const parts = [patch.power ? "Turn on" : "Turn off"];
  if (patch.mode) parts.push(cap(patch.mode));
  if (patch.temp !== undefined) parts.push(`${patch.temp}°`);
  if (patch.fan) parts.push(`Fan ${patch.fan}`);
  return parts.join(" · ");
}

function daysLabel(days: number[]) {
  const set = new Set(days);
  if (set.size === 7) return "Every day";
  if (set.size === 5 && WEEKDAYS.every((d) => set.has(d))) return "Weekdays";
  if (set.size === 2 && set.has(0) && set.has(6)) return "Weekends";
  return DAY_ORDER.filter((d) => set.has(d))
    .map((d) => DAY_NAMES[d])
    .join(", ");
}

export function Timers({ devices }: { devices: Unit[] }) {
  const router = useRouter();
  const [timers, setTimers] = useState<Timer[] | null>(null);
  const [chosen, setDevice] = useState<string>(devices[0].id);
  const device = devices.some((d) => d.id === chosen) ? chosen : devices[0].id; // the chosen unit may have been removed
  const [action, setAction] = useState<"on" | "off">("on");
  const [time, setTime] = useState("07:00");
  const [mode, setMode] = useState<Mode | "">("");
  const [temp, setTemp] = useState("");
  const [fan, setFan] = useState<Fan | "">("");
  const [when, setWhen] = useState<"weekly" | "once">("weekly");
  const [after, setAfter] = useState(120);
  const [days, setDays] = useState<number[]>(WEEKDAYS);
  const [error, setError] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      fetch("/api/timers")
        .then((r) =>
          signedOut(r, router) ? undefined : r.ok ? r.json() : Promise.reject(),
        )
        .then((t?: Timer[]) => {
          if (!t) return;
          setTimers(t);
          setLoadFailed(false); // cleared by the next good poll, kept apart from the form's own errors
        })
        .catch(() => setLoadFailed(true)),
    [router],
  );
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000); // one-shot timers disappear once they have fired
    return () => clearInterval(t);
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (when === "weekly" && days.length === 0)
      return setError("Pick at least one day.");
    setBusy(true);
    try {
      const res = await fetch("/api/timers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device,
          ...(when === "once" ? { after } : { time, days }),
          patch: {
            power: action === "on",
            // Settings only apply when turning on; blank = keep whatever the unit already has.
            ...(action === "on" && {
              ...(mode && { mode }),
              ...(temp !== "" && { temp: Number(temp) }),
              ...(fan && { fan }),
            }),
          },
        }),
      });
      if (signedOut(res, router)) return;
      if (res.ok) {
        setError("");
        load();
      } else {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? "Couldn't add the timer. Try again.");
      }
    } catch {
      setError("Couldn't add the timer. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const [removing, setRemoving] = useState<string | null>(null);
  async function remove(id: string) {
    if (removing) return;
    setRemoving(id);
    try {
      const res = await fetch(`/api/timers?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (signedOut(res, router)) return;
      if (!res.ok) throw new Error();
      setError("");
      await load();
      document.getElementById("timers-h")?.focus(); // the delete button is gone: keep keyboard users in this section
    } catch {
      setError("Couldn't delete the timer. Try again.");
    } finally {
      setRemoving(null);
    }
  }
  const nameOf = (id: string) => devices.find((d) => d.id === id)?.name ?? id;

  return (
    <section aria-labelledby="timers-h" className="mt-16">
      <h2
        id="timers-h"
        tabIndex={-1}
        className="text-section font-semibold tracking-tight outline-none"
      >
        Timers
      </h2>
      <p className="mt-2 max-w-prose text-ui text-muted">
        Switch a unit on or off on a weekly schedule, or once after a delay
        (like a sleep timer). When turning on, you can also set mode,
        temperature and fan.
      </p>

      <div className="mt-5 grid items-start gap-6 lg:grid-cols-2">
        <ul
          className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface empty:hidden"
          aria-label="Scheduled timers"
        >
          {loadFailed && (
            <li role="alert" className="px-5 py-3.5 text-ui text-danger">
              Couldn&apos;t load timers. Trying again.
            </li>
          )}
          {timers === null && (
            <li className="h-[4.5rem] bg-raised motion-safe:animate-pulse" />
          )}
          {timers?.length === 0 && (
            <li className="px-5 py-4 text-ui text-muted">
              No timers yet. Add one to turn a unit on before you get home, or
              off overnight.
            </li>
          )}
          {timers?.map((t) => (
            <li key={t.id} className="flex items-center gap-4 py-3 pr-3 pl-5">
              <span className="w-[4.25rem] text-section font-medium tabular-nums">
                {t.at ? clock(t.at) : t.time}
              </span>
              <span className="min-w-0 flex-1 text-ui">
                <span className="block truncate font-medium">
                  {actionLabel(t.patch)} · {nameOf(t.device)}
                </span>
                <span className="block text-muted">
                  {t.at ? "Once" : daysLabel(t.days)}
                </span>
              </span>
              <button
                type="button"
                onClick={() => remove(t.id)}
                aria-label={`Delete timer: ${actionLabel(t.patch)}, ${nameOf(t.device)}, ${t.at ? clock(t.at) : t.time}`}
                disabled={removing !== null}
                className="grid size-11 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-danger disabled:opacity-50"
              >
                <Trash className="size-5" />
              </button>
            </li>
          ))}
        </ul>

        <form
          onSubmit={add}
          className="grid gap-5 rounded-2xl border border-line bg-surface p-5 sm:p-6"
        >
          <label className="block text-label font-medium text-muted">
            Unit
            <select
              value={device}
              onChange={(e) => setDevice(e.target.value)}
              className={`${control} mt-1.5 h-11`}
            >
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>

          <Segmented
            legend="When"
            name="timer-when"
            options={WHEN}
            value={when}
            onChange={setWhen}
          />

          <div className="grid grid-cols-[1fr_auto] items-start gap-3">
            <Segmented
              legend="Action"
              name="timer-action"
              options={ACTIONS}
              value={action}
              onChange={setAction}
            />
            {when === "weekly" ? (
              <label className="block text-label font-medium text-muted">
                Time
                <input
                  type="time"
                  required
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className={`${control} mt-1.5 h-13 w-32 tabular-nums`}
                />
              </label>
            ) : (
              <label className="block text-label font-medium text-muted">
                In
                <select
                  value={after}
                  onChange={(e) => setAfter(Number(e.target.value))}
                  className={`${control} mt-1.5 h-13 w-32`}
                >
                  {AFTER.map((m) => (
                    <option key={m} value={m}>
                      {afterLabel(m)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {action === "on" && (
            <div className="grid grid-cols-3 gap-3">
              <label className="block text-label font-medium text-muted">
                Mode
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as Mode | "")}
                  className={`${control} mt-1.5 h-11`}
                >
                  <option value="">Keep</option>
                  {MODES.map((m) => (
                    <option key={m} value={m}>
                      {cap(m)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-label font-medium text-muted">
                Temp °C
                <input
                  type="number"
                  inputMode="decimal"
                  min={TEMP_MIN}
                  max={TEMP_MAX}
                  step={0.5}
                  placeholder="Keep"
                  value={temp}
                  onChange={(e) => setTemp(e.target.value)}
                  className={`${control} mt-1.5 h-11 tabular-nums`}
                />
              </label>
              <label className="block text-label font-medium text-muted">
                Fan
                <select
                  value={fan}
                  onChange={(e) => setFan(e.target.value as Fan | "")}
                  className={`${control} mt-1.5 h-11`}
                >
                  <option value="">Keep</option>
                  {FANS.map((f) => (
                    <option key={f} value={f}>
                      {cap(f)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {when === "weekly" && (
            <fieldset className="min-w-0 border-0 p-0">
              <legend className="sr-only">Repeat</legend>
              <div className="mb-1.5 flex items-baseline justify-between text-meta text-muted">
                <span aria-hidden="true">Repeat</span>
                <span className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setDays(WEEKDAYS)}
                    className="-my-3 py-3 text-accent hover:underline"
                  >
                    Weekdays
                  </button>
                  <button
                    type="button"
                    onClick={() => setDays(ALL_DAYS)}
                    className="-my-3 py-3 text-accent hover:underline"
                  >
                    Every day
                  </button>
                </span>
              </div>
              <div className="grid grid-cols-7 gap-0.5">
                {DAY_ORDER.map((d) => {
                  const on = days.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setDays(on ? days.filter((x) => x !== d) : [...days, d])
                      }
                      className={`h-11 rounded-lg text-label font-medium transition-colors duration-150 ${
                        on
                          ? "bg-accent text-accent-ink"
                          : "bg-raised text-muted hover:text-ink"
                      }`}
                    >
                      {DAY_NAMES[d]}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}

          {error && (
            <p role="alert" className="text-ui text-danger">
              {error}
            </p>
          )}
          <button
            disabled={busy}
            className="h-11 rounded-lg bg-accent font-medium text-accent-ink transition-opacity hover:opacity-90 active:opacity-80 disabled:opacity-60"
          >
            {busy ? "Adding…" : "Add timer"}
          </button>
        </form>
      </div>
    </section>
  );
}
