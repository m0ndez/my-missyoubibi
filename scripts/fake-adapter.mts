// Dev/test only: a fake WF-RAC adapter on 127.0.0.1:51443 (plain HTTP), enough for the bridge to find, pair and poll it.
//   npm run fake -- <12-digit MAC>
// FAKE_BIND=0.0.0.0 listens on the LAN too (so a container can find it); default 127.0.0.1.
// FAKE_AP=1 makes it look like an adapter in setup mode (for scripts/provision.mts).
// Unpaired until it receives updateAccountInfo; then answers states and applies power and setpoint writes.
import http from "node:http";
import { crc16 } from "../lib/wfrac";

const bind = process.env.FAKE_BIND ?? "127.0.0.1";
const mac = (process.argv[2] ?? "").toLowerCase();
if (!/^[0-9a-f]{12}$/.test(mac)) { console.error("usage: npm run fake -- <12-digit MAC>"); process.exit(1); }
// A real getAirconStat blob captured from a unit (off, cool 24, fan auto); the receive block is patched per state.
const REAL = "AAfrj7D/AAAAAAAQDwAAAAAAAf////+BXoAESAcwuQAAiAAAAAUAAAAAAAOAILr/gBDs/5QQFQDgfg==";
let paired = false;
let power = false;
let temp = 24;

const HUMIDITY = 54; // what the fake's "sensor" reads, in percent

// `answer`: one operation-data segment to append to the RECEIVE block, as the real units do when a code is requested.
// The reply's checksum, as a real unit sends it (the bridge refuses a reply without it): CRC16 over [receive start - 2, end - 4).
const seal = (b: Buffer) => {
  const c = crc16(b.subarray(b[18] * 4 + 19, b.length - 4));
  b[b.length - 2] = c & 0xff;
  b[b.length - 1] = c >> 8;
  return b.toString("base64");
};

function stat(answer?: number[]): string {
  const d = Buffer.from(REAL, "base64");
  const rx = d[18] * 4 + 21;
  d[rx + 2] = (d[rx + 2] & ~0x03) | (power ? 1 : 0);
  d[rx + 4] = temp * 2;
  if (!answer) return seal(d);
  const count = d[rx + 18];
  return seal(Buffer.concat([d.subarray(0, rx + 18), Buffer.from([count + 1]), d.subarray(rx + 19, rx + 19 + count * 4), Buffer.from(answer), Buffer.from([0, 0, 0, 0])]));
}

http.createServer((req, res) => {
  let text = "";
  req.on("data", (c) => (text += c));
  req.on("end", () => {
    const cmd = req.url?.split("/").pop();
    const body = (() => { try { return JSON.parse(text); } catch { return {}; } })();
    let out: object = { result: 0, contents: {} };
    if (cmd === "getDeviceInfo") out = { result: 0, contents: { airconId: mac, macAddress: mac, apMode: process.env.FAKE_AP === "1" ? 1 : 0 } };
    else if (cmd === "setNetworkInfo") { console.log("setNetworkInfo ssid:", body.contents?.ssid, "(password not logged)"); out = { result: 0, contents: {} }; }
    else if (cmd === "updateAccountInfo") { paired = true; out = { result: 0, contents: { airconId: mac } }; }
    else if (cmd === "deleteAccountInfo") { paired = false; out = { result: 0, contents: {} }; }
    else if (cmd === "getAirconStat" || cmd === "setAirconStat") {
      if (!paired) out = { result: 11, contents: {} };
      else {
        if (cmd === "setAirconStat") {
          const b = Buffer.from(body.contents?.airconStat ?? "", "base64");
          if (b.length > 4) {
            if (b[2] & 0x02) power = (b[2] & 0x01) === 1;
            if (b[4] & 0x80) temp = (b[4] & 0x7f) / 2;
          }
        }
        // A request for operation-data code 0xAD (a 1-segment command block): answer with the humidity, `ad 10 <percent> ff`.
        const asked = cmd === "setAirconStat" && Buffer.from(body.contents?.airconStat ?? "", "base64");
        const answer = asked && asked.length > 19 && asked[18] === 1 && asked[19] === 0xad ? [0xad, 0x10, HUMIDITY, 0xff] : undefined;
        out = { result: 0, contents: { airconId: mac, airconStat: stat(answer) } };
      }
    }
    console.log(new Date().toISOString().slice(11, 19), cmd, "->", paired ? "paired" : "unpaired", `power=${power} temp=${temp}`);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(out));
  });
}).listen(51443, bind, () => console.log(`fake adapter ${mac} on ${bind}:51443`));
