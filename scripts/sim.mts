// Dev-only: MQTT broker + 3 fake MHI air conditioners. Run: npm run sim
import net from "node:net";
import { Aedes } from "aedes";
import mqtt from "mqtt";
import { DEMO_DEVICES as DEVICES, parsePatch, type AcState } from "../lib/ac";

const aedes = await Aedes.createBroker();
const port = Number(process.env.SIM_PORT ?? 1883); // another port when a real broker already holds 1883
net.createServer(aedes.handle).listen(port, () => console.log(`broker :${port}`));

// ponytail: one shared client, no last-will, so devices never go offline here.
const client = mqtt.connect(`mqtt://localhost:${port}`);
// BROKER_ONLY=1: just the broker, no fake units (use with real adapters via `npm run wfrac`).
const acs = new Map<string, AcState>(
  (process.env.BROKER_ONLY === "1" ? [] : DEVICES).map((d) => [d.id, { power: false, mode: "cool", temp: 25, fan: "auto", vane: "swing", roomTemp: 29, compressor: false, outdoorTemp: 33.5, humidity: 52, energy: 0, fault: null }]),
);
const publish = (id: string) =>
  client.publish(`mhi/${id}/state`, JSON.stringify(acs.get(id)), { retain: true });

client.on("connect", () => {
  client.subscribe("mhi/+/set");
  acs.forEach((_, id) => {
    client.publish(`mhi/${id}/online`, "1", { retain: true });
    publish(id);
  });
});
client.on("message", (topic, payload) => {
  const id = topic.split("/")[1];
  const ac = acs.get(id);
  let patch;
  try { patch = parsePatch(JSON.parse(payload.toString())); } catch { return; }
  if (!ac || !patch) return;
  Object.assign(ac, patch);
  publish(id);
});

// Room temp drifts toward setpoint when cooling, toward 30 when off.
setInterval(() => {
  acs.forEach((ac, id) => {
    const target = ac.power && ac.mode !== "fan" ? ac.temp : 30;
    ac.roomTemp = Math.round((ac.roomTemp! + Math.sign(target - ac.roomTemp!) * 0.1) * 10) / 10;
    ac.compressor = ac.power && ac.mode !== "fan" && ac.roomTemp > ac.temp;
    if (ac.compressor) ac.energy = (ac.energy ?? 0) + 0.25 / 20; // fake: ~0.25 kWh per minute of cooling
    publish(id);
  });
}, 3000);
