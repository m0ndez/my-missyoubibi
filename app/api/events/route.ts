import { verifySession } from "@/lib/auth";
import { hub } from "@/lib/hub";
import type { DeviceState } from "@/lib/ac";

// SSE: current state of every device, then live updates. Besides states: {id, setup} (a new unit being brought up) and
// {id, gone: true} (a unit was removed).
const MAX_STREAMS = 20; // one household: a handful of open tabs. More than this is a runaway client.
let streams = 0;

export async function GET(req: Request) {
  if (streams >= MAX_STREAMS) return new Response(null, { status: 503, headers: { "Retry-After": "30" } });
  const token = /(?:^|;\s*)session=([^;]+)/.exec(req.headers.get("cookie") ?? "")?.[1];
  const { states, setups, bus } = hub();
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(c) {
      const sendJson = (o: object) => c.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
      const send = (id: string, s: DeviceState) => sendJson({ id, ...s });
      const setup = (id: string, text: string) => sendJson({ id, setup: text });
      const gone = (id: string) => sendJson({ id, gone: true });
      setups.forEach((t, id) => setup(id, t));
      states.forEach((s, id) => send(id, s));
      bus.on("state", send);
      bus.on("setup", setup);
      bus.on("gone", gone);
      streams++;
      let open = true;
      const end = () => {
        if (!open) return;
        open = false;
        streams--;
        bus.off("state", send);
        bus.off("setup", setup);
        bus.off("gone", gone);
        clearInterval(ping);
        try {
          c.close();
        } catch {
          /* already closed */
        }
      };
      // The session was checked when the stream opened. Check it again with every ping: signing out (every device) or reaching the
      // end of the 14 days must also end a stream that is already open.
      const ping = setInterval(() => {
        c.enqueue(enc.encode(": ping\n\n"));
        void verifySession(token).then((ok) => ok || end());
      }, 25_000);
      req.signal.addEventListener("abort", end);
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform" },
  });
}
