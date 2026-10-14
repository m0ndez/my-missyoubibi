import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { control, signedOut } from "./control";
import { Chevron } from "./icons";
import { Segmented } from "./segmented";

// How to get an adapter onto the home Wi-Fi, three ways. From MHI's "Wireless LAN connection manual" RSA012A135 (sections 4 and 5);
// the full write-up is in docs/add-a-unit.md. The unit's remote starts all three: E2 makes the adapter open its own network (AP mode),
// E1 makes it join through the router's WPS button.
type Step = { title: string; text: string; notes?: string[] };
type Method = "app" | "computer" | "wps";

const OFF: Step = {
  title: "Turn the unit off",
  text: "Press ON/OFF on the remote. The Wi-Fi setting can't be changed while the unit runs.",
};
const MENU: Step = {
  title: "Open the Wi-Fi setting",
  text: "Press MENU (the small button under the display) until “SL” shows.",
};
const choose = (mode: "E1" | "E2", what: string): Step => ({
  title: `Choose ${mode}`,
  text: `Press ▲ or ▼ (TEMP, or TIMER on remotes with a SET button) until “${mode}” shows. ${what}`,
});
const CONFIRM: Step = {
  title: "Confirm",
  text: "Press SET. On the slim remote, ON/OFF is the SET button. The unit beeps “peep pip” and the RUN and TIMER lights blink together. No beep: go back to step 2.",
};
const JOIN: Step = {
  title: "Join its network within 5 minutes",
  text: "On your phone or computer, join Wi-Fi “Smart-M-Air-XXXX” (XXXX = the last 4 characters of the MAC). The key is on the label on the unit's front or inside its inlet panel, and in its QR code.",
};
const WIFI_NOTES = [
  "The unit only works on 2.4 GHz. It can't see 5 GHz networks.",
  "Router has two names (for example Home and Home_5G)? Choose the 2.4 GHz one, Home.",
  "The Smart M-Air app pre-fills the network your phone is on. If that is the 5 GHz one, type the 2.4 GHz name instead.",
  "One name for both bands and it won't connect? Turn off Smart Connect (band steering) in the router, or give 2.4 GHz its own name.",
  "Router settings: WPA2 security (not WPA3-only), MAC filtering off, network name not hidden.",
];
const CHECK: Step = {
  title: "Check it joined",
  text: "Rejoin your home Wi-Fi and press “Find units on my network” below. The adapter should appear. You can also look for it in your router's list of connected devices. If it isn't there, wait until the RUN and TIMER lights stop blinking and repeat from step 2.",
};
const ADD: Step = {
  title: "Add it here",
  text: "Tap the adapter in the list, or enter its MAC: it is on the unit's label and in its QR code, and your router's connected-devices list shows it (the three adapters seen here start with 34:8E:89). Name it and press Add unit, then try the power button.",
};

const AP = (mode: Step[]): Step[] => [
  OFF,
  MENU,
  choose("E2", "E2 is the unit's own network (AP mode)."),
  CONFIRM,
  JOIN,
  ...mode,
  CHECK,
  ADD,
];

const METHODS: {
  value: Method;
  label: string;
  about: string;
  steps: Step[];
}[] = [
  {
    value: "app",
    label: "Smart M-Air app",
    about:
      "The official route, confirmed on a real unit. Needs the Smart M-Air app on a phone.",
    steps: AP([
      {
        title: "Send your 2.4 GHz Wi-Fi to the unit",
        text: "In the Smart M-Air app, tap Find unregistered Air Conditioners, then Settings. Choose your router's 2.4 GHz network, enter its password and confirm.",
        notes: WIFI_NOTES,
      },
    ]),
  },
  {
    value: "computer",
    label: "This tool",
    about:
      "No phone or app account: run it from a computer. Only tested against a fake adapter so far.",
    steps: AP([
      {
        title: "Send your 2.4 GHz Wi-Fi from a computer",
        text: "On a computer joined to the unit's network, run npm run provision in this project. It detects the computer's network and the unit's address, asks for your Wi-Fi name and password, and shows what it will send. Add -- --send to send it.",
        notes: WIFI_NOTES.filter((n) => !n.includes("Smart M-Air app")),
      },
    ]),
  },
  {
    value: "wps",
    label: "WPS",
    about:
      "Fastest if your router has a WPS button: no phone, no computer. From MHI's manual, not tried here.",
    steps: [
      OFF,
      MENU,
      choose("E1", "E1 is WPS mode."),
      CONFIRM,
      {
        title: "Press the WPS button on your router within 2 minutes",
        text: "The unit joins your Wi-Fi by itself. WPS only works if your router offers 2.4 GHz. How long to hold the button depends on the router. If nothing happens, wait until the RUN and TIMER lights stop blinking and repeat from step 2.",
      },
      CHECK,
      ADD,
    ],
  },
];

type FoundUnit = { mac: string; ip: string };

// "Find units on my network": the bridge scans the LAN for WF-RAC adapters that aren't added yet. Picking one fills in its MAC.
// (Smart M-Air's own account has no public API, so this is how units are listed without typing the MAC.)
function Finder({
  onPick,
  onNone,
}: {
  onPick: (mac: string) => void;
  onNone: () => void; // a scan that found nothing new: the unit is probably not on the Wi-Fi yet
}) {
  const [state, setState] = useState<
    "idle" | "scanning" | "done" | "failed" | "slow"
  >("idle");
  const [units, setUnits] = useState<FoundUnit[]>([]);
  const [cut, setCut] = useState(false);
  const router = useRouter();
  const alive = useRef(true); // the polling loop must stop when the panel is gone
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  async function start() {
    setState("scanning");
    const posted = await fetch("/api/devices/scan", { method: "POST" }).catch(
      () => null,
    );
    if (posted && signedOut(posted, router)) return;
    if (!posted?.ok) return setState("failed");
    const t0 = Date.now();
    const poll = async () => {
      const f: {
        scanning: boolean;
        problem?: string;
        units: FoundUnit[];
      } | null = await fetch("/api/devices/scan", { cache: "no-store" })
        .then((r) => (signedOut(r, router) ? null : r.json()))
        .catch(() => null);
      if (!alive.current) return;
      if (f && !f.scanning) {
        setUnits(f.units);
        setCut(f.problem === "lan");
        if (f.units.length === 0 && f.problem !== "lan") onNone();
        return setState("done");
      }
      if (Date.now() - t0 > 90_000) return setState("slow");
      setTimeout(poll, 1500);
    };
    setTimeout(poll, 1500);
  }

  return (
    <div aria-live="polite" className="grid gap-2 px-5 pt-5 sm:px-6">
      <button
        type="button"
        disabled={state === "scanning"}
        onClick={start}
        className="h-11 rounded-lg bg-raised text-ui font-medium transition-colors enabled:hover:bg-line disabled:opacity-60"
      >
        {state === "scanning"
          ? "Scanning your network…"
          : "Find units on my network"}
      </button>
      {state === "done" && cut && (
        <p role="alert" className="text-ui text-danger">
          The bridge can&apos;t reach your network: your added units are offline
          too, so an empty list means nothing. In Docker or Podman on a Mac,
          allow the app that runs it under System Settings → Privacy &amp;
          Security → Local Network, then restart the VM from that app&apos;s
          terminal. (docs/troubleshooting.md)
        </p>
      )}
      {state === "done" &&
        !cut &&
        (units.length > 0 ? (
          <ul className="grid gap-1.5">
            {units.map((u) => (
              <li key={u.mac}>
                <button
                  type="button"
                  onClick={() => onPick(u.mac)}
                  className="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg bg-raised px-3 text-left text-ui transition-colors hover:bg-line"
                >
                  <span>
                    Adapter{" "}
                    <span className="font-mono">
                      {u.mac.slice(-4).toUpperCase()}
                    </span>
                    <span className="text-muted"> · {u.ip}</span>
                  </span>
                  <span className="text-muted">Use</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-label text-muted">
            No new adapters found. Units you already added are hidden. A unit
            that isn&apos;t on your Wi-Fi yet needs the steps below.
          </p>
        ))}
      {state === "failed" && (
        <p role="alert" className="text-ui text-danger">
          Couldn&apos;t start the scan. Try again.
        </p>
      )}
      {state === "slow" && (
        <p role="alert" className="text-ui text-danger">
          The bridge didn&apos;t answer. Check that it is running, then try
          again.
        </p>
      )}
    </div>
  );
}

function SetupMode({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: (open: boolean) => void;
}) {
  const [method, setMethod] = useState<Method>("app");
  const m = METHODS.find((x) => x.value === method)!;
  return (
    <details
      open={open}
      onToggle={(e) => onToggle(e.currentTarget.open)}
      className="group rounded-xl bg-raised"
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-3 py-1.5 text-ui [&::-webkit-details-marker]:hidden">
        <span>
          <span className="font-medium">Unit not on your Wi-Fi yet?</span>{" "}
          <span className="text-muted">Connect the unit first</span>
        </span>
        <Chevron className="size-5 shrink-0 text-muted transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-open:rotate-180" />
      </summary>
      <div className="grid gap-3 px-3 pt-1 pb-3">
        <Segmented
          legend="How do you want to connect it?"
          name="setup-method"
          options={METHODS}
          value={method}
          onChange={setMethod}
        />
        <p className="text-label text-muted">{m.about}</p>
        <ol className="grid list-decimal gap-2.5 pl-5 text-ui marker:text-muted">
          {m.steps.map((s) => (
            <li key={s.title}>
              <span className="font-medium">{s.title}.</span>{" "}
              <span className="text-muted">{s.text}</span>
              {s.notes && (
                <ul className="mt-1.5 grid list-disc gap-1 rounded-lg bg-surface py-2 pr-2.5 pl-6 text-muted">
                  {s.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </div>
    </details>
  );
}

// Add a unit that is already on the home Wi-Fi: paste what its Smart M-Air QR code says (or just the MAC) and name it.
// The bridge then finds the adapter on the network and pairs with it; the new card shows the progress.
export function AddUnit({
  suggestions,
  defaultOpen,
  onAdded,
}: {
  suggestions: string[];
  defaultOpen?: boolean; // first run: no units yet, so start with the panel open
  onAdded: () => void;
}) {
  const router = useRouter();
  const nameRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(!!defaultOpen); // decided once: adding the first unit must not close the panel that says "Added"
  const [setupOpen, setSetupOpen] = useState(false);
  const [qr, setQr] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim())
      return setMsg({ ok: false, text: "Give the unit a name." });
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qr, name: name.trim() }),
      });
      if (signedOut(res, router)) return;
      const body = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(body.error ?? "Couldn't add the unit. Try again.");
      setMsg({
        ok: true,
        text: `Added "${body.name}". Its card shows the progress while the adapter is found.`,
      });
      setQr("");
      setName("");
      onAdded();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="group mt-4 rounded-2xl border border-line bg-surface"
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-5 py-2 text-ui font-medium [&::-webkit-details-marker]:hidden">
        Add a unit
        <Chevron className="size-5 shrink-0 text-muted transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-open:rotate-180" />
      </summary>
      <div className="border-t border-line">
        <Finder
          onPick={(mac) => {
            setQr(mac);
            nameRef.current?.focus(); // the only thing left to type
          }}
          onNone={() => setSetupOpen(true)}
        />
      </div>
      <form onSubmit={add} className="grid gap-4 p-5 sm:p-6">
        <div>
          <label className="block text-label font-medium text-muted">
            Name
            <input
              ref={nameRef}
              required
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Bedroom"
              className={`${control} mt-1.5 h-11`}
            />
          </label>
          {suggestions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setName(s)}
                  className="min-h-11 rounded-full bg-raised px-3.5 text-label text-muted transition-colors hover:text-ink"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
        <label className="block text-label font-medium text-muted">
          QR code text, or the adapter&apos;s MAC
          <textarea
            required
            rows={2}
            value={qr}
            onChange={(e) => setQr(e.target.value)}
            placeholder={"MAC 348E89A1B2C3,SSID:…\nor 348E89A1B2C3"}
            spellCheck={false}
            className={`${control} mt-1.5 py-2 font-mono`}
          />
        </label>
        <p className="text-label text-muted">
          The MAC is on the unit&apos;s label and in Smart M-Air&apos;s QR code
          (you can paste the whole QR text: the Wi-Fi key in it is ignored). The
          unit must already be on your Wi-Fi.
        </p>
        {msg && (
          <p
            role={msg.ok ? "status" : "alert"}
            className={`text-ui ${msg.ok ? "text-muted" : "text-danger"}`}
          >
            {msg.text}
          </p>
        )}
        <button
          disabled={busy}
          className="h-11 rounded-lg bg-accent font-medium text-accent-ink transition-opacity hover:opacity-90 active:opacity-80 disabled:opacity-60"
        >
          {busy ? "Adding…" : "Add unit"}
        </button>
      </form>
      <div className="border-t border-line p-5 sm:p-6">
        <SetupMode open={setupOpen} onToggle={setSetupOpen} />
      </div>
    </details>
  );
}
