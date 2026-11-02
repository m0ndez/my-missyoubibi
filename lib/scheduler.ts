import { recordEnergy } from "./energy";
import { hub, isOffline } from "./hub";
import { dueOnce, dueTimers, loadTimers, removeTimer } from "./timers";

const g = globalThis as unknown as { __sched?: boolean };

// Started once per server process from instrumentation.ts.
export function startScheduler() {
  if (g.__sched) return;
  g.__sched = true;
  const fired = new Set<string>();
  // Always listening: energy accounting must not depend on a browser being open.
  hub().bus.on("state", (id: string, s: { energy?: number | null }) => {
    try {
      recordEnergy(id, s.energy);
    } catch (e) {
      console.error("energy:", e);
    }
  });
  setInterval(() => {
    try {
      const { client } = hub();
      const timers = loadTimers();
      const once = dueOnce(timers, Date.now());
      // Drop instead of queueing: a 07:30 "on" must not run at 08:10 after a broker outage.
      for (const t of dueTimers(timers, new Date(), fired)) {
        if (isOffline(t.device)) console.error(`timer ${t.id} skipped: unit ${t.device} offline`);
        else if (client.connected) client.publish(`mhi/${t.device}/set`, JSON.stringify(t.patch));
        else console.error(`timer ${t.id} skipped: broker offline`);
      }
      // One-shot: removed once sent. With the broker down it waits (retried every tick) until it counts as missed.
      // An offline unit counts as missed at once: waiting would send it late when the unit returns.
      for (const t of once) {
        if (t.missed) removeTimer(t.id);
        else if (isOffline(t.device)) {
          console.error(`timer ${t.id} missed: unit ${t.device} offline`);
          removeTimer(t.id);
        }
        else if (client.connected) {
          client.publish(`mhi/${t.device}/set`, JSON.stringify(t.patch));
          removeTimer(t.id);
        } else console.error(`timer ${t.id} waiting: broker offline`);
      }
    } catch (e) {
      console.error("scheduler:", e);
    }
  }, 15_000);
}
