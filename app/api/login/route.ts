import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { SESSION_DAYS, configProblem, misconfigured, publicUrl, signSession } from "@/lib/auth";
import { readForm } from "@/lib/body";

// Wrong guesses are slowed down, never refused to the right password: a neighbour on the LAN who spams wrong guesses can't lock the
// owner out. Each wrong guess waits 1 s, doubling after the third recent one up to 30 s; at most MAX_WAITING guesses wait at once
// (the rest get 429 at once, which costs nothing), so guesses/s is bounded. No per-IP keying: behind a proxy every client is the same.
const wrong: number[] = []; // when recent wrong guesses happened
const WINDOW_MS = 10 * 60_000;
const MAX_WAITING = 20;
let waiting = 0;

const sha = (s: string) => createHash("sha256").update(s).digest();

export async function POST(req: Request) {
  const expected = process.env.APP_PASSWORD;
  const problem = configProblem(); // fail closed: never accept a login against a weak or missing configuration
  if (problem || !expected) return misconfigured(problem ?? "auth not configured");

  const form = await readForm(req);
  if (!form) return new Response(null, { status: 413 });
  const password = String(form.get("password") ?? "");
  if (!timingSafeEqual(sha(password), sha(expected))) {
    if (waiting >= MAX_WAITING) return new Response("too many attempts, try later", { status: 429 });
    const now = Date.now();
    while (wrong.length && wrong[0] < now - WINDOW_MS) wrong.shift();
    const delay = Math.min(30_000, 1000 * 2 ** Math.max(0, wrong.length - 3));
    wrong.push(now);
    waiting++;
    try {
      await new Promise((r) => setTimeout(r, delay));
    } finally {
      waiting--;
    }
    return NextResponse.redirect(publicUrl(req, "/login?e=1"), 303);
  }
  const res = NextResponse.redirect(publicUrl(req, "/"), 303);
  res.cookies.set("session", await signSession(), {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https", // plain http over LAN must still work
    maxAge: SESSION_DAYS * 86_400,
    path: "/",
  });
  return res;
}
