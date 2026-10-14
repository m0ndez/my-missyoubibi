// Bridge: official MHI WF-RAC adapters (local HTTP/HTTPS API) <-> our mhi/<id>/* MQTT contract. Protocol sources: see NOTICE.
//   Run (outside Docker): npm run wfrac. Units come from the app; WFRAC_DEVICES="id=ip,..." pins fixed addresses instead.
// Reads are always on. Writes are OFF unless WFRAC_WRITE=1. One-time pairing: `npm run wfrac -- register`.
//
// Latency design (measured on real units):
//  - HTTPS adapters need 1-17 s for a new TLS handshake but answer in ~0.4 s on an open connection, so connections are kept alive.
//  - The adapter serves one connection at a time, so each adapter has ONE worker (requests are serialized per adapter)
//    while adapters run in parallel.
//  - A write is sent as soon as it arrives, not at the next poll. The adapter's "60 s write lock" only blocks other
//    clients (e.g. the official app); back-to-back writes from this client are accepted.
import { execFile } from "node:child_process";
import dns from "node:dns/promises";
import net from "node:net";
import os from "node:os";
import http from "node:http";
import https from "node:https";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import mqtt from "mqtt";
import { parsePatch, type AcControl, type AcState } from "../lib/ac";
import { cidrHosts, sameMac, subnetHosts } from "../lib/discover";
import { decodeHumidity, decodeSilent, decodeStat, encodeCommand, encodeHumidityRead, encodeSilent, encodeSilentRead } from "../lib/wfrac";
import { checkPin, pinnedAgent, type Pins } from "../lib/pin";

// Optional fixed addresses: WFRAC_DEVICES="bedroom=192.168.1.50,...". Otherwise adapters are found by their MAC and the
// address is remembered in data/wfrac-ips.json.
const envIps = new Map(
  (process.env.WFRAC_DEVICES ?? "").split(",").map((p) => p.trim().split("=") as [string, string])
    .filter(([id, ip]) => /^[a-z][a-z0-9-]{0,23}$/.test(id ?? "") && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip ?? "")),
);
const POLL_MS = 5_000; // how often an idle adapter is read; external changes (remote, official app) show up this fast
const MIN_GAP_MS = 500; // breathing room between requests to one adapter (the protocol notes ask for >= 1 s; 0.5 s is fine in practice)
const MAX_REPLY = 64 * 1024; // a real reply is under 1 KB
const REQUEST_TIMEOUT_MS = 20_000; // a cold HTTPS handshake alone can take 17 s
const HUMIDITY_POLL_MS = 60_000; // relative humidity changes slowly; one extra request a minute is plenty
const SILENT_POLL_MS = 30_000; // silent mode costs an extra request, and only changes when someone changes it
const SILENT_RETRY_MS = 5 * 60_000; // after 3 failed reads (a unit without silent mode, or a Wi-Fi blip) try again this rarely
const WRITE = process.env.WFRAC_WRITE === "1";
// Told to the adapter when pairing: the timezone of this installation (TZ), else of this machine.
const TIMEZONE = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

// Stable operator id, created on first run. The adapter stores up to 4 of these.
const idFile = path.join(process.env.DATA_DIR ?? "data", "wfrac-operator-id");
let operatorId: string;
try {
  operatorId = fs.readFileSync(idFile, "utf8").trim();
} catch {
  operatorId = "";
}
if (!operatorId) {
  operatorId = randomUUID(); // an empty or truncated file would otherwise give an empty id for ever
  fs.mkdirSync(path.dirname(idFile), { recursive: true });
  fs.writeFileSync(idFile, operatorId, { mode: 0o600 }); // the id is this bridge's credential on the adapters
}

type Reply = { result: number; contents: { airconId: string; airconStat: string } };

// Adapter uses a self-signed cert and old TLS (mbedTLS 2.4): relax verification for these LAN hosts only.
// Certificate pins (trust on first use). A changed certificate is refused until WFRAC_REPIN=1 is set for one run.
const pinFile = path.join(process.env.DATA_DIR ?? "data", "wfrac-pins.json");
let pins: Pins = {};
try {
  pins = JSON.parse(fs.readFileSync(pinFile, "utf8"));
} catch {
  /* first run */
}
const REPIN_UNTIL = Date.now() + 10 * 60_000; // WFRAC_REPIN=1 is meant for one start: it stops counting after 10 minutes
function savePins() {
  try {
    fs.mkdirSync(path.dirname(pinFile), { recursive: true });
    fs.writeFileSync(pinFile, JSON.stringify(pins, null, 1));
  } catch (e) { console.error("couldn't save certificate pins:", (e as Error).message); }
}
function pinCheck(ip: string, fingerprint: string): Error | undefined {
  const r = checkPin(pins, ip, fingerprint);
  if (r === "ok") return undefined;
  if (r === "mismatch" && !(process.env.WFRAC_REPIN === "1" && Date.now() < REPIN_UNTIL)) {
    return new Error(`adapter ${ip} presented a different TLS certificate than the one pinned (${pins[ip]}). If you replaced the adapter, run once with WFRAC_REPIN=1.`);
  }
  pins[ip] = fingerprint;
  savePins();
  console.log(`pinned ${ip}: ${fingerprint}`);
  return undefined;
}

// One agent per adapter and maxSockets 1: never a second connection to an adapter that serves one at a time, and
// dropping one adapter's dead socket must not cut requests in flight to the others.
const agentList = new Map<string, https.Agent | http.Agent>();
function agentFor(proto: "https" | "http", ip: string) {
  const k = `${proto}://${ip}`;
  if (!agentList.has(k)) {
    agentList.set(k, proto === "https"
      ? pinnedAgent((fp) => pinCheck(ip, fp), { ciphers: "DEFAULT@SECLEVEL=0", minVersion: "TLSv1", keepAlive: true, maxSockets: 1 })
      : new http.Agent({ keepAlive: true, maxSockets: 1 }));
  }
  return agentList.get(k)!;
}

// Older firmware branch ("WF-RAC") serves plain HTTP, newer ones HTTPS. Learn per adapter on first success.
const scheme = new Map<string, "https" | "http">();

function request(proto: "https" | "http", ip: string, command: string, body: string, opts: { agent?: http.Agent; timeout?: number } = {}): Promise<Reply> {
  const timeout = opts.timeout ?? REQUEST_TIMEOUT_MS;
  if (process.env.WFRAC_CURL === "1") {
    // Dev on macOS where Node is denied LAN access by Local Network privacy but system curl is not.
    // No connection reuse here, so HTTPS adapters are slow (new TLS handshake per request). Not for real use.
    const url = `${proto}://${ip}:51443/beaver/command/${command}`;
    return new Promise((resolve, reject) => {
      const child = execFile("curl", ["-sk", "-m", String(timeout / 1000), "-X", "POST", "-H", "Content-Type: application/json", "-d", "@-", url],
        { maxBuffer: MAX_REPLY },
        (err, out) => {
          if (err) return reject(err);
          try { resolve(JSON.parse(out)); } catch { reject(new Error("bad body")); }
        });
      child.stdin?.end(body); // the body holds the operator id: not in curl's arguments, where `ps` shows it
    });
  }
  const lib = proto === "https" ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      { host: ip, port: 51443, path: `/beaver/command/${command}`, method: "POST", agent: opts.agent ?? agentFor(proto, ip), timeout,
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
      (res) => {
        let text = "";
        res.on("data", (c) => {
          text += c;
          if (text.length > MAX_REPLY) req.destroy(new Error("reply too large")); // anything on the LAN can answer a scan
        });
        res.on("end", () => { try { resolve(JSON.parse(text)); } catch { reject(new Error(`bad body (${res.statusCode})`)); } });
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end(body);
  });
}

const bodyOf = (command: string, contents?: object) => () => JSON.stringify({
  apiVer: "1.0", command, deviceId: "home-ac-app", operatorId, timestamp: Math.floor(Date.now() / 1000),
  ...(contents && { contents }),
});

async function call(ip: string, command: string, contents?: object): Promise<Reply> {
  const body = bodyOf(command, contents);
  const known = scheme.get(ip) ?? (pins[ip] ? "https" : undefined); // a pinned adapter speaks https: never fall back to cleartext
  for (const proto of known ? [known] : (["https", "http"] as const)) {
    try {
      let r: Reply;
      try {
        r = await request(proto, ip, command, body());
      } catch (e) {
        if (!known) throw e;
        // A kept-alive socket may have died silently (adapter Wi-Fi blip). Drop it and retry once on a fresh one.
        agentFor(proto, ip).destroy();
        r = await request(proto, ip, command, body());
      }
      scheme.set(ip, proto);
      return r;
    } catch (e) {
      if (known || proto === "http") throw e;
    }
  }
  throw new Error("unreachable");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

if (process.argv[2] === "register") {
  // Pairs this app's operator id with every adapter in WFRAC_DEVICES (uses one of its 4 account slots).
  // Units added from the app are paired automatically; this is for the fixed-address setup.
  for (const [id, ip] of envIps) {
    const info = await call(ip, "getDeviceInfo");
    const airconId = info.contents.airconId;
    const r = await call(ip, "updateAccountInfo", { accountId: operatorId, airconId, remote: 0, timezone: TIMEZONE });
    console.log(id, ip, "register result:", r.result);
    await sleep(1000);
  }
  process.exit(0);
}

// ---- finding and pairing adapters -------------------------------------------------------------------------------
type Dev = { id: string; name: string; mac: string };
const dataDir = process.env.DATA_DIR ?? "data";
const readJson = <T,>(file: string, fallback: T): T => {
  try { return JSON.parse(fs.readFileSync(path.join(dataDir, file), "utf8")); } catch { return fallback; }
};
const writeJson = (file: string, v: unknown) => {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, file), JSON.stringify(v, null, 1));
  } catch (e) { console.error(`couldn't write ${file}:`, (e as Error).message); } // a full or read-only disk must not take the bridge down
};
const knownIps: Record<string, string> = readJson("wfrac-ips.json", {}); // mac -> last address seen
const paired: Record<string, boolean> = readJson("wfrac-paired.json", {});

// Probes use their own connections: they must not pin the certificate of every host that answers on 51443.
const probeAgents = {
  http: new http.Agent({ keepAlive: false }),
  https: new https.Agent({ rejectUnauthorized: false, ciphers: "DEFAULT@SECLEVEL=0", minVersion: "TLSv1", keepAlive: false }),
};
// A probe goes to whatever answers on the port, unverified: it carries a throwaway id, never ours.
const probeBody = () => JSON.stringify({ apiVer: "1.0", command: "getDeviceInfo", deviceId: "home-ac-app", operatorId: "probe", timestamp: Math.floor(Date.now() / 1000) });
// Asks an address "who are you?": the adapter's MAC (= airconId), or null if nothing that speaks this protocol is there.
async function probe(ip: string, timeout = 3_000): Promise<string | null> {
  for (const proto of ["http", "https"] as const) {
    try {
      const r = await request(proto, ip, "getDeviceInfo", probeBody(), { agent: probeAgents[proto], timeout });
      const id = r?.contents?.airconId;
      if (typeof id === "string") { scheme.set(ip, proto); return id.toLowerCase(); }
    } catch { /* not here, or the other scheme */ }
  }
  return null;
}

// Each adapter announces itself over mDNS as <mac>.local (docs/firmware.md).
async function viaMdns(mac: string): Promise<string | null> {
  const host = `${mac}.local`;
  if (process.env.WFRAC_CURL === "1") {
    return new Promise((resolve) =>
      execFile("curl", ["-sk", "-m", "4", "-o", "/dev/null", "-w", "%{remote_ip}", `https://${host}:51443/`], (_e, out) =>
        resolve(/^\d+\.\d+\.\d+\.\d+$/.test(out.trim()) ? out.trim() : null)));
  }
  try {
    const r = await Promise.race([dns.lookup(host, { family: 4 }), sleep(4_000).then(() => null)]);
    return r ? r.address : null;
  } catch { return null; }
}

const portOpen = (ip: string) =>
  process.env.WFRAC_CURL === "1"
    ? Promise.resolve(true) // Node cannot open sockets here; let the (curl) probe decide
    : new Promise<boolean>((resolve) => {
        const s = net.connect({ host: ip, port: 51443, timeout: 800 });
        const done = (ok: boolean) => { s.destroy(); resolve(ok); };
        s.once("connect", () => done(true));
        s.once("timeout", () => done(false));
        s.once("error", () => done(false));
      });

// Ask every host on our own subnet(s) that has port 51443 open who it is. With `want`, stops at that adapter; otherwise
// returns every adapter that answered (mac -> address). `skip`: addresses not worth disturbing (adapters already in use).
async function scan(want?: string, skip?: Set<string>): Promise<Map<string, string>> {
  // In a container our own interfaces are Docker's, so `npm run setup` passes the LAN's subnet in WFRAC_SUBNET.
  const hosts = (process.env.WFRAC_SUBNET ? cidrHosts(process.env.WFRAC_SUBNET) : Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal).flatMap((i) => subnetHosts(i!.address, i!.netmask)))
    .filter((ip) => !skip?.has(ip));
  const found = new Map<string, string>();
  let next = 0;
  await Promise.all(Array.from({ length: 32 }, async () => {
    while (!(want && found.size) && next < hosts.length) {
      const ip = hosts[next++];
      if (!(await portOpen(ip))) continue;
      const id = await probe(ip, process.env.WFRAC_CURL === "1" ? 3_000 : 12_000);
      if (id && (!want || sameMac(id, want))) found.set(id, ip);
    }
  }));
  return found;
}
const viaScan = async (mac: string) => [...(await scan(mac, new Set([...running.values()].map((r) => r.ip).filter((ip): ip is string => !!ip)))).values()][0] ?? null;

async function findIp(d: Dev): Promise<string | null> {
  const remember = (ip: string) => {
    const old = knownIps[d.mac];
    // Pins are kept per address, so carry the pin of a known adapter over to its new address: a different certificate there is refused.
    if (old && old !== ip && pins[old] && !pins[ip]) { pins[ip] = pins[old]; savePins(); }
    knownIps[d.mac] = ip;
    writeJson("wfrac-ips.json", knownIps);
    return ip;
  };
  const cached = knownIps[d.mac];
  if (cached && sameMac(await probe(cached, 12_000), d.mac)) return cached;
  const m = await viaMdns(d.mac);
  if (m && sameMac(await probe(m, 12_000), d.mac)) return remember(m);
  const s = await viaScan(d.mac);
  return s ? remember(s) : null;
}

// `npm run wfrac -- find <mac>`: where is this adapter? Tries the mDNS name, then scans the local subnet (read-only).
if (process.argv[2] === "find") {
  const mac = (process.argv[3] ?? "").toLowerCase().replace(/[:-]/g, "");
  if (!/^[0-9a-f]{12}$/.test(mac)) { console.error("usage: npm run wfrac -- find <12-digit MAC>"); process.exit(1); }
  const timed = async (name: string, f: () => Promise<string | null>) => {
    const t = Date.now();
    const ip = await f();
    console.log(`${name}: ${ip ?? "no answer"} (${((Date.now() - t) / 1000).toFixed(1)} s)`);
    return ip;
  };
  const m = await timed("mDNS <mac>.local", async () => { const ip = await viaMdns(mac); return ip && sameMac(await probe(ip, 12_000), mac) ? ip : null; });
  await timed("subnet scan   ", () => viaScan(mac));
  process.exit(m ? 0 : 0);
}

// Register our operator id with the adapter, then check it answers. Always register, even if reading already works: an adapter
// answers state requests from anyone but only accepts changes from a registered app (seen after removing and re-adding a unit:
// reads fine, writes silently ignored). Registering the same id again reuses its slot.
async function ensurePaired(ip: string, mac: string): Promise<boolean> {
  const reg = await call(ip, "updateAccountInfo", { accountId: operatorId, airconId: mac, remote: 0, timezone: TIMEZONE }).catch(() => null);
  // result 0 on every adapter tried (SRK24 https, SRK18 and DXK12 http). Anything else: a full slot table, or a refused app.
  if (!reg || reg.result !== 0) { console.error(`pairing ${mac}: the adapter answered ${reg ? `result ${reg.result}` : "nothing"}`); return false; }
  await sleep(1_500);
  const r = await call(ip, "getAirconStat", { airconId: mac }).catch(() => null);
  return !!(r?.contents?.airconStat && decodeStat(r.contents.airconStat));
}

// ---- MQTT ---------------------------------------------------------------------------------------------------------
const client = mqtt.connect(process.env.MQTT_URL ?? "mqtt://localhost:1883", {
  username: process.env.MQTT_USER, password: process.env.MQTT_PASS,
});
client.on("error", (e) => console.error("mqtt:", e.message));
client.on("connect", () => client.subscribe(["mhi/_devices", "mhi/_scan", "mhi/+/set"]));

// Container healthcheck: a file touched while the bridge is alive and connected to the broker (adapters being offline is not unhealthy).
const heartbeat = process.env.WFRAC_HEARTBEAT;
if (heartbeat) {
  const beat = () => { if (client.connected) fs.writeFileSync(heartbeat, String(Date.now())); };
  client.on("connect", beat);
  setInterval(beat, 15_000).unref();
}

// What the bridge is doing to bring a unit up, for the app to show: finding | pairing | ready | error:<reason>.
const shown = new Set<string>();
function status(id: string, text: string) { shown.add(id); client.publish(`mhi/${id}/setup`, text, { retain: true }); }
function clearSetup(id: string) { if (shown.delete(id)) client.publish(`mhi/${id}/setup`, "", { retain: true }); }

const airconIds = new Map<string, string>();
const last = new Map<string, string>();
const fails = new Map<string, number>();
const queue = new Map<string, Partial<AcControl>>(); // newest patch per device, merged
const silent = new Map<string, boolean>(); // last known silent-mode state (not part of the normal state block)
const silentAt = new Map<string, number>();
const silentFails = new Map<string, number>(); // after 3 failures reads back off to SILENT_RETRY_MS; a success resets
const humidity = new Map<string, number>(); // last known relative humidity (op-code 0xAD): not in the normal state block either
const humidityAt = new Map<string, number>();
const humidityFails = new Map<string, number>(); // no answer or "no sensor": 3 in a row and it is asked only every SILENT_RETRY_MS
const wake = new Map<string, () => void>(); // cut a worker's idle wait short
const retried = new Set<string>(); // devices whose last write already failed once and was put back
const unapplied = new Map<string, number>(); // writes in a row the unit answered without applying (reset by a write that took, or a new change)
const LOCK_MS = 60_000; // after a change, the adapter refuses other apps' writes for this long (docs/firmware.md)

function publish(id: string, s: AcState) {
  const json = JSON.stringify({ ...s, ...(silent.has(id) && { silent: silent.get(id) }), ...(humidity.has(id) && { humidity: humidity.get(id) }) });
  if (last.get(id) !== json) { last.set(id, json); client.publish(`mhi/${id}/state`, json, { retain: true }); }
}

// Silent mode: read it back (also after a write: the write's own answer is an error code on real units though it applies).
async function syncSilent(id: string, ip: string, airconId: string, write?: boolean) {
  if (write === undefined && (silentFails.get(id) ?? 0) >= 3 && Date.now() - (silentAt.get(id) ?? 0) < SILENT_RETRY_MS) return;
  try {
    if (write !== undefined) {
      await call(ip, "setAirconStat", { airconId, airconStat: encodeSilent(write) }).catch(() => null);
      await sleep(2_000); // the unit applies it a moment after answering; reading straight back sees the old value
    }
    const r = await call(ip, "setAirconStat", { airconId, airconStat: encodeSilentRead() }).catch(() => null);
    const on = r?.contents?.airconStat ? decodeSilent(r.contents.airconStat) : null;
    if (on === null) throw new Error("no answer");
    silent.set(id, on);
    silentFails.set(id, 0);
  } catch {
    silentFails.set(id, (silentFails.get(id) ?? 0) + 1);
  }
  silentAt.set(id, Date.now());
}

// Relative humidity costs one extra request, and moves slowly: asked once a minute. A unit without the sensor answers a sentinel
// (decodeHumidity says null), so after 3 empty answers it is asked only every few minutes.
async function syncHumidity(id: string, ip: string, airconId: string) {
  if ((humidityFails.get(id) ?? 0) >= 3 && Date.now() - (humidityAt.get(id) ?? 0) < SILENT_RETRY_MS) return;
  try {
    const r = await call(ip, "setAirconStat", { airconId, airconStat: encodeHumidityRead() }).catch(() => null);
    const v = r?.contents?.airconStat ? decodeHumidity(r.contents.airconStat) : null;
    if (v === null) throw new Error("no humidity");
    humidity.set(id, v);
    humidityFails.set(id, 0);
  } catch {
    humidityFails.set(id, (humidityFails.get(id) ?? 0) + 1);
    if ((humidityFails.get(id) ?? 0) >= 3) humidity.delete(id); // a sensor that stopped answering must not leave an old number on screen
  }
  humidityAt.set(id, Date.now());
}

// One request to one adapter: a write if a change is queued, otherwise a read. Both return the unit's state.
async function tick(id: string, ip: string) {
  let sent: Partial<AcControl> | undefined;
  try {
    if (!airconIds.has(id)) airconIds.set(id, (await call(ip, "getDeviceInfo")).contents.airconId);
    const airconId = airconIds.get(id)!;
    const queued = queue.get(id);
    queue.delete(id);
    sent = queued;
    const { silent: wantSilent, ...patch } = queued ?? {};
    const hasPatch = Object.keys(patch).length > 0;
    if (WRITE && wantSilent !== undefined) await syncSilent(id, ip, airconId, wantSilent);
    // Observed on real units: successful writes can still answer result 12. Trust the returned state, not the code.
    const r = hasPatch && WRITE
      ? await call(ip, "setAirconStat", { airconId, airconStat: encodeCommand(patch) })
      : await call(ip, "getAirconStat", { airconId });
    const s = r.contents?.airconStat ? decodeStat(r.contents.airconStat) : null;
    if (!s) throw new Error(`unusable reply (result ${r.result})`);
    if (!running.has(id)) return; // removed while this request was in flight: don't bring its topics back
    fails.set(id, 0);
    retried.delete(id);
    // The adapter answers a refused write like an accepted one, with the old state. Another app (the Smart M-Air app, say) changed the
    // unit within the last minute and holds the lock: put back what didn't take once the lock is over, instead of dropping it.
    const missed = hasPatch && WRITE ? Object.entries(patch).filter(([k, v]) => s[k as keyof AcState] !== v) : [];
    if (!missed.length) unapplied.delete(id);
    else {
      const n = (unapplied.get(id) ?? 0) + 1;
      unapplied.set(id, n);
      console.error(id, `write not applied (${missed.map(([k]) => k).join(", ")})${n === 1 ? `, trying again in ${LOCK_MS / 1000 + 1} s` : ""}`);
      if (n === 1)
        setTimeout(() => {
          if (!running.has(id)) return;
          queue.set(id, { ...Object.fromEntries(missed), ...queue.get(id) }); // a newer change for the same field wins
          wake.get(id)?.();
        }, LOCK_MS + 1_000);
    }
    if (Date.now() - (silentAt.get(id) ?? 0) > SILENT_POLL_MS) await syncSilent(id, ip, airconId);
    if (Date.now() - (humidityAt.get(id) ?? 0) > HUMIDITY_POLL_MS) await syncHumidity(id, ip, airconId);
    client.publish(`mhi/${id}/online`, "1", { retain: true });
    publish(id, s);
    clearSetup(id);
  } catch (e) {
    if (!running.has(id)) return;
    const n = (fails.get(id) ?? 0) + 1;
    fails.set(id, n);
    console.error(id, ip, (e as Error).message);
    // A write that failed on the way is put back once (a newer change for the same device wins), not silently lost.
    if (WRITE && sent && !retried.has(id)) {
      retried.add(id);
      queue.set(id, { ...sent, ...queue.get(id) });
    } else retried.delete(id);
    if (n === 3) client.publish(`mhi/${id}/online`, "0", { retain: true }); // adapter drops Wi-Fi about hourly: tolerate blips
  }
}

type Run = { stop: boolean; ip?: string; mac: string };
const running = new Map<string, Run>();

// "Find units on my network" in the app: list every adapter that answers, except the ones we already poll.
let scanning = false;
let lastScan = 0;
async function scanNetwork() {
  // Adapters serve one connection at a time and a scan probes the whole subnet: no back-to-back scans.
  if (scanning || Date.now() - lastScan < 15_000) return;
  scanning = true;
  lastScan = Date.now();
  const publishFound = (units: { mac: string; ip: string }[], now: boolean, problem?: "lan") =>
    client.publish("mhi/_found", JSON.stringify({ scanning: now, units, ...(problem && { problem }) }), { retain: true });
  publishFound([], true);
  try {
    const mine = new Set([...running.values()].map((r) => r.ip).filter((ip): ip is string => !!ip));
    const units = [...(await scan(undefined, mine))].map(([mac, ip]) => ({ mac, ip }));
    // Nothing answered and none of our own units answers either: more likely we can't reach the LAN than that it is empty.
    const cut = units.length === 0 && running.size > 0 && [...running.keys()].every((id) => (fails.get(id) ?? 0) >= 3);
    publishFound(units, false, cut ? "lan" : undefined);
  } catch (e) {
    console.error("scan:", (e as Error).message);
    publishFound([], false);
  } finally { scanning = false; }
}

client.on("message", (topic, buf) => {
  if (topic === "mhi/_scan") { void scanNetwork(); return; }
  if (topic === "mhi/_devices") {
    const list = parseList(buf.toString());
    if (list) applyList(list);
    return;
  }
  const id = topic.split("/")[1];
  let patch;
  try { patch = parsePatch(JSON.parse(buf.toString())); } catch { return; }
  if (!patch || !running.has(id)) return;
  if (!WRITE) return console.error(id, "change ignored: WFRAC_WRITE=1 is not set (the bridge is read-only)");
  unapplied.delete(id); // a new change from the page gets its own retry
  queue.set(id, { ...queue.get(id), ...patch });
  wake.get(id)?.(); // send now instead of waiting for the next poll
});

function parseList(text: string): Dev[] | null {
  try {
    const x: unknown = JSON.parse(text);
    const ok = (d: Dev) => d && /^[a-z][a-z0-9-]{0,23}$/.test(d.id) && typeof d.name === "string" && /^[0-9a-f]{12}$/.test(d.mac);
    return Array.isArray(x) && x.every(ok) ? (x as Dev[]) : null;
  } catch { return null; }
}

let gotList = false;
function applyList(list: Dev[]) {
  gotList = true;
  const ids = new Set(list.map((d) => d.id));
  for (const id of [...running.keys()]) if (!ids.has(id)) void stopDevice(id);
  for (const d of list) {
    const run = running.get(d.id);
    if (run) run.mac ||= d.mac; // started from WFRAC_DEVICES before the list was known
    else void startDevice(d);
  }
}

// Removal of an adapter in progress (mac -> its cleanup), so a re-add can't be registered and then unregistered by the old cleanup.
const removals = new Map<string, Promise<void>>();

async function startDevice(d: Dev) {
  const run: Run = { stop: false, mac: d.mac };
  running.set(d.id, run);
  await removals.get(d.mac);
  while (!run.stop) {
    status(d.id, "finding");
    const ip = envIps.get(d.id) ?? (await findIp(d));
    if (run.stop) return;
    if (!ip) { status(d.id, "error:notfound"); await sleep(60_000); continue; }
    const who = await probe(ip, 12_000);
    if (run.stop) return;
    if (!sameMac(who, d.mac)) { status(d.id, who ? "error:wrongunit" : "error:unreachable"); await sleep(30_000); continue; }
    run.ip = ip;
    // Register on every start, not only the first: an adapter that was reset or had its app list cleared still answers reads, but
    // ignores changes from an app it no longer knows.
    status(d.id, "pairing");
    const ok = await ensurePaired(ip, d.mac);
    if (run.stop) return;
    if (!ok) { status(d.id, "error:pairing"); await sleep(60_000); continue; }
    paired[d.mac] = true;
    writeJson("wfrac-paired.json", paired);
    status(d.id, "ready"); // the first good poll clears it
    return worker(d, run);
  }
}

// A removed unit: stop polling, free its account slot on the adapter (best effort), forget its address.
async function stopDevice(id: string) {
  const run = running.get(id);
  if (!run) return;
  run.stop = true;
  running.delete(id);
  wake.get(id)?.();
  for (const m of [queue, last, fails, unapplied, airconIds, silent, silentAt, silentFails, humidity, humidityAt, humidityFails, wake] as Map<string, unknown>[]) m.delete(id);
  shown.delete(id);
  const mac = run.mac;
  if (mac) { delete paired[mac]; delete knownIps[mac]; writeJson("wfrac-paired.json", paired); writeJson("wfrac-ips.json", knownIps); }
  const cleanup = (async () => {
    if (run.ip && mac) await call(run.ip, "deleteAccountInfo", { accountId: operatorId, airconId: mac }).catch(() => null);
    for (const t of ["state", "online", "setup"]) client.publish(`mhi/${id}/${t}`, "", { retain: true }); // an in-flight poll may have published again
    console.log("removed", id);
  })();
  if (mac) removals.set(mac, cleanup);
  await cleanup;
  if (mac && removals.get(mac) === cleanup) removals.delete(mac);
}

// One worker per adapter: serialized requests to the same adapter, adapters in parallel.
async function worker(d: Dev, run: Run) {
  const id = d.id;
  let lastFind = 0;
  while (!run.stop) {
    await tick(id, run.ip!);
    await sleep(MIN_GAP_MS);
    if (run.stop) break;
    // Silent for a while: the adapter may have a new address (DHCP). Look again, at most every 5 minutes.
    if (run.mac && !envIps.has(id) && (fails.get(id) ?? 0) >= 6 && Date.now() - lastFind > 300_000) {
      lastFind = Date.now();
      const ip = await findIp({ ...d, mac: run.mac });
      if (ip && ip !== run.ip) { console.log(id, "moved", run.ip, "->", ip); run.ip = ip; }
    }
    if (queue.has(id)) continue; // a change arrived meanwhile: send it right away
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, POLL_MS - MIN_GAP_MS);
      wake.set(id, () => { clearTimeout(t); resolve(); });
    });
  }
}

process.on("unhandledRejection", (e) => console.error("wfrac: unhandled:", e)); // one failed file write or request must not stop every unit
console.log(`wfrac: writes ${WRITE ? "ENABLED" : "disabled"}`);
// Fixed addresses from WFRAC_DEVICES work without the app: used when no unit list shows up (the app publishes it, retained).
setTimeout(() => {
  if (gotList) return;
  for (const [id, ip] of envIps) {
    if (running.has(id)) continue;
    const run: Run = { stop: false, ip, mac: "" };
    running.set(id, run);
    void worker({ id, name: id, mac: "" }, run);
  }
  console.log(`wfrac: no unit list from the app, using WFRAC_DEVICES (${envIps.size})`);
}, 4_000);
