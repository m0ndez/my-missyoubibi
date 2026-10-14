# Known issues and limits

Found in the pre-release review and **not fixed yet** (everything critical and high was fixed). Each is small in practice; they are
listed so nobody has to rediscover them. Fixing one is a good first contribution.

## Bridge and protocol

- **First contact is trust-on-first-use.** The bridge pins an HTTPS adapter's certificate the first time it sees it and carries the
  pin across address changes, but it can't tell a genuine first contact from an impostor's. Anything that can impersonate the adapter
  at that moment is trusted. (A changed certificate afterwards is refused.)
- **A silent-mode change that fails isn't retried.** The bridge reads the real value back and shows it, and the page reports "The unit
  take the change" after 90 seconds, but it doesn't send the change again.
- **Writes are judged by the state read back, not checked against what was asked.** An adapter answers `result 12` even when a write
  worked, so the bridge trusts the returned state; a write the unit answers without applying (usually because another app changed it in the last minute, which locks other apps for 60 s)
  is sent again once, 61 s later; if that doesn't take either, the page says so.
- **A retry after a timeout can apply a write twice.** Harmless here: every change the app sends is "set to this value" (power
  on, 26 degrees), never "toggle".
- **Humidity isn't calibrated or checked.** It is the unit's own return-air reading (a plausible, stable value on all three tested units, but never compared with a hygrometer), it sits next to the unit's warm exhaust so it can read differently from the room, and a unit without the sensor shows nothing. A real 30 % is hidden because it looks the same as "no sensor".
- **The reply checksum rule was found by search, and matches every reply seen** (three models, HTTP and HTTPS). A model whose replies
  all fail it shows offline with `unusable reply` in the bridge log: set `WFRAC_CRC=0` and report the model.
- **Per-unit state is keyed by the unit's id.** A unit removed and re-added with the same id while its old worker is mid-request
  can briefly overlap with it (the cleanup is serialised, so registration is safe, but the old worker's last poll may land late).
- **`WFRAC_CURL=1`** (a development option for a Mac where Node can't reach the LAN) has no connection reuse, so HTTPS adapters are slow.
  Don't use it for real.

## Security

- **Guessing is slowed, not blocked.** Wrong passwords wait 1 s, then longer (30 s at most) while guessing continues, and at most 20 wait at
  once; the right password always works. There is no per-address limit (it needs a trustworthy client address). Use the generated password.
- **A custom domain needs `ALLOWED_HOSTS`.** The page answers `421 Unknown host` to names that aren't loopback, private, Tailscale or `.local`-style.
- **The broker isn't encrypted.** Passwords cross your LAN in clear text if you set `MQTT_BIND=0.0.0.0`. The default keeps it on
  localhost. TLS for the broker is not provided.
- **The broker's ACL lets the `app` user write the per-unit state topics** (needed to clear a removed unit's retained values), so a
  compromised app container could forge a unit's state. It cannot command units except through the app's own API.
- **`ALLOW_NO_AUTH=1` disables the login for `npm run dev`** (loopback only; `npm run dev:lan` opens it to the LAN). The installed app ignores it.
- **At most 20 open event streams and 20 broker connections**; a runaway client gets a 503, not a crash.

## Web app

- The login page shows "That password didn't match" for any failed login. (More than 20 guesses at once get a plain 429 page.)
- A scan that never finishes is abandoned after 90 seconds with "The bridge didn't answer"; nothing cancels it on the bridge.
- Energy history starts when the app first runs: the units keep none. Earlier days can be entered by hand.
- English and degrees Celsius only.
- **Home Assistant discovery (`HA_DISCOVERY=1`) is experimental and untested on a real Home Assistant yet.** Configs are republished when
  Home Assistant announces `online`, and removed with their unit even if the flag is off.

## Install and operations

- **Windows is untested.** Network detection falls back to the first private, non-virtual address; set `WFRAC_SUBNET` by hand if it
  picks wrongly.
- **`WFRAC_SUBNET` is rewritten by every `npm run setup`** (it reports when it changes). To keep a manual value, edit `.env` after setup.
- **The arm64 images are built on GitHub's native arm64 runners**, which are free only for public repositories.
- **GitHub packages are private until you make them public** (repository → Packages → Package settings). An anonymous
  `docker compose pull` fails with `denied` before that.
- **Release notes come from `CHANGELOG.md`**: move `[Unreleased]` under a version heading (and bump `package.json`) before tagging.
