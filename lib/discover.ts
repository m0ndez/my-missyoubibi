import { check } from "./check";

// Finding an adapter on the LAN by its MAC. Pure helpers; the bridge does the network I/O.
const toInt = (ip: string) => ip.split(".").reduce((n, o) => n * 256 + Number(o), 0);
const toIp = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");

// Every host address on the interface's subnet except its own, at most a /24 around it (254 probes).
export function subnetHosts(address: string, netmask: string): string[] {
  const me = toInt(address);
  let mask = toInt(netmask);
  if (mask < toInt("255.255.255.0")) mask = toInt("255.255.255.0"); // a /16 would mean 65k probes: only scan our own /24
  const net = (me & mask) >>> 0;
  const bcast = (net | (~mask >>> 0)) >>> 0;
  const out: string[] = [];
  for (let n = net + 1; n < bcast; n++) if (n !== me) out.push(toIp(n >>> 0));
  return out;
}

// Where a brand-new adapter (in setup mode) can be, seen from this computer: it is the DHCP server of its own little network, so
// it is our gateway, or the first address of the subnet we were given. Every interface is considered (the default route can be
// Ethernet while Wi-Fi is the adapter's network). 192.168.10.1 is the setup address seen once on a real adapter.
export function adapterCandidates(ifaces: { address: string; netmask: string }[], gateway?: string | null): string[] {
  const firsts = ifaces.map(({ address, netmask }) => {
    const mask = toInt(netmask) >>> 0;
    if (mask > toInt("255.255.255.252")) return null; // a /31 or /32 (VPN tunnel): no neighbours to find
    const first = (((toInt(address) & mask) >>> 0) + 1) >>> 0;
    return first === toInt(address) ? null : toIp(first); // we are .1 ourselves: not an adapter
  });
  return [...new Set([gateway, ...firsts, "192.168.10.1"].filter((x): x is string => !!x))];
}

// A subnet written "192.168.1.0/24" (several, comma separated): the scan range when the bridge runs in a container,
// where its own interfaces are Docker's, not the LAN's. Bad entries are ignored.
export function cidrHosts(list: string): string[] {
  return list.split(",").flatMap((c) => {
    const [addr, bits] = c.trim().split("/");
    const b = Number(bits);
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(addr ?? "") || !Number.isInteger(b) || b < 0 || b > 30) return [];
    return subnetHosts(addr, toIp(b === 0 ? 0 : (~0 << (32 - b)) >>> 0));
  });
}

// The bridge's answer to a network scan (retained on mhi/_found): every adapter that answered, and whether it is still looking.
// `problem: "lan"`: nothing answered and every unit we poll is offline too, so the bridge itself can't reach the network.
export type Found = { scanning: boolean; units: { mac: string; ip: string }[]; problem?: "lan" };
export function parseFound(text: string): Found | null {
  try {
    const x = JSON.parse(text) as Found;
    const ok = (u: Found["units"][number]) => u && /^[0-9a-f]{12}$/.test(u.mac) && /^\d+\.\d+\.\d+\.\d+$/.test(u.ip);
    return typeof x?.scanning === "boolean" && Array.isArray(x.units) && x.units.length <= 50 && x.units.every(ok)
      ? { scanning: x.scanning, units: x.units.map(({ mac, ip }) => ({ mac, ip })), ...(x.problem === "lan" && { problem: "lan" as const }) }
      : null;
  } catch { return null; }
}

export const sameMac = (a: unknown, b: string) => typeof a === "string" && a.replace(/[:-]/g, "").toLowerCase() === b;

// Self-check: `npx tsx lib/discover.ts`
if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("lib/discover.ts")) {
  const h = subnetHosts("192.168.1.50", "255.255.255.0");
  check(h.length === 253 && h[0] === "192.168.1.1" && h.at(-1) === "192.168.1.254" && !h.includes("192.168.1.50"), "/24 without ourselves", h.length);
  check(subnetHosts("10.0.5.9", "255.255.0.0").length === 253 && subnetHosts("10.0.5.9", "255.255.0.0")[0] === "10.0.5.1", "big subnets are cut to our /24");
  const s = subnetHosts("192.168.1.130", "255.255.255.192"); // a /26: only its own 61 other hosts
  check(s.length === 61 && s[0] === "192.168.1.129" && s.at(-1) === "192.168.1.190", "narrow subnets stay narrow", s.length);
  check(sameMac("348E89A1B2C3", "348e89a1b2c3") && sameMac("34:8e:89:a1:b2:c3", "348e89a1b2c3") && !sameMac(undefined, "x"), "mac compare");
  const c = cidrHosts("192.168.1.0/24, 10.0.0.0/30, nonsense, 1.2.3.4/40");
  check(c.length === 254 + 2 && c[0] === "192.168.1.1" && c.includes("10.0.0.1") && c.includes("10.0.0.2"), "cidr list", c.length);
  check(parseFound('{"scanning":false,"units":[{"mac":"348e89a1b2c3","ip":"192.168.1.50","x":1}]}')?.units[0]?.ip === "192.168.1.50", "found parses");
  check(parseFound('{"scanning":false,"units":[],"problem":"lan"}')?.problem === "lan" && parseFound('{"scanning":false,"units":[],"problem":"x"}')?.problem === undefined, "found problem flag");
  check(parseFound('{"scanning":"no","units":[]}') === null && parseFound('{"scanning":true,"units":[{"mac":"zz","ip":"1.2.3.4"}]}') === null && parseFound("nope") === null, "found rejects junk");
  const cands = adapterCandidates([{ address: "192.168.10.23", netmask: "255.255.255.0" }, { address: "10.0.0.5", netmask: "255.255.0.0" }, { address: "172.16.0.1", netmask: "255.255.255.0" }], "192.168.1.1");
  check(cands.join() === "192.168.1.1,192.168.10.1,10.0.0.1,192.168.10.1".split(",").filter((x, i, a) => a.indexOf(x) === i).join(), "adapter candidates: gateway, each subnet's .1 (not ourselves), setup address, no repeats", cands);
  check(adapterCandidates([{ address: "10.10.10.22", netmask: "255.255.255.255" }], "192.168.1.1").join() === "192.168.1.1,192.168.10.1", "tunnel interfaces are skipped");
  check(adapterCandidates([]).join() === "192.168.10.1", "no interfaces: the setup address alone");
  console.log("discover.ts checks done");
}
