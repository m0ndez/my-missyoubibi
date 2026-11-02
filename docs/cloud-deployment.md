# Cloud deployment

The Cloud deployment runs the App and the Broker on a VPS. Only the Bridge stays at home, and it connects **outward** to the Broker over TLS. It is an optional alternative to the Home deployment ([install](install.md)), built from the same code and images. Why it is built this way: [ADR 0001](adr/0001-vps-first-cloud-deployment.md). The topology: [architecture](architecture.md).

```
phone ──https──> Cloudflare (Access, then Tunnel) <──outbound── tunnel ─> app ─> broker (1883, compose network only)
                                                                                    ^
home: bridge ──mqtts 8883 (DNS-only name, verified certificate, user "device")──────┘
```

Two things reach the VPS from outside: the Bridge on 8883, and you over SSH. There is no inbound web port.

Do the steps in order. Wording on Cloudflare's dashboard changes now and then; where a step names a menu, check it against Cloudflare's current documentation.

## What you need

- A VPS (Linux, amd64 or arm64) with Docker and the Compose plugin, and a Cloudflare account that manages your domain.
- Two names under that domain:
  - `BROKER_HOST`, for example `mqtt.example.com`: a **DNS-only** A record (grey cloud) pointing at the VPS. Cloudflare's proxy carries only HTTP and HTTPS, so it cannot carry 8883. This exposes the VPS's address; the firewall below is what protects it.
  - `APP_HOST`, for example `ac.example.com`: created for you by the tunnel (step 3).
- On the home machine: Docker or Podman, for the Bridge only ([step 4](#4-run-the-bridge-at-home)).

## 1. Prepare the VPS

Clone the repository and copy the settings file:

```bash
git clone https://github.com/m0ndez/my-missyoubibi && cd my-missyoubibi
cp .env.cloud.example .env.cloud && chmod 600 .env.cloud
```

Fill in `.env.cloud`. Every secret lives in this file on the VPS and nowhere else:

| Setting | What it is |
|---|---|
| `BROKER_HOST`, `ACME_EMAIL`, `CLOUDFLARE_API_TOKEN` | The certificate (step 2). |
| `MQTT_PASS` | Broker password of the `app` user. `openssl rand -hex 24`. |
| `MQTT_DEVICE_PASS` | Broker password of the `device` user (the Bridge). `openssl rand -hex 24`. This is the only secret the home machine holds. |
| `APP_HOST` | The App's public name. The App refuses any other `Host` (it is passed as `ALLOWED_HOSTS`). |
| `TUNNEL_TOKEN` | From step 3. |
| `APP_PASSWORD`, `AUTH_SECRET` | The shared password (at least 10 characters) and the cookie-signing secret. `openssl rand -base64 18`, `openssl rand -hex 32`. |
| `TZ` | Your timezone, for example `Asia/Bangkok`. Timers and daily energy totals use it. |

### Firewall: inbound 8883 and SSH only

With `ufw` (adapt for your VPS provider's own firewall, and apply the same rules there if it has one):

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 8883/tcp
sudo ufw enable
```

Do not open 80, 443 or 1883. The plain Broker listener on 1883 is not published by the compose file and stays reachable only by the App on the compose network. Note that Docker publishes ports by editing the firewall itself and can bypass `ufw`: the compose file publishes only 8883, so check from outside with `nmap -Pn -p 1-10000 <vps address>` after the stack is up.

## 2. Broker hostname and certificate

1. Create the `BROKER_HOST` A record (DNS-only) pointing at the VPS.
2. Create a Cloudflare API token limited to your one zone, with **Zone → DNS → Edit** only, and put it in `CLOUDFLARE_API_TOKEN`. If certbot fails with a zone lookup error, add **Zone → Zone → Read** to the token.
3. First run with `ACME_STAGING=1` in `.env.cloud` to test issuance without Let's Encrypt's rate limits (the certificate is untrusted). Remove the line and restart for the real one: `docker compose -f docker-compose.cloud.yml --env-file .env.cloud up -d`. Certbot renews twice a day and signals the Broker to re-read the files; it needs no restart.

## 3. Publish the App: tunnel and Access

The `tunnel` service connects out to Cloudflare, so nothing listens for web traffic on the VPS.

1. In Cloudflare **Zero Trust → Networks → Tunnels**, create a tunnel (type: Cloudflared). Copy its token into `TUNNEL_TOKEN` in `.env.cloud`.
2. Add a **public hostname** to the tunnel: your `APP_HOST`, service type **HTTP**, URL `app:3000`. (`app` is the compose service name.)
3. Start everything: `docker compose -f docker-compose.cloud.yml --env-file .env.cloud up -d`. `docker compose ps` should show `mosquitto`, `certbot`, `app` and `tunnel` running and healthy.
4. In **Zero Trust → Access → Applications**, add a **Self-hosted** application for `APP_HOST`, with one policy:
   - Action **Allow**, rule **Include → Emails**: list only the household's addresses.
   - Login method: **One-time PIN** (email). Turn off any other identity provider for this application.
5. Open `https://APP_HOST` in a private window. Cloudflare Access asks for your email and sends a PIN, then the App asks for the shared password. **Both layers stay**: Access keeps the internet away from the App, and the shared password and its login backoff still protect it if the Access policy is ever loosened by mistake.

If you see "Unknown host. Add it to ALLOWED_HOSTS", `APP_HOST` does not match the name you opened.

### Check the installed page behind Access

The manifest and icons are fetched by the browser itself, which may not carry the Access session. Test before adding anything:

1. In a private window, sign in through Access and the App, then open DevTools → Application → Manifest (or use "Add to Home Screen" on a phone). The manifest and the icons must load and show no errors.
2. From a machine with no Access session: `curl -sI https://APP_HOST/manifest.webmanifest`. A `302` to `cloudflareaccess.com` is expected.
3. **Only if** step 1 shows the manifest or icons failing (or the phone refuses to install), add a second Access application for the same hostname with the paths `/manifest.webmanifest`, `/pwa-icon/*`, `/apple-icon*` and `/icon.svg`, and a policy with action **Bypass**. Those files hold nothing private (the App's own proxy already serves them without a session). Do not bypass anything else.

### When the Access session expires

With the page open, the page notices that its live stream fails and Access answers with a sign-in redirect, and reloads to sign in again. A short network drop only reconnects.
