// Wi-Fi setup for a brand-new WF-RAC adapter that is still in its own setup network (Smart-M-Air-XXXX).
//   1. Join that network from this computer (key: the KEY in the adapter's QR code, RAC2WLAN on the ones seen so far).
//   2. npm run provision                       dry run: shows what it would send
//      npm run provision -- --send             sends your home Wi-Fi name and password to the adapter
//   3. Join your home Wi-Fi again, then add the unit in the app with the QR's MAC.
// The adapter's address is this computer's default gateway while joined to its setup network, else 192.168.10.1 (override: --ip <address>).
// WIFI_SSID / WIFI_PASSWORD in the environment skip the prompts. --yes skips the confirmation, --force sends to an adapter that
// doesn't report setup mode. Join the 2.4 GHz network: the adapter can't use 5 GHz.
// Only tested against scripts/fake-adapter.mts (FAKE_AP=1), not a real adapter in setup mode: the protocol notes only list
// `setNetworkInfo { ssid, netPass }`. The Smart M-Air app is the route confirmed to work.
import { execFile } from "node:child_process";
import readline from "node:readline";
import { adapterCandidates } from "../lib/discover";
import { defaultRoute, interfaces } from "./netinfo.mts";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => args[args.indexOf(`--${n}`) + 1];
// Provisioning never needs the bridge's identity: any id does for getDeviceInfo, and this tool sends to adapters it has not verified.
const operatorId = "provision";

type Answer = { result: number; contents: Record<string, unknown>; via: "http" | "https" };
// `only` pins the protocol (used for the Wi-Fi password: no second attempt over another one); otherwise http first, then https.
function post(ip: string, command: string, contents?: object, secs = 12, only?: "http" | "https"): Promise<Answer | null> {
  const body = JSON.stringify({ apiVer: "1.0", command, deviceId: "home-ac-app", operatorId, timestamp: Math.floor(Date.now() / 1000), ...(contents && { contents }) });
  // The body goes in on stdin, not in curl's arguments: it holds the Wi-Fi password, and arguments show up in `ps`.
  const tryProto = (proto: "http" | "https") =>
    new Promise<Answer | null>((resolve) => {
      const child = execFile("curl", ["-sk", "-m", String(secs), "-X", "POST", "-H", "Content-Type: application/json", "-d", "@-", `${proto}://${ip}:51443/beaver/command/${command}`],
        (err, out) => { try { resolve(err ? null : { ...JSON.parse(out), via: proto }); } catch { resolve(null); } });
      child.stdin?.end(body);
    });
  return only ? tryProto(only) : tryProto("http").then((r) => r ?? tryProto("https"));
}

function ask(question: string, hidden = false): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise((resolve) => {
    if (hidden) (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => {}; // do not echo the password
    process.stdout.write(question);
    rl.question("", (a) => { rl.close(); if (hidden) process.stdout.write("\n"); resolve(a); });
  });
}

// Where are we, and where could the adapter be? Every network interface counts: the default route can be Ethernet while Wi-Fi is
// the adapter's setup network. On macOS the Wi-Fi name is often hidden from programs, so a missing name is not an error.
const nets = interfaces();
console.log(nets.length ? `This computer: ${nets.map((n) => `${n.name} ${n.address}${n.ssid ? ` (Wi-Fi "${n.ssid}")` : ""}`).join(", ")}.` : "No network connection found on this computer.");
const onSetup = nets.find((n) => /^smart-m-air/i.test(n.ssid ?? ""));
if (!onSetup && nets.some((n) => n.ssid))
  console.warn('Not joined to a "Smart-M-Air-XXXX" network yet. Join it first (its key is on the unit\'s label and in its QR code), then run this again.');
const candidates: string[] = opt("ip")
  ? [opt("ip")!]
  : adapterCandidates(onSetup ? [onSetup, ...nets.filter((n) => n !== onSetup)] : nets, onSetup ? null : defaultRoute().gateway);
console.log(`Looking for the adapter at ${candidates.join(", ")}…`);
const answers = await Promise.all(candidates.map((c) => post(c, "getDeviceInfo", undefined, 3)));
const isAdapter = (r: (typeof answers)[number]) => /^[0-9a-f]{12}$/i.test(String(r?.contents?.airconId ?? ""));
const hit = answers.findIndex(isAdapter);
const ip = candidates[Math.max(hit, 0)];
const info = hit >= 0 ? answers[hit] : null;
const mac = String(info?.contents?.airconId ?? "");
if (!info || !/^[0-9a-f]{12}$/i.test(mac)) {
  console.error("Nothing that looks like a WF-RAC adapter answered. Join the unit's Smart-M-Air-XXXX network, or pass its address with --ip <address>.");
  process.exit(1);
}
console.log(`Adapter ${mac}, apMode ${JSON.stringify(info.contents.apMode)}.`);
if (!info.contents.apMode && !flag("force")) {
  console.error("This adapter is already on a Wi-Fi network (not in setup mode). Reset its Wi-Fi from Smart M-Air first. Nothing was sent.");
  process.exit(1);
}

const ssid = process.env.WIFI_SSID ?? (await ask("Home Wi-Fi name (the 2.4 GHz one: the adapter can't use 5 GHz): "));
const netPass = process.env.WIFI_PASSWORD ?? (await ask("Home Wi-Fi password (not shown): ", true));
if (!ssid || !netPass) { console.error("Both the Wi-Fi name and the password are needed."); process.exit(1); }
// Same limits the router has: a name is at most 32 bytes, a WPA2 password 8 to 63 characters (open networks aren't supported here).
if (Buffer.byteLength(ssid) > 32) { console.error("A Wi-Fi name is at most 32 bytes. Nothing was sent."); process.exit(1); }
if (netPass.length < 8 || netPass.length > 63) { console.error("A WPA2 password is 8 to 63 characters (open networks aren't supported here). Nothing was sent."); process.exit(1); }

if (!flag("send")) {
  console.log(`\nDry run. Would send setNetworkInfo { ssid: ${JSON.stringify(ssid)}, netPass: ${"*".repeat(netPass.length)} } to ${ip}.`);
  console.log("Run again with --send to apply. The adapter will then leave its setup network and join yours.");
  process.exit(0);
}
if (!flag("yes") && (await ask(`Type the last 4 characters of the MAC (${mac.slice(-4)}) to send: `)).trim().toLowerCase() !== mac.slice(-4).toLowerCase()) {
  console.error("Not confirmed. Nothing was sent.");
  process.exit(1);
}
const r = await post(ip, "setNetworkInfo", { ssid, netPass }, 12, info.via); // the protocol the adapter answered on, once
console.log(r ? `Adapter answered result ${r.result}.` : "No answer (normal if it already left the setup network).");
console.log(`Now join your home Wi-Fi again and add the unit in the app with the MAC ${mac}. The adapter needs about a minute to join.`);
