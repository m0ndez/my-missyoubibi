// End-to-end smoke test: `npm run build && npm run e2e`. Starts everything for real, on throwaway ports and data:
//   broker (in-process) <- built app (next start) -> broker <- bridge (scripts/wfrac.mts) -> fake adapter (127.0.0.1:51443)
// The bridge reaches the broker over a TLS listener with a throwaway certificate (E2E_PLAIN_BRIDGE=1 uses the plain one instead), and must refuse a certificate it does not trust.
// (needs `npm run build` first: it runs the standalone server). Then drives it only through the app's public API: sign in, add a unit by MAC, see it online, power it on, change the setpoint,
// lose and regain the bridge (the page must show the unit offline, then online), remove it. Exits non-zero on the first thing that doesn't happen.
import { Aedes } from "aedes";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import mqtt from "mqtt";
import { probeVerdict } from "../lib/reauth";

const BROKER = 18830, APP = 18831, TLS_BROKER = 18832, MAC = "001122334455", ORIGIN = `http://127.0.0.1:${APP}`;
const PASSWORD = "e2e-Password-1234", SECRET = "e".repeat(40);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-"));
const children: ChildProcess[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function start(name: string, cmd: string, args: string[], env: Record<string, string>) {
  const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  p.stdout.on("data", (d) => process.env.E2E_VERBOSE && process.stdout.write(`[${name}] ${d}`));
  p.stderr.on("data", (d) => process.env.E2E_VERBOSE && process.stderr.write(`[${name}] ${d}`));
  children.push(p);
  return p;
}
function stopAll() { for (const c of children) c.kill("SIGTERM"); }
function fail(msg: string): never { console.error(`\nFAIL: ${msg}`); stopAll(); process.exit(1); }

async function until<T>(what: string, f: () => Promise<T | undefined | false> | T | undefined | false, ms = 30_000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await f(); if (v) return v; await sleep(300); }
  return fail(`timed out waiting for ${what}`);
}

// ---- infrastructure ------------------------------------------------------------------------------------------------
const aedes = await Aedes.createBroker();
const server = net.createServer(aedes.handle).listen(BROKER);
const certFile = path.join(tmp, "broker.pem"), keyFile = path.join(tmp, "broker.key");
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyFile, "-out", certFile, "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost"], { stdio: "ignore" });
const tlsServer = tls.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }, aedes.handle).listen(TLS_BROKER);

const fakeAdapter = start("fake", "npx", ["tsx", "scripts/fake-adapter.mts", MAC], {});
await until("the fake adapter", () => new Promise<boolean>((res) => { const s = net.connect(51443, "127.0.0.1"); s.once("connect", () => { s.destroy(); res(true); }); s.once("error", () => res(false)); }));

const common = { MQTT_URL: `mqtt://127.0.0.1:${BROKER}` };
fs.mkdirSync(path.join(tmp, "app"));
fs.writeFileSync(path.join(tmp, "app", "devices.json"), "[]"); // no built-in seed units: only the one this test adds
start("app", "node", [".next/standalone/server.js"], {
  ...common, APP_PASSWORD: PASSWORD, AUTH_SECRET: SECRET, DATA_DIR: path.join(tmp, "app"), HA_DISCOVERY: "",
  NODE_ENV: "production", PORT: String(APP), HOSTNAME: "127.0.0.1",
});
const plainBridge = !!process.env.E2E_PLAIN_BRIDGE;
const bridgeEnv = {
  ...common, MQTT_URL: plainBridge ? common.MQTT_URL : `mqtts://127.0.0.1:${TLS_BROKER}`, NODE_EXTRA_CA_CERTS: certFile, DATA_DIR: path.join(tmp, "bridge"), WFRAC_WRITE: "1", WFRAC_DEVICES: "e2e=127.0.0.1", WFRAC_CURL: "", WFRAC_SUBNET: "",
};
// Run through node directly (not npx), so killing it really kills the bridge and the broker sees a dropped connection.
const BRIDGE_CMD = ["--import", "tsx", "scripts/wfrac.mts"];
const startBridge = () => start("bridge", "node", BRIDGE_CMD, bridgeEnv);

// A bridge that does not trust the broker's certificate must stop with a clear error, not retry forever or connect anyway.
if (!plainBridge) {
  const untrusting = spawn("node", BRIDGE_CMD, {
    env: { ...process.env, ...bridgeEnv, NODE_EXTRA_CA_CERTS: "", DATA_DIR: path.join(tmp, "bridge-untrusting") }, stdio: ["ignore", "ignore", "pipe"],
  });
  children.push(untrusting);
  let err = "";
  untrusting.stderr.on("data", (d) => (err += d));
  const code = await new Promise<number | null>((res) => { const t = setTimeout(() => res(null), 20_000); untrusting.once("exit", (c) => { clearTimeout(t); res(c); }); });
  if (code === null || code === 0) fail(`a bridge that does not trust the certificate must exit with an error, got ${code}`);
  if (!/refusing to connect/.test(err)) fail(`the untrusted certificate error must say so, got: ${err.trim()}`);
  console.log("a bridge that does not trust the broker's certificate refuses it");
}
let bridge = startBridge();

// What the bridge publishes, seen from outside.
const states = new Map<string, Record<string, unknown>>();
const watcher = mqtt.connect(common.MQTT_URL);
const sets: string[] = []; // every command that reached the broker
watcher.on("connect", () => watcher.subscribe(["mhi/+/state", "mhi/+/set"]));
watcher.on("message", (t, b) => { if (t.endsWith("/set")) { sets.push(b.toString()); return; } const id = t.split("/")[1]; if (b.length) states.set(id, JSON.parse(b.toString())); else states.delete(id); });

// ---- the API, like the page uses it ---------------------------------------------------------------------------------
let cookie = "";
async function api(method: string, url: string, body?: unknown) {
  const res = await fetch(ORIGIN + url, {
    method, redirect: "manual",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", ...(cookie && { Cookie: cookie }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null), res };
}

await until("the app", async () => (await fetch(`${ORIGIN}/api/health`).catch(() => null))?.status === 200);
console.log("app, broker, bridge and fake adapter are up");

const health = await fetch(`${ORIGIN}/api/health`);
if (!health.ok) fail("health check is not 200 with the broker connected");

if ((await api("GET", "/api/timers")).status !== 401) fail("the API must refuse a request without a session");
const login = await fetch(`${ORIGIN}/api/login`, {
  method: "POST", redirect: "manual", headers: { Origin: ORIGIN, "Content-Type": "application/x-www-form-urlencoded" },
  body: `password=${encodeURIComponent(PASSWORD)}`,
});
cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
if (!cookie.includes("session=")) fail("signing in did not give a session cookie");
console.log("signed in");

// What the page shows: the same /api/events stream the browser reads, latest state per unit.
const seen = new Map<string, Record<string, unknown>>();
const events = await fetch(`${ORIGIN}/api/events`, { headers: { Cookie: cookie } });
if (events.status !== 200 || !events.body) fail(`the state stream refused a signed-in request: ${events.status}`);
if (!events.headers.get("content-type")?.startsWith("text/event-stream")) fail("the state stream must stay an event stream (the tunnel buffers other types)");

// The page's session probe (lib/reauth.ts) against the real app and against a server that answers with a sign-in redirect.
const probe = (url: string, headers?: Record<string, string>) => fetch(url, { cache: "no-store", redirect: "manual", headers }).then(probeVerdict);
if ((await probe(`${ORIGIN}/api/timers`, { Cookie: cookie })) !== "ok") fail("the page's probe must see a signed-in session as fine");
if ((await probe(`${ORIGIN}/api/timers`)) !== "login") fail("the page's probe must send an expired session to the App's login");
const access = http.createServer((_, out) => out.writeHead(302, { Location: "https://team.cloudflareaccess.com/login" }).end());
await new Promise<void>((ok) => access.listen(0, "127.0.0.1", ok));
const accessUrl = `http://127.0.0.1:${(access.address() as net.AddressInfo).port}/api/timers`;
if ((await probe(accessUrl)) !== "reauth") fail("the page's probe must re-authenticate on a sign-in redirect");
await new Promise((ok) => access.close(ok));
if (await probe(accessUrl).then(() => true, () => false)) fail("a plain network failure must reject, so the page just reconnects");
void (async () => {
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of events.body as unknown as AsyncIterable<Uint8Array>) {
    buf += dec.decode(chunk, { stream: true });
    for (let i = buf.indexOf("\n\n"); i >= 0; i = buf.indexOf("\n\n")) {
      const line = buf.slice(0, i).split("\n").find((l) => l.startsWith("data: "));
      buf = buf.slice(i + 2);
      if (!line) continue;
      const o = JSON.parse(line.slice(6));
      if (o.gone) seen.delete(o.id);
      else if ("online" in o) seen.set(o.id, o);
    }
  }
})().catch(() => {}); // the stream ends with an error when the app is stopped at teardown: nothing to report

// (fetch won't send a made-up Host header, so this one goes through node:http.)
const rebind = await new Promise<number>((res) => http.get({ host: "127.0.0.1", port: APP, path: "/login", headers: { host: "attacker.example.com" } }, (r) => { r.resume(); res(r.statusCode ?? 0); }));
if (rebind !== 421) fail(`a request for an unlisted Host must get 421, got ${rebind}`);

const bad = await fetch(`${ORIGIN}/api/login`, { method: "POST", redirect: "manual", headers: { Origin: ORIGIN, "Content-Type": "application/x-www-form-urlencoded" }, body: "password=wrong" });
if ((bad.headers.getSetCookie?.() ?? []).some((c) => c.startsWith("session="))) fail("a wrong password must not give a session");

// Wrong guesses must never lock the owner out.
for (let i = 0; i < 3; i++) void fetch(`${ORIGIN}/api/login`, { method: "POST", redirect: "manual", headers: { Origin: ORIGIN, "Content-Type": "application/x-www-form-urlencoded" }, body: "password=guess" + i });
const again = await fetch(`${ORIGIN}/api/login`, { method: "POST", redirect: "manual", headers: { Origin: ORIGIN, "Content-Type": "application/x-www-form-urlencoded" }, body: `password=${encodeURIComponent(PASSWORD)}` });
if (!(again.headers.getSetCookie?.() ?? []).some((c) => c.startsWith("session="))) fail("the right password was refused after wrong guesses");

const added = await api("POST", "/api/devices", { name: "E2E", qr: `MAC ${MAC.toUpperCase()},SSID:Smart-M-Air-4455,KEY:RAC2WLAN` });
if (added.status !== 201 || added.body?.id !== "e2e") fail(`adding a unit by QR text failed: ${added.status} ${JSON.stringify(added.body)}`);
console.log("added a unit by its QR text");

await until("the unit's state", () => states.get("e2e"), 45_000);
console.log("the bridge found, paired and is polling it");

if ((await api("POST", "/api/set", { id: "e2e", patch: { power: true, temp: 26 } })).status !== 200) fail("a change was refused");
await until("power on and 26 degrees", () => { const s = states.get("e2e"); return s?.power === true && s?.temp === 26; });
console.log("power on and setpoint 26 reached the unit and came back");
await until("humidity from the unit's sensor", () => states.get("e2e")?.humidity === 54);
console.log("the unit's humidity (54 %) came through the bridge")

// The bridge disappears (a dropped connection, so its last-will fires): the page must stop showing the unit as online.
await until("the page to show the unit online", () => seen.get("e2e")?.online === true);
bridge.kill("SIGKILL");
await until("the page to show the unit offline once the bridge is gone", () => seen.get("e2e")?.online === false, 30_000);
console.log("the bridge went away and the page shows the unit offline");
// A command for an offline unit is refused with its own status and message, and nothing reaches the broker.
const sentBefore = sets.length;
const refused = await api("POST", "/api/set", { id: "e2e", patch: { power: false } });
if (refused.status !== 409 || !/offline/.test(refused.body?.error ?? "")) fail(`a command for an offline unit must get 409 with a message, got ${refused.status} ${JSON.stringify(refused.body)}`);
await sleep(500);
if (sets.length !== sentBefore) fail("a refused command still reached the broker");
console.log("a command for the offline unit was refused and nothing was sent");
bridge = startBridge();
await until("the page to show the unit online again", () => seen.get("e2e")?.online === true, 45_000);
console.log("the bridge came back and the unit is online again, with no app restart");
if ((await api("POST", "/api/set", { id: "e2e", patch: { power: false } })).status !== 200) fail("a command was refused after the bridge came back");
await until("power off after the bridge returned", () => states.get("e2e")?.power === false);
if (sets.length !== sentBefore + 1) fail("the refused command was replayed after the bridge returned");
console.log("a command works again after the bridge returned, and the refused one was not replayed");

const renamed = await api("PATCH", "/api/devices/e2e", { name: "Study" });
if (renamed.status !== 200) fail("rename failed");
const list = await api("GET", "/api/devices");
if (!Array.isArray(list.body) || list.body.find((d: { id: string }) => d.id === "e2e")?.name !== "Study") fail("the list does not show the new name");

const removed = await api("DELETE", "/api/devices/e2e");
if (removed.status !== 200) fail("removing the unit failed");
await until("the unit's state to be cleared", () => !states.has("e2e"));
console.log("renamed and removed");

console.log("\nPASS: end-to-end smoke test");
watcher.end(true);
stopAll();
server.close();
tlsServer.close();
await aedes.close();
fakeAdapter.kill();
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(0);
