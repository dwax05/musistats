import type { ReactNode } from "react";

type Segment<T extends string> = { value: T; label: ReactNode };

type SegmentedControlProps<T extends string> = {
  ariaLabel: string;
  options: readonly Segment<T>[];
  value: T;
  onChange: (value: T) => void;
};

export default function SegmentedControl<T extends string>({
  ariaLabel,
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));

  return (
    <div
      aria-label={ariaLabel}
      className="relative grid w-fit rounded-xl border border-border-app bg-surface p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-1 left-1 rounded-lg bg-accent shadow-[0_2px_0_#087c30] transition-transform duration-200 ease-out"
        style={{
          width: `calc((100% - 0.5rem) / ${options.length})`,
          transform: `translateX(${selectedIndex * 100}%)`,
        }}
      />
      {options.map((option) => {
        const selected = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={selected}
            className={`relative rounded-lg px-3 py-2 text-xs font-semibold transition-colors sm:px-4 ${selected ? "text-accent-fg" : "text-muted hover:text-fg"}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
