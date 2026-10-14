import { connection } from "next/server";
import { guard } from "@/lib/auth";
import { listDevices } from "@/lib/devices";
import { hub } from "@/lib/hub";

// What the last network scan found, minus the units already added.
export async function GET() {
  await connection();
  const { scanning, units, problem } = hub().found();
  const have = new Set(listDevices().map((d) => d.mac));
  return Response.json({ scanning, problem, units: units.filter((u) => !have.has(u.mac)) });
}

// Ask the bridge to scan the network for adapters (it answers on mhi/_found; poll GET).
export async function POST(req: Request) {
  const denied = await guard(req);
  if (denied) return denied;
  hub().scan();
  return Response.json({ ok: true }, { status: 202 });
}
