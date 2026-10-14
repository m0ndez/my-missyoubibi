# Supported models

This talks to the **WF-RAC Wi-Fi adapter** that Mitsubishi Heavy Industries (MHI) air conditioners use with the Smart M-Air app,
over the adapter's local network API. It does not use the cloud and does not need the Smart M-Air account.

## Tested on real hardware

| Indoor unit | Adapter | Works |
|---|---|---|
| SRK24YYS-W1/B | HTTPS (newer firmware, self-signed certificate, old TLS) | power, mode (cool, dry, fan, auto), setpoint, fan speed, up/down and left/right louvers, 3D auto, silent mode; compressor, outdoor temperature, energy, fault code (read); room humidity reads a plausible value (not checked against a hygrometer) |
| SRK18YYS-W1/B | plain HTTP | same |
| DXK12YYS-W1 | plain HTTP | same |

Everything in that table was checked on these three units (this is the author's set). Humidity depends on the unit having a return-air humidity sensor: all three answered a real-looking value, but a unit without the sensor shows none. Left/right positions 1 to 7 are the remote's fin
pairs; up/down 1 is up and 4 is angled down, plus swing. See [firmware notes](firmware.md) for the details.

## Not possible over this interface

ECO, Hi power and Home-leave (the remote handles those itself; the adapter exposes no switch for them), and self-clean. The page
doesn't offer them. Details of what was tried are in [firmware notes](firmware.md).

## Other models (researched, not tested here)

There is no public, complete list of units that work with the adapter. MHI's own pages name product ranges, not model codes. Most
of what follows comes from sellers and from community projects, so treat it as a lead, not a promise. Checked October 2026.

Status key: **Tested here** (the three units above only), **Reported working** (someone publicly says it works, with the adapter
and this kind of local API), **Listed by the maker** (an MHI page names the range, nobody reports it), **Seller list only**
(shops list it, no maker page and no report), **Unknown**.

| Family | Models named by a source | Status | Source |
|---|---|---|---|
| Wall, Thailand "YYS" | SRK24YYS-W1/B, SRK18YYS-W1/B, DXK12YYS-W1 | Tested here | this repo |
| Wall, Thailand "YYSH-WF" | SRK18YYSH-WF with SRC18YYSH-W; SRK13YYSH-WF with SRC13YYSH-W (a shop says built-in Wi-Fi; not said to be the same as the "YYS-W1" codes above) | Seller list only | [hkele.com.hk](https://hkele.com.hk/en/SRK18YYSH-WF-SRC18YYSH-W), [hkele.com.hk](https://hkele.com.hk/en/SRK13YYSH-WF-SRC13YYSH-W) |
| Wall, "ZS" (Europe) | SRK20ZS-WF, SRK35ZS-WF (with outdoor SCM45ZS-W); SRK50ZS-WF | Reported working | [WF-RAC Home Assistant integration](https://github.com/blues-sechseck/Mitsubishi-WF-RAC-Integration), [Airco Bridge for Homey](https://community.homey.app/t/157487), [simon42 forum](https://community.simon42.com/t/geraete-fuer-mitsubishi-heavy-wf-rac/90012) |
| Wall, "ZS" other sizes | SRK-ZS-W, -WB, -WT; MHI says Wi-Fi is built in on the range | Listed by the maker | [MHI Air Conditioning Europe](https://mhiae.com/smart-m-air-app/), [Cooling Post, June 2022](https://coolingpost.com/products/mhi-adds-wireless-lan-connectivity) |
| Wall, "ZSX" | SRK-ZSX-W, -WB, -WT, SRK-ZSX-S, ZSX-WF (README of the integration mentions the series, no unit reported) | Listed by the maker | [MHI Air Conditioning Europe](https://mhiae.com/smart-m-air-app/), [Cooling Post](https://coolingpost.com/products/mhi-adds-wireless-lan-connectivity) |
| Wall, "ZR" | SRK-ZR-W, ZR-WF | Listed by the maker | [MHI Air Conditioning Europe](https://mhiae.com/smart-m-air-app/) |
| Wall, "ZT" and "ZTL" | ZT-WF, ZTL (no full model code given) | Reported working | owner reports (half-degree setpoints) in the [integration README](https://github.com/blues-sechseck/Mitsubishi-WF-RAC-Integration); ZTL also on the [MHI page](https://mhiae.com/smart-m-air-app/) |
| Floor ("SRF") | SRF-ZSX, SRF-ZMX | Seller list only | [Orion Air Sales](https://www.orionairsales.co.uk/mitsubishi-heavy-industries-air-conditioning-wf-rac-mhi-smart-m-air-wi-fi-srk-srf-srr-17695-p.asp), [Condex](https://condex.bg/en/product-details/wifi-wf-rac-en/), [Climaled](https://climaled.fr/en/air-conditioner-mitsubishi-heavy-industries-wifi-wf-rec-app-control-premium-line-indoor-unit-ac) |
| Ducted, slim ("SRR") | SRR-ZS | Seller list only | same three shops |
| Ceiling cassette ("FDT") | e.g. FDT140VH: the shop shows Wi-Fi as "optional" and does not name the adapter | Unknown | [Climaled](https://climaled.fr/en/air-conditioner-mitsubishi-heavy-industires-fdt140vh-fdc140vna-w-cassette-smart-950x950-dc-inverter-1-phase-mono-split) |
| Ducted ("FDU"), other FD* codes, DXK/DXC other sizes, Japan domestic lines | none | Unknown | no source found |

Notes on the table:

- "Reported working" for the ZS rows comes from a handful of owners, mostly of the same few units. The integration and this project
  talk to the same adapter protocol, but that does not prove every feature works on each unit. Louver and mode support differ.
- The only MHI sources found were the Europe site and a 2022 trade news item. No Thailand, Australia, or Japan compatibility list
  turned up, and no public Smart M-Air model list was found. The Thai "YYS" units here work, but that is the only Thai data.
- The "-WF" suffix on some model codes (for example SRK20ZS-WF) appears on units sold with Wi-Fi. No source explains the suffix
  officially, so do not rely on its presence or absence.
- One seller says the adapter suits "selected" SRK, SRR and SRF units and tells buyers to check the exact indoor unit first.

## Adapter variants

| Name | What is known | Source |
|---|---|---|
| `WF-RAC` | Plain HTTP on port 51443 (this project saw it on the SRK18YYS and DXK12YYS). | [Airco Bridge](https://community.homey.app/t/157487), [integration README](https://github.com/blues-sechseck/Mitsubishi-WF-RAC-Integration) |
| `WF-RAC-HTTPS` | Same port, HTTPS, newer firmware. Tested with SRK50ZS-WF there and with SRK24YYS here. | same |
| `WCBN4612L` | A firmware branch name in the integration README; no unit reported. | [integration README](https://github.com/blues-sechseck/Mitsubishi-WF-RAC-Integration) |
| `INWFIMHI001I000` | A newer adapter set up in the "AC-Cloud" app, not Smart M-Air. The Homey app says it is not compatible. Not tried here. | [Homey app](https://community.homey.app/t/app-pro-mitsubishi-wf-rac/77116) |
| `MH-AC-WIFI-1` | The Homey developer says it is not supported. | [Homey app](https://community.homey.app/t/app-pro-mitsubishi-wf-rac/77116) |

The integration tries plain HTTP and then HTTPS, so you don't pick one by hand. The report form asks which one answered. Other adapters on the market also carry the "WF-RAC" name, so the label alone does not prove it is the right
one; the real test is whether the adapter answers on port 51443 and the Smart M-Air app can add it.

No source found documents any E1 or E2 difference between adapter variants or models. The E1 (WPS) and E2 (AP) steps in
[add a unit](add-a-unit.md) are what was done on real units here.

## Does my unit have the port, or do I need a kit?

- Sellers describe the WF-RAC as a small external module that plugs into the **CNS** connector on the indoor unit's board and takes its
  12 V from there ([Orion Air Sales](https://www.orionairsales.co.uk/mitsubishi-heavy-industries-air-conditioning-wf-rac-mhi-smart-m-air-wi-fi-srk-srf-srr-17695-p.asp),
  [GEMA manual](https://sk.gemashop.de/cdn/shop/files/GEMA_Bedienungsanleitung_Mitsubishi_Heavy_WF-RAC_v1.pdf)). A 5-pin connector marked CNS on
  the board is the thing to look for: see [phase 0 hardware check](phase0-hardware-check.md). The name "CN-WF" was not found in any source.
- Some ranges ship with the module fitted; others need it added. One spec sheet marks Smart M-Air as "(option)" on the SRK20-50ZS
  ([MEP Content](https://www.mepcontent.com/nl/bim-files/detail/31081/rac-srk20-50zs-s----w-wf-wfb-wft)), and a hobby write-up says S-series
  and all "WF" types either ship with it or can be retrofitted ([filipnet.de](https://www.filipnet.de/haos-mhi-wfrac/)). Ask the seller
  for your exact indoor-unit code.
- To tell whether the adapter is already inside: the indoor unit's label or QR code carries the setup SSID (Smart-M-Air-XXXX),
  key and MAC (see [add a unit](add-a-unit.md)); the Smart M-Air app can add the unit; a scan for TCP port 51443 finds it.
- The adapter is 2.4 GHz only and accepts one connection at a time.

## Report your model

Use the **Model report** form: open a new issue on this repository and pick "Model report" (template:
[model-report.yml](../.github/ISSUE_TEMPLATE/model-report.yml)). It asks for the indoor-unit model, adapter name (and last four MAC
characters), whether the adapter answered over HTTP or HTTPS, and what worked. Reports move a row from "Seller list only" or
"Unknown" to "Reported working".

## Not supported

- Mitsubishi **Electric** units (MELCloud, the MAC-577IF-E adapter): a different company and a different protocol.
- Adapters from other makers fitted to MHI units (for example Intesis / Airconwithme): different protocol.
- Units controlled only through a wired controller or IR remote (no Wi-Fi adapter). A wired alternative exists for reference in
  `fallback/` (unmaintained, not used by the app).
