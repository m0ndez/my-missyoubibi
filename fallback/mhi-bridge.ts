// FALLBACK (docs/firmware.md Path A), not used by the deployed WF-RAC path. Known limit: it does not carry vane, threeD or silent.
import { check } from "../lib/check";
import { FANS, MODES, TEMP_MAX, TEMP_MIN, type AcControl, type AcState, type Fan, type Mode } from "../lib/ac";

// Translates MHI-AC-Ctrl firmware topics <-> our mhi/<id>/* contract.
// Topic names confirmed from the project's SW-Configuration.md / source (absalom-muc/MHI-AC-Ctrl):
//   status  <host>/Power|Mode|Tsetpoint|Fan|Troom   (retained)    <host>/connected "1"|"0" (last-will)
//   command <host>/set/Power|Mode|Tsetpoint|Fan                    (publish retain=false)
// Set the firmware HOSTNAME (its MQTT prefix) to `mhi-<id>`.

export type Partial4 = { power?: boolean; mode?: Mode; temp?: number; fan?: Fan; roomTemp?: number | null };

// Number("") is 0, so validate the text first.
const num = (s: string) => (/^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null);

// One device status message -> field to merge into the known state, or null to ignore.
export function fromDevice(topic: string, payload: string): Partial4 | null {
  switch (topic) {
    case "Power":
      return payload === "On" ? { power: true } : payload === "Off" ? { power: false } : null;
    case "Mode": {
      const mode = payload.toLowerCase() as Mode;
      return MODES.includes(mode) ? { mode } : null; // "Heat" is not in MODES: ignored on purpose
    }
    case "Tsetpoint": {
      const temp = num(payload);
      return temp === null ? null : { temp };
    }
    case "Fan": {
      const fan = payload.toLowerCase() as Fan;
      return FANS.includes(fan) ? { fan } : null;
    }
    case "Troom": {
      const roomTemp = num(payload);
      return roomTemp === null ? null : { roomTemp };
    }
    default:
      return null;
  }
}

// A state is publishable once every control field is known (roomTemp may be absent).
export function complete(s: Partial4): AcState | null {
  const { power, mode, temp, fan } = s;
  if (power === undefined || !mode || temp === undefined || !fan) return null;
  return { power, mode, temp, fan, roomTemp: s.roomTemp ?? null };
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

// Our patch -> [topic suffix, payload] pairs for the device.
export function toDevice(patch: Partial<AcControl>): [string, string][] {
  const out: [string, string][] = [];
  if (patch.power !== undefined) out.push(["set/Power", patch.power ? "On" : "Off"]);
  if (patch.mode) out.push(["set/Mode", cap(patch.mode)]);
  if (patch.temp !== undefined && patch.temp >= TEMP_MIN && patch.temp <= TEMP_MAX)
    out.push(["set/Tsetpoint", String(patch.temp)]);
  if (patch.fan) out.push(["set/Fan", patch.fan === "auto" ? "Auto" : patch.fan]);
  return out;
}

// Self-check: `npx tsx lib/mhi-bridge.ts`
if (process.argv[1]?.endsWith("fallback/mhi-bridge.ts")) {
  const eq = (a: unknown, b: unknown, m: string) => check(JSON.stringify(a) === JSON.stringify(b), m, a);
  eq(fromDevice("Power", "On"), { power: true }, "power on");
  eq(fromDevice("Mode", "Cool"), { mode: "cool" }, "mode lowercased");
  eq(fromDevice("Mode", "Heat"), null, "heat ignored");
  eq(fromDevice("Fan", "Auto"), { fan: "auto" }, "fan auto");
  eq(fromDevice("Fan", "3"), { fan: "3" }, "fan level");
  eq(fromDevice("Tsetpoint", "24.5"), { temp: 24.5 }, "setpoint");
  eq(fromDevice("Tsetpoint", "abc"), null, "garbage setpoint");
  eq(fromDevice("Troom", ""), null, "empty room temp");
  eq(fromDevice("Troom", " "), null, "blank room temp");
  eq(fromDevice("Vanes", "1"), null, "unknown topic");
  eq(complete({ power: true, mode: "cool", temp: 24 }), null, "incomplete state");
  eq(complete({ power: true, mode: "cool", temp: 24, fan: "auto" }), { power: true, mode: "cool", temp: 24, fan: "auto", roomTemp: null }, "complete state");
  eq(toDevice({ power: true, mode: "dry", fan: "auto", temp: 22 }),
    [["set/Power", "On"], ["set/Mode", "Dry"], ["set/Tsetpoint", "22"], ["set/Fan", "Auto"]], "commands");
  console.log("mhi-bridge.ts checks done");
}
