# Firmware paths (Phase 3)

## Path 0 (preferred): your existing WF-RAC Wi-Fi adapters, local API
The three units already have MHI WF-RAC adapters (they appear in the official Smart M-Air app). The adapter serves a
local HTTPS API on port 51443 with no cloud (protocol reference: the community project jeatheak/Mitsubishi-WF-RAC-Integration, MIT, now blues-sechseck/Mitsubishi-WF-RAC-Integration, docs/wf-rac-module-reference.md; see NOTICE).
No hardware to buy, no unit to open.

- Verified on one real unit (an SRK24 with an HTTPS adapter): mDNS service `_beaver._tcp` (seen when browsing by hand; the bridge only resolves `<mac>.local`), `getDeviceInfo`,
  `getAirconStat`, and decoding of power/mode/fan/setpoint/room temperature all match the official app's screen.
- On a Mac where Node is denied LAN access, add `WFRAC_CURL=1` to the bridge command (uses system curl). Not needed on Linux. (The Docker bridge hits the same macOS rule: see [troubleshooting](troubleshooting.md).)
- Real-unit dev setup: `npm run backend` (broker + bridge in Docker, finds the adapters by MAC), then `npm run dev`.
- Write verified on SRK24 (`-ad-c7`, HTTPS adapter): pairing via `updateAccountInfo` worked, and `setAirconStat` changed the
  setpoint 24.0 -> 25.0 -> 24.0 (confirmed by re-reading). The adapter answered `result: 12` even though the write applied,
  so judge success by the returned state, not by `result`.
- Also verified: power on/off on SRK24, setpoint writes on the older plain-HTTP adapters (DXK12 `-0d-15`, SRK18 `-eb-a3`), pairing on both.
- Mode and fan writes verified on DXK12 (older plain-HTTP adapter): dry/fan/auto/cool and fan 1-4/auto all round-trip through the adapter. Not yet verified on SRK24/SRK18, nor whether the unit physically responds (it was Off during the test).
- Louver (up/down vane) writes verified on SRK24 and DXK12: positions 1-4 and swing. Swing needs DB1's set-bit too
  (`c0 80`); `c0 00` is silently ignored. Read-only extras decoded from every poll (no extra requests): compressor running
  (`state[9]&2`), outdoor temperature and per-run energy (trailer segments `0x80`/`0x94`), unit error code (`state[6]`).
- Verified on DXK12 (plain-HTTP adapter): left/right louver (`command[11] = 0x10 | pos-1`, `command[12] |= 0x02`; swing is
  `command[11] = 0x10`, `command[12] = 0x03`), 3D auto (`command[12] = 0x0c` on / `0x08` off), and silent mode (operation-data
  code `0x21` write / `0xDD` read, sent as a variable segment in a command block with no set-bits; the write answers an error
  yet applies, and takes ~2 s, so the bridge reads it back). Silent is polled every 30 s. Left/right, 3D auto and silent were then
  also confirmed on SRK18 and SRK24 (set, read back, restored); SRK24 and SRK18 take much longer per write on a Mac because of `WFRAC_CURL`.
- Energy report: the unit's per-run kWh counter (resets at power-on, 0.25 kWh steps) is summed into daily totals by the
  app server (`data/energy.json`), so history exists only from the first run of the app. Earlier days can be added by hand
  (Energy > "Add earlier days", or `POST /api/energy {id, text: "2026-10-01 4.5"}`); past days only, they replace the stored day.
  Set `ENERGY_RATE` for a cost estimate.
- Not available over this interface: self-clean (cannot be started remotely), ECO, Hi power and Home-leave toggles
  (no known bus code; Home-leave is a settings screen under code 248, not a switch). Scanned on DXK12 with the remote
  (watching state bytes and all 49 answering codes for 1 h+): the remote's presses apply after up to ~90 s. ECO on = fan
  drops to speed 1 and code 0x05 (effective target, = setpoint*2 normally) reads +1 (24.5 vs 24); a second press reverts both.
  Writing fan 1 does not set the 0x05 offset, so no write path is known. Hi on = fan becomes speed 3, second press reverts;
  nothing else changes (no flag), and it is ignored while 3D is on. The house button only moved the setpoint (24 -> 33,
  mirrored in 0x05), so it is not a switch either.
  Codes 0x11/0x13/0x80-0x82/0x85/0x87/0x90/0xae are analog sensors that drift every minute. (0xad, which drifts too, is the relative humidity: see below.)
- Louver numbering (observed on a real DXK12, facing the unit): up/down 1 points up, 4 is angled down (the remote has 5 steps,
  the adapter 4 plus swing). Left/right 1..7 are the remote's fin pairs, left fin then right fin: 1 left-left, 2 left-centre,
  3 centre-centre, 4 centre-right, 5 right-right, 6 left-right (spread), 7 right-left (converge on the centre). The unit does not
  put the louvers on auto when 3D auto is switched off; the remote does, so the app sends `swing` for both louvers with it.
- Relative humidity: operation-data code `0xAD`, requested the way silent mode is read (a command block with one variable segment, no
  set-bits) and answered as a segment `ad 10 <percent> ff` in the RECEIVE block. Note the marker byte `0x10` (silent mode's answer uses
  `0x80`). The community reference documents `0xAD` as "relative humidity [%], OP2, read at the indoor unit's return-air sensor", with `30`
  = no sensor, `0` = broken wire, `0xFF` = no value, but only had a unit without the sensor to test. Read here: DXK12 54 %, SRK18 70 %,
  SRK24 47 %, each identical on repeated reads, different per room, none of them the sentinel. **Not compared with a hygrometer.** The
  bridge asks once a minute (one extra request) and publishes it as `humidity` in the unit's state; a unit that answers the sentinel
  or nothing simply shows no humidity, and a real 30 % is hidden too (indistinguishable from "no sensor").
- Fan nibble `state[3] & 0x0f`: 7 = auto, 0..2 = fan 1..3, 6 = fan 4. Values 3, 4 and 5 are not used by these
  units as far as seen (Hi power just shows fan 3, nibble 2); if one appears it decodes to "no selection" instead of making the
  state unusable. A setpoint outside 10..40 or a room temperature outside -20..60 marks a
  reply as corrupt too.
- Reply checksum: CRC16-CCITT (poly 0x1021, init 0xFFFF, little-endian) over bytes `[R-2, length-4)` where `R = state[18]*4 + 21` is where the RECEIVE
  block starts, compared with the last two bytes. The community reference gives no range; this one was found by search and matched 7 of 7
  replies (SRK24 over HTTPS, SRK18 and DXK12 over HTTP; status and operation-data answers). `WFRAC_CRC=0` skips it.
- Finding an adapter: mDNS `_beaver._tcp`, host `<mac>.local` (verified: `<mac>.local` resolves to a DXK12 adapter on the home network, and
  the app's bridge uses it first), then a scan of the local /24 for port 51443 answering `getDeviceInfo` with that MAC. The QR code
  in Smart M-Air's add-device screen holds `MAC <mac>,SSID:Smart-M-Air-<last 4>,KEY:<setup key>`: the adapter's setup network and its key.
  A new adapter is put on the home Wi-Fi with `setNetworkInfo { ssid, netPass }` while joined to that network (`npm run provision`;
  untested on a real adapter: the address, the `apMode` value and the answer in setup mode are assumed). Pairing is
  `updateAccountInfo`, undone by `deleteAccountInfo`; a unit that already answers `getAirconStat` for us counts as paired.
- Bridge: `WFRAC_DEVICES="srk24=<ip>,srk18=<ip>,dxk12=<ip>" npm run wfrac` (reads only).
  Writes need `WFRAC_WRITE=1` and a one-time `npm run wfrac -- register` (uses 1 of the adapter's 4 account slots).
- TLS: the HTTPS adapter uses a self-signed certificate and old TLS, so verification is off, but the bridge pins the
  certificate on first contact (`wfrac-pins.json` in the bridge's data folder) and refuses a different one (`WFRAC_REPIN=1` accepts a replacement).
  The check runs before the request is written, so the operator id is not sent to an impostor. Plain-HTTP adapters have nothing to pin.
- Costs of this path: the adapter serves one connection at a time and polling every 5 s can slow the official app;
  a successful write locks other clients' writes for 60 s; the adapter drops Wi-Fi about hourly (the bridge tolerates 3 failed polls).
- macOS note: Node on a Mac needs Local Network permission for the terminal app (System Settings > Privacy & Security >
  Local Network). It is not an issue on a Linux Pi.

Paths A and B below are fallbacks only if the adapters stop being usable.

Research notes (fallbacks). "Confirmed" = read in the project docs/source. "Inferred" = not verified for these models.

## Path A: wired, MHI-AC-Ctrl (https://github.com/absalom-muc/MHI-AC-Ctrl)
- Hardware (confirmed): ESP8266 (WEMOS D1 mini) or ESP32, a 12 V to 5 V DC-DC converter (CNS supplies 12 V), and a 4-channel
  **bidirectional** 5 V / 3.3 V level shifter. A resistor divider is not suitable; a direct connection can damage the ESP8266.
- Pin mapping: see the schematic in the project's repo (not in its text docs).
- Models: SRK24YYS / SRK18YYS / DXK12YYS are **not listed** as supported and no report was found. The closest reports are
  SRK18-YXS2W6 (basic operation works, issue #86) and DXK24ZMA-S on ESP32 (issue #201). Bench-test one unit first.
- Firmware config: set the MQTT `HOSTNAME` to `mhi-<id>` (`mhi-srk24`, `mhi-srk18`, `mhi-dxk12`), plus broker host and the `device` user.
- Run the bridge next to the app: `MQTT_URL=mqtt://app:<pw>@<broker>:1883 npm run bridge` (code in `fallback/`; it does not carry vane, 3D or silent).
  It maps `mhi-<id>/Power|Mode|Tsetpoint|Fan|Troom|connected` to `mhi/<id>/state|online` and `mhi/<id>/set` to `mhi-<id>/set/*`.
  Heat mode is ignored on purpose (not in this app's modes).

## Path B: IR, ESPHome `heatpumpir`
- Hardware: ESP32 + IR LED (transistor driver) pointed at the indoor unit. One per unit, or per room.
- Protocols available in ESPHome (confirmed from `climate.py`): `mitsubishi_heavy_zj`, `mitsubishi_heavy_zm`,
  `mitsubishi_heavy_zmp`, `mitsubishi_heavy_fdtc`, `mitsubishi_heavy_kj`.
- Which one fits YYS units: **unknown**. Inferred: remote family RLA502A700x suggests `zm`; try `zm`, then `zmp`, then `zj`.
- Limitation: IR is one-way. State is whatever was last sent; the unit's real state (e.g. someone used the remote) is not seen.
- Minimal YAML (assembled from the schema, untested):
  ```yaml
  remote_transmitter:
    pin: GPIO4
    carrier_duty_percent: 50%
  climate:
    - platform: heatpumpir
      name: "AC"
      protocol: mitsubishi_heavy_zm
      horizontal_default: middle
      vertical_default: middle
      min_temperature: 18
      max_temperature: 30
  ```
- Needs its own topic bridge to our `mhi/<id>/*` contract. Not written: build it only if path A is ruled out.
