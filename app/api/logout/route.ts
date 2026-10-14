import { NextResponse } from "next/server";
import { guard, publicUrl, revokeSessions } from "@/lib/auth";

// Signs out every device: tokens issued before now stop working.
export async function POST(req: Request) {
  const denied = await guard(req);
  if (denied) return denied;
  revokeSessions();
  const res = NextResponse.redirect(publicUrl(req, "/login"), 303);
  res.cookies.delete("session");
  return res;
}
