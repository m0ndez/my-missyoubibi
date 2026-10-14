# Add a unit

You add units from the page: **Add a unit** at the bottom of the unit list. The adapter has to be on your 2.4 GHz Wi-Fi first; if it
is already (it works in Smart M-Air), skip to step 3.

1. The adapter must be on your home Wi-Fi (the unit already works in Smart M-Air). If it is brand new or was reset, do step 2 first.
2. **Get the unit onto your Wi-Fi.** Pick one of three ways (the app shows the same steps under **Add a unit**). The sequence on the
   remote comes from MHI's *Wireless LAN connection manual* (RSA012A135, sections 4 and 5):
   1. Turn the unit **off** with ON/OFF (the setting can't be changed while it runs).
   2. Press **MENU** (small button under the display) until **SL** shows.
   3. Press **▲/▼** until **E1** (WPS) or **E2** (AP mode) shows: **TEMP** on the slim remote, **TIMER** on the remote with a SET button.
   4. Press **SET** (on the slim remote the **ON/OFF** button is SET). The unit beeps "peep pip" and the **RUN** and **TIMER**
      lights blink together (1 s on, 1 s off). No beep: repeat from step 2.

   **A. Smart M-Air app (E2).** The official route, confirmed on a real unit.
   - Within **5 minutes**, join Wi-Fi **Smart-M-Air-XXXX** (XXXX = last 4 characters of the MAC) from a phone. The SSID, key and MAC
     are on the label on the front of the indoor unit, inside the inlet panel, and in its QR code. Seen so far: key `RAC2WLAN`; check your label.
   - In the app: **Find unregistered Air Conditioners** → **Settings** → pick your router (or type its SSID), enter its password.

   **B. This tool (E2).** No phone or app account needed; only tested against a fake adapter, not a real one in setup mode.
   - Join **Smart-M-Air-XXXX** from a computer, then run `npm run provision` in this project (dry run; add `-- --send` to send).
   - It lists the computer's networks (and the Wi-Fi name where the OS allows reading it), looks for the adapter at the gateway, at the
     first address of each subnet and at `192.168.10.1` (`--ip` overrides), shows the adapter's MAC and setup-mode flag, asks for your
     Wi-Fi name and password, checks them (name up to 32 bytes, WPA2 password 8 to 63 characters) and asks you to type the last 4
     characters of the MAC before sending. The password goes to the adapter, never to the command line.

   **C. WPS (E1).** No phone, no computer; from MHI's manual, not tried here.
   - Within **2 minutes**, press the **WPS button** on your router. The unit joins by itself. WPS needs the router's 2.4 GHz band.
   - MHI's manual then registers the unit in Smart M-Air's own list; that is optional here.

   **Whichever you pick:**
   - The adapter has a **2.4 GHz** radio only (the manual: the router must support the 2.4 GHz band).
   - Router with two names (`Home` and `Home_5G`): choose the 2.4 GHz one. The Smart M-Air app pre-fills the network your phone
     is on (MHI's manual), so type the 2.4 GHz name yourself if that was the 5 GHz one.
   - One name for both bands and joining fails: turn off Smart Connect / band steering, or give 2.4 GHz its own name (common
     router advice, not from MHI).
   - MHI's FAQ: MAC filtering must be off or allow the adapter, the network name must not be hidden, and a WEP-only router doesn't
     work. WPA2 is the safe choice; WPA3-only is not confirmed to work.
   - **Check it joined:** rejoin your home Wi-Fi and press **Find units on my network** in the app, or look in your router's list of
     connected devices (the three adapters seen here have MACs starting `34:8E:89`). If the lights stop blinking before it joins, start again at step 2.
   - Notes: the manual lists the ZSX/ZS/ZR/ZMX/ZM series and does not name SRK/DXK models, so the SL menu is not confirmed for these
     exact units. If a remote has no MENU/SL, try the adapter's own buttons: with the unit off, hold the adapter's **Set** button
     2 s or more to select E2 (from an installer guide for the same adapter; not confirmed in MHI's manual).
   - Verified end to end on a real unit (method A): remove the unit in the app, join it to the 2.4 GHz network, add it again by MAC,
     power it on. Re-adding only works because the bridge always re-registers (see `ensurePaired`).

3. In the app, open **Add a unit**. **Find units on my network** makes the bridge scan the subnet and list every adapter that answers
   and isn't added yet (adapters it already polls are skipped, so they aren't disturbed); tap one to fill in its MAC. There is no import from
   a Smart M-Air account: MHI publishes no API for it, and the community integrations are local-only. Then paste the QR code's text (or just the 12-character MAC), name it, and press **Add unit**.
   Its card shows "Looking for the adapter…", then "Pairing…", then the controls. An adapter keeps only 4 paired apps: if
   pairing fails, remove an old one in Smart M-Air.
4. Rename it by tapping its name on the card; remove it under **Unit settings**. Removing deletes the unit's timers, frees its pairing slot and
   keeps its energy history.

The new unit must be reachable from the host that runs the bridge (same network, no client isolation on the Wi-Fi).

## Sources for the setup-mode steps

- MHI, *Wireless LAN connection manual* RSA012A135 (English): https://www.mhi-mth.co.jp/en/products/pdf/rsa012a135_english.pdf
  (sections 4 and 5: SL/E1/E2, SET, the 2 and 5 minute limits, "peep pip", RUN and TIMER lights; sections 5(B) and 6: AP mode,
  Smart-M-Air-XXXX, label with SSID/KEY/MAC)
- MHI, *Smart M-Air Operation Manual* RKZ012A107C: https://www.mhi-mth.co.jp/en/products/pdf/rkz012a107c_english.pdf
- MHI, *WF-RAC technical manual*, as mirrored at https://www.coolmark.nl/media/files/technical_manual_2021-wf-rac.pdf
