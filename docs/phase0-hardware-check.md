# Phase 0: what to check on the air conditioners

> Superseded: the units already have WF-RAC Wi-Fi adapters, which the app uses (see `docs/firmware.md`, Path 0). This
> check is only needed if you fall back to the wired or IR paths.

Goal: decide between the wired path (CNS connector) and the IR path. Do this once, on the SRK18 first.

1. Switch the breaker off. Open the front panel and expose the indoor control board. A qualified technician should do this if unsure.
2. Look for a **5-pin JST XH connector labelled CNS** (2.5 mm pitch). Photograph the board, the connector and the board's label.
3. Note the model printed on the **remote** (e.g. `RLA502A700x` or `RKX502A001x`).
4. Decide:
   - CNS present: wired path (`docs/firmware.md`, path A). Also check the unit actually speaks the protocol with a bench test before wiring all three.
   - No CNS: IR path (`docs/firmware.md`, path B).
5. Record the result here: SRK24 ___, SRK18 ___, DXK12 ___, remote model ___.
