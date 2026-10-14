import { connection } from "next/server";
import { hub } from "@/lib/hub";

// For container healthchecks and uptime monitors: open to anyone, says nothing but whether the app can reach its broker.
export async function GET() {
  await connection();
  const mqtt = hub().client.connected;
  return Response.json({ ok: mqtt, mqtt }, { status: mqtt ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
