'use client';

import { useId } from 'react';

/** Picked option values, keyed by filter group. */
export type FilterSelection = Record<string, string[]>;

export type FilterGroup = {
  key: string;
  label: string;
  /** `count` is the number of records that carry this value, computed by the caller. */
  options: { value: string; label: string; count: number }[];
};

/** Add or remove one option value within its group. */
export function toggleFilter(selected: FilterSelection, key: string, value: string) {
  const values = selected[key] ?? [];
  return {
    ...selected,
    [key]: values.includes(value) ? values.filter((item) => item !== value) : [...values, value],
  };
}

/**
 * Side panel of grouped checkbox filters for a register. The caller owns the selection and
 * applies it to its rows; this component only renders options and reports toggles.
 */
export function FilterPanel({
  title = 'Filters',
  groups,
  selected,
  onChange,
}: {
  title?: string;
  groups: FilterGroup[];
  selected: FilterSelection;
  onChange: (next: FilterSelection) => void;
}) {
  const titleId = useId();
  return (
    <aside
      aria-labelledby={titleId}
      className="self-start rounded-panel border border-border bg-surface"
    >
      <h2 id={titleId} className="m-0 border-b border-border px-4 py-3 text-panel-title">
        {title}
      </h2>
      {groups.map((group) => (
        <fieldset
          key={group.key}
          className="m-0 min-w-0 border-0 border-b border-border-subtle px-4 py-3 last:border-b-0"
        >
          <legend className="float-left mb-1.5 w-full p-0 text-caption font-[650] text-ink-muted">
            {group.label}
          </legend>
          {group.options.map((option) => (
            <label
              key={option.value}
              className="clear-left flex cursor-pointer items-center gap-2 py-1 text-small"
            >
              <input
                type="checkbox"
                className="size-3.5 accent-primary"
                checked={selected[group.key]?.includes(option.value) ?? false}
                onChange={() => onChange(toggleFilter(selected, group.key, option.value))}
              />
              <span className="flex-1">{option.label}</span>{' '}
              <span className="text-caption text-ink-muted tabular-nums">{option.count}</span>
            </label>
          ))}
        </fieldset>
      ))}
    </aside>
  );
}
