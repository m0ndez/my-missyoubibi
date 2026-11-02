// FALLBACK (docs/firmware.md Path A): wired MHI-AC-Ctrl. Not used by the deployed WF-RAC path; drops vane/threeD/silent.
// Bridge for MHI-AC-Ctrl firmware (ESP8266/ESP32 on the AC's CNS port). Run: npm run bridge
// Firmware HOSTNAME must be `mhi-<id>` for each id in lib/ac.ts DEMO_DEVICES.
import mqtt from "mqtt";
import { DEMO_DEVICES as DEVICES } from "../lib/ac";
import { complete, fromDevice, toDevice, type Partial4 } from "./mhi-bridge";
import { parsePatch } from "../lib/ac";

const client = mqtt.connect(process.env.MQTT_URL ?? "mqtt://localhost:1883", {
  username: process.env.MQTT_USER,
  password: process.env.MQTT_PASS,
});
client.on("error", (e) => console.error("mqtt:", e.message));
const known = new Map<string, Partial4>(DEVICES.map((d) => [d.id, {}]));

client.on("connect", () => {
  client.publish("mhi/_bridge/online", "1", { retain: true }); // clears a "0" a killed wfrac bridge left retained
  for (const { id } of DEVICES) {
    client.subscribe([`mhi-${id}/+`, `mhi/${id}/set`]); // `mhi-<id>/+` skips set/* and OpData/*
  }
});

client.on("message", (topic, buf) => {
  const payload = buf.toString();
  for (const { id } of DEVICES) {
    if (topic === `mhi/${id}/set`) {
      let patch;
      try { patch = parsePatch(JSON.parse(payload)); } catch { return; }
      if (patch) for (const [suffix, value] of toDevice(patch)) client.publish(`mhi-${id}/${suffix}`, value);
      return;
    }
    if (!topic.startsWith(`mhi-${id}/`)) continue;
    const field = topic.slice(`mhi-${id}/`.length);
    if (field === "connected") {
      client.publish(`mhi/${id}/online`, payload === "1" ? "1" : "0", { retain: true });
      return;
    }
    const change = fromDevice(field, payload);
    if (!change) return;
    const merged = { ...known.get(id), ...change };
    known.set(id, merged);
    const state = complete(merged);
    if (state) client.publish(`mhi/${id}/state`, JSON.stringify(state), { retain: true });
    return;
  }
});
