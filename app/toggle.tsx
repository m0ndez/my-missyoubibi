// Compact on/off row for secondary settings (3D auto, silent). The main power switch lives in the card header.
export function Toggle({
  label,
  checked,
  disabled,
  className = "",
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  className?: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex min-h-14 w-full items-center justify-between gap-3 text-ui font-medium text-ink disabled:opacity-40 ${className}`}
    >
      {label}
      <span
        className={`relative h-6 w-10 shrink-0 rounded-full transition-colors duration-200 ${checked ? "bg-accent" : "bg-surface ring-1 ring-edge ring-inset"}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 size-5 rounded-full transition-transform duration-200 ${checked ? "translate-x-4 bg-surface" : "bg-muted"}`}
        />
      </span>
    </button>
  );
}
