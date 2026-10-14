import fs from "node:fs";
import path from "node:path";
import type { DeviceInfo } from "./ac";
import { check } from "./check";

// The list of units: data/devices.json. Empty on a fresh install (the page then shows its first-run screen). Server side only.
// ponytail: JSON file read per call (mtime-cached); fine for a handful of units.
export type Device = DeviceInfo;
export const MAX_DEVICES = 12;
const file = () => path.join(process.env.DATA_DIR ?? "data", "devices.json");

const shape = (x: unknown): x is Device => {
  const d = x as Device;
  return (
    typeof d === "object" &&
    d !== null &&
    /^[a-z][a-z0-9-]{0,23}$/.test(d.id) &&
    typeof d.name === "string" &&
    d.name.length > 0 &&
    /^[0-9a-f]{12}$/.test(d.mac)
  );
};

let cache: { key: string; list: Device[] } | undefined;
export function listDevices(): Device[] {
  let st: fs.Stats;
  try {
    st = fs.statSync(file());
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const key = `${file()}@${st.mtimeMs}:${st.size}`;
  if (cache?.key === key) return cache.list;
  const data: unknown = JSON.parse(fs.readFileSync(file(), "utf8")); // corrupt file: throw, never replace the list with the seed
  if (!Array.isArray(data) || !data.every(shape)) throw new Error(`${file()}: not a list of units`);
  cache = { key, list: data };
  return data;
}

function save(list: Device[]) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  const tmp = `${file()}.tmp`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeFileSync(fd, JSON.stringify(list, null, 1));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file());
}

export const isDevice = (id: unknown) => listDevices().some((d) => d.id === id);

// The adapter's MAC from what the Smart M-Air QR code holds ("MAC 348E89A1B2C3,SSID:...,KEY:..."), "34:8E:89:A1:B2:C3" or
// a bare 12-digit MAC. The QR's Wi-Fi key is for the adapter's setup network and is never read or stored here.
export function parseMac(text: string): string | null {
  const hex = "(?:[0-9a-f]{2}[:-]?){5}[0-9a-f]{2}";
  const m = new RegExp(`MAC\\s*[:=]?\\s*(${hex})(?![0-9a-f])`, "i").exec(text) ?? new RegExp(`^\\s*(${hex})\\s*$`, "i").exec(text);
  return m ? m[1].replace(/[:-]/g, "").toLowerCase() : null;
}

const cleanName = (n: unknown) => (typeof n === "string" ? n.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 40) : "");

function idFor(name: string, taken: Set<string>): string {
  let base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20);
  if (!/^[a-z]/.test(base)) base = `unit${base ? "-" + base : ""}`.slice(0, 20);
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  return id;
}

type Result = { ok: true; device: Device } | { ok: false; error: string };

// Two units with the same name can't be told apart on the page or in a timer.
const nameTaken = (list: Device[], name: string, except?: string) =>
  list.find((d) => d.id !== except && d.name.toLowerCase() === name.toLowerCase());

export function addDevice(input: { name: unknown; qr: unknown }): Result {
  const name = cleanName(input.name);
  const mac = typeof input.qr === "string" ? parseMac(input.qr) : null;
  if (!mac) return { ok: false, error: "Couldn't find a MAC address in that. Paste the QR text or the 12-character MAC." };
  if (!name) return { ok: false, error: "Give the unit a name." };
  const list = listDevices();
  if (list.length >= MAX_DEVICES) return { ok: false, error: `At most ${MAX_DEVICES} units.` };
  const dup = nameTaken(list, name);
  if (dup) return { ok: false, error: `Another unit is already called "${dup.name}". Pick a different name.` };
  const same = list.find((d) => d.mac === mac);
  if (same) return { ok: false, error: `That adapter is already added as "${same.name}".` };
  const device = { id: idFor(name, new Set(list.map((d) => d.id))), name, mac };
  save([...list, device]);
  return { ok: true, device };
}

export function renameDevice(id: string, name: unknown): Result {
  const n = cleanName(name);
  const list = listDevices();
  const d = list.find((x) => x.id === id);
  if (!d) return { ok: false, error: "No such unit." };
  if (!n) return { ok: false, error: "Give the unit a name." };
  const dup = nameTaken(list, n, id);
  if (dup) return { ok: false, error: `Another unit is already called "${dup.name}". Pick a different name.` };
  save(list.map((x) => (x.id === id ? { ...x, name: n } : x)));
  return { ok: true, device: { ...d, name: n } };
}

export function removeDevice(id: string): Device | null {
  const list = listDevices();
  const d = list.find((x) => x.id === id);
  if (!d) return null;
  save(list.filter((x) => x.id !== id));
  return d;
}

// Self-check: `npx tsx lib/devices.ts`
if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("lib/devices.ts")) {
  check(parseMac("MAC 348E89A1B2C3,SSID:Smart-M-Air-B2C3,KEY:RAC2WLAN") === "348e89a1b2c3", "QR text");
  check(parseMac("MAC:34:8E:89:A1:B2:C3") === "348e89a1b2c3" && parseMac("34-8e-89-a1-b2-c3") === "348e89a1b2c3", "separators");
  check(parseMac("  348E89A1B2C3 ") === "348e89a1b2c3", "bare MAC");
  check(parseMac("hello") === null && parseMac("MAC 348E89A1B2C") === null && parseMac("348E89A1B2C3FF") === null, "not a MAC");
  process.env.DATA_DIR = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "devices-check-"));
  check(listDevices().length === 0, "a fresh install has no units");
  const a = addDevice({ name: "Living room", qr: "MAC 001122334455,SSID:x,KEY:y" });
  check(a.ok && a.device.id === "living-room" && a.device.mac === "001122334455", "add", a);
  check(!addDevice({ name: "living ROOM", qr: "AABBCCDDEEFF" }).ok, "same name refused, any case");
  const b = addDevice({ name: "Living-room", qr: "AABBCCDDEEFF" });
  check(b.ok && b.device.id === "living-room-2", "unique id", b);
  check(!addDevice({ name: "x", qr: "001122334455" }).ok, "same adapter twice refused");
  check(!addDevice({ name: "", qr: "112233445566" }).ok && !addDevice({ name: "x", qr: "nope" }).ok, "bad input refused");
  const c = addDevice({ name: "2nd floor", qr: "112233445566" });
  check(c.ok && /^[a-z]/.test(c.device.id), "id starts with a letter", c);
  check(renameDevice("living-room", "Lounge").ok && listDevices().some((d) => d.name === "Lounge"), "rename");
  check(!renameDevice("living-room", "2nd FLOOR").ok && renameDevice("living-room", "LOUNGE").ok, "rename: clash refused, own name in another case fine");
  check(listDevices().length === 3, "list persisted");
  check(removeDevice("living-room")?.mac === "001122334455" && !isDevice("living-room") && removeDevice("nope") === null, "remove");
  fs.writeFileSync(file(), "{broken");
  let threw = false;
  try { listDevices(); } catch { threw = true; }
  check(threw, "a corrupt file throws instead of resetting the list");
  console.log("devices.ts checks done");
}
