# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/), and the project uses
[semantic versioning](https://semver.org/).

## [Unreleased]

### Added
- One-command setup (`npm run setup`): detects the network and timezone, writes `.env` with generated secrets, starts the stack with Docker or Podman.
- The bridge runs in Docker and finds adapters by MAC, so fixed IP addresses aren't needed.
- Add, rename and remove units from the page; "Find units on my network"; three documented ways to get a new adapter onto your Wi-Fi.
- First-run screen, a "can't reach the backend" notice, status dots, installable-app icons.
- Room humidity on each unit that has a humidity sensor, next to the room temperature (and for Home Assistant). The bridge reads it once a minute; a unit without the sensor shows none.
- `npm run setup` asks whether to serve the page to phones on your Wi-Fi and prints the address to open (`--lan` / `--local` skip the question).
- The bridge refuses an adapter reply whose checksum fails, and sends a change again once (after the adapter's 60 s lock) when another app got in first.
- The page answers only to its own addresses (`ALLOWED_HOSTS` adds yours); setup refuses `MQTT_BIND` off loopback without `MQTT_ALLOW_LAN=1`.
- A researched list of other MHI models and what is known about each, in docs/supported-models.md.
- Each unit shows its adapter and MAC under its name; the airflow pictures are captioned and fit their boxes.
- A design pass over the whole UI: a new palette (warm paper and deep teal in light, teal graphite and aqua in dark, with one accent that only ever means "on", "selected" or the primary action), six named type roles with 16 px inputs, a 4-point spacing rhythm, and flat hairline rows instead of nested boxes. The built-in demo units now use made-up adapter addresses.
- Panels open and close with an eased height and fade, unit cards fade in, and every panel has the same drawn 20 px chevron (it was a 7 px text glyph, and "Unit settings" had none). With reduced motion, panels just fade.
- `/api/health`, container healthchecks, an end-to-end smoke test, CI, and a tag-driven release of multi-arch images.
- MIT licence, NOTICE, SECURITY.md, CONTRIBUTING.md, issue forms, and the docs in `docs/`.

### Changed
- Wrong passwords wait 1 s, then longer (up to 30 s); the right password is never refused (it used to lock everyone out for ten minutes).
- `npm run dev` listens on this computer only (`npm run dev:lan` for a phone); `ALLOW_NO_AUTH` is ignored by a production build.
- The bridge image is a 170 MB single-file bundle (it was 920 MB); release images build on native arm64 runners. Home Assistant discovery: entity naming, humidity, hvac_action, and a republish when Home Assistant restarts.
- The app refuses to start (every request fails closed) when `APP_PASSWORD` is short, well known or contains characters `.env` misreads.
- A fresh install starts with no units (it used to list three demo units).
- The timezone comes from `TZ` (detected by setup) instead of being fixed.
- The message broker has per-user access rules, size limits and a connection limit.
- Open event streams end after sign-out or session expiry; request bodies are size-capped.
- Pairing requires the adapter to accept the registration and is repeated at every start.

### Fixed
- Re-adding a removed unit left it readable but ignoring changes.
- The bridge sent its identity to every host that answered on the adapter port, and could fall back from HTTPS to plain HTTP.
- Compose dropped `HA_DISCOVERY`, `ENERGY_RATE` and `ENERGY_CURRENCY`, so they had no effect in Docker.
- The page stopped updating after an error response from the event stream until it was reloaded.
- Timers: failed adds, deletes and loads were silent; double clicks added duplicates.
- The Remove button's text failed contrast in dark mode (2.4:1); the reduced-motion setting no longer makes every change snap (colour changes still fade); a unit's adapter and MAC wrap instead of being cut off on 320 px screens.

## [0.1.0]

First working version: power, mode, setpoint, fan, louvers, silent mode, timers, energy report, MQTT bridge for WF-RAC adapters.
