'use client';

// PROTOTYPE (#398). Form parts shared by the public scene variants. Throwaway; do not import.

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '../../components/ui/button';
import { Field, inputClass } from '../../components/ui/field';
import { cn } from '../../lib/class-names';
import { user } from './fake-states';
import type { FieldKey, FieldSpec, StepView } from './public-flows';

export type VariantProps = {
  view: StepView;
  busy: boolean;
  submit(next: () => void): void;
  /** Changes on every fake state; variants that persist across steps key their body by it. */
  stateKey?: string;
};

export type Mode = 'code' | 'recovery';

function checked(event: { currentTarget: unknown }) {
  return (event.currentTarget as { checked: boolean }).checked;
}

export function copy(text: string) {
  const clipboard = (
    globalThis as unknown as { navigator?: { clipboard?: { writeText(v: string): Promise<void> } } }
  ).navigator?.clipboard;
  void clipboard?.writeText(text).catch(() => undefined);
}

export function useFactorMode(view: StepView): [Mode, (mode: Mode) => void] {
  const [mode, setMode] = useState<Mode>(view.factor?.current ?? 'code');
  return [
    mode,
    (next) => {
      if (next === 'code' && view.factor?.toCode) return view.factor.toCode();
      if (next === 'recovery' && view.factor?.toRecovery) return view.factor.toRecovery();
      setMode(next);
    },
  ];
}

/** Ticks once a second. Only the text changes, so it stays cheap on high-refresh displays. */
export function useCountdown(seconds: number | undefined) {
  const [left, setLeft] = useState(seconds ?? 0);
  useEffect(() => {
    if (!seconds) return;
    const started = Date.now();
    const timer = setInterval(
      () => setLeft(Math.max(0, seconds - Math.floor((Date.now() - started) / 1000))),
      1000,
    );
    return () => clearInterval(timer);
  }, [seconds]);
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

export function onSubmit(props: VariantProps, acknowledged: boolean) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const { primary } = props.view;
    if (!primary || props.busy || props.view.wait) return;
    if (primary.requiresAck && !acknowledged) return;
    props.submit(primary.next);
  };
}

const fieldLabels: Record<FieldKey, string> = {
  email: 'Email',
  password: 'Password',
  'new-password': 'New password',
  name: 'Full name',
  code: 'Authentication code',
  recovery: 'Recovery Code',
};

export function FieldInput({
  spec,
  mode,
  error,
  segmentedCode = false,
}: {
  spec: FieldSpec;
  mode: Mode;
  error?: string | undefined;
  segmentedCode?: boolean;
}) {
  const kind = spec.kind === 'code' && mode === 'recovery' ? 'recovery' : spec.kind;
  if (kind === 'code' && segmentedCode) return <SegmentedCode error={error} />;
  const input = (() => {
    switch (kind) {
      case 'email':
        return spec.kind === 'email' && spec.readOnly ? (
          <input className={cn(inputClass, 'bg-canvas')} readOnly value={user.email} />
        ) : (
          <input className={inputClass} type="email" autoComplete="username" />
        );
      case 'password':
        return <input className={inputClass} type="password" autoComplete="current-password" />;
      case 'new-password':
        return <input className={inputClass} type="password" autoComplete="new-password" />;
      case 'name':
        return <input className={inputClass} autoComplete="name" />;
      case 'code':
        return (
          <input
            className={cn(inputClass, 'font-mono tracking-[0.3em]')}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            placeholder="123456"
          />
        );
      default:
        return (
          <input
            className={cn(inputClass, 'font-mono tracking-[0.12em]')}
            autoComplete="off"
            placeholder="xxxxx-xxxxx"
          />
        );
    }
  })();
  return (
    <div className="grid gap-1">
      <Field label={fieldLabels[kind]} error={error}>
        {input}
      </Field>
      {kind === 'new-password' ? (
        <span className="text-caption text-ink-muted">
          15 to 128 characters. Spaces are fine. Don’t use your name or email.
        </span>
      ) : null}
    </div>
  );
}

function SegmentedCode({ error }: { error?: string | undefined }) {
  const refs = useRef<({ focus(): void } | null)[]>([]);
  return (
    <fieldset className="m-0 grid gap-1.5 border-0 p-0">
      <legend className="mb-1 text-caption font-[650] text-ink">Authentication code</legend>
      <div className="flex gap-2">
        {Array.from({ length: 6 }, (_, index) => (
          <input
            key={index}
            ref={(element) => {
              refs.current[index] = element as unknown as { focus(): void } | null;
            }}
            aria-label={`Digit ${index + 1}`}
            aria-invalid={error ? true : undefined}
            inputMode="numeric"
            maxLength={1}
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            className={cn(inputClass, 'h-12 w-11 text-center font-mono text-[1.25rem]')}
            onChange={(event) => {
              if ((event.currentTarget as unknown as { value: string }).value)
                refs.current[index + 1]?.focus();
            }}
          />
        ))}
      </div>
    </fieldset>
  );
}

/** Deterministic QR-looking grid. Not a real QR code. */
export function FakeQr({ size = 168 }: { size?: number }) {
  const cells = 25;
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const finder = (x: number, y: number) =>
    [
      [0, 0],
      [cells - 7, 0],
      [0, cells - 7],
    ].some(([fx = 0, fy = 0]) => x >= fx && x < fx + 7 && y >= fy && y < fy + 7);
  const finderOn = (x: number, y: number) => {
    const fx = x >= cells - 7 ? x - (cells - 7) : x;
    const fy = y >= cells - 7 ? y - (cells - 7) : y;
    const edge = fx === 0 || fx === 6 || fy === 0 || fy === 6;
    const core = fx >= 2 && fx <= 4 && fy >= 2 && fy <= 4;
    return edge || core;
  };
  const rects: ReactNode[] = [];
  for (let y = 0; y < cells; y++)
    for (let x = 0; x < cells; x++) {
      const on = finder(x, y) ? finderOn(x, y) : random() > 0.52;
      if (on) rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} />);
    }
  return (
    <svg
      role="img"
      aria-label="QR code for your authenticator app (prototype placeholder)"
      viewBox={`-2 -2 ${cells + 4} ${cells + 4}`}
      width={size}
      height={size}
      className="rounded-control border border-border bg-white fill-ink"
    >
      {rects}
    </svg>
  );
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={() => {
        copy(text);
        setDone(true);
      }}
    >
      {done ? 'Copied' : label}
    </Button>
  );
}

export function Ack({
  value,
  onChange,
  className,
}: {
  value: boolean;
  onChange(v: boolean): void;
  className?: string;
}) {
  return (
    <label className={cn('flex items-start gap-2.5 text-small text-ink', className)}>
      <input
        type="checkbox"
        className="mt-0.5 size-4 accent-primary"
        checked={value}
        onChange={(event) => onChange(checked(event))}
      />
      <span>I’ve saved these Recovery Codes somewhere safe.</span>
    </label>
  );
}

export function PrimaryButton({
  view,
  busy,
  acknowledged,
  waitLabel,
}: {
  view: StepView;
  busy: boolean;
  acknowledged: boolean;
  waitLabel?: string | undefined;
}) {
  if (!view.primary) return null;
  const blocked = Boolean(view.wait) || (view.primary.requiresAck && !acknowledged);
  return (
    <Button variant="primary" className="min-h-11" type="submit" disabled={busy || blocked}>
      {busy ? view.primary.busyLabel : view.wait && waitLabel ? waitLabel : view.primary.label}
    </Button>
  );
}

export function fieldError(view: StepView, kind: FieldKey, mode: Mode) {
  const shown = kind === 'code' && mode === 'recovery' ? 'recovery' : kind;
  return view.error?.field === shown || (view.error?.field === 'recovery' && kind === 'code')
    ? view.error.message
    : undefined;
}
