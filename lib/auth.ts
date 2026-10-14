import fs from "node:fs";
import path from "node:path";
import { check } from "./check";
import { weakPassword } from "./password";

// Single shared password -> HMAC-signed expiring cookie. Web Crypto only, so it runs in proxy.ts too.
const enc = new TextEncoder();
export const SESSION_DAYS = 14;

async function mac(msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(process.env.AUTH_SECRET ?? ""),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg + "|" + (process.env.APP_PASSWORD ?? ""))); // password in MAC: changing it revokes sessions
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Token = issued-at.expiry.MAC. "Sign out" revokes every session issued up to now (one household, one password), by
// writing a timestamp that verifySession compares each token's issued-at against.
const revokedFile = () => path.join(process.env.DATA_DIR ?? "data", "session-revoked-before");
function revokedBefore(): number {
  try {
    return Number(fs.readFileSync(revokedFile(), "utf8")) || 0;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return 0; // never signed out
    console.error("session-revoked-before is unreadable: refusing every session until it is fixed:", (e as Error).message);
    return Number.POSITIVE_INFINITY; // fail closed: a damaged marker must not bring signed-out sessions back
  }
}
export function revokeSessions() {
  fs.mkdirSync(path.dirname(revokedFile()), { recursive: true });
  const tmp = `${revokedFile()}.tmp`;
  fs.writeFileSync(tmp, String(Date.now()));
  fs.renameSync(tmp, revokedFile()); // atomic: a crash mid-write can't leave a half-written marker
}

export async function signSession(): Promise<string> {
  const iat = Date.now();
  const body = `${iat}.${iat + SESSION_DAYS * 86_400_000}`;
  return `${body}.${await mac(body)}`;
}

export async function verifySession(token: string | undefined): Promise<boolean> {
  const [iat, exp, sig] = token?.split(".") ?? [];
  if (!iat || !exp || !sig || Number(exp) < Date.now() || Number(iat) <= revokedBefore()) return false;
  return safeEqual(sig, await mac(`${iat}.${exp}`));
}

// Which Host headers this server answers to. A browser sends the address it used, so a page a stranger controls can't reach the
// app by a name that later resolves to your LAN address (DNS rebinding) unless that name is on this list: loopback, private and
// Tailscale addresses, bare and `.local`/`.lan`/`.home.arpa`/`.ts.net` names, plus ALLOWED_HOSTS (comma separated; `*.example.com`).
export function hostAllowed(header: string | null, extra = process.env.ALLOWED_HOSTS ?? ""): boolean {
  if (!header) return false;
  const host = (header.startsWith("[") ? header.slice(0, header.indexOf("]") + 1) : header.replace(/:\d+$/, "")).toLowerCase();
  if (host.startsWith("[")) return /^\[(::1|f[cd][0-9a-f:]*|fe80[0-9a-f:]*)\]$/.test(host);
  const v4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  if (!host.includes(".") || /\.(local|lan|home\.arpa|ts\.net)$/.test(host)) return true;
  return extra.split(",").some((e) => {
    const x = e.trim().toLowerCase();
    return x !== "" && (x.startsWith("*.") ? host.endsWith(x.slice(1)) : host === x);
  });
}

// Redirects must go to the address the browser used (Host / X-Forwarded-*), not the one the server listens on: in a
// container that is 0.0.0.0, which no other device can open. A forwarded host is believed only if it passes hostAllowed too.
export function publicUrl(req: Request, path: string): URL {
  const forwarded = req.headers.get("x-forwarded-host");
  const host = forwarded && hostAllowed(forwarded) ? forwarded : req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.slice(0, -1);
  return new URL(path, host ? `${proto}://${host}` : req.url);
}

// CSRF guard for cookie-authenticated mutations. Browsers always send Sec-Fetch-Site (and Origin on POST/DELETE);
// a request with neither is not a browser page, so it is refused.
export function sameOrigin(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false; // "Origin: null"
  }
}

// Why the server must not start as configured, or null. Checked once at start-up (instrumentation.ts), so a bad configuration
// fails loudly in the logs instead of serving a weak login. ALLOW_NO_AUTH=1 (the dev server on a trusted machine) skips it,
// and is ignored by a production build.
export function configProblem(env: Record<string, string | undefined> = process.env): string | null {
  if (env.ALLOW_NO_AUTH === "1" && env.NODE_ENV !== "production") return null;
  if (!env.APP_PASSWORD || !env.AUTH_SECRET) return "APP_PASSWORD and AUTH_SECRET are not set. Run `npm run setup`.";
  const weak = weakPassword(env.APP_PASSWORD);
  if (weak) return `APP_PASSWORD is too weak (${weak}). Run \`npm run setup\`, which replaces it with a strong one.`;
  if (env.AUTH_SECRET.length < 32) return "AUTH_SECRET is shorter than 32 characters. Run `npm run setup`.";
  return null;
}

// What anyone but the operator sees when the login configuration is unusable: no detail (it would tell a stranger what is weak).
// The reason goes to the server log, once.
let logged = false;
export function misconfigured(problem: string): Response {
  if (!logged) {
    logged = true;
    console.error(`auth: ${problem}`);
  }
  return new Response("This server is not set up correctly. The operator can see why in the server log.", { status: 500 });
}

// Every mutating route calls this itself: proxy.ts is a first gate, not an authorization layer.
export async function guard(req: Request): Promise<Response | null> {
  if (!sameOrigin(req)) return Response.json({ error: "forbidden" }, { status: 403 });
  const problem = configProblem();
  if (problem) return misconfigured(problem);
  if (!process.env.APP_PASSWORD || !process.env.AUTH_SECRET) return null; // ALLOW_NO_AUTH=1: configProblem allowed it
  const token = /(?:^|;\s*)session=([^;]+)/.exec(req.headers.get("cookie") ?? "")?.[1];
  return (await verifySession(token)) ? null : new Response(null, { status: 401 });
}

// Self-check: `npx tsx lib/auth.ts`
if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("lib/auth.ts")) {
  void (async () => {
  const req = (h: Record<string, string>) => new Request("http://app.local/api/set", { method: "POST", headers: { host: "app.local", ...h } });
  check(publicUrl(new Request("http://0.0.0.0:3000/api/login", { headers: { host: "192.168.1.5:3000" } }), "/login").href === "http://192.168.1.5:3000/login", "redirects use the Host the browser used");
  check(publicUrl(new Request("http://0.0.0.0:3000/x", { headers: { host: "a.ts.net", "x-forwarded-proto": "https", "x-forwarded-host": "a.ts.net" } }), "/").href === "https://a.ts.net/", "behind a TLS proxy");
  check(publicUrl(new Request("http://0.0.0.0:3000/x", { headers: { host: "192.168.1.5:3000", "x-forwarded-host": "evil.example.com" } }), "/").href === "http://192.168.1.5:3000/", "an unlisted forwarded host is not believed");
  const hosts: [string, boolean][] = [["localhost:3000", true], ["127.0.0.1", true], ["[::1]:3000", true], ["192.168.1.134:3000", true], ["172.20.0.5", true], ["172.32.0.1", false], ["100.101.2.3", true],
    ["8.8.8.8", false], ["bibi:3000", true], ["mac.local", true], ["house.ts.net", true], ["evil.example.com", false], ["192.168.1.1.evil.com", false], ["[2001:db8::1]", false]];
  for (const [h, want] of hosts) check(hostAllowed(h, "") === want, `host ${h} -> ${want}`);
  check(hostAllowed("ac.example.com", "ac.example.com") && hostAllowed("a.example.org", "*.example.org") && !hostAllowed("example.org", "*.example.org"), "ALLOWED_HOSTS");
  check(!hostAllowed(null), "no Host refused");
  check(sameOrigin(req({ origin: "http://app.local" })), "same origin ok");
  check(sameOrigin(req({ "sec-fetch-site": "same-origin" })), "fetch metadata ok");
  check(!sameOrigin(req({ origin: "http://evil.example" })), "other origin refused");
  check(!sameOrigin(req({ origin: "null" })), "Origin: null refused, not a 500");
  check(!sameOrigin(req({})), "no Origin and no fetch metadata refused");
  check(!sameOrigin(req({ "sec-fetch-site": "cross-site", origin: "http://app.local" })), "cross-site refused");
  const ok = { APP_PASSWORD: "kQ3v-9xTm2Lw", AUTH_SECRET: "x".repeat(32) };
  check(configProblem(ok) === null && configProblem({ ...ok, APP_PASSWORD: "admin" })?.includes("too weak") === true, "weak password refused at start-up");
  check(configProblem({ ...ok, AUTH_SECRET: "short" }) !== null && configProblem({}) !== null && configProblem({ ALLOW_NO_AUTH: "1" }) === null && configProblem({ ALLOW_NO_AUTH: "1", NODE_ENV: "production" }) !== null, "missing or short secrets refused; dev opt-out honoured, but not in production");
  process.env.AUTH_SECRET = ok.AUTH_SECRET; process.env.APP_PASSWORD = ok.APP_PASSWORD;
  process.env.DATA_DIR = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "auth-check-"));
  const good = await signSession();
  check((await guard(req({ origin: "http://app.local", cookie: `a=b; session=${good}` }))) === null, "valid session passes");
  check((await guard(req({ origin: "http://app.local" })))?.status === 401, "no cookie -> 401");
  check((await guard(req({ origin: "http://app.local", cookie: `session=${good}x` })))?.status === 401, "bad signature -> 401");
  process.env.APP_PASSWORD = "admin";
  check((await guard(req({ origin: "http://app.local", cookie: `session=${good}` })))?.status === 500, "a weak password fails closed, even with a valid session");
  process.env.APP_PASSWORD = ok.APP_PASSWORD;
  check((await guard(req({ origin: "http://evil.example", cookie: `session=${good}` })))?.status === 403, "cross origin -> 403");
  await new Promise((r) => setTimeout(r, 5));
  revokeSessions();
  check((await guard(req({ origin: "http://app.local", cookie: `session=${good}` })))?.status === 401, "signed-out session -> 401");
  await new Promise((r) => setTimeout(r, 5));
  check((await guard(req({ origin: "http://app.local", cookie: `session=${await signSession()}` }))) === null, "a new login after sign-out works");
  console.log("auth.ts checks done");
  })();
}
