# my-missyoubibi

Control of Mitsubishi Heavy air conditioners from a web page, through the units' Wi-Fi adapters. It runs either entirely at home or split between home and a cloud host.

## Language

**Unit**:
One air conditioner, as the person sees and names it on the page.
_Avoid_: Device, AC, aircon

**Adapter**:
The WF-RAC Wi-Fi module fitted to a Unit. It is reachable only from the home network.
_Avoid_: Module, dongle

**Bridge**:
The part that lives on the home network and talks to the Adapters. It is the only part that ever touches them.
_Avoid_: Gateway, agent, connector

**App**:
The web page, its API, login, timers and energy records.
_Avoid_: Service, server, backend

**Broker**:
The message relay between the App and the Bridge.
_Avoid_: MQTT server, hub

**Service**:
Not a term of this project. Name the App, the Broker or the Bridge instead.

## Deployment

**Home deployment**:
App, Broker and Bridge all run on the home network. Everything works with the internet down.
_Avoid_: Local mode, self-hosted

**Cloud deployment**:
App and Broker run on a cloud host and only the Bridge stays home, connecting outward to the Broker. An optional alternative to the Home deployment, built from the same code.
_Avoid_: Remote mode, hosted mode
