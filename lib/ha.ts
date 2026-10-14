import { check } from "./check";
import { DEMO_DEVICES, FANS, TEMP_MAX, TEMP_MIN, VANES } from "./ac";

// Home Assistant MQTT discovery: one `climate` entity per device, driven by our JSON contract.
// Enabled with HA_DISCOVERY=1. Experimental: not tested against a real Home Assistant yet.
export const HA_STATUS_TOPIC = "homeassistant/status"; // Home Assistant's birth message: "online" when it (re)starts
export const discoveryTopic = (id: string) => `homeassistant/climate/mhi_${id}/config`;

export function discoveryMessages(devices: readonly { id: string; name: string }[]) {
  return devices.map(({ id, name }) => ({
    topic: discoveryTopic(id),
    payload: {
      name: null, // the entity takes the device name (HA 2023.8+)
      unique_id: `mhi_${id}`,
      device: { identifiers: [`mhi_${id}`], name, manufacturer: "Mitsubishi Heavy Industries", model: "WF-RAC" },
      availability_topic: `mhi/${id}/online`,
      payload_available: "1",
      payload_not_available: "0",
      temperature_unit: "C",
      min_temp: TEMP_MIN,
      max_temp: TEMP_MAX,
      temp_step: 0.5,
      modes: ["off", "auto", "cool", "dry", "fan_only"],
      mode_state_topic: `mhi/${id}/state`,
      mode_state_template:
        "{% if not value_json.power %}off{% elif value_json.mode == 'fan' %}fan_only{% else %}{{ value_json.mode }}{% endif %}",
      mode_command_topic: `mhi/${id}/set`,
      mode_command_template:
        '{% if value == "off" %}{"power": false}{% else %}{"power": true, "mode": "{{ "fan" if value == "fan_only" else value }}"}{% endif %}',
      temperature_state_topic: `mhi/${id}/state`,
      temperature_state_template: "{{ value_json.temp }}",
      temperature_command_topic: `mhi/${id}/set`,
      temperature_command_template: '{"temp": {{ value }}}',
      current_temperature_topic: `mhi/${id}/state`,
      current_temperature_template: "{{ value_json.roomTemp }}",
      current_humidity_topic: `mhi/${id}/state`, // absent on units without a humidity sensor
      current_humidity_template: "{{ value_json.humidity | default(none) }}",
      action_topic: `mhi/${id}/state`, // valid actions: off, heating, cooling, drying, idle, fan
      action_template:
        "{% if not value_json.power %}off{% elif value_json.mode == 'fan' %}fan{% elif not value_json.compressor %}idle{% elif value_json.mode == 'dry' %}drying{% elif value_json.mode in ['cool', 'auto'] %}cooling{% else %}idle{% endif %}",
      fan_modes: [...FANS],
      fan_mode_state_topic: `mhi/${id}/state`,
      fan_mode_state_template: "{{ value_json.fan }}",
      fan_mode_command_topic: `mhi/${id}/set`,
      fan_mode_command_template: '{"fan": "{{ value }}"}',
      swing_modes: [...VANES], // up/down louver; devices that don't report a vane just never update it
      swing_mode_state_topic: `mhi/${id}/state`,
      swing_mode_state_template: "{{ value_json.vane }}",
      swing_mode_command_topic: `mhi/${id}/set`,
      swing_mode_command_template: '{"vane": "{{ value }}"}',
    },
  }));
}

// Self-check: `npx tsx lib/ha.ts`
if (process.argv[1]?.endsWith("lib/ha.ts")) {
  const msgs = discoveryMessages(DEMO_DEVICES);
  check(msgs.length === DEMO_DEVICES.length, "one per device");
  check(new Set(msgs.map((m) => m.payload.unique_id)).size === msgs.length, "unique ids");
  check(msgs.every((m) => JSON.stringify(m.payload)), "serialisable");
  const p = msgs[0].payload;
  check(p.name === null && p.temperature_unit === "C", "name null, unit C");
  check(p.device.name === DEMO_DEVICES[0].name && p.device.identifiers[0] === p.unique_id, "device block");
  check(msgs[0].topic === discoveryTopic(DEMO_DEVICES[0].id), "topic helper");
  check(p.current_humidity_template.includes("default(none)"), "humidity tolerates a missing value");
  check(p.action_topic === p.mode_state_topic && p.action_template.includes("drying"), "hvac action");
  console.log("ha.ts checks done");
}
