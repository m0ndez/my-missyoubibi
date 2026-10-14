// Native radio group (arrow keys, form semantics for free) drawn as a segmented control.
export function Segmented<T extends string>({
  legend,
  name,
  options,
  value,
  onChange,
  disabled,
}: {
  legend: string;
  name: string;
  options: readonly { value: T; label: string }[];
  value: T | null; // null = nothing selected (state unknown)
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset
      disabled={disabled}
      className="min-w-0 border-0 p-0 transition-opacity disabled:opacity-40"
    >
      <legend className="mb-2 text-label font-medium text-muted">
        {legend}
      </legend>
      <div
        className="grid gap-1 rounded-xl bg-raised p-1"
        style={{
          gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
        }}
      >
        {options.map((o) => (
          <label key={o.value}>
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="peer sr-only"
            />
            <span className="grid min-h-11 cursor-pointer place-items-center rounded-lg text-ui font-medium text-muted transition-colors duration-150 hover:text-ink peer-checked:bg-surface peer-checked:text-ink peer-checked:ring-1 peer-checked:ring-edge peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-accent peer-disabled:cursor-default">
              {o.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
