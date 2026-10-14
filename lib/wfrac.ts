// WF-RAC adapter codec. Protocol knowledge: see NOTICE (community reference by jeatheak / blues-sechseck, MIT) and docs/firmware.md.
import { check } from "./check";
import { FANS, MODES, TEMP_MAX, TEMP_MIN, type AcControl, type AcState, type Fan, type Mode, type Vane, type VaneLR } from "./ac";

// MHI WF-RAC Wi-Fi adapter, local API (https://<ip>:51443/beaver/command/<name>, POST JSON).
// Byte layout from the community protocol reference in jeatheak/Mitsubishi-WF-RAC-Integration
// (docs/wf-rac-module-reference.md). Power/mode/fan/setpoint read+write verified on real units;
// vane write and the status extras (compressor, outdoor temp, energy, fault) follow the reference.

const MODE_BITS: Record<Mode, number> = { auto: 0x00, dry: 0x04, cool: 0x08, fan: 0x0c };
const FAN_BITS: Record<Fan, number> = { auto: 0x07, "1": 0x00, "2": 0x01, "3": 0x02, "4": 0x06 };

// Outdoor air sensor: raw byte -> tenths of a degree (pywfrac outdoorTempList; non-linear, so a table, not a formula).
const OUTDOOR_TENTHS = [
  -500, -500, -500, -500, -500, -489, -460, -440, -420, -410, -390, -380, -370, -360, -350, -340,
  -330, -320, -310, -300, -290, -285, -280, -270, -260, -255, -250, -240, -235, -230, -225, -220,
  -215, -210, -205, -200, -195, -190, -185, -180, -175, -170, -165, -160, -155, -150, -146, -143,
  -140, -135, -130, -126, -123, -120, -115, -110, -106, -103, -100, -96, -93, -90, -86, -83,
  -80, -76, -73, -70, -66, -63, -60, -56, -53, -50, -46, -43, -40, -37, -35, -32,
  -30, -26, -23, -20, -17, -15, -12, -10, -6, -3, 0, 2, 5, 7, 10, 13,
  16, 20, 22, 25, 27, 30, 32, 35, 37, 40, 42, 45, 47, 50, 52, 55,
  57, 60, 62, 65, 67, 70, 72, 75, 77, 80, 82, 85, 87, 90, 92, 95,
  97, 100, 102, 105, 107, 110, 112, 115, 117, 120, 122, 125, 127, 130, 132, 135,
  137, 140, 142, 144, 146, 148, 150, 152, 155, 157, 160, 162, 165, 167, 170, 172,
  175, 177, 180, 182, 185, 187, 190, 192, 194, 196, 198, 200, 202, 205, 207, 210,
  212, 215, 217, 220, 222, 225, 227, 230, 232, 235, 237, 240, 242, 245, 247, 250,
  252, 255, 257, 260, 262, 265, 267, 270, 272, 275, 277, 280, 282, 285, 287, 290,
  292, 295, 297, 300, 302, 305, 307, 310, 313, 316, 320, 322, 325, 327, 330, 332,
  335, 337, 340, 343, 346, 350, 352, 355, 357, 360, 363, 366, 370, 372, 375, 377,
  380, 383, 386, 390, 393, 396, 400, 403, 406, 410, 413, 416, 420, 423, 426, 430,
];

export function crc16(bytes: Uint8Array): number {
  let c = 0xffff; // CRC16-CCITT, poly 0x1021, no reflection
  for (const b of bytes) {
    c ^= b << 8;
    for (let i = 0; i < 8; i++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
  }
  return c;
}

// The RECEIVE block (what the unit reports) follows the COMMAND block. Its checksum is CRC16 over bytes [start-2, length-4), stored
// little-endian in the last two bytes. The community reference gives no range; this one was found by search and matches every reply
// seen (3 models, HTTP and HTTPS, status and operation-data reads). WFRAC_CRC=0 turns the check off, for a model that proves different.
const start = (d: Buffer) => d[18] * 4 + 21;
export function replyCrcOk(d: Buffer): boolean {
  if (process.env.WFRAC_CRC === "0") return true;
  const at = start(d);
  if (d.length < at + 4) return false;
  return crc16(d.subarray(at - 2, d.length - 4)) === (d[d.length - 2] | (d[d.length - 1] << 8));
}

// airconStat (base64) -> state. A reply that fails its checksum, or whose numbers are implausible, is null ("unusable"), never published.
export function decodeStat(b64: string): AcState | null {
  const d = Buffer.from(b64, "base64");
  if (d.length < 20 || !replyCrcOk(d)) return null;
  const rx = d.subarray(start(d));
  if (rx.length < 19) return null;
  // Heat mode or an unlisted fan step (Hi mode shows fan 3...) decode to null: the state stays usable, no selection is shown.
  const mode = (Object.keys(MODE_BITS) as Mode[]).find((m) => MODE_BITS[m] === (rx[2] & 0x3c)) ?? null;
  const fan = (Object.keys(FAN_BITS) as Fan[]).find((f) => FAN_BITS[f] === (rx[3] & 0x0f)) ?? null;
  // The reply's trailer is `count` 4-byte segments [code, op1, op2, op3] the unit pushes unsolicited.
  let outdoorTemp: number | null = null;
  let energy: number | null = null;
  for (let i = 0; i < rx[18] && 19 + i * 4 + 4 <= rx.length; i++) {
    const [code, op1, op2, op3] = rx.subarray(19 + i * 4, 23 + i * 4);
    if (code === 0x80 && (op1 & 0x30) === 0x10) outdoorTemp = OUTDOOR_TENTHS[op2] / 10;
    if (code === 0x94 && (op1 & 0x30) === 0x10) energy = ((op3 << 8) | op2) * 0.25;
  }
  // Plausibility as well (the CRC is only as good as our reading of the range): setpoint 10..40 (the remote's Home button
  // sets 33), room -20..60.
  const temp = rx[4] / 2;
  const room = rx[5] === 0xff ? null : (rx[5] - 59) / 4;
  if (temp < 10 || temp > 40 || (room !== null && (room < -20 || room > 60))) return null;
  const err = rx[6] & 0x7f;
  // Left/right louver and 3D auto live in state[11..12]. state[12] bit0 = L/R swinging (position then not reported).
  const lrPos = (rx[11] & 0x1f) + 1;
  const lr = (rx[12] & 0x03) === 1 ? "swing" : lrPos <= 7 ? String(lrPos) : undefined; // a position this app doesn't know hides the control
  return {
    power: (rx[2] & 0x03) === 1,
    mode,
    fan,
    temp,
    roomTemp: room,
    vane: (rx[2] & 0xc0) === 0x40 ? "swing" : (String(((rx[3] >> 4) & 3) + 1) as Vane),
    vaneLR: lr as VaneLR | undefined,
    threeD: (rx[12] & 0x0c) === 0x04,
    compressor: (rx[9] & 0x02) !== 0,
    outdoorTemp,
    energy,
    fault: rx[6] & 0x80 ? `M${String(err).padStart(2, "0")}` : err ? `E${err}` : null,
  };
}

const IDLE = [[0xff, 0xff, 0xff, 0xff]]; // "nothing to send" segment
const block = (state: number[], segs: number[][] = IDLE) => {
  const body = [...state, segs.length, ...segs.flat()]; // state + count + variable segments
  const crc = crc16(Uint8Array.from(body));
  return [...body, crc & 0xff, crc >> 8]; // CRC little-endian
};
// A command block with no set-bits changes nothing; only its variable segment (operation-data request/write) acts.
const segmentOnly = (seg: number[]) => {
  const s = new Array<number>(18).fill(0);
  s[5] = 0xff;
  return Buffer.from([...block(s, [seg]), ...block(new Array<number>(18).fill(0))]).toString("base64");
};

// Patch -> airconStat (base64) for setAirconStat. Only fields in the patch carry their "set" bit.
export function encodeCommand(patch: Partial<AcControl>): string {
  const s = new Array<number>(18).fill(0);
  s[5] = 0xff; // keep the unit's own room sensor
  if (patch.power !== undefined) s[2] |= 0x02 | (patch.power ? 0x01 : 0);
  if (patch.mode) s[2] |= 0x20 | MODE_BITS[patch.mode];
  if (patch.fan) s[3] |= 0x08 | FAN_BITS[patch.fan];
  if (patch.vane) {
    s[2] |= patch.vane === "swing" ? 0xc0 : 0x80; // swing on / off (a fixed position stops the swing)
    // DB1's set-bit is needed even for swing: `c0 00` is ignored by the unit (verified on SRK24), `c0 80` works.
    s[3] |= 0x80 | (patch.vane === "swing" ? 0 : (Number(patch.vane) - 1) << 4);
  }
  if (patch.temp !== undefined) {
    if (patch.temp < TEMP_MIN || patch.temp > TEMP_MAX) throw new Error("temp out of range");
    s[4] = Math.round(patch.temp * 2) | 0x80;
  }
  if (patch.vaneLR) {
    // Same pattern as up/down: position set-bit 0x10 in command[11]; command[12] bit1 = swing set-bit, bit0 = swing value.
    s[11] |= 0x10 | (patch.vaneLR === "swing" ? 0 : Number(patch.vaneLR) - 1);
    s[12] |= patch.vaneLR === "swing" ? 0x03 : 0x02;
  }
  if (patch.threeD !== undefined) s[12] |= 0x08 | (patch.threeD ? 0x04 : 0); // bit3 set-bit, bit2 value
  const zero = new Array<number>(18).fill(0); // RECEIVE-shaped block, ignored by the unit
  return Buffer.from([...block(s), ...block(zero)]).toString("base64");
}

// Silent mode is not in the state block: it is operation-data code 0xDD (read) / 0x21 (write), sent as a variable segment.
// Verified on DXK12: the write answers result 11/12 yet applies; only reading 0xDD back tells. Read answer: `dd 80 20 00` = on.
export const encodeSilent = (on: boolean) => segmentOnly([0x21, on ? 1 : 0, 0xff, 0xff]);
// Reading an operation-data code: the answer comes back as a 4-byte segment [code, marker, OP2, OP3] in the RECEIVE block.
// The marker differs by code: 0x80 for silent mode (0xDD), 0x10 for humidity (0xAD), as seen on real units.
export const encodeOpRead = (code: number) => segmentOnly([code, 0xff, 0xff, 0xff]);
export function decodeOp(b64: string, code: number, marker: number): { op2: number; op3: number } | null {
  const d = Buffer.from(b64, "base64");
  if (d.length < 20 || !replyCrcOk(d)) return null;
  const rx = d.subarray(start(d));
  for (let i = 0; i < rx[18] && 19 + i * 4 + 4 <= rx.length; i++) {
    if (rx[19 + i * 4] === code && rx[20 + i * 4] === marker) return { op2: rx[21 + i * 4], op3: rx[22 + i * 4] };
  }
  return null;
}
export const encodeSilentRead = () => encodeOpRead(0xdd);
export const decodeSilent = (b64: string): boolean | null => {
  const r = decodeOp(b64, 0xdd, 0x80);
  return r === null ? null : (r.op2 & 0x20) !== 0;
};

// Relative humidity in percent at the indoor unit's return-air sensor: code 0xAD, answered `ad 10 <percent> ff`. Not every unit has the
// sensor. The community reference says a unit without one answers a constant 30 (0 = broken wire, 0xFF = no value), so those
// read as "no humidity" rather than a number that would mislead. (A real 30 % is hidden too: rare, and indistinguishable.)
export const encodeHumidityRead = () => encodeOpRead(0xad);
export function decodeHumidity(b64: string): number | null {
  const v = decodeOp(b64, 0xad, 0x10)?.op2;
  return v !== undefined && v >= 1 && v <= 100 && v !== 30 ? v : null;
}

// Self-check: `npx tsx lib/wfrac.ts`
if (process.argv[1]?.endsWith("lib/wfrac.ts")) {
  // Real getAirconStat from a unit that was off, Cool, 24.0, fan auto, room ~31.5
  const real =
    "AAfrj7D/AAAAAAAQDwAAAAAAAf////+BXoAESAcwuQAAiAAAAAUAAAAAAAOAILr/gBDs/5QQFQDgfg==";
  const s = decodeStat(real);
  check(
    JSON.stringify(s) ===
      JSON.stringify({ power: false, mode: "cool", fan: "auto", temp: 24, roomTemp: 31.5, vane: "swing", vaneLR: "swing", threeD: true, compressor: false, outdoorTemp: 37, energy: 5.25, fault: null }),
    "decode real blob",
    s,
  );
  const d = Buffer.from(real, "base64");
  check(replyCrcOk(d), "the real reply's checksum verifies");
  // Recompute the reply checksum after a test edits a byte (what a unit would send).
  const seal = (b: Buffer) => { const c = crc16(b.subarray(start(b) - 2, b.length - 4)); b[b.length - 2] = c & 0xff; b[b.length - 1] = c >> 8; return b; };
  const flipped = Buffer.from(d); flipped[start(d) + 4] ^= 0x01;
  check(decodeStat(flipped.toString("base64")) === null, "a reply with a flipped bit is rejected");
  const end = 19 + d[18] * 4;
  check(crc16(d.subarray(0, end)) === (d[end] | (d[end + 1] << 8)), "crc16 matches device");
  const c = Buffer.from(encodeCommand({ temp: 22, power: true }), "base64");
  check(c[4] === 0xac && c[2] === 0x03 && c[5] === 0xff, "command bytes", c.subarray(0, 8));
  check(crc16(c.subarray(0, 23)) === (c[23] | (c[24] << 8)), "command crc");
  const sw = Buffer.from(encodeCommand({ vane: "swing" }), "base64");
  check(sw[2] === 0xc0 && sw[3] === 0x80, "swing on bytes", sw.subarray(0, 6));
  const v3 = Buffer.from(encodeCommand({ vane: "3" }), "base64");
  check(v3[2] === 0x80 && v3[3] === 0xa0, "vane 3 bytes", v3.subarray(0, 6));
  check(crc16(v3.subarray(0, 23)) === (v3[23] | (v3[24] << 8)), "vane crc");
  const lr = Buffer.from(encodeCommand({ vaneLR: "3", threeD: false }), "base64");
  check(lr[11] === 0x12 && lr[12] === 0x0a, "L/R pos 3 + 3D off bytes", lr.subarray(10, 14));
  const lrs = Buffer.from(encodeCommand({ vaneLR: "swing", threeD: true }), "base64");
  check(lrs[11] === 0x10 && lrs[12] === 0x0f, "L/R swing + 3D on bytes", lrs.subarray(10, 14));
  const sil = Buffer.from(encodeSilent(true), "base64");
  check(sil[2] === 0 && sil[18] === 1 && sil[19] === 0x21 && sil[20] === 1, "silent write segment", sil.subarray(18, 24));
  check(crc16(sil.subarray(0, 23)) === (sil[23] | (sil[24] << 8)), "silent crc");
  // reply shaped like the real one: state(18) + count 4 + 3 pushed segments + dd 80 20 00
  const reply = Buffer.from(encodeSilentRead(), "base64"); // reuse a valid command frame, then append a RECEIVE block
  const framed = (rx: number[]) => seal(Buffer.from([...reply.subarray(0, 25), ...rx, 0, 0])).toString("base64"); // command block + RECEIVE block, sealed
  check(decodeSilent(framed([...new Array(18).fill(0), 1, 0xdd, 0x80, 0x20, 0x00])) === true, "silent on decoded");
  check(decodeSilent(Buffer.from([...reply.subarray(0, 25), ...new Array(18).fill(0), 1, 0xdd, 0x80, 0x20, 0x00, 0, 0]).toString("base64")) === null, "an unsealed reply is refused");
  check(decodeSilent(encodeSilentRead()) === null, "no 0xDD answer -> null");
  // humidity: real replies were `ad 10 36 ff` (54 %), `ad 10 46 ff` (70 %), `ad 10 2f ff` (47 %)
  const humReply = (pct: number) => framed([...new Array(18).fill(0), 1, 0xad, 0x10, pct, 0xff]);
  check(decodeHumidity(humReply(0x36)) === 54 && decodeHumidity(humReply(0x46)) === 70 && decodeHumidity(humReply(0x2f)) === 47, "humidity decodes");
  check(decodeHumidity(humReply(30)) === null && decodeHumidity(humReply(0)) === null && decodeHumidity(humReply(0xff)) === null && decodeHumidity(humReply(101)) === null, "sentinels and nonsense are no humidity");
  check(decodeHumidity(encodeHumidityRead()) === null, "no 0xAD answer -> null");
  check(decodeStat("AAAA") === null, "short blob rejected");
  const bad = Buffer.from(real, "base64");
  bad[start(bad) + 4] = 0xfe; // setpoint 127
  check(decodeStat(seal(bad).toString("base64")) === null, "implausible setpoint rejected");
  // Hi mode shows an unlisted fan step; heat mode an unlisted mode: still a usable state, not "offline".
  const odd = Buffer.from(real, "base64");
  const rxAt = start(odd);
  odd[rxAt + 3] = (odd[rxAt + 3] & 0xf0) | 0x03; // fan nibble 3 (not in FAN_BITS)
  odd[rxAt + 2] = (odd[rxAt + 2] & ~0x3c) | 0x10; // heat
  const o = decodeStat(seal(odd).toString("base64"));
  check(o && o.fan === null && o.mode === null && o.temp === 24, "unknown fan/mode keeps the state", o);
  odd[rxAt + 11] = 0x06; odd[rxAt + 12] = 0x00; // L/R position 7 -> "7"; 0x0a -> out of range
  check(decodeStat(seal(odd).toString("base64"))?.vaneLR === "7", "L/R 7 decodes");
  odd[rxAt + 11] = 0x0a;
  check(decodeStat(seal(odd).toString("base64"))?.vaneLR === undefined, "L/R beyond 7 hides the control");
  try { encodeCommand({ temp: 40 }); check(false, "range"); } catch { /* expected */ }
  console.log("wfrac.ts checks done", FANS.length, MODES.length);
}
