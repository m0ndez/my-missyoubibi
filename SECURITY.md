# Security

## Reporting a problem

Please report vulnerabilities privately through GitHub: **Security → Report a vulnerability** on this repository. Don't open a
public issue for them. Expect an answer within a week. Fixes go into the next release; the changelog says what was fixed.

## What this protects, and what it doesn't

This app controls real air conditioners from a web page. This page describes the **Home deployment** (everything on your home network, the
default). The optional **Cloud deployment** is different on purpose: see its [security model](docs/cloud-deployment.md#security-model). Read this before exposing either.

- **The adapters have no login of their own.** Anyone on your LAN can already talk to a WF-RAC adapter directly (that is how the
  official app and every integration work). This project doesn't change that and can't fix it: keep untrusted devices (guests,
  IoT junk) off the network the adapters are on.
- **The web app has one shared password.** It is refused at start-up if it is short or a well-known one (`npm run setup` generates a
  strong one). Sessions are signed cookies that last 14 days; **Sign out** signs out every device, including pages that are already
  open (live streams close within 25 seconds). Wrong passwords wait 1 s, then longer (up to 30 s) while guessing continues, and the right password is never refused, so a
  neighbour can't lock you out. Request bodies are size-capped.
- **Plain HTTP.** `npm run setup` asks whether to serve the page to phones on your Wi-Fi. If you say yes (`APP_BIND=0.0.0.0`), the
  password and cookie cross the Wi-Fi unencrypted and anyone on it can read them. For a phone away from home, or to keep them private,
  put HTTPS in front (`tailscale serve --bg 3000`, or a reverse proxy with a certificate). The page answers only to its own addresses
  (loopback, private and Tailscale IPs, `.local`/`.lan`/`.ts.net` names, `ALLOWED_HOSTS`), which blocks DNS rebinding.
- **In the Home deployment, never port-forward** the app (3000) or the broker (1883) to the internet. (The Cloud deployment publishes the app
  through a Cloudflare Tunnel behind Cloudflare Access and opens one TLS broker port for the bridge only; it never port-forwards 3000 or 1883.)
- **The broker** (Home deployment) requires a login, accepts connections from this machine only by default, and its users are created from `.env` at
  start-up. `mosquitto/acl` gives each user only the topics it needs (a compromised bridge can't command your units or rewrite the
  unit list), and messages and connections are capped. **It is not encrypted:** `MQTT_BIND=0.0.0.0` (which setup only accepts together with `MQTT_ALLOW_LAN=1`) sends the broker passwords across your LAN in
  clear text, so only use it on a network you trust.
- **The bridge pins** each HTTPS adapter's certificate on first contact (trust on first use): it refuses a different certificate
  later (`WFRAC_REPIN=1` accepts a replacement after you swapped an adapter). Plain-HTTP adapters have nothing to pin.
- **Writes are real.** The bridge changes real units. It is read-only unless `WFRAC_WRITE=1` (set in the Docker stack).

## Things to know

- `ALLOW_NO_AUTH=1` turns the login off for the development server (`npm run dev`, which listens on this computer only; `npm run
  dev:lan` opens it to your network). The installed app ignores it; `npm run setup` warns if it is in `.env`.
- There is no per-address limit on wrong passwords (behind a proxy every client looks the same): the delay above is what slows guessing.
- More limits are in [docs/known-issues.md](docs/known-issues.md).

## Hardening checklist (Home deployment; for the Cloud deployment see its [security model](docs/cloud-deployment.md#security-model))

1. Run `npm run setup` (strong generated secrets, `.env` mode 600).
2. Keep `MQTT_BIND` at its default; use Tailscale or a TLS reverse proxy for remote access (or the [Cloud deployment](docs/cloud-deployment.md)), and `APP_BIND=127.0.0.1` if you don't need phones on the LAN.
3. Keep the adapters' network free of untrusted devices; give the adapters no internet access if you can (the official app's
   cloud isn't used here).
4. Update when a release fixes something: `git pull && npm run setup` (see [install](docs/install.md#update)).
5. Back up the `app-data` volume (names, timers, energy history) and the `bridge-data` volume (the bridge's identity on the adapters).

## Supported versions

Only the latest release gets fixes.
