'use client';

import {
  cloneElement,
  isValidElement,
  useId,
  type ComponentPropsWithRef,
  type ReactNode,
} from 'react';
import { cn } from '../../lib/class-names';

export const inputClass =
  'min-h-9 w-full rounded-control border border-border bg-surface px-2.5 text-body font-normal text-ink outline-none focus:border-primary focus:shadow-[inset_0_0_0_1px_var(--color-primary)] aria-invalid:border-danger';
export const labelClass = 'grid gap-1 text-caption font-[650] text-ink';

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
        <span id={errorId} className="text-caption font-normal text-danger">
          {error}
        </span>
      ) : null}
    </label>
  );
}

/**
 * Form-level error from the server, announced when it appears. Renders nothing when empty.
 * Pass `ref` with `tabIndex={-1}` to move focus to the message.
 */
export function FormError({
  message,
  className,
  ...props
}: Omit<ComponentPropsWithRef<'p'>, 'children'> & { message: string }) {
  return message ? (
    <p
      role="alert"
      {...props}
      className={cn(
        'm-0 rounded-control border border-danger/40 bg-danger/5 px-3 py-2.5 text-small text-danger',
        className,
      )}
    >
      {message}
    </p>
  ) : null;
}
