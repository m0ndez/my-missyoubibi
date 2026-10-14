"use client";

import { useRouter } from "next/navigation";
import { Chevron } from "./icons";
import { useCallback, useEffect, useState } from "react";
import { control, signedOut, type Unit } from "./control";

// `today` is the server's day key: the report must not read the browser clock (a phone in another timezone would show the wrong day).
type Report = {
  days: Record<string, Record<string, number>>;
  today: string;
  rate: number | null;
  currency: string;
};

const key = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysBack = (today: string | undefined, n: number) => {
  if (!today) return [];
  const [y, m, d] = today.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => key(new Date(y, m - 1, d - i)));
};

export function Energy({ devices }: { devices: Unit[] }) {
  const [r, setR] = useState<Report | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(
    () =>
      fetch("/api/energy")
        .then((res) => (res.ok ? res.json() : Promise.reject()))
        .then((x: Report) => {
          setR(x);
          setFailed(false);
        })
        .catch(() => setFailed(true)),
    [],
  );
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const sum = (id: string | null, keys: string[]) =>
    keys.reduce(
      (n, k) =>
        n +
        (id
          ? (r?.days[k]?.[id] ?? 0)
          : Object.values(r?.days[k] ?? {}).reduce((a, b) => a + b, 0)),
      0,
    );
  const today = daysBack(r?.today, 1);
  const week = daysBack(r?.today, 7);
  const month = Object.keys(r?.days ?? {}).filter(
    (k) => r && k.startsWith(r.today.slice(0, 7)),
  );
  const chart = daysBack(r?.today, 14).reverse();
  const peak = Math.max(0.25, ...chart.map((k) => sum(null, [k])));
  const kwh = (n: number) => n.toFixed(n < 10 ? 2 : 1);
  const money = (n: number) =>
    r?.rate ? `${r.currency}${(n * r.rate).toFixed(2)}` : null;
  const empty = r && Object.keys(r.days).length === 0;

  const tiles = [
    { label: "Today", keys: today },
    { label: "Last 7 days", keys: week },
    { label: "This month", keys: month },
  ];

  return (
    <section aria-labelledby="energy-h" className="mt-16">
      <h2 id="energy-h" className="text-section font-semibold tracking-tight">
        Energy
      </h2>
      <p className="mt-2 max-w-prose text-ui text-muted">
        Power used by the units, counted from their own meters. The units keep
        no history, so it starts when this app first runs (earlier days can be
        added below), and it reads slightly low (the meter has 0.25 kWh steps).
      </p>

      {failed && !r && (
        <p role="alert" className="mt-4 text-ui text-danger">
          Couldn&apos;t load the energy report.
        </p>
      )}
      {!r && !failed && (
        <div className="mt-5 h-24 rounded-xl bg-raised motion-safe:animate-pulse" />
      )}
      {empty && (
        <p className="mt-5 rounded-xl border border-dashed border-line p-4 text-ui text-muted">
          No readings yet. Turn a unit on: usage shows up after its first 0.25
          kWh.
        </p>
      )}

      {r && !empty && (
        <div className="mt-5 grid items-start gap-6 lg:grid-cols-2">
          <div className="grid gap-6">
            <dl className="grid grid-cols-3 divide-x divide-line rounded-2xl border border-line bg-surface">
              {tiles.map((t) => {
                const n = sum(null, t.keys);
                return (
                  <div key={t.label} className="px-4 py-4">
                    <dt className="text-meta text-muted">{t.label}</dt>
                    <dd className="mt-1.5 text-section font-medium tabular-nums">
                      {kwh(n)}
                      <span className="ml-1 text-ui text-muted">kWh</span>
                    </dd>
                    {money(n) && (
                      <dd className="text-meta text-muted tabular-nums">
                        ≈ {money(n)}
                      </dd>
                    )}
                  </div>
                );
              })}
            </dl>

            <table className="w-full text-ui">
              <caption className="sr-only">Energy per unit in kWh</caption>
              <thead>
                <tr className="text-left text-meta font-normal text-muted">
                  <th scope="col" className="py-2 font-normal">
                    Unit
                  </th>
                  {tiles.map((t) => (
                    <th
                      key={t.label}
                      scope="col"
                      className="py-2 text-right font-normal"
                    >
                      {t.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => (
                  <tr key={d.id} className="border-t border-line">
                    <th
                      scope="row"
                      className="py-2.5 pr-2 text-left font-medium"
                    >
                      {d.name}
                    </th>
                    {tiles.map((t) => (
                      <td
                        key={t.label}
                        className="py-2.5 text-right tabular-nums"
                      >
                        {kwh(sum(d.id, t.keys))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <figure className="rounded-2xl border border-line bg-surface p-4">
            <figcaption className="text-meta text-muted">
              All units, last 14 days (kWh per day)
            </figcaption>
            <ul className="sr-only" aria-label="Daily energy, last 14 days">
              {chart.map((k) => (
                <li key={k}>
                  {k}: {kwh(sum(null, [k]))} kWh
                </li>
              ))}
            </ul>
            <div className="mt-3 flex h-32 items-end gap-1" aria-hidden="true">
              {chart.map((k) => {
                const n = sum(null, [k]);
                return (
                  <div
                    key={k}
                    className="flex h-full flex-1 flex-col justify-end"
                    title={`${k}: ${kwh(n)} kWh`}
                  >
                    <div
                      className={`rounded-t-sm ${k === today[0] ? "bg-accent" : "bg-accent/45"}`}
                      style={{
                        height: `${Math.max(n > 0 ? 3 : 0, (n / peak) * 100)}%`,
                      }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="mt-1.5 flex justify-between text-meta text-muted tabular-nums">
              <span>{chart[0].slice(5)}</span>
              <span>Peak {kwh(peak)}</span>
              <span>Today</span>
            </div>
          </figure>
        </div>
      )}

      <Backfill devices={devices} onSaved={load} />
    </section>
  );
}

// Past days the units can't report: typed or pasted from a bill, a smart plug, or the Smart M-Air app.
function Backfill({
  devices,
  onSaved,
}: {
  devices: Unit[];
  onSaved: () => void;
}) {
  const router = useRouter();
  const [chosen, setId] = useState<string>(devices[0]?.id ?? "");
  const id = devices.some((d) => d.id === chosen)
    ? chosen
    : (devices[0]?.id ?? "");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [replaces, setReplaces] = useState<
    { day: string; old: number; kwh: number }[]
  >([]); // days that already hold data

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/energy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, text, confirm: replaces.length > 0 }),
      });
      if (signedOut(res, router)) return;
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && body.replaces) {
        setReplaces(body.replaces);
        return;
      }
      if (!res.ok) throw new Error(body.error ?? "Couldn't save. Try again.");
      setMsg({
        ok: true,
        text: `Saved ${body.saved} ${body.saved === 1 ? "day" : "days"}.`,
      });
      setText("");
      setReplaces([]);
      onSaved();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="group mt-6 rounded-2xl border border-line bg-surface">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-5 py-2 text-ui font-medium [&::-webkit-details-marker]:hidden">
        Add earlier days
        <Chevron className="size-5 shrink-0 text-muted transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-open:rotate-180" />
      </summary>
      <form
        onSubmit={save}
        className="grid gap-5 border-t border-line p-5 sm:p-6"
      >
        <label className="block text-label font-medium text-muted">
          Unit
          <select
            value={id}
            onChange={(e) => {
              setId(e.target.value);
              setReplaces([]);
            }}
            className={`${control} mt-1.5 h-11`}
          >
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-label font-medium text-muted">
          One day per line: date, then kWh
          <textarea
            required
            rows={5}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setReplaces([]);
            }}
            placeholder={"2026-10-01 4.5\n2026-10-02 6.25"}
            spellCheck={false}
            className={`${control} mt-1.5 py-2 font-mono tabular-nums`}
          />
        </label>
        <p className="text-label text-muted">
          Past days only. A day you add replaces what is stored for that unit
          and day.
        </p>
        {replaces.length > 0 && (
          <p role="alert" className="text-ui text-danger">
            This replaces{" "}
            {replaces.length === 1 ? "a day" : `${replaces.length} days`} that
            already {replaces.length === 1 ? "holds" : "hold"} data:{" "}
            {replaces
              .slice(0, 3)
              .map(
                (r) => `${r.day} ${r.old.toFixed(2)} → ${r.kwh.toFixed(2)} kWh`,
              )
              .join(", ")}
            {replaces.length > 3 ? ", …" : ""}. Press the button again to
            replace.
          </p>
        )}
        {msg && (
          <p
            role={msg.ok ? "status" : "alert"}
            className={`text-ui ${msg.ok ? "text-muted" : "text-danger"}`}
          >
            {msg.text}
          </p>
        )}
        <button
          disabled={busy}
          className="h-11 rounded-lg bg-accent font-medium text-accent-ink transition-opacity hover:opacity-90 active:opacity-80 disabled:opacity-60"
        >
          {busy
            ? "Saving…"
            : replaces.length > 0
              ? "Replace and save"
              : "Save days"}
        </button>
      </form>
    </details>
  );
}
