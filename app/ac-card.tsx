import { useState } from "react";
import {
  FANS,
  TEMP_MAX,
  TEMP_MIN,
  type AcControl,
  type DeviceState,
  type Fan,
  type Mode,
} from "@/lib/ac";
import { Airflow } from "./airflow";
import { Minus, Plus, Power } from "./icons";
import { Segmented } from "./segmented";
import { Toggle } from "./toggle";
import { UnitName } from "./unit-name";
import { UnitSettings } from "./unit-settings";

const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: "cool", label: "Cool" },
  { value: "dry", label: "Dry" },
  { value: "fan", label: "Fan" },
  { value: "auto", label: "Auto" },
];
const FAN_OPTIONS = FANS.map((f) => ({
  value: f,
  label: f === "auto" ? "Auto" : f,
}));

// What the bridge reports while it brings a newly added unit up (see scripts/wfrac.mts).
const SETUP_TEXT: Record<string, string> = {
  finding: "Looking for the adapter on your network…",
  pairing: "Pairing with the adapter…",
  ready: "Connecting…",
  "error:notfound":
    "Can't find the adapter on this network. If it never joined your Wi-Fi, put it in setup mode (E2) and send it your 2.4 GHz Wi-Fi: see “Add a unit”. Still trying.",
  "error:unreachable": "The adapter doesn't answer. Still trying.",
  "error:wrongunit": "That address belongs to a different unit.",
  "error:pairing":
    "Pairing failed. An adapter keeps only 4 paired apps: remove one in Smart M-Air. Retrying.",
};

const step =
  "grid size-12 place-items-center rounded-full border border-line bg-raised text-ink transition-colors duration-150 enabled:hover:border-muted enabled:active:bg-line disabled:opacity-35";

type Props = {
  name: string;
  mac: string;
  suggestions: string[]; // room names not used by another unit
  state?: DeviceState; // last state reported by the unit
  patch?: Partial<AcControl>; // changes sent but not yet confirmed by the unit
  setup?: string; // progress of a newly added unit, from the bridge
  error?: string;
  onRename: (name: string) => Promise<string | void>;
  onRemove: () => Promise<string | void>;
  onChange: (patch: Partial<AcControl>) => void;
};

export function AcCard({
  name,
  mac,
  suggestions,
  state,
  patch,
  setup,
  error,
  onRename,
  onRemove,
  onChange,
}: Props) {
  const [renaming, setRenaming] = useState(false);
  const view = state && { ...state, ...patch };
  const offline = state ? !state.online : false;
  const disabled = !view || offline;
  const on = !!view?.power && !offline;
  const applying = !!patch && !offline;

  // compressor is only reported by some sources; without it we can't tell idle from cooling.
  const running = !view?.power
    ? "Off"
    : view.compressor
      ? view.mode === "dry"
        ? "Drying"
        : view.mode === "cool"
          ? "Cooling"
          : "Running" // fan or auto: the compressor may be heating or cooling, which this app doesn't know
      : view.compressor === false && view.mode !== "fan"
        ? "On · idle"
        : "On";
  const setupBad = !view && !!setup?.startsWith("error:");
  const status = !view
    ? setup
      ? (SETUP_TEXT[setup] ?? "Setting up…")
      : "Waiting for the unit…"
    : offline
      ? "Offline. Check the unit's Wi-Fi."
      : applying
        ? "Applying…"
        : running;
  // The same state as the words, for a glance across three cards: danger = offline or setup failed, accent = running, pulse = waiting.
  const dot =
    offline || setupBad
      ? "bg-danger"
      : !view
        ? "bg-muted motion-safe:animate-pulse"
        : on
          ? "bg-accent"
          : "bg-line";
  // The numbers are a row of labelled readings, not a sentence: they change on every poll, so they stay out of the live region
  // (only the status word is announced), and each one wraps as a unit instead of mid-phrase.
  const readings: [string, string][] = [];
  if (view && !offline) {
    if (view.roomTemp != null)
      readings.push(["Room", `${view.roomTemp.toFixed(1)}°`]);
    if (view.humidity != null)
      readings.push(["Humidity", `${Math.round(view.humidity)}%`]);
    if (state?.outdoorTemp != null)
      readings.push(["Outdoor", `${state.outdoorTemp.toFixed(1)}°`]);
    if (state?.energy != null && state.power)
      readings.push(["This run", `${state.energy.toFixed(2)} kWh`]);
  }

  return (
    <section
      aria-label={name}
      className={`card-in rounded-2xl border bg-surface px-5 pt-5 pb-1 transition-colors duration-200 sm:px-6 sm:pt-6 ${on ? "border-accent/70" : "border-line"}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <UnitName
            name={name}
            suggestions={suggestions}
            onEditing={setRenaming}
            onRename={onRename}
          />
        </div>
        {!renaming && (
          <button
            type="button"
            role="switch"
            aria-checked={!!view?.power}
            aria-label={`${name} power`}
            disabled={disabled}
            onClick={() => view && onChange({ power: !view.power })}
            className="-m-1.5 grid min-h-11 min-w-11 shrink-0 place-items-center p-1.5 disabled:opacity-40"
          >
            <span
              className={`relative h-8 w-14 rounded-full transition-colors duration-200 ${on ? "bg-accent" : "bg-surface ring-1 ring-edge ring-inset"}`}
            >
              <span
                className={`absolute top-1 left-1 grid size-6 place-items-center rounded-full transition-transform duration-200 ${on ? "translate-x-6 bg-surface text-accent" : "bg-muted text-surface"}`}
              >
                <Power className="size-3.5" />
              </span>
            </span>
          </button>
        )}
      </div>

      <p
        className="mt-1 flex flex-wrap gap-x-2 font-mono text-meta leading-snug text-muted"
        title={`Smart-M-Air-${mac.slice(-4).toUpperCase()}`}
      >
        <span>Adapter {mac.slice(-4).toUpperCase()}</span>
        <span aria-hidden>·</span>
        <span>{mac.toUpperCase().match(/../g)?.join(":")}</span>
      </p>

      <p
        className={`mt-4 flex items-start gap-2 text-ui font-medium ${offline || setupBad ? "text-danger" : "text-ink"}`}
      >
        <span
          aria-hidden
          className={`mt-[0.5em] size-2 shrink-0 rounded-full ${dot}`}
        />
        <span role="status" className="min-w-0">
          {status}
        </span>
      </p>
      {readings.length > 0 && (
        <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-0.5 pl-4 text-label">
          {readings.map(([label, value]) => (
            <div key={label} className="flex gap-1.5">
              <dt className="text-muted">{label}</dt>
              <dd className="font-medium tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div
        role="group"
        aria-label={`${name} setpoint`}
        className="mt-7 mb-8 flex items-center justify-between gap-2"
      >
        <button
          type="button"
          aria-label={`Lower ${name} setpoint`}
          disabled={disabled || view.temp <= TEMP_MIN}
          onClick={() => view && onChange({ temp: view.temp - 0.5 })}
          className={step}
        >
          <Minus className="size-5" />
        </button>
        <output
          className={`flex items-baseline gap-0.5 tabular-nums transition-colors duration-200 ${view ? (on ? "text-ink" : "text-muted") : "text-muted motion-safe:animate-pulse"}`}
        >
          <span className="text-display font-light tracking-tight">
            {view ? view.temp.toFixed(1) : "––.–"}
          </span>
          <span className="text-section font-light text-muted">°C</span>
        </output>
        <button
          type="button"
          aria-label={`Raise ${name} setpoint`}
          disabled={disabled || view.temp >= TEMP_MAX}
          onClick={() => view && onChange({ temp: view.temp + 0.5 })}
          className={step}
        >
          <Plus className="size-5" />
        </button>
      </div>

      <div className="grid gap-5">
        <Segmented<Mode>
          legend="Mode"
          name={`${name}-mode`}
          options={MODE_OPTIONS}
          value={view?.mode ?? null}
          disabled={disabled}
          onChange={(mode) => onChange({ mode })}
        />
        <Segmented<Fan>
          legend="Fan speed"
          name={`${name}-fan`}
          options={FAN_OPTIONS}
          value={view?.fan ?? null}
          disabled={disabled}
          onChange={(fan) => onChange({ fan })}
        />
      </div>

      {state?.fault && !offline && (
        <p role="alert" className="mt-5 text-ui text-danger">
          The unit reports error {state.fault}. Check the indoor unit or call
          service.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-5 text-ui text-danger">
          {error}
        </p>
      )}

      {/* The secondary controls are one list of rows, not three boxes: hairlines separate them. */}
      <div className="mt-6 divide-y divide-line border-t border-line">
        {(view?.vane || view?.vaneLR || view?.threeD !== undefined) && (
          <Airflow
            name={name}
            vane={view.vane}
            vaneLR={view.vaneLR}
            threeD={view.threeD}
            on={on}
            disabled={disabled}
            onVane={(vane) => onChange({ vane })}
            onVaneLR={(vaneLR) => onChange({ vaneLR })}
            // Like the remote: turning 3D off puts both louvers on auto. The unit does not do it by itself over this interface.
            onThreeD={(threeD) =>
              onChange({
                threeD,
                ...(!threeD && view.vane && { vane: "swing" as const }),
                ...(!threeD && view.vaneLR && { vaneLR: "swing" as const }),
              })
            }
          />
        )}
        {view?.silent !== undefined && (
          <Toggle
            label="Silent"
            checked={view.silent}
            disabled={disabled}
            onChange={(silent) => onChange({ silent })}
          />
        )}
        <UnitSettings name={name} mac={mac} onRemove={onRemove} />
      </div>
    </section>
  );
}
