import { EventEmitter } from "node:events";
import mqtt from "mqtt";
import { isAcState, type AcState, type DeviceState } from "./ac";
import { listDevices, isDevice } from "./devices";
import { parseFound, type Found } from "./discover";
import { discoveryMessages, discoveryTopic, HA_STATUS_TOPIC } from "./ha";

type Hub = {
  client: mqtt.MqttClient;
  states: Map<string, DeviceState>;
  setups: Map<string, string>; // what the bridge is doing to bring a new unit up: "finding", "pairing", "ready", "error: ..."
  bus: EventEmitter;
  publishDevices: () => void; // tell the bridge the unit list (retained)
  forget: (id: string) => void; // a unit was removed: drop its state and its retained topics
  found: () => Found; // adapters the last network scan saw
  scan: () => void; // ask the bridge to scan the network for adapters
};
const g = globalThis as unknown as { __hub?: Hub };

// One MQTT connection per server process (survives dev hot reload via globalThis).
export function hub(): Hub {
  if (!g.__hub) {
    const client = mqtt.connect(process.env.MQTT_URL ?? "mqtt://localhost:1883", {
      username: process.env.MQTT_USER,
      password: process.env.MQTT_PASS,
    });
    client.on("error", (e) => console.error("mqtt:", e.message)); // mqtt.js retries; unhandled 'error' would crash
    const raw = new Map<string, AcState>();
    const online = new Map<string, boolean>();
    const states = new Map<string, DeviceState>();
    const setups = new Map<string, string>();
    let found: Found = { scanning: false, units: [] };
    const bus = new EventEmitter();
    bus.setMaxListeners(0);

    // Combine the device's last state with its online flag; nothing is emitted until both are known.
    const publish = (id: string) => {
      const s = raw.get(id);
      if (!s || !online.has(id)) return; // wait for both retained messages: no false "offline" flash
      const d = { ...s, online: online.get(id)! };
      states.set(id, d);
      bus.emit("state", id, d);
    };

    // The bridge learns which units exist from this retained message (the app owns the list).
    const discover = (devices: { id: string; name: string }[]) => {
      if (process.env.HA_DISCOVERY !== "1") return;
      for (const m of discoveryMessages(devices)) client.publish(m.topic, JSON.stringify(m.payload), { retain: true });
    };
    const publishDevices = () => {
      const list = listDevices();
      client.publish("mhi/_devices", JSON.stringify(list.map(({ id, name, mac }) => ({ id, name, mac }))), { retain: true });
      discover(list);
    };
    const forget = (id: string) => {
      raw.delete(id);
      online.delete(id);
      states.delete(id);
      setups.delete(id);
      for (const t of ["state", "online", "setup"]) client.publish(`mhi/${id}/${t}`, "", { retain: true }); // clears the retained value
      client.publish(discoveryTopic(id), "", { retain: true }); // always: toggling HA_DISCOVERY off must not leave a ghost entity
      bus.emit("gone", id);
    };

    client.on("connect", () => {
      client.subscribe(["mhi/+/state", "mhi/+/online", "mhi/+/setup", "mhi/_found"]);
      if (process.env.HA_DISCOVERY === "1") client.subscribe(HA_STATUS_TOPIC);
      publishDevices();
    });
    client.on("message", (topic, payload) => {
      if (topic === HA_STATUS_TOPIC) {
        if (payload.toString() === "online") discover(listDevices()); // Home Assistant (re)started: it needs the configs again
        return;
      }
      const [, id, kind] = topic.split("/");
      if (topic === "mhi/_found") {
        found = parseFound(payload.toString()) ?? found;
        return;
      }
      let known = false;
      try {
        known = isDevice(id);
      } catch {
        return; // damaged devices.json: ignore the message rather than throw inside the listener
      }
      if (!known) return; // ignore unknown ids: no unbounded map growth
      if (kind === "setup") {
        const text = payload.toString();
        if (text) setups.set(id, text.slice(0, 200));
        else setups.delete(id);
        bus.emit("setup", id, text.slice(0, 200));
        return;
      }
      if (kind === "online") {
        online.set(id, payload.toString() === "1");
      } else {
        try {
          const s: unknown = JSON.parse(payload.toString());
          if (!isAcState(s)) return; // wrong shape would crash the page (it reads temp.toFixed())
          raw.set(id, s);
        } catch {
          return; // ignore malformed payload
        }
      }
      publish(id);
    });
    const scan = () => {
      found = { scanning: true, units: [] }; // until the bridge answers; the page gives up if it never does
      client.publish("mhi/_scan", "1");
    };
    g.__hub = { client, states, setups, bus, publishDevices, forget, found: () => found, scan };
  }
  return g.__hub;
}
