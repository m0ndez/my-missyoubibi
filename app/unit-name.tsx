import { useEffect, useRef, useState } from "react";
import { control } from "./control";

// A unit's name on its card. Tap it to rename in place: Enter saves, Esc cancels. The quick picks fill the box, they don't save.
export function UnitName({
  name,
  suggestions,
  onEditing,
  onRename,
}: {
  name: string;
  suggestions: string[];
  onEditing: (editing: boolean) => void; // the card hides its power switch meanwhile, so this can use the full width
  onRename: (name: string) => Promise<string | void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const renameButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    // The input or Save/Cancel the user was on is gone after closing: put keyboard focus back on the name.
    if (wasEditing.current && !editing) renameButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  const edit = (on: boolean) => {
    setEditing(on);
    onEditing(on);
  };

  if (!editing)
    return (
      <h2 className="text-title font-semibold">
        <button
          ref={renameButton}
          type="button"
          aria-label={`Rename ${name}`}
          onClick={() => {
            setValue(name);
            setError("");
            edit(true);
          }}
          className="-mx-1.5 flex min-h-11 max-w-full items-center gap-1.5 rounded-lg px-1.5 text-left transition-colors hover:bg-raised"
        >
          <span className="truncate">{name}</span>
          <svg
            aria-hidden
            viewBox="0 0 16 16"
            className="size-3.5 shrink-0 text-muted"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10.5 2.5l3 3L5 14H2v-3z" />
          </svg>
        </button>
      </h2>
    );

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) return setError("Give the unit a name.");
    if (value.trim() === name) return edit(false);
    setBusy(true);
    const err = await onRename(value.trim());
    setBusy(false);
    if (err) setError(err);
    else edit(false);
  }

  return (
    <form
      onSubmit={save}
      onKeyDown={(e) => e.key === "Escape" && edit(false)}
      className="grid gap-3 pb-5"
    >
      <input
        autoFocus
        required
        maxLength={40}
        aria-label={`New name for ${name}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.target.select()}
        className={`${control} h-11`}
      />
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setValue(s)}
              className="min-h-11 rounded-full bg-raised px-3.5 text-label text-muted transition-colors hover:text-ink"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="text-ui text-danger">
          {error}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button
          disabled={busy}
          className="h-11 rounded-lg bg-accent text-ui font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => edit(false)}
          className="h-11 rounded-lg bg-surface text-ui font-medium ring-1 ring-line transition-colors hover:bg-line/40"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
