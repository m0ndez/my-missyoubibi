import { parsePatch } from "@/lib/ac";
import { readJson } from "@/lib/body";
import { isDevice } from "@/lib/devices";
import { guard } from "@/lib/auth";
import { hub, isOffline } from "@/lib/hub";

export async function POST(req: Request) {
  const denied = await guard(req);
  if (denied) return denied;
  const body = await readJson(req);
  const patch = parsePatch(body?.patch);
  if (!patch || !isDevice(body?.id)) {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  const { client } = hub();
  if (!client.connected) return Response.json({ error: "unavailable" }, { status: 503 }); // mqtt.js would queue it and replay it later
  // Refused, not queued: a stale "turn on" arriving when the unit returns is worse than none.
  if (isOffline(body.id)) return Response.json({ error: "That unit is offline, so nothing was sent. Try again once it is back." }, { status: 409 });
  client.publish(`mhi/${body.id}/set`, JSON.stringify(patch));
  return Response.json({ ok: true });
}
