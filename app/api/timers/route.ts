import { connection } from "next/server";
import { readJson } from "@/lib/body";
import { guard } from "@/lib/auth";
import { MAX_TIMERS, addTimer, loadTimers, removeTimer } from "@/lib/timers";

export async function GET() {
  await connection(); // read per request: without this the file read can be prerendered at build time
  return Response.json(loadTimers());
}

export async function POST(req: Request) {
  const denied = await guard(req);
  if (denied) return denied;
  if (loadTimers().length >= MAX_TIMERS) {
    return Response.json({ error: `You can keep at most ${MAX_TIMERS} timers. Delete one first.` }, { status: 409 });
  }
  const timer = addTimer(await readJson(req));
  return timer ? Response.json(timer) : Response.json({ error: "That timer isn't valid. Check the time, days and settings." }, { status: 400 });
}

export async function DELETE(req: Request) {
  const denied = await guard(req);
  if (denied) return denied;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "bad request" }, { status: 400 });
  removeTimer(id);
  return Response.json({ ok: true });
}
