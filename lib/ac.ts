// MQTT contract (device firmware, simulator and future Home Assistant discovery all use this):
//   mhi/<id>/state   retained JSON AcState, published by the device
//   mhi/<id>/online  retained "1" | "0"; device sets "1" on connect and registers "0" as MQTT last-will
//   mhi/<id>/set     JSON Partial<AcControl>, published by the web app
//   mhi/_bridge/online  retained "1" | "0"; the bridge sets "1" on connect and registers "0" as MQTT last-will (all units go offline)
import { check } from "./check";
export const MODES = ["auto", "cool", "dry", "fan"] as const;
export const FANS = ["auto", "1", "2", "3", "4"] as const;
export const VANES = ["swing", "1", "2", "3", "4"] as const; // up/down louver: auto-swing or a fixed position
export const VANES_LR = ["swing", "1", "2", "3", "4", "5", "6", "7"] as const; // left/right louver
export const TEMP_MIN = 18;
export const TEMP_MAX = 30;

export type Mode = (typeof MODES)[number];
export type Fan = (typeof FANS)[number];
export type Vane = (typeof VANES)[number];
export type VaneLR = (typeof VANES_LR)[number];

// Everything after `fan` is optional: only some sources (the WF-RAC bridge) report it.
export type AcControl = {
  power: boolean;
  mode: Mode;
  temp: number;
  fan: Fan;
  vane?: Vane;
  vaneLR?: VaneLR;
  threeD?: boolean; // "3D auto": the unit sweeps both louvers by itself
  silent?: boolean; // quiet outdoor-unit operation
};
// mode/fan are null when the unit reports a value this app has no name for (heat mode, an unlisted fan step):
// better to show "no selection" than to drop the whole state and look offline.
export type AcState = Omit<AcControl, "mode" | "fan"> & {
  mode: Mode | null;
  fan: Fan | null;
  roomTemp: number | null;
  compressor?: boolean; // the unit is calling for the compressor (actively cooling), not just powered on
  outdoorTemp?: number | null;
  energy?: number | null; // kWh used in the current run; the unit resets it at every power-on
  fault?: string | null; // unit error code such as "E5"; null/absent = none
  humidity?: number | null; // relative humidity %, from the indoor unit's return-air sensor; absent on units without one
};
export type DeviceState = AcState & { online: boolean };

// A unit in the list. The live list is data/devices.json (lib/devices.ts): a fresh install starts empty and units are added from
// the page. `mac` is the adapter's MAC without separators, lower case: it is also the airconId and the mDNS name.
export type DeviceInfo = { id: string; name: string; mac: string };
// Three made-up units (made-up MACs) for the dev tools and the self-checks: scripts/sim.mts fakes them. Never part of a real install.
export const DEMO_DEVICES: readonly DeviceInfo[] = [
  { id: "living-room", name: "Living room", mac: "348e89a1b2c3" },
  { id: "bedroom", name: "Bedroom", mac: "348e89a1b2c4" },
  { id: "office", name: "Office", mac: "348e89a1b2c5" },
];

// A unit is online only while the bridge is. `bridge` is undefined until mhi/_bridge/online has been seen: a bridge older than that
// topic never publishes it, so an unknown bridge counts as online and the unit's own flag decides.
export const unitOnline = (bridge: boolean | undefined, unit: boolean) => bridge !== false && unit;

// Known offline. A unit with no state yet is not "offline": a command may still reach it.
export const isOfflineState = (s: { online: boolean } | undefined) => s?.online === false;

// Trust boundary: retained MQTT payload -> state. A malformed one must not reach the UI (it reads temp.toFixed()).
export function isAcState(x: unknown): x is AcState {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.power === "boolean" &&
    typeof o.temp === "number" &&
    Number.isFinite(o.temp) &&
    (o.mode === null || MODES.includes(o.mode as Mode)) &&
    (o.fan === null || FANS.includes(o.fan as Fan)) &&
    (o.roomTemp === null || typeof o.roomTemp === "number") &&
    (o.humidity === undefined || o.humidity === null || (typeof o.humidity === "number" && o.humidity >= 0 && o.humidity <= 100))
  );
}

// Trust boundary: request body -> validated patch. Returns null when invalid or empty.
export function parsePatch(x: unknown): Partial<AcControl> | null {
  if (typeof x !== "object" || x === null) return null;
  const o = x as Record<string, unknown>;
  const p: Partial<AcControl> = {};
  if ("power" in o) {
    if (typeof o.power !== "boolean") return null;
    p.power = o.power;
  }
  if ("mode" in o) {
    if (!MODES.includes(o.mode as Mode)) return null;
    p.mode = o.mode as Mode;
  }
  if ("fan" in o) {
    if (!FANS.includes(o.fan as Fan)) return null;
    p.fan = o.fan as Fan;
  }
  if ("vane" in o) {
    if (!VANES.includes(o.vane as Vane)) return null;
    p.vane = o.vane as Vane;
  }
  if ("vaneLR" in o) {
    if (!VANES_LR.includes(o.vaneLR as VaneLR)) return null;
    p.vaneLR = o.vaneLR as VaneLR;
  }
  for (const k of ["threeD", "silent"] as const) {
    if (k in o) {
      if (typeof o[k] !== "boolean") return null;
      p[k] = o[k];
    }
  }
  if ("temp" in o) {
    const t = o.temp;
    if (typeof t !== "number" || t < TEMP_MIN || t > TEMP_MAX || (t * 2) % 1 !== 0) return null;
    p.temp = t;
  }
  return Object.keys(p).length ? p : null;
}

// Self-check: `npx tsx lib/ac.ts`
if (process.argv[1]?.endsWith("lib/ac.ts")) {
  const ok = (x: unknown) => parsePatch(x) !== null;
  check(ok({ power: true }), "power ok");
  check(ok({ temp: 24.5 }), "half step ok");
  check(!ok({ temp: 24.3 }), "bad step rejected");
  check(!ok({ temp: 40 }), "range rejected");
  check(!ok({ mode: "heat" }), "unknown mode rejected");
  check(ok({ vane: "swing" }) && ok({ vane: "3" }), "vane ok");
  check(!ok({ vane: "5" }), "bad vane rejected");
  check(ok({ vaneLR: "7", threeD: true, silent: false }), "lr/3d/silent ok");
  check(!ok({ vaneLR: "8" }) && !ok({ silent: "yes" }) && !ok({ threeD: 1 }), "bad lr/3d/silent rejected");
  check(!ok({}), "empty rejected");
  check(!ok(null), "null rejected");
  const st = { power: true, mode: "cool", fan: "auto", temp: 24, roomTemp: 25 };
  check(isAcState(st) && isAcState({ ...st, fan: null, mode: null, roomTemp: null }), "state ok, unknown mode/fan ok");
  check(!isAcState({ ...st, temp: undefined }) && !isAcState({ ...st, power: "on" }) && !isAcState(null), "bad state rejected");
  check(unitOnline(true, true) === true && unitOnline(true, false) === false, "bridge online: the unit's own flag decides");
  check(unitOnline(false, true) === false && unitOnline(false, false) === false, "bridge offline: every unit is offline");
  check(unitOnline(undefined, true) === true && unitOnline(undefined, false) === false, "bridge never seen: the unit's flag decides");
  check(isOfflineState({ online: false }) && !isOfflineState({ online: true }) && !isOfflineState(undefined), "offline only when known offline");
  console.log("ac.ts checks done");
}
