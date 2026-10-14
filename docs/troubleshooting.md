# Troubleshooting

Start with `docker compose ps` (all three services should say `healthy`) and `docker compose logs --tail 50 bridge app`.
With Podman, use `podman compose` and `podman ps`.

## The page says "Can't reach the backend"

The page is running but the broker isn't. If you just started the stack, wait a minute. Otherwise check
`docker compose ps`; if `mosquitto` is restarting, `docker compose logs mosquitto` says why (a missing `MQTT_PASS` in `.env` is the
usual cause: run `npm run setup`).

## The page is blank, or every request says "This server is not set up correctly"

The app refuses to run with a missing, weak or default `APP_PASSWORD` (or a short `AUTH_SECRET`). The reason is in
`docker compose logs app`. Run `npm run setup`: it replaces weak values with strong ones. The new password is in `.env`.

## A card says "Waiting for the unit…" or "Can't find the adapter on this network"

The bridge hasn't heard from the adapter. In order:

1. Is the unit on your Wi-Fi? Open Smart M-Air on your phone: if it shows the unit there, yes. If not, see [add a unit](add-a-unit.md).
2. Is it on the **2.4 GHz** network, and is your computer on the same subnet? The bridge scans `WFRAC_SUBNET` (in `.env`); if you moved
   to another network, run `npm run setup` again to refresh it.
3. Does your router isolate Wi-Fi clients ("AP isolation", "guest network")? Then the computer can't reach the adapter.
4. Find the adapter yourself: `docker compose exec bridge node bridge.mjs find <12-digit MAC>` (read-only). The router's
   list of connected devices shows it too (the three adapters seen here have MACs starting `34:8E:89`).

## "Pairing failed"

An adapter remembers only 4 apps (Smart M-Air and each integration take one). Remove one you don't use in Smart M-Air, or remove
the unit here and add it again. The bridge asks the adapter to register it at every start and needs the adapter to answer
`result 0`.

## A unit shows its state but ignores changes

The bridge isn't registered on that adapter any more (it was reset, or its app list was cleared). Restarting the bridge registers it
again: `docker compose restart bridge`. Writes are also locked for about 60 seconds after another app changed something, and
"Applying…" turns into "The unit didn't confirm the change" after 90 seconds.

## Every unit is offline, on a Mac

The Docker/Podman VM reaches your LAN through the app that started it, and macOS blocks that unless the app has **Local Network**
permission. Symptoms: all units offline at once, "Find units on my network" empty, and the page says "The bridge can't reach your
network". Check from the host: `docker compose exec bridge nc -z -w2 <adapter ip> 51443` fails while `nc -z <adapter ip> 51443` on the
Mac works.

1. System Settings → Privacy & Security → **Local Network**: switch on the app you run Docker or Podman from (your terminal, Docker
   Desktop, Podman Desktop).
2. Restart the VM **from that same app** (`podman machine stop && podman machine start`, or restart Docker Desktop), then
   `docker compose up -d`.

Programs shipped by Apple (`curl`, `nc`) are exempt, which is why those work while the VM doesn't. Not an issue on Linux.

## An adapter's address changes

Normal (DHCP). The bridge finds it again by MAC after 6 failed polls, at most every 5 minutes. A pinned HTTPS adapter keeps its
pin across the move. To keep addresses fixed, reserve one per adapter in your router.

## "adapter … presented a different TLS certificate"

The bridge remembers each HTTPS adapter's certificate on first contact and refuses a different one. If you replaced the adapter
(or something else now answers at its address), that's the message. If you did replace it, set `WFRAC_REPIN=1` in `.env`, run
`npm run setup`, wait for the unit to come back, then delete that line. It counts for 10 minutes after the bridge starts.

## Timers fire at the wrong time, or the energy day rolls over at the wrong hour

`TZ` in `.env`. Setup detects it once; set the right one (`Europe/Berlin`, `Asia/Bangkok`, ...) and run `npm run setup`.

## Home Assistant doesn't show the units

Set `HA_DISCOVERY=1` in `.env` and run `npm run setup`. Home Assistant has to connect to the broker as user `app`
([Home Assistant](install.md#home-assistant)).

## Start over

`docker compose down -v` deletes the volumes (units, timers, energy history, the bridge's identity). Back up first
([install](install.md#back-up-and-restore)). Then `npm run setup`.
