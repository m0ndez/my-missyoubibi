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

## 4. Run the Bridge at home

`docker-compose.bridge.yml` runs only the Bridge. It takes the Broker's address and the Bridge's own password, publishes no port and accepts no inbound connection.

```bash
cp .env.bridge.example .env.bridge && chmod 600 .env.bridge   # BROKER_HOST, MQTT_DEVICE_PASS (from the VPS), WFRAC_SUBNET, TZ
docker compose -f docker-compose.bridge.yml --env-file .env.bridge up -d
docker compose -f docker-compose.bridge.yml logs -f bridge     # connected to the broker; the adapters are found
```

The Bridge keeps its identity on the adapters and their certificate pins in its `bridge-data` volume. **Run this from the same directory as the Home deployment's `docker-compose.yml`**: Compose names volumes after the directory, so the Bridge picks up the volume the Home deployment already made and does not have to pair with the adapters again. Compose will warn about "orphan containers" from the other file; ignore it and never add `--remove-orphans`.

If the Bridge cannot verify the Broker's certificate it stops with a clear error. A staging certificate (`ACME_STAGING=1`) is untrusted, so use the real one here.

## 5. Move your data from the Home deployment (once)

This copies the Units, timers and energy history to the VPS. It changes nothing on the Home deployment's volumes, so you can go back (below).

1. **Same timezone.** `TZ` in `.env.cloud` must equal the `TZ` the Home deployment used (`grep TZ .env`). Timers fire at local clock times and daily energy totals split at local midnight, so a different value shifts both.
2. **Note what you will check:** open the Home page and write down the Unit names, the timers, and today's and yesterday's energy totals.
3. **Stop the Home deployment**, so nothing writes while you copy and the two Apps never fire the same timer: in the Home directory, `docker compose stop`. Use `stop`, not `down -v`: `-v` deletes the volumes this procedure depends on.
4. **Export the three files** from the stopped App container:

   ```bash
   mkdir export && for f in devices timers energy; do docker compose cp app:/data/$f.json export/$f.json; done
   ```

   A file that does not exist (no timers yet, for example) is fine: skip it.
5. **Copy them to the VPS** (`scp export/*.json you@vps:`) and put them into the App's volume there:

   ```bash
   docker compose -f docker-compose.cloud.yml --env-file .env.cloud stop app
   for f in devices timers energy; do docker compose -f docker-compose.cloud.yml --env-file .env.cloud cp $f.json app:/data/$f.json; done
   docker compose -f docker-compose.cloud.yml --env-file .env.cloud run --rm --no-deps --user root --entrypoint chown app -R node:node /data
   docker compose -f docker-compose.cloud.yml --env-file .env.cloud start app
   ```

6. **Start the Bridge at home** (step 4).
7. **Check:**
   - Sign in at `https://APP_HOST`. The same Unit names are there, each online within about 30 seconds.
   - The timers list equals what you wrote down.
   - The Energy report shows the same totals for the days you noted. The history is intact if the days before today are unchanged.
   - Send one command to a Unit and see it change.

### Going back

Stop the Bridge there (`docker compose -f docker-compose.bridge.yml stop`) and start the Home deployment again (`docker compose start`). Its volumes were not touched. Keep them for a week or so before removing them.

## 6. Nightly backup to R2, and restore

The `backup` service copies the App's data volume (Units, timers, energy history, the sign-out marker) to a Cloudflare R2 bucket at 03:00 UTC every night, and once when it starts. The Bridge's own volume is **not** backed up off the home machine; if it is lost, the Bridge pairs with the adapters again.

### Set up

1. In Cloudflare **R2**, create a private bucket and note your account id.
2. Create an R2 API token with **Object Read & Write**, limited to that one bucket (R2 → Manage API tokens).
3. Put `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` in `.env.cloud` on the VPS. They exist nowhere else. `BACKUP_KEEP_DAYS` (default 30) sets the retention: after each successful backup, archives older than that are deleted. A backup that fails never deletes anything.
4. `docker compose -f docker-compose.cloud.yml --env-file .env.cloud up -d`, then check the first run: `docker compose -f docker-compose.cloud.yml --env-file .env.cloud logs backup` ends with `backup app-data-<time>.tar.gz done`.

List what is in the bucket:

```bash
docker compose -f docker-compose.cloud.yml --env-file .env.cloud run --rm --no-deps --entrypoint sh backup -c 'rclone lsf "$BACKUP_REMOTE"'
```

### Restore

The `restore` service fills an **empty** `app-data` volume from the newest archive, or from the archive you name. It refuses a volume that has files in it, so it cannot overwrite live data by mistake.

**On a new VPS** (the usual case: the old one is gone). Do steps 1 and 2 above to the point where `.env.cloud` is filled in, then **before** starting the App:

```bash
docker compose -f docker-compose.cloud.yml --env-file .env.cloud --profile restore run --rm restore
# or a specific archive: ... run --rm restore app-data-20261101T030000Z.tar.gz
docker compose -f docker-compose.cloud.yml --env-file .env.cloud up -d
```

Then check what you would check after a cutover: the Unit names, the timers, and the energy totals for the days before today.

**Onto a VPS that already runs** (for example after a bad edit). This deletes the data now in the volume, and it cannot be undone, so first make sure the backup you are about to restore is the one you want (`lsf` above). Then:

```bash
docker compose -f docker-compose.cloud.yml --env-file .env.cloud rm -sf app backup
docker volume ls | grep app-data      # the volume is named <directory>_app-data
docker volume rm <directory>_app-data
docker compose -f docker-compose.cloud.yml --env-file .env.cloud --profile restore run --rm restore
docker compose -f docker-compose.cloud.yml --env-file .env.cloud up -d
```

## Security model

What the Cloud deployment exposes, and what protects it. The Home deployment's rules ([SECURITY.md](../SECURITY.md)) do not apply to it as written: that page's "never expose" lines are about the Home deployment.

- **The App** is reachable only through Cloudflare. Cloudflare Access (an email one-time PIN, only the household's addresses) stands in front, then the App's own shared password, signed cookies and login delay. The VPS has no inbound web port. Cloudflare terminates TLS for this name, so Cloudflare can see the traffic between the phone and the App.
- **The Broker's 8883 listener** is the one public port. Only the `device` user can log in on it (a separate password file from `app`), with a certificate the Bridge verifies. `mosquitto/acl` lets that user publish only what a Bridge should: it cannot command Units or rewrite the unit list. Messages and connections are capped.
- **The plain listener (1883)** is not published; only the App reaches it, over the compose network.
- **The VPS's address is public**, because the Broker's name must be DNS-only (Cloudflare's proxy cannot carry 8883). The firewall (8883 and SSH only) is the protection; keep SSH to keys only.
- **Secrets** (the tunnel token, the Broker passwords, the shared password, the session secret, the Cloudflare API and R2 tokens) are read from `.env.cloud` on the VPS only. The home machine holds only the Bridge's own Broker password. Scope the Cloudflare API token to one zone and DNS edit, and the R2 token to the one bucket.
- **Commands are not queued.** A Bridge outage means missed timers and refused commands, not commands that fire later.
- **The adapters** still have no login of their own and stay on your home network: only the Bridge reaches them.
