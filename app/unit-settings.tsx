import { useState } from "react";
import { Chevron } from "./icons";

// Remove a unit (renaming is on the card's name). It goes through the page, which owns the list; it returns an error message or nothing.
export function UnitSettings({
  name,
  mac,
  onRemove,
}: {
  name: string;
  mac: string;
  onRemove: () => Promise<string | void>;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(f: () => Promise<string | void>) {
    setBusy(true);
    setError("");
    setError((await f()) ?? "");
    setBusy(false);
  }

  return (
    <details className="group">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 text-ui font-medium text-muted transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
        Unit settings
        <Chevron className="size-5 shrink-0 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-open:rotate-180" />
      </summary>
      <div className="grid gap-4 pt-1 pb-5">
        <p className="text-label text-muted">
          The adapter is called{" "}
          <span className="font-mono">
            Smart-M-Air-{mac.slice(-4).toUpperCase()}
          </span>{" "}
          in Smart M-Air and on its label: the last 4 characters of its MAC.
        </p>

        {asking ? (
          <div className="grid gap-2 rounded-xl bg-raised p-3">
            <p className="text-ui">
              Remove {name}? Its timers are deleted and its slot on the adapter
              is freed. Energy history stays.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                disabled={busy}
                onClick={() => void run(onRemove)}
                className="h-11 rounded-lg bg-danger font-medium text-danger-ink transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                Remove
              </button>
              <button
                disabled={busy}
                onClick={() => setAsking(false)}
                className="h-11 rounded-lg bg-surface text-ui font-medium ring-1 ring-line transition-colors hover:bg-line/40"
              >
                Keep
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAsking(true)}
            className="h-11 rounded-lg text-ui font-medium text-danger ring-1 ring-line transition-colors hover:bg-raised"
          >
            Remove unit…
          </button>
        )}
        {error && (
          <p role="alert" className="text-ui text-danger">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
