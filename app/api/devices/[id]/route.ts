import { guard } from "@/lib/auth";
import { readJson } from "@/lib/body";
import { removeDevice, renameDevice } from "@/lib/devices";
import { hub } from "@/lib/hub";
import { removeTimersFor } from "@/lib/timers";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const denied = await guard(req);
  if (denied) return denied;
  const body = await readJson(req);
  const r = renameDevice((await params).id, body?.name);
  if (!r.ok) return Response.json({ error: r.error }, { status: r.error === "No such unit." ? 404 : 400 });
  hub().publishDevices();
  return Response.json({ id: r.device.id, name: r.device.name });
}

// Remove a unit. Its timers go too; its energy history stays. The bridge frees the adapter's account slot.
export async function DELETE(req: Request, { params }: Ctx) {
  const denied = await guard(req);
  if (denied) return denied;
  const id = (await params).id;
  if (!removeDevice(id)) return Response.json({ error: "No such unit." }, { status: 404 });
  removeTimersFor(id);
  const h = hub();
  h.forget(id);
  h.publishDevices();
  return Response.json({ ok: true });
}
