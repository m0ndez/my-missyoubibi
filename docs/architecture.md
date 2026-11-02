# Architecture

There are two deployments of the same code: the **Home deployment** (everything on the home network, below) and the optional
**Cloud deployment** (the App and the Broker on a VPS, [further down](#the-cloud-deployment)).

```
 browser ──HTTP + SSE──▶ app ──MQTT (user: app)──▶ mosquitto ◀──MQTT (user: device)── bridge ──HTTP(S) :51443──▶ WF-RAC adapters
                          │  timers, energy, login               (acl: mosquitto/acl)   (scripts/wfrac.mts)
                          └─ /data (JSON files)
```

In the Home deployment, three processes in three containers. The page never talks to an adapter: the bridge translates between MQTT and each adapter's
protocol, so the web app doesn't depend on the hardware (the dev simulator, a fake adapter and the real units all use the same topics).

## The MQTT contract

Defined in `lib/ac.ts`. `<id>` is the unit's id (letters, digits, dashes).

| Topic | Direction | Content |
|---|---|---|
| `mhi/<id>/state` | bridge → app, retained | JSON state: power, mode, setpoint, fan, louvers, silent, room temperature and humidity, outdoor temperature, energy, fault |
| `mhi/<id>/online` | bridge → app, retained | `1` / `0` |
| `mhi/<id>/set` | app → bridge | JSON patch of the fields to change |
| `mhi/_bridge/online` | bridge → app, retained | `1` when the bridge connects, `0` as its MQTT last-will. While it is `0` the app shows every unit offline. A bridge that never publishes it counts as online |
| `mhi/<id>/setup` | bridge → app, retained | progress of a new unit: `finding`, `pairing`, `ready`, `error:<reason>` |
| `mhi/_devices` | app → bridge, retained | the unit list `[{id, name, mac}]` (the app owns it) |
| `mhi/_scan` | app → bridge | "scan the network for adapters" |
| `mhi/_found` | bridge → app, retained | the scan result `{scanning, units:[{mac, ip}], problem?}` |
| `homeassistant/…` | app → Home Assistant | discovery messages, when `HA_DISCOVERY=1` |

The broker's rules (`mosquitto/acl`) match this table: the bridge can't publish `set` or `_devices`, the app can't publish `_found`.

The bridge's `MQTT_URL` may be `mqtts://`: it then verifies the broker's certificate against Node's trusted roots (plus `NODE_EXTRA_CA_CERTS`) and exits with an error if it doesn't verify. A plain `mqtt://` address behaves as before.
Messages are limited to 64 KB.

## The bridge

One worker per adapter. Each polls `getAirconStat` every 5 s, sends a change as soon as it arrives (as `setAirconStat`), and
reads the unit's real state back because the adapter answers an error code even when a write worked. An adapter serves one connection
at a time, so each gets its own HTTP agent with one socket.

- **Finding an adapter:** the last known address, then `<mac>.local` (mDNS: only outside a container), then a scan of `WFRAC_SUBNET`.
  Every candidate is asked who it is (`getDeviceInfo`, with a throwaway id, never the bridge's) and must answer the expected MAC.
- **Pairing:** `updateAccountInfo` with the bridge's operator id at every start; the adapter must answer `result 0`. Removing a unit
  sends `deleteAccountInfo`.
- **TLS:** HTTPS adapters use a self-signed certificate and old TLS, so normal verification isn't possible. The bridge pins the
  certificate on first contact, refuses a different one, and never falls back to plain HTTP for a pinned adapter.
- **State blobs** are base64 blocks with bit fields: see [firmware notes](firmware.md) and `lib/wfrac.ts`.

## The app

Next.js (App Router). `instrumentation.ts` starts the timer scheduler (every 15 s) and the energy recorder in the server process.
`proxy.ts` is the first gate (session required for everything except the login, `/api/health` and icons); every route that changes
anything also checks the session and the request's origin itself (`guard()` in `lib/auth.ts`). `/api/events` is a Server-Sent
Events stream of states; it re-checks the session while open.

## Data

| Where | File | Holds |
|---|---|---|
| `app-data` volume (`/data`) | `devices.json`, `timers.json`, `energy.json`, `session-revoked-before` | units, schedules, daily kWh per unit, sign-out marker |
| `bridge-data` volume (`/data`) | `wfrac-operator-id`, `wfrac-pins.json`, `wfrac-ips.json`, `wfrac-paired.json` | the bridge's identity, certificate pins, addresses |
| `mosquitto-data` volume | broker persistence | retained messages |

JSON files are written atomically (temp file and rename). Backup and restore: [install](install.md#back-up-and-restore).

## Images

`Dockerfile` ends in two images, `app` (Next.js standalone output) and `bridge`, picked by compose with `target:`. The bridge is
bundled: `npm run bundle:bridge` runs esbuild over `scripts/wfrac.mts` and `lib/*`, with `mqtt` inlined, into one `dist/bridge.mjs`
(Node 24, ESM). The image copies only that file onto a clean `node:24-alpine`, with no `node_modules` and no `tsx`
(about 170 MB instead of 920 MB). Base images are pinned by digest of the multi-arch index, so amd64 and arm64 get the same release.

Releases build each image per platform on native runners (amd64 and arm64, no QEMU), push by digest, and a merge job creates the
multi-platform tags: see [CONTRIBUTING](../CONTRIBUTING.md#releasing-maintainers). `.github/dependabot.yml` keeps the actions, the base
image digests and the npm packages current (npm minor and patch updates are grouped).

## Trust

- The adapters have no login of their own, so anyone on the LAN can already control them. This project doesn't change that: see
  [SECURITY.md](../SECURITY.md).
- Everything from the LAN is untrusted input: adapter replies (size and shape checked, ranges checked before anything is published),
  MQTT payloads (shape checked), HTTP bodies (size capped, parsed against a whitelist).
- Secrets live in `.env` (mode 600) and in the volumes; in the Home deployment nothing is sent to any cloud. The Cloud deployment keeps its
  secrets in `.env.cloud` on the VPS only: see its [security model](cloud-deployment.md#security-model).

## The Cloud deployment

The same App, Broker and Bridge, split across two places. The decision and what it costs: [ADR 0001](adr/0001-vps-first-cloud-deployment.md). The steps:
[cloud-deployment.md](cloud-deployment.md).

```
 browser ──HTTPS──▶ Cloudflare (Access, Tunnel) ◀──outbound── tunnel ──▶ app ──MQTT :1883 (compose network only)──▶ mosquitto
                                                                                                                    ▲
 home: bridge ──MQTTS :8883 (DNS-only hostname, verified certificate, user: device)─────────────────────────────────┘
       └──HTTP(S) :51443──▶ WF-RAC adapters
```

- **Unchanged:** the MQTT contract above, the App, the Bridge's behaviour and the Home deployment's compose file. The Bridge only gets a TLS Broker URL.
- **Broker:** two listeners with their own users. 1883 (plain, not published) accepts `app`; 8883 (TLS, public) accepts `device`. Both use `mosquitto/acl`.
  A certificate from Let's Encrypt, issued by DNS-01 through Cloudflare, is renewed by a sidecar that signals the Broker to re-read it.
- **Outages:** the Bridge's last-will on `mhi/_bridge/online` makes every Unit show offline within about 30 s of the home internet going down.
  A command for an offline Unit is refused, and a timer that comes due for one is skipped (a one-shot counts as missed); nothing is queued.
- **Backup:** the App's data volume goes to R2 every night. The Bridge's volume stays at home.
