import { check } from "./check";

// What the page's probe of an authenticated JSON endpoint says about its session.
// "login": the App itself refused (401). "reauth": something in front of the App (Cloudflare Access) answered with a redirect or a
// page that isn't JSON; a native event stream cannot be made to get a 401 there, so the page must navigate to sign in again.
// "ok": anything else, including a 5xx while the backend restarts: keep reconnecting.
export function probeVerdict(r: { type: string; status: number; ok: boolean; headers: { get(name: string): string | null } }): "login" | "reauth" | "ok" {
  if (r.status === 401) return "login";
  // fetched with redirect: "manual", so a sign-in redirect is never followed: browsers give an opaque redirect, Node the 3xx itself
  if (r.type === "opaqueredirect" || (r.status >= 300 && r.status < 400)) return "reauth";
  if (r.ok && !/json/i.test(r.headers.get("content-type") ?? "")) return "reauth";
  return "ok";
}

// Self-check: `npx tsx lib/reauth.ts`
if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("lib/reauth.ts")) {
  const res = (type: string, status: number, ct?: string) => ({
    type,
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(ct ? { "content-type": ct } : {}),
  });
  check(probeVerdict(res("basic", 200, "application/json")) === "ok", "valid session stays ok");
  check(probeVerdict(res("basic", 401)) === "login", "401 goes to the App's login");
  check(probeVerdict(res("opaqueredirect", 0)) === "reauth", "sign-in redirect re-authenticates");
  check(probeVerdict(res("basic", 200, "text/html; charset=utf-8")) === "reauth", "sign-in page re-authenticates");
  check(probeVerdict(res("basic", 502)) === "ok", "backend restarting keeps retrying");
  check(probeVerdict(res("basic", 302)) === "reauth", "a 3xx (Node, redirect: manual) re-authenticates");
  console.log("reauth.ts checks done");
}
