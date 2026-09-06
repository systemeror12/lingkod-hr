'use client';

import { cloneElement, isValidElement, useId, type ReactNode } from 'react';

export const inputClass =
  'min-h-10 w-full rounded-[3px] border border-line bg-paper px-3 text-sm text-ink outline-none focus:border-cobalt focus:ring-2 focus:ring-cobalt/15';
export const labelClass = 'grid gap-1.5 text-xs font-[650] text-ink';

/** Wrap one control in its label and associate any server validation error. */
export function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  error?: string | undefined;
  children: ReactNode;
}) {
  const errorId = useId();
  const control =
    error && isValidElement<{ 'aria-describedby'?: string; 'aria-invalid'?: boolean }>(children)
      ? cloneElement(children, {
          'aria-invalid': true,
          'aria-describedby': [children.props['aria-describedby'], errorId]
            .filter(Boolean)
            .join(' '),
        })
      : children;
  return (
    <label className={labelClass} htmlFor={htmlFor}>
      <span>{label}</span>
      {control}
      {error ? (
        <span id={errorId} className="text-xs text-[#9a3030]">
          {error}
        </span>
      ) : null}
    </label>
  );
}

export function FormError({ message }: { message: string }) {
  return message ? (
    <p
      role="alert"
      className="m-0 rounded-[3px] border border-[#e8b6b6] bg-[#fff4f4] px-3 py-3 text-[13px] text-[#9a3030]"
    >
      {message}
    </p>
  ) : null;
}
