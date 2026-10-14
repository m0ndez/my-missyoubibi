import http from "node:http";
import https from "node:https";
import type { Duplex } from "node:stream";
import tls from "node:tls";
import { check } from "./check";

// Trust on first use for the adapters' self-signed TLS certificates (their TLS is old and unverifiable, so
// rejectUnauthorized stays off): the first certificate seen for an IP is remembered, a different one later is refused.
export type Pins = Record<string, string>;

export function checkPin(pins: Pins, ip: string, fingerprint: string): "new" | "ok" | "mismatch" {
  const known = pins[ip];
  return !known ? "new" : known === fingerprint ? "ok" : "mismatch";
}

// An https agent that checks the certificate BEFORE the request is sent (so the operator id is never written to an
// impostor). With rejectUnauthorized off Node never calls checkServerIdentity for a self-signed certificate, so the check
// lives in createConnection: the socket is handed to the HTTP client only after `verify(fingerprint)` accepts it.
export function pinnedAgent(verify: (fingerprint: string) => Error | undefined, options: https.AgentOptions): https.Agent {
  class PinnedAgent extends https.Agent {
    createConnection(opts: http.RequestOptions, callback?: (err: Error | null, stream: Duplex) => void): Duplex | null | undefined {
      const cb = callback!; // always given by the Agent; the async form is documented but its types are loose
      const socket = tls.connect({ ...(opts as tls.ConnectionOptions), rejectUnauthorized: false });
      socket.once("error", (e) => cb(e, socket));
      socket.once("secureConnect", () => {
        const fingerprint = socket.getPeerCertificate().fingerprint256;
        const bad = fingerprint ? verify(fingerprint) : new Error("the adapter presented no certificate");
        if (bad) {
          socket.destroy();
          cb(bad, socket);
        } else cb(null, socket);
      });
      return undefined; // undefined = "the socket arrives through the callback"
    }
  }
  return new PinnedAgent(options);
}

// Self-check: `npx tsx lib/pin.ts`
if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("lib/pin.ts")) {
  const pins: Pins = { "10.0.0.2": "AA:BB" };
  check(checkPin(pins, "10.0.0.3", "CC") === "new", "unknown ip is new");
  check(checkPin(pins, "10.0.0.2", "AA:BB") === "ok", "same certificate ok");
  check(checkPin(pins, "10.0.0.2", "DD") === "mismatch", "different certificate refused");
  console.log("pin.ts checks done");
}
