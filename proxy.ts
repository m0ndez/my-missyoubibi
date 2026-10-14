import { NextResponse, type NextRequest } from "next/server";
import { configProblem, hostAllowed, misconfigured, publicUrl, verifySession } from "@/lib/auth";

// Reachable without a session: the login page and its endpoint, and the health check.
const OPEN = /^\/(?:login|api\/login|api\/health)(?:\/|$)/;

export async function proxy(req: NextRequest) {
  if (!hostAllowed(req.headers.get("host"))) return new NextResponse("Unknown host. Add it to ALLOWED_HOSTS in .env.", { status: 421 });
  if (OPEN.test(req.nextUrl.pathname)) return NextResponse.next();
  // Fail closed. A missing or weak login configuration stops everything (the message is for whoever runs the server); the only
  // way open is an explicit ALLOW_NO_AUTH=1 (local dev on a trusted machine), which configProblem honours.
  const problem = configProblem();
  if (problem) return misconfigured(problem);
  if (!process.env.APP_PASSWORD || !process.env.AUTH_SECRET) return NextResponse.next();
  if (await verifySession(req.cookies.get("session")?.value)) return NextResponse.next();
  return req.nextUrl.pathname.startsWith("/api/")
    ? new NextResponse(null, { status: 401 })
    : NextResponse.redirect(publicUrl(req, "/login"));
}

export const config = {
  matcher: ["/((?!_next/|pwa-icon/|apple-icon|icon\\.svg$|manifest\\.webmanifest$|favicon\\.ico$).*)"],
};
