import { connection } from "next/server";
import { readJson } from "@/lib/body";
import { isDevice } from "@/lib/devices";
import { guard } from "@/lib/auth";
import { dayKey, loadEnergy, parseDays, setDays } from "@/lib/energy";

// kWh per day per unit, plus the optional tariff so the page can show an estimated cost.
export async function GET() {
  await connection(); // read per request: without this the file read can be prerendered at build time
  const rate = Number(process.env.ENERGY_RATE);
  return Response.json({
    days: loadEnergy(),
    today: dayKey(new Date()),
    rate: Number.isFinite(rate) && rate > 0 ? rate : null,
    currency: process.env.ENERGY_CURRENCY ?? "฿",
  });
}

// Backfill past days for one unit: { id, text: "2026-10-01 4.5\n2026-10-02 6" }.
export async function POST(req: Request) {
  const denied = await guard(req);
  if (denied) return denied;
  const body = await readJson(req, 64 * 1024) // a backfill of a few years of daily totals is still small;
  if (
    !isDevice(body?.id) ||
    typeof body?.text !== "string"
  ) {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  const parsed = parseDays(body.text);
  if ("error" in parsed)
    return Response.json({ error: parsed.error }, { status: 400 });
  // Replacing a day that already holds data needs a second, explicit request.
  const stored = loadEnergy();
  const replaces = parsed.entries
    .map((e) => ({
      day: e.day,
      old: stored[e.day]?.[body.id] ?? 0,
      kwh: e.kwh,
    }))
    .filter((e) => e.old > 0 && e.old !== e.kwh);
  if (replaces.length > 0 && body.confirm !== true)
    return Response.json({ error: "replaces", replaces }, { status: 409 });
  setDays(body.id, parsed.entries);
  return Response.json({ saved: parsed.entries.length });
}
