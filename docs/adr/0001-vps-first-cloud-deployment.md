# Cloud deployment is VPS-first; the Bridge dials out

The project began as "no cloud". The goal now is control from anywhere without Tailscale on every phone, and no always-on box at home running the App. We add an optional **Cloud deployment**: the App and Broker run on a VPS and the Bridge stays home, connecting outward to the Broker over TLS. The **Home deployment** stays fully supported, because the code is already local-first and the MQTT contract between App and Bridge is unchanged.

## Considered Options

- **Cloudflare Workers (Durable Objects, D1).** Deferred. The App holds a persistent MQTT connection, a `setInterval` scheduler and JSON-file storage in one long-lived process. Moving to Workers means rewriting the hub, the scheduler and storage. A VPS runs the current code almost unchanged. Cloudflare is still used for the edge: Access and a tunnel in front of the App.
- **App on the public internet behind its own reverse proxy and certificate.** Rejected in favour of a Cloudflare Tunnel plus Cloudflare Access, so the VPS opens no inbound web port.

## Consequences

- The Broker has a public TLS listener (8883) that accepts only the Bridge's `device` user. Cloudflare's proxy does not carry MQTT, so that hostname is DNS-only.
- Commands and timers are not queued across a Bridge outage. A stale command firing late is worse than a missed one.
- `README.md` ("no cloud") and `SECURITY.md` ("never expose") must say that this applies to the Home deployment.
