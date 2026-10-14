// What the network this machine is on looks like. Used by `npm run setup` (the bridge's scan range) and `npm run provision`
// (default Wi-Fi name). Runs under plain Node 24 (no tsx), so keep it free of dependencies.
import { execFileSync } from "node:child_process";
import os from "node:os";

export type Net = {
  iface: string;
  ip: string;
  cidr: string; // the subnet to scan, never wider than a /24
  gateway: string | null;
  ssid: string | null; // null when it can't be read (macOS hides it without Location permission)
};

const run = (cmd: string, args: string[]) => {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000 });
  } catch {
    return "";
  }
};

const toInt = (ip: string) => ip.split(".").reduce((n, o) => n * 256 + Number(o), 0);
const toIp = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");

// The interface the default route leaves by: that is the network the units are on, whatever else (VPN, Docker) is up.
function defaultRoute(): { iface: string | null; gateway: string | null } {
  if (process.platform === "darwin") {
    const out = run("route", ["-n", "get", "default"]);
    return { iface: /interface:\s*(\S+)/.exec(out)?.[1] ?? null, gateway: /gateway:\s*([\d.]+)/.exec(out)?.[1] ?? null };
  }
  const out = run("ip", ["route", "show", "default"]);
  return { iface: /dev (\S+)/.exec(out)?.[1] ?? null, gateway: /via ([\d.]+)/.exec(out)?.[1] ?? null };
}

function wifiName(iface: string): string | null {
  const clean = (s: string | undefined) => (s && !/redacted|not associated/i.test(s) ? s.trim() || null : null);
  if (process.platform === "darwin") return clean(/Network:\s*(.+)/.exec(run("networksetup", ["-getairportnetwork", iface]))?.[1]);
  if (process.platform === "win32") {
    const block = run("netsh", ["wlan", "show", "interfaces"]).split(/\r?\n\s*\r?\n/).find((b) => new RegExp(`^\\s*Name\\s*:\\s*${iface}\\s*$`, "m").test(b));
    return clean(block && /^\s*SSID\s*:\s*(.+)$/m.exec(block)?.[1]);
  }
  return clean(run("iwgetid", [iface, "-r"])) ?? clean(run("nmcli", ["-g", "GENERAL.CONNECTION", "dev", "show", iface]));
}

// Every network this computer is on (not just the default route's), for finding an adapter in setup mode.
export function interfaces(): { name: string; address: string; netmask: string; ssid: string | null }[] {
  return Object.entries(os.networkInterfaces()).flatMap(([name, list]) =>
    (list ?? []).filter((a) => a.family === "IPv4" && !a.internal).map((a) => ({ name, address: a.address, netmask: a.netmask, ssid: wifiName(name) })));
}

export { defaultRoute };

// Interfaces that are not the home LAN: VPN and mesh tunnels, container and VM bridges. A full-tunnel VPN becomes the default route,
// and its address is not where the adapters are.
const VIRTUAL = /^(utun|tun|tap|wg|tailscale|ppp|ipsec|docker|br-|veth|vethernet|podman|virbr|vmnet|vboxnet|lo)/i;
const isPrivate = (ip: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);

export function detect(): Net | null {
  const route = defaultRoute();
  const addrs = os.networkInterfaces();
  const lan = Object.entries(addrs).flatMap(([name, list]) =>
    (list ?? []).filter((i) => i.family === "IPv4" && !i.internal && isPrivate(i.address) && !VIRTUAL.test(name)).map((i) => ({ name, i })));
  // The default route's interface if it is a real LAN one, else the first real LAN interface, else anything with an address.
  const pick = lan.find((x) => x.name === route.iface) ?? lan[0];
  const iface = pick?.name ?? route.iface;
  const gateway = pick && pick.name === route.iface ? route.gateway : null;
  const a = pick?.i ?? Object.values(addrs).flat().find((i) => i && i.family === "IPv4" && !i.internal);
  if (!a) return null;
  const bits = Math.max(24, Number(a.cidr?.split("/")[1] ?? 24));
  const base = toInt(a.address) & ((~0 << (32 - bits)) >>> 0);
  return {
    iface: iface ?? "?",
    ip: a.address,
    cidr: `${toIp(base >>> 0)}/${bits}`,
    gateway,
    ssid: iface ? wifiName(iface) : null,
  };
}
