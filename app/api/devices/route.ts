import { connection } from "next/server";
import { readJson } from "@/lib/body";
import { guard } from "@/lib/auth";
import { addDevice, listDevices } from "@/lib/devices";
import { hub } from "@/lib/hub";

export async function GET() {
  await connection(); // read per request, never prerendered
  return Response.json(listDevices());
}

// Add a unit: { qr: "<QR text or MAC>", name }. The bridge then finds the adapter and pairs with it; progress arrives on the event stream.
export async function POST(req: Request) {
  const denied = await guard(req);
  if (denied) return denied;
  const body = await readJson(req);
  const r = addDevice({ name: body?.name, qr: body?.qr });
  if (!r.ok) return Response.json({ error: r.error }, { status: 400 });
  hub().publishDevices();
  return Response.json({ id: r.device.id, name: r.device.name }, { status: 201 });
}
