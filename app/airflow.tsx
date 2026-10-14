import type { ReactNode } from "react";
import { Chevron } from "./icons";
import type { Vane, VaneLR } from "@/lib/ac";
import { Toggle } from "./toggle";

// The louvers drawn instead of numbered. Angles come from watching a real DXK12 (see docs/firmware.md):
// up/down 1 points up, 4 is angled down; left/right 1 is left, 7 is "converge to centre". The remote's seven
// left/right modes are the combinations of its two fins (left L, centre C, right R): LL, LC, CC, CR, RR, LR, RL.
const UD_ANGLE = { "1": -14, "2": 18, "3": 44, "4": 70 } as const; // degrees below horizontal
const L = 32; // fin tilted so the air goes left (as seen facing the unit); right is -L
const LR_FINS: Record<Exclude<VaneLR, "swing">, readonly [number, number]> = {
  "1": [L, L],
  "2": [L, 0],
  "3": [0, 0],
  "4": [0, -L],
  "5": [-L, -L],
  "6": [L, -L], // spread wide
  "7": [-L, L], // converge to the centre
};
const UD_NAMES: Record<Exclude<Vane, "swing">, string> = {
  "1": "Highest",
  "2": "High",
  "3": "Low",
  "4": "Lowest",
};
const LR_NAMES: Record<Exclude<VaneLR, "swing">, string> = {
  "1": "Both left",
  "2": "Left and centre",
  "3": "Centre",
  "4": "Centre and right",
  "5": "Both right",
  "6": "Spread wide",
  "7": "Focus on centre",
};

const rad = (d: number) => (d * Math.PI) / 180;
const rot = (deg: number, ox: number, oy: number) => ({
  transform: `rotate(${deg}deg)`,
  transformOrigin: `${ox}px ${oy}px`,
});
const ease =
  "transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none";

// Side view: the unit on the wall, one flap hinged at its outlet. `flow` draws the air leaving it.
function SideView({
  pos,
  flow,
  crop,
  className,
}: {
  pos: Vane;
  flow: boolean;
  crop?: boolean; // zoom on the flap: for small icons
  className?: string;
}) {
  const [hx, hy] = [100, 30];
  const sweep = pos === "swing";
  const a = sweep ? 28 : UD_ANGLE[pos];
  const wedge = (r: number) =>
    `M${hx} ${hy}L${hx + r * Math.cos(rad(UD_ANGLE["1"]))} ${hy + r * Math.sin(rad(UD_ANGLE["1"]))}A${r} ${r} 0 0 1 ${hx + r * Math.cos(rad(UD_ANGLE["4"]))} ${hy + r * Math.sin(rad(UD_ANGLE["4"]))}Z`;
  return (
    <svg
      viewBox={crop ? "58 8 82 50" : "0 0 160 92"}
      className={className}
      aria-hidden
    >
      <rect
        x="4"
        y="6"
        width="114"
        height="24"
        rx="9"
        className="fill-surface stroke-line"
        strokeWidth="1.5"
      />
      {sweep && <path d={wedge(56)} className="fill-accent/15" />}
      <g className={sweep ? "sweep-ud" : ease} style={rot(a, hx, hy)}>
        {flow && (
          <path
            d={`M${hx + 34} ${hy}H${hx + 58}M${hx + 34} ${hy - 7}H${hx + 54}M${hx + 34} ${hy + 7}H${hx + 54}`}
            className="stroke-accent/55"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="1 5"
          />
        )}
        <path
          d={`M${hx} ${hy}H${hx + 28}`}
          className="stroke-ink"
          strokeWidth="5"
          strokeLinecap="round"
        />
      </g>
      <circle cx={hx} cy={hy} r="3" className="fill-muted" />
    </svg>
  );
}

// Top view: the unit's outlet at the top edge, two fins hinged side by side, the air fanning into the room below.
function TopView({
  pos,
  flow,
  crop,
  className,
}: {
  pos: VaneLR;
  flow: boolean;
  crop?: boolean;
  className?: string;
}) {
  const sweep = pos === "swing";
  const [left, right] = sweep ? [0, 0] : LR_FINS[pos];
  const hinges = [62, 98] as const;
  const fin = (x: number, deg: number) => (
    <g key={x} className={sweep ? "sweep-lr" : ease} style={rot(deg, x, 26)}>
      {flow && (
        <path
          d={`M${x} ${26 + 30}V${26 + 58}`}
          className="stroke-accent/55"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="1 5"
        />
      )}
      <path
        d={`M${x} 26V${26 + 22}`}
        className="stroke-ink"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <circle cx={x} cy="26" r="3" className="fill-muted" />
    </g>
  );
  return (
    <svg
      viewBox={crop ? "36 2 88 52" : "0 0 160 92"}
      className={className}
      aria-hidden
    >
      {sweep && (
        <path
          d="M62 26L33 82A62 62 0 0 0 127 82L98 26Z"
          className="fill-accent/10"
        />
      )}
      <rect
        x="20"
        y="4"
        width="120"
        height="22"
        rx="9"
        className="fill-surface stroke-line"
        strokeWidth="1.5"
      />
      {fin(hinges[0], left)}
      {fin(hinges[1], right)}
    </svg>
  );
}

type Stop<T> = { value: T; name: string; icon: ReactNode };

// Native radios (arrow keys, form semantics) drawn as picture buttons.
function Stops<T extends string>({
  legend,
  group,
  value,
  stops,
  disabled,
  cols,
  onChange,
}: {
  legend: string;
  group: string;
  value: T;
  stops: Stop<T>[];
  disabled?: boolean;
  cols: string;
  onChange: (v: T) => void;
}) {
  return (
    <fieldset
      disabled={disabled}
      className="min-w-0 border-0 p-0 transition-opacity disabled:opacity-40"
    >
      <legend className="mb-1.5 text-label font-medium text-muted">
        {legend}
      </legend>
      <div className={`grid gap-1.5 ${cols}`}>
        {stops.map((s) => (
          <label key={s.value}>
            <input
              type="radio"
              name={group}
              value={s.value}
              checked={value === s.value}
              onChange={() => onChange(s.value)}
              className="peer sr-only"
            />
            <span className="grid min-h-12 cursor-pointer place-items-center rounded-lg bg-raised px-1 py-1.5 text-muted transition-colors duration-150 hover:text-ink peer-checked:bg-surface peer-checked:text-ink peer-checked:ring-2 peer-checked:ring-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-accent peer-disabled:cursor-default">
              {s.icon}
              <span className="sr-only">{s.name}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function Airflow({
  name,
  vane,
  vaneLR,
  threeD,
  on,
  disabled,
  onVane,
  onVaneLR,
  onThreeD,
}: {
  name: string;
  vane?: Vane;
  vaneLR?: VaneLR;
  threeD?: boolean;
  on: boolean;
  disabled: boolean;
  onVane: (v: Vane) => void;
  onVaneLR: (v: VaneLR) => void;
  onThreeD: (on: boolean) => void;
}) {
  // 3D auto: the unit moves both louvers itself, so the pictures show them sweeping.
  const shownVane: Vane | undefined = threeD ? "swing" : vane;
  const shownLR: VaneLR | undefined = threeD ? "swing" : vaneLR;
  const udStops: Stop<Vane>[] = (["1", "2", "3", "4"] as const)
    .map((v) => ({
      value: v as Vane,
      name: UD_NAMES[v],
      icon: <SideView pos={v} flow={false} crop className="h-9 w-full" />,
    }))
    .concat({
      value: "swing",
      name: "Swing",
      icon: <SideView pos="swing" flow={false} crop className="h-9 w-full" />,
    });
  const lrStops: Stop<VaneLR>[] = (["1", "2", "3", "4", "5", "6", "7"] as const)
    .map((v) => ({
      value: v as VaneLR,
      name: LR_NAMES[v],
      icon: <TopView pos={v} flow={false} crop className="h-9 w-full" />,
    }))
    .concat({
      value: "swing",
      name: "Swing",
      icon: <TopView pos="swing" flow={false} crop className="h-9 w-full" />,
    });

  const summary = [
    shownVane &&
      `up and down ${shownVane === "swing" ? "swinging" : UD_NAMES[shownVane].toLowerCase()}`,
    shownLR &&
      `left and right ${shownLR === "swing" ? "swinging" : LR_NAMES[shownLR].toLowerCase()}`,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <details className="group">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 py-2 [&::-webkit-details-marker]:hidden">
        <span className="text-ui font-medium">Airflow</span>
        <span className="sr-only">{summary}</span>
        <span
          aria-hidden
          className="ml-auto flex items-center gap-1.5 text-ink"
        >
          {shownVane && (
            <SideView pos={shownVane} flow={false} crop className="h-8 w-11" />
          )}
          {shownLR && (
            <TopView pos={shownLR} flow={false} crop className="h-8 w-11" />
          )}
        </span>
        <Chevron className="size-5 shrink-0 text-muted transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-open:rotate-180" />
      </summary>

      <div className="grid gap-5 pt-1 pb-5">
        {(shownVane || shownLR) && (
          <div
            className={`grid gap-2 text-ink ${shownVane && shownLR ? "grid-cols-2" : "grid-cols-1"}`}
          >
            {[
              shownVane && {
                key: "ud",
                label: "Up / down",
                caption:
                  shownVane === "swing" ? "Swinging" : UD_NAMES[shownVane],
                picture: (
                  <SideView
                    pos={shownVane}
                    flow={on}
                    className="h-auto w-full"
                  />
                ),
              },
              shownLR && {
                key: "lr",
                label: "Left / right",
                caption: shownLR === "swing" ? "Swinging" : LR_NAMES[shownLR],
                picture: (
                  <TopView pos={shownLR} flow={on} className="h-auto w-full" />
                ),
              },
            ].map(
              (v) =>
                v && (
                  <figure
                    key={v.key}
                    className="min-w-0 overflow-hidden rounded-lg bg-surface px-1.5 pt-2 pb-2.5"
                  >
                    {v.picture}
                    <figcaption className="mt-1.5 text-center text-label font-medium text-ink">
                      <span className="sr-only">{v.label}: </span>
                      {v.caption}
                    </figcaption>
                  </figure>
                ),
            )}
          </div>
        )}
        {threeD && (
          <p className="text-label text-muted">
            3D auto is steering both louvers. Turn it off to pick a position:
            they start on swing.
          </p>
        )}
        {shownVane && vane && (
          <Stops<Vane>
            legend="Up / down"
            group={`${name}-vane`}
            value={vane}
            stops={udStops}
            disabled={disabled || threeD}
            cols="grid-cols-5"
            onChange={onVane}
          />
        )}
        {shownLR && vaneLR && (
          <Stops<VaneLR>
            legend="Left / right"
            group={`${name}-vane-lr`}
            value={vaneLR}
            stops={lrStops}
            disabled={disabled || threeD}
            cols="grid-cols-4"
            onChange={onVaneLR}
          />
        )}
        {threeD !== undefined && (
          <Toggle
            label="3D auto"
            checked={threeD}
            disabled={disabled}
            className="border-t border-line"
            onChange={onThreeD}
          />
        )}
      </div>
    </details>
  );
}
