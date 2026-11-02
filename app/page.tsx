"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AcControl, DeviceState } from "@/lib/ac";
import { AcCard } from "./ac-card";
import { AddUnit } from "./add-unit";
import { ROOM_NAMES, type Unit } from "./control";
import { Energy } from "./energy";
import { Timers } from "./timers";

type Row = DeviceState & { id: string };
type Pending = { patch: Partial<AcControl>; since: number };

const SEND_DELAY_MS = 250; // coalesce rapid taps (24 -> 26) into one request
// The adapter refuses writes for 60 s after one, and the bridge holds the change until then.
const APPLY_TIMEOUT_MS = 90_000;

const omit = <T,>(o: Record<string, T>, key: string) =>
  Object.fromEntries(Object.entries(o).filter(([k]) => k !== key)) as Record<
    string,
    T
  >;

export default function Home() {
  const router = useRouter();
  const [devices, setDevices] = useState<Unit[] | null>(null);
  const [setups, setSetups] = useState<Record<string, string>>({});
  const [acs, setAcs] = useState<Record<string, DeviceState>>({});
  const [pending, setPending] = useState<Record<string, Pending>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [live, setLive] = useState(false);
  const [wasLive, setWasLive] = useState(false);
  const [backendDown, setBackendDown] = useState(false);
  const [devicesError, setDevicesError] = useState(false);
  const pendingRef = useRef(pending);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);
  const queued = useRef<
    Record<
      string,
      { patch: Partial<AcControl>; timer: ReturnType<typeof setTimeout> }
    >
  >({});

  const settle = useCallback((id: string, error?: string) => {
    setPending((p) => omit(p, id));
    setErrors((e) => ({ ...e, [id]: error ?? "" }));
  }, []);

  const loadDevices = useCallback(
    () =>
      fetch("/api/devices", { cache: "no-store" })
        .then((r) =>
          r.status === 401
            ? router.replace("/login")
            : r.ok
              ? r.json()
              : Promise.reject(),
        )
        .then((list?: Unit[]) => {
          if (!list) return;
          setDevices(list);
          setDevicesError(false);
        })
        .catch(() => setDevicesError(true)),
    [router],
  );
  useEffect(() => {
    void loadDevices();
  }, [loadDevices]);

  useEffect(() => {
    let es: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let delay = 1000;
    let stopped = false;
    const connect = () => {
      es = new EventSource("/api/events");
      es.onopen = () => {
        delay = 1000;
        setLive(true);
        setWasLive(true);
        setBackendDown(false);
      };
      es.onerror = () => {
        setLive(false); // EventSource reconnects by itself, but it cannot see a 401: probe, so an expired session goes to /login
        fetch("/api/timers", { cache: "no-store" }).then(
          (r) => r.status === 401 && router.replace("/login"),
          () => {},
        );
        // The browser retries a dropped connection by itself, but an error answer (backend restarting, 5xx) closes the stream for
        // good: reconnect ourselves, backing off, so the page recovers without a reload.
        if (es?.readyState === EventSource.CLOSED && !stopped) {
          es.close();
          retry = setTimeout(connect, delay);
          delay = Math.min(delay * 2, 30_000);
        }
      };
      es.onmessage = (e) => {
        let msg:
          Row | { id: string; setup: string } | { id: string; gone: true };
        try {
          msg = JSON.parse(e.data);
        } catch {
          return; // one malformed event must not take the handler down
        }
        if ("gone" in msg) {
          setAcs((prev) => omit(prev, msg.id));
          setSetups((prev) => omit(prev, msg.id));
          void loadDevices();
          return;
        }
        if ("setup" in msg) {
          setSetups((prev) =>
            msg.setup ? { ...prev, [msg.id]: msg.setup } : omit(prev, msg.id),
          );
          return;
        }
        const { id, ...s } = msg;
        setAcs((prev) => ({ ...prev, [id]: s }));
        // Drop the optimistic values the unit has now confirmed.
        setPending((prev) => {
          const p = prev[id];
          if (!p) return prev;
          const left = Object.entries(p.patch).filter(
            ([k, v]) => s[k as keyof AcControl] !== v,
          );
          if (left.length === 0) return omit(prev, id);
          return { ...prev, [id]: { ...p, patch: Object.fromEntries(left) } };
        });
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      es?.close();
    };
  }, [router, loadDevices]);

  // The page can be up while the broker behind it is not (stack still starting, or stopped): say so instead of "Connecting…" forever.
  useEffect(() => {
    if (live) return;
    const check = () =>
      fetch("/api/health", { cache: "no-store" }).then(
        (r) => setBackendDown(r.status === 503),
        () => {},
      );
    const first = setTimeout(check, 4000);
    const every = setInterval(check, 10_000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [live]);

  // A change the unit never confirms must not sit on screen as if it worked.
  useEffect(() => {
    const t = setInterval(() => {
      for (const [id, p] of Object.entries(pendingRef.current)) {
        if (Date.now() - p.since > APPLY_TIMEOUT_MS)
          settle(id, "The unit didn't take the change, even after a retry. If you just used the remote or the Smart M-Air app, wait a minute and try again.");
      }
    }, 2000);
    return () => clearInterval(t);
  }, [settle]);

  const change = useCallback(
    (id: string, patch: Partial<AcControl>) => {
      setErrors((e) => ({ ...e, [id]: "" }));
      setPending((p) => ({
        ...p,
        [id]: { patch: { ...p[id]?.patch, ...patch }, since: Date.now() },
      }));
      const prev = queued.current[id];
      clearTimeout(prev?.timer);
      const merged = { ...prev?.patch, ...patch };
      queued.current[id] = {
        patch: merged,
        timer: setTimeout(async () => {
          delete queued.current[id];
          try {
            const res = await fetch("/api/set", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id, patch: merged }),
            });
            if (res.status === 401) {
              settle(id);
              return router.replace("/login");
            }
            if (res.status === 409) // unit offline: the server says why
              return settle(id, ((await res.json().catch(() => null))?.error as string) ?? "That unit is offline.");
            if (!res.ok) throw new Error(String(res.status));
          } catch {
            settle(
              id,
              "Couldn't send the change. Check the connection and try again.",
            );
          }
        }, SEND_DELAY_MS),
      };
    },
    [settle, router],
  );

  const rename = useCallback(
    async (id: string, name: string) => {
      const res = await fetch(`/api/devices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      }).catch(() => null);
      if (res?.status === 401) return router.replace("/login");
      if (!res?.ok)
        return (
          ((await res?.json().catch(() => null))?.error as string) ??
          "Couldn't save. Try again."
        );
      await loadDevices();
    },
    [router, loadDevices],
  );
  const removeUnit = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/devices/${id}`, { method: "DELETE" }).catch(
        () => null,
      );
      if (res?.status === 401) return router.replace("/login");
      if (!res?.ok)
        return (
          ((await res?.json().catch(() => null))?.error as string) ??
          "Couldn't remove it. Try again."
        );
      setAcs((prev) => omit(prev, id));
      await loadDevices();
    },
    [router, loadDevices],
  );

  const unusedRooms = ROOM_NAMES.filter(
    (r) => !devices?.some((d) => d.name.toLowerCase() === r.toLowerCase()),
  );

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-8 flex items-center justify-between gap-4">
        <h1 className="text-section font-semibold tracking-tight sm:text-page">
          Air conditioners
        </h1>
        <div className="flex items-center gap-1">
          <p
            role="status"
            className="flex items-center gap-2 text-ui whitespace-nowrap text-muted"
          >
            <span
              aria-hidden
              className={`size-2 rounded-full ${live ? "bg-accent" : "bg-muted motion-safe:animate-pulse"}`}
            />
            {live ? "Live" : wasLive ? "Reconnecting…" : "Connecting…"}
          </p>
          <form method="post" action="/api/logout">
            <button className="min-h-11 rounded-lg px-3 text-ui whitespace-nowrap text-muted transition-colors hover:text-ink">
              Sign out
            </button>
          </form>
        </div>
      </header>

      {backendDown && (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-line bg-surface p-4 text-ui"
        >
          <p className="font-medium text-danger">
            Can&apos;t reach the backend
          </p>
          <p className="mt-1 text-ui text-muted">
            This page is running, but the broker that carries the units&apos;
            messages is not. If you just started the stack, give it a minute.
            Otherwise run <code className="font-mono">npm run setup</code> or
            check <code className="font-mono">docker compose ps</code>.
          </p>
        </div>
      )}

      {devices !== null && devices.length === 0 && (
        <section
          aria-labelledby="welcome-h"
          className="rounded-2xl border border-dashed border-line px-5 py-6"
        >
          <h2
            id="welcome-h"
            className="text-section font-semibold tracking-tight"
          >
            No air conditioners yet
          </h2>
          <p className="mt-1.5 max-w-prose text-ui text-muted">
            Add your first unit below: let the app find it on your network, or
            enter its MAC address. If the unit isn&apos;t on your Wi-Fi yet, the
            steps to connect it are in the same place.
          </p>
        </section>
      )}

      {devices === null && devicesError ? (
        <div
          role="alert"
          className="rounded-2xl border border-line bg-surface p-5"
        >
          <p className="font-medium text-danger">
            Couldn&apos;t load your units
          </p>
          <p className="mt-1 text-ui text-muted">
            The page reached the server but the list didn&apos;t load.
          </p>
          <button
            onClick={() => void loadDevices()}
            className="mt-3 h-11 rounded-lg bg-raised px-4 text-ui font-medium transition-colors hover:bg-line"
          >
            Try again
          </button>
        </div>
      ) : devices === null ? (
        <div className="h-40 rounded-2xl bg-raised motion-safe:animate-pulse" />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,19rem),1fr))] items-start gap-5">
          {devices.map(({ id, name, mac }) => (
            <AcCard
              key={id}
              name={name}
              mac={mac}
              suggestions={unusedRooms}
              state={acs[id]}
              patch={pending[id]?.patch}
              setup={setups[id]}
              error={errors[id]}
              onChange={(patch) => change(id, patch)}
              onRename={(n) => rename(id, n)}
              onRemove={() => removeUnit(id)}
            />
          ))}
        </div>
      )}
      {devices && (
        <AddUnit
          suggestions={unusedRooms}
          defaultOpen={devices.length === 0}
          onAdded={loadDevices}
        />
      )}

      {devices && devices.length > 0 && <Timers devices={devices} />}
      {devices && devices.length > 0 && <Energy devices={devices} />}
    </main>
  );
}
