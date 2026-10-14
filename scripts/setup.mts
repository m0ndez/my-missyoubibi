// One-command setup: `npm run setup` (or `node scripts/setup.mts`, no npm install needed).
//   - detects the network this machine is on (the bridge scans it for the adapters),
//   - writes .env with fresh secrets (existing values are kept; `change-me` placeholders are replaced),
//   - starts the stack with Docker or Podman.
// `--backend` starts only the broker and the bridge (for `npm run dev`); `--no-start` only writes .env;
// `--pull` fetches the published images instead of building them (for a release download without the build tools).
// `--lan` / `--local` choose whether the page is also served to phones on your Wi-Fi (APP_BIND); without either, a terminal is asked once.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { createInterface } from "node:readline/promises";
import { detect } from "./netinfo.mts";

// Node warns that lib/*.ts has no package "type" and is being reparsed as a module: true, harmless, and not for the person running setup.
process.removeAllListeners("warning");
const { weakPassword } = await import("../lib/password.ts");

const args = process.argv.slice(2);
const backendOnly = args.includes("--backend");
const file = ".env";
const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n") : [];
const pattern = (key: string) => new RegExp(`^${key}=(.*)$`);
// A value the way Docker Compose reads it: a "#" starts a comment only after a space, matching quotes are dropped.
const clean = (raw: string) => {
  const v = raw.replace(/\s+#.*$/, "").trim();
  return /^(["']).*\1$/.test(v) ? v.slice(1, -1) : v;
};
const get = (key: string) => lines.map((l) => pattern(key).exec(l)?.[1]).filter((v) => v !== undefined).map((v) => clean(v!))[0] ?? "";
const set = (key: string, value: string) => {
  const i = lines.findIndex((l) => pattern(key).test(l));
  if (i >= 0) lines[i] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
};
const drop = (key: string) => {
  const i = lines.findIndex((l) => pattern(key).test(l));
  if (i >= 0) lines.splice(i, 1);
};
const secret = (n: number) => crypto.randomBytes(n).toString("hex");
const blank = (v: string) => v === "" || v === "change-me";
const weak = (v: string) => blank(v) || weakPassword(v) !== null; // the app refuses to start with these, so replace them

// The login password is the only one a person types, so it is short; the rest are machine secrets.
const passwordWasNew = weak(get("APP_PASSWORD"));
if (passwordWasNew) set("APP_PASSWORD", crypto.randomBytes(9).toString("base64url"));
if (blank(get("AUTH_SECRET")) || get("AUTH_SECRET").length < 32) set("AUTH_SECRET", secret(32));
if (blank(get("MQTT_PASS"))) set("MQTT_PASS", get("MQTT_APP_PASSWORD") || secret(16)); // older .env files called it MQTT_APP_PASSWORD
if (blank(get("MQTT_DEVICE_PASS"))) set("MQTT_DEVICE_PASS", secret(16));
if (!get("MQTT_URL")) set("MQTT_URL", "mqtt://localhost:1883"); // `npm run dev` talks to the broker published on localhost
if (!get("MQTT_USER")) set("MQTT_USER", "app");
// Timers and daily energy totals follow this timezone (and the adapter is told it at pairing). Detected once, then yours to change.
if (!get("TZ")) set("TZ", Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
drop("MQTT_APP_PASSWORD");
drop("LAN_IP"); // the broker is no longer published on the LAN: the bridge runs inside the stack

// The broker is not encrypted: its passwords would cross the LAN in clear text. Opening it is allowed, on purpose.
const mqttBind = get("MQTT_BIND");
if (mqttBind && !["127.0.0.1", "localhost", "::1"].includes(mqttBind) && get("MQTT_ALLOW_LAN") !== "1") {
  console.error(`MQTT_BIND=${mqttBind} would serve the broker, unencrypted, on your network. If that is what you want (Home Assistant on another machine), add MQTT_ALLOW_LAN=1 to .env; otherwise remove MQTT_BIND.`);
  process.exit(1);
}

if (get("ALLOW_NO_AUTH") === "1")
  console.warn("WARNING: ALLOW_NO_AUTH=1 is in .env. `npm run dev` then serves the controls with no login (only to this computer; `npm run dev:lan` would open it to your whole network). The installed app ignores it.");

const net = detect();
if (net) {
  const was = get("WFRAC_SUBNET");
  if (was && was !== net.cidr) console.log(`WFRAC_SUBNET changed from ${was} to ${net.cidr} (the network now detected). Edit .env if you want ${was}.`);
  set("WFRAC_SUBNET", net.cidr);
  console.log(`Network: ${net.iface} ${net.ip}, scanning ${net.cidr} for adapters${net.ssid ? `, Wi-Fi "${net.ssid}"` : ""}.`);
} else {
  console.log("Couldn't detect the network. Set WFRAC_SUBNET (for example 192.168.1.0/24) in .env.");
}

// Phones: the page is served over plain HTTP, so on the LAN the password crosses your Wi-Fi unencrypted. That is the owner's choice,
// asked once (the answer is kept as APP_BIND); `tailscale serve` is the encrypted way (docs/install.md).
if (!backendOnly && !get("APP_BIND")) {
  let lan = args.includes("--lan");
  if (!lan && !args.includes("--local") && process.stdin.isTTY && process.stdout.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const a = (await rl.question("Use it from your phone on this Wi-Fi? Serves the page on your network over plain HTTP (the password isn't encrypted). [y/N] ")).trim();
    rl.close();
    lan = /^y/i.test(a);
  }
  set("APP_BIND", lan ? "0.0.0.0" : "127.0.0.1");
}

fs.writeFileSync(file, lines.join("\n").replace(/\n*$/, "\n"), { mode: 0o600 }); // private from the first byte, not after
fs.chmodSync(file, 0o600); // (an existing file keeps its old mode otherwise)
console.log(".env written.");
if (passwordWasNew) console.log(`Password: ${get("APP_PASSWORD")}   (kept in .env)`); // before the build, which can fail
if (args.includes("--no-start")) process.exit(0);

// Docker, or Podman where Docker isn't installed.
const works = (cmd: string) => spawnSync(cmd, ["compose", "version"], { stdio: "ignore" }).status === 0;
const runtime = ["docker", "podman"].find(works);
if (!runtime) {
  console.error("Neither `docker compose` nor `podman compose` works here. Install Docker, then run this again.");
  process.exit(1);
}
const services = backendOnly ? ["mosquitto", "bridge"] : [];
let pull = args.includes("--pull");
if (pull && spawnSync(runtime, ["compose", "pull", ...services], { stdio: "inherit" }).status !== 0) {
  console.warn("Couldn't pull the published images (not released yet, or the packages are private). Building them from source instead.");
  pull = false;
}
const up = spawnSync(runtime, ["compose", "up", "-d", pull ? "--no-build" : "--build", ...services], { stdio: "inherit" });
if (up.status !== 0) process.exit(up.status ?? 1);

if (backendOnly) console.log("\nBackend is up. Start the web app with: npm run dev   (http://localhost:3000)");
else {
  console.log("\nRunning: http://localhost:3000");
  if (get("APP_BIND") === "0.0.0.0") {
    console.log(net ? `On your phone (same Wi-Fi): http://${net.ip}:3000   (add it to the home screen to install it)` : "On your phone: http://<this computer's IP>:3000");
    console.log("It is plain HTTP: anyone on this Wi-Fi can see the password as you sign in. For HTTPS from anywhere, see docs/install.md (Tailscale).");
  } else console.log("Phone: run `npm run setup -- --lan` to serve it on your Wi-Fi, or see docs/install.md for HTTPS.");
}
console.log("Login password: APP_PASSWORD in .env");
console.log("The bridge finds your units by MAC; a new unit is added from the page (\"Add a unit\").");
