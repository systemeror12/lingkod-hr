'use client';

// PROTOTYPE (#398). Three layouts for the same public step model. Throwaway; do not import.

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  InvitationKicker,
  InvitationLayout,
  InvitationTitle,
} from '../../components/invitation-layout';
import { Button } from '../../components/ui/button';
import { Field, FormError, inputClass } from '../../components/ui/field';
import { cn } from '../../lib/class-names';
import { manualSecret, otpauthUri, recoveryCodes, user } from './fake-states';
import type { FieldKey, FieldSpec, StepView } from './public-flows';

export type VariantProps = { view: StepView; busy: boolean; submit(next: () => void): void };

type Mode = 'code' | 'recovery';

function checked(event: { currentTarget: unknown }) {
  return (event.currentTarget as { checked: boolean }).checked;
}

function copy(text: string) {
  const clipboard = (
    globalThis as unknown as { navigator?: { clipboard?: { writeText(v: string): Promise<void> } } }
  ).navigator?.clipboard;
  void clipboard?.writeText(text).catch(() => undefined);
}

function useFactorMode(view: StepView): [Mode, (mode: Mode) => void] {
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
function useCountdown(seconds: number | undefined) {
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

function onSubmit(props: VariantProps, acknowledged: boolean) {
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

function FieldInput({
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
function FakeQr({ size = 168 }: { size?: number }) {
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

function CopyButton({ text, label }: { text: string; label: string }) {
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

function Ack({
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

function PrimaryButton({
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

function fieldError(view: StepView, kind: FieldKey, mode: Mode) {
  const shown = kind === 'code' && mode === 'recovery' ? 'recovery' : kind;
  return view.error?.field === shown || (view.error?.field === 'recovery' && kind === 'code')
    ? view.error.message
    : undefined;
}

/* ───────────────────────── Variant A: single card ───────────────────────── */

/** One card; each step replaces the last. Errors and waits show as a banner above the form. */
export function SingleCard(props: VariantProps) {
  const { view, busy } = props;
  const [mode, setMode] = useFactorMode(view);
  const [ack, setAck] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const outcome = view.outcome;

  return (
    <InvitationLayout labelledBy="proto-title" showMark>
      <div className="grid gap-2">
        <InvitationKicker>{outcome?.kicker ?? view.kicker}</InvitationKicker>
        <InvitationTitle id="proto-title">{outcome?.title ?? view.title}</InvitationTitle>
        {outcome ? (
          <p className="m-0 text-body text-ink-muted">{outcome.body}</p>
        ) : view.lead ? (
          <p className="m-0 text-body text-ink-muted">{view.lead}</p>
        ) : null}
        {view.identity && !outcome ? (
          <p className="m-0 text-small text-ink">
            Signing in as <strong>{view.identity}</strong>
          </p>
        ) : null}
      </div>

      {outcome ? (
        <div className="grid gap-2">
          {outcome.action ? (
            <Button variant="primary" className="min-h-11" onClick={outcome.action.go}>
              {outcome.action.label}
            </Button>
          ) : null}
          {outcome.secondary ? (
            <Button onClick={outcome.secondary.go}>{outcome.secondary.label}</Button>
          ) : null}
        </div>
      ) : view.codesLeft ? (
        <div className="grid gap-3">
          <div
            className={cn(
              'rounded-panel border px-4 py-3',
              view.codesLeft.count > 0 ? 'border-border bg-canvas' : 'border-danger/40 bg-danger/5',
            )}
          >
            <span className="block text-[2rem] leading-none font-[700] text-ink">
              {view.codesLeft.count}
            </span>
            <span className="text-small text-ink-muted">Recovery Codes left</span>
          </div>
          {view.codesLeft.actions.map((action) => (
            <Button
              key={action.label}
              variant={action.primary ? 'primary' : 'quiet'}
              className="min-h-11"
              onClick={action.go}
            >
              {action.label}
            </Button>
          ))}
        </div>
      ) : (
        <form className="grid gap-4" onSubmit={onSubmit(props, ack)} noValidate>
          <FormError message={view.wait?.message ?? view.error?.message ?? ''} />
          {view.enrollment === 'scan' ? (
            <div className="grid justify-items-center gap-3">
              <FakeQr />
              <Button type="button" onClick={() => setShowKey(!showKey)}>
                {showKey ? 'Hide setup key' : 'Can’t scan? Show the setup key'}
              </Button>
              {showKey ? (
                <div className="grid w-full gap-2 rounded-control border border-border bg-canvas p-3">
                  <code className="text-small break-all">{manualSecret}</code>
                  <code className="text-caption break-all text-ink-muted">{otpauthUri}</code>
                  <div className="flex gap-2">
                    <CopyButton text={manualSecret.replaceAll(' ', '')} label="Copy key" />
                    <CopyButton text={otpauthUri} label="Copy otpauth:// link" />
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          {view.enrollment === 'codes' ? (
            <>
              <ol className="m-0 grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-control border border-border bg-canvas p-4 font-mono text-body">
                {recoveryCodes.map((code) => (
                  <li key={code} className="ml-5">
                    {code}
                  </li>
                ))}
              </ol>
              <div className="flex gap-2">
                <CopyButton text={recoveryCodes.join('\n')} label="Copy all" />
                <Button type="button" variant="secondary">
                  Download .txt
                </Button>
              </div>
              <Ack value={ack} onChange={setAck} />
            </>
          ) : null}
          {view.fields?.map((spec) => (
            <FieldInput key={spec.kind} spec={spec} mode={mode} />
          ))}
          <PrimaryButton view={view} busy={busy} acknowledged={ack} />
          {view.factor ? (
            <Button
              type="button"
              onClick={() => setMode(mode === 'code' ? 'recovery' : 'code')}
              disabled={busy}
            >
              {mode === 'code' ? 'Use a Recovery Code instead' : 'Use your authenticator code'}
            </Button>
          ) : null}
          {view.secondary?.map((action) => (
            <Button key={action.label} type="button" onClick={action.go} disabled={busy}>
              {action.label}
            </Button>
          ))}
          {view.footnote && mode === 'recovery' ? (
            <p className="m-0 text-caption text-ink-muted">{view.footnote}</p>
          ) : null}
          {view.pendingSeconds ? (
            <p className="m-0 text-caption text-ink-muted">
              This step times out after {view.pendingSeconds / 60} minutes.
            </p>
          ) : null}
        </form>
      )}
    </InvitationLayout>
  );
}

/* ───────────────────────── Variant B: step rail ───────────────────────── */

const toneBorder = {
  danger: 'border-l-danger',
  warning: 'border-l-warning',
  success: 'border-l-success',
};
const toneText = { danger: 'text-danger', warning: 'text-warning', success: 'text-success' };

/**
 * Wide panel: the whole journey in a left rail, the current step on the right. Field errors sit
 * under the field; waits and terminal errors replace the form with a state panel.
 */
export function StepRail(props: VariantProps) {
  const { view, busy } = props;
  const [mode, setMode] = useFactorMode(view);
  const [ack, setAck] = useState(false);
  const countdown = useCountdown(view.pendingSeconds);
  const unplaced = view.error && !view.error.field ? view.error.message : '';

  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-5 py-10 text-ink">
      <section
        aria-labelledby="proto-title"
        className="grid w-full max-w-[880px] overflow-hidden rounded-panel border border-border bg-surface min-[760px]:grid-cols-[240px_minmax(0,1fr)]"
      >
        <aside className="grid content-start gap-6 bg-nav p-6 text-nav-ink">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-control bg-nav-focus text-small font-bold text-nav">
              L
            </span>
            <span className="text-small font-[650]">{view.flow}</span>
          </div>
          <ol className="m-0 grid list-none gap-1 p-0">
            {view.rail.map((step, index) => (
              <li
                key={step.label}
                aria-current={step.status === 'current' ? 'step' : undefined}
                className={cn(
                  'flex items-center gap-2.5 rounded-control px-2 py-2 text-small',
                  step.status === 'current' && 'bg-white/10 font-[650]',
                  step.status === 'todo' && 'text-nav-muted',
                )}
              >
                <span
                  className={cn(
                    'grid size-6 shrink-0 place-items-center rounded-full border text-caption',
                    step.status === 'done'
                      ? 'border-nav-focus bg-nav-focus text-nav'
                      : step.status === 'current'
                        ? 'border-nav-ink'
                        : 'border-nav-muted',
                  )}
                >
                  {step.status === 'done' ? '✓' : index + 1}
                </span>
                {step.label}
              </li>
            ))}
          </ol>
          {view.identity ? (
            <div className="grid gap-0.5 border-t border-white/10 pt-4 text-caption">
              <span className="text-nav-muted">Account</span>
              <span className="break-all">{view.identity}</span>
            </div>
          ) : null}
          {view.pendingSeconds && !view.outcome ? (
            <div className="grid gap-0.5 text-caption">
              <span className="text-nav-muted">{view.pendingLabel}</span>
              <span className="font-mono text-small">in {countdown}</span>
            </div>
          ) : null}
        </aside>

        <div className="grid content-start gap-5 p-7 min-[621px]:p-10">
          <div className="grid gap-1.5">
            <InvitationKicker>{view.kicker}</InvitationKicker>
            <InvitationTitle id="proto-title">{view.title}</InvitationTitle>
            {view.lead && !view.outcome && !view.wait ? (
              <p className="m-0 text-body text-ink-muted">{view.lead}</p>
            ) : null}
          </div>

          {view.outcome || view.wait ? (
            <div
              className={cn(
                'grid gap-3 rounded-panel border border-l-4 border-border p-5',
                view.outcome ? toneBorder[view.outcome.tone] : 'border-l-warning',
              )}
            >
              <span
                className={cn(
                  'text-caption font-[650] tracking-[0.08em] uppercase',
                  view.outcome ? toneText[view.outcome.tone] : 'text-warning',
                )}
              >
                {view.outcome?.kicker ?? 'Please wait'}
              </span>
              {view.wait ? (
                <>
                  <span className="text-[2rem] leading-none font-[700]">
                    {view.wait.minutesLeft} min
                  </span>
                  <p className="m-0 text-body text-ink-muted">{view.wait.message}</p>
                  <p className="m-0 text-caption text-ink-muted">
                    Waiting doesn’t lock your account. Each new cool-down for this email is longer.
                  </p>
                  {view.secondary?.map((action) => (
                    <Button key={action.label} className="justify-self-start" onClick={action.go}>
                      {action.label}
                    </Button>
                  ))}
                </>
              ) : view.outcome ? (
                <>
                  {view.outcome.title !== view.title ? (
                    <strong className="text-body">{view.outcome.title}</strong>
                  ) : null}
                  <p className="m-0 text-body text-ink-muted">{view.outcome.body}</p>
                  <div className="flex flex-wrap gap-2">
                    {view.outcome.action ? (
                      <Button variant="primary" onClick={view.outcome.action.go}>
                        {view.outcome.action.label}
                      </Button>
                    ) : null}
                    {view.outcome.secondary ? (
                      <Button onClick={view.outcome.secondary.go}>
                        {view.outcome.secondary.label}
                      </Button>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
          ) : view.codesLeft ? (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <span className="text-small font-[650]">
                  {view.codesLeft.count} of 10 Recovery Codes left
                </span>
                <div className="flex gap-1" aria-hidden="true">
                  {Array.from({ length: 10 }, (_, index) => (
                    <span
                      key={index}
                      className={cn(
                        'h-2 flex-1 rounded-full',
                        index < view.codesLeft!.count
                          ? 'bg-primary'
                          : view.codesLeft!.count === 0
                            ? 'bg-danger/30'
                            : 'bg-border',
                      )}
                    />
                  ))}
                </div>
                <p className="m-0 text-body text-ink-muted">{view.lead}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {view.codesLeft.actions.map((action) => (
                  <Button
                    key={action.label}
                    variant={action.primary ? 'primary' : 'secondary'}
                    onClick={action.go}
                  >
                    {action.label}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <form className="grid gap-4" onSubmit={onSubmit(props, ack)} noValidate>
              {view.enrollment === 'scan' ? (
                <ol className="m-0 grid list-none gap-4 p-0">
                  <li className="grid gap-1">
                    <strong className="text-small">1. Install an authenticator app</strong>
                    <span className="text-small text-ink-muted">
                      Google Authenticator, Microsoft Authenticator, or any TOTP app.
                    </span>
                  </li>
                  <li className="grid gap-2">
                    <strong className="text-small">2. Scan the QR code, or enter the key</strong>
                    <div className="flex flex-wrap items-start gap-4">
                      <FakeQr size={140} />
                      <div className="grid min-w-0 flex-1 gap-2 text-small">
                        <span className="text-caption text-ink-muted">Setup key</span>
                        <code className="break-all">{manualSecret}</code>
                        <details>
                          <summary className="cursor-pointer text-caption text-primary">
                            Show otpauth:// link
                          </summary>
                          <code className="mt-1 block text-caption break-all text-ink-muted">
                            {otpauthUri}
                          </code>
                        </details>
                      </div>
                    </div>
                  </li>
                  <li>
                    <strong className="text-small">3. Enter the code the app shows</strong>
                  </li>
                </ol>
              ) : null}
              {view.enrollment === 'codes' ? (
                <>
                  <table className="w-full border-collapse font-mono text-body">
                    <tbody>
                      {Array.from({ length: 5 }, (_, row) => (
                        <tr key={row} className="border-b border-border-subtle">
                          {[row, row + 5].map((index) => (
                            <td key={index} className="py-1.5">
                              <span className="mr-2 text-caption text-ink-muted">{index + 1}.</span>
                              {recoveryCodes[index]}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="flex flex-wrap gap-2">
                    <CopyButton text={recoveryCodes.join('\n')} label="Copy" />
                    <Button type="button" variant="secondary">
                      Download
                    </Button>
                    <Button type="button" variant="secondary">
                      Print
                    </Button>
                  </div>
                  <Ack
                    value={ack}
                    onChange={setAck}
                    className="rounded-control border border-warning/50 bg-warning/5 p-3"
                  />
                </>
              ) : null}
              {view.factor ? (
                <div
                  role="radiogroup"
                  aria-label="Verify with"
                  className="grid gap-2 min-[621px]:grid-cols-2"
                >
                  {(
                    [
                      ['code', 'Authenticator app', '6-digit code'],
                      ['recovery', 'Recovery Code', 'One of your saved codes'],
                    ] as const
                  ).map(([key, title, note]) => (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={mode === key}
                      onClick={() => setMode(key)}
                      className={cn(
                        'grid cursor-pointer gap-0.5 rounded-control border p-3 text-left',
                        mode === key ? 'border-primary bg-primary/5' : 'border-border bg-surface',
                      )}
                    >
                      <span className="text-small font-[650]">{title}</span>
                      <span className="text-caption text-ink-muted">{note}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              {view.fields?.map((spec) => (
                <FieldInput
                  key={spec.kind}
                  spec={spec}
                  mode={mode}
                  error={fieldError(view, spec.kind, mode)}
                />
              ))}
              <FormError message={unplaced} />
              <div className="flex flex-wrap items-center gap-2">
                <PrimaryButton view={view} busy={busy} acknowledged={ack} />
                {view.secondary?.map((action) => (
                  <Button key={action.label} type="button" onClick={action.go} disabled={busy}>
                    {action.label}
                  </Button>
                ))}
              </div>
              {view.footnote && mode === 'recovery' ? (
                <p className="m-0 text-caption text-ink-muted">{view.footnote}</p>
              ) : null}
            </form>
          )}
        </div>
      </section>
    </main>
  );
}

/* ───────────────────────── Variant C: context strip ───────────────────────── */

const stripTone = {
  danger: 'bg-danger text-white',
  warning: 'bg-warning text-white',
  success: 'bg-success text-white',
};

/**
 * Narrow card with a strip on top that carries who, where, and how long. The strip changes colour
 * for outcomes. Second factor is a tab pair; the code is six boxes; errors sit under the button.
 */
export function ContextStrip(props: VariantProps) {
  const { view, busy } = props;
  const [mode, setMode] = useFactorMode(view);
  const [ack, setAck] = useState(false);
  const countdown = useCountdown(view.pendingSeconds);
  const outcome = view.outcome;
  const message = view.wait?.message ?? view.error?.message;

  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-5 py-10 text-ink">
      <section
        aria-labelledby="proto-title"
        className="w-full max-w-[480px] overflow-hidden rounded-panel border border-border bg-surface shadow-[0_12px_40px_rgb(15_34_64/10%)]"
      >
        <header
          className={cn(
            'grid gap-1 px-6 py-4',
            outcome ? stripTone[outcome.tone] : 'bg-nav text-nav-ink',
          )}
        >
          <div className="flex items-center justify-between gap-3 text-caption">
            <span className="font-[650] tracking-[0.08em] uppercase">
              {outcome?.kicker ?? `${view.flow} · ${view.kicker}`}
            </span>
            {view.pendingSeconds && !outcome ? (
              <span
                className="rounded-full bg-white/10 px-2 py-0.5 font-mono"
                title={view.pendingLabel}
              >
                ⏱ {countdown}
              </span>
            ) : null}
          </div>
          {view.identity ? (
            <div className="flex items-center gap-2 text-small">
              <span className="grid size-6 place-items-center rounded-full bg-white/20 text-[10px] font-bold">
                MS
              </span>
              <span className="truncate">{view.identity}</span>
            </div>
          ) : null}
        </header>

        <div className="grid gap-4 p-6">
          <div className="grid gap-1.5">
            <h1 id="proto-title" className="m-0 text-page-title text-ink">
              {outcome?.title ?? view.title}
            </h1>
            {outcome ? (
              <p className="m-0 text-body text-ink-muted">{outcome.body}</p>
            ) : view.lead ? (
              <p className="m-0 text-body text-ink-muted">{view.lead}</p>
            ) : null}
          </div>

          {outcome ? (
            <div className="flex flex-wrap gap-2">
              {outcome.action ? (
                <Button variant="primary" className="min-h-11 flex-1" onClick={outcome.action.go}>
                  {outcome.action.label}
                </Button>
              ) : null}
              {outcome.secondary ? (
                <Button className="min-h-11" onClick={outcome.secondary.go}>
                  {outcome.secondary.label}
                </Button>
              ) : null}
            </div>
          ) : view.codesLeft ? (
            <ul className="m-0 grid list-none gap-0 divide-y divide-border-subtle rounded-control border border-border p-0">
              <li className="flex items-center justify-between px-3 py-2.5 text-small">
                <span>Recovery Codes left</span>
                <strong className={view.codesLeft.count === 0 ? 'text-danger' : ''}>
                  {view.codesLeft.count}
                </strong>
              </li>
              {view.codesLeft.actions.map((action) => (
                <li key={action.label}>
                  <button
                    type="button"
                    onClick={action.go}
                    className={cn(
                      'flex w-full cursor-pointer items-center justify-between px-3 py-2.5 text-left text-small hover:bg-canvas',
                      action.primary && 'font-[650] text-primary',
                    )}
                  >
                    {action.label}
                    <span aria-hidden="true">›</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <form className="grid gap-4" onSubmit={onSubmit(props, ack)} noValidate>
              {view.factor ? (
                <div role="tablist" className="grid grid-cols-2 rounded-control bg-canvas p-1">
                  {(
                    [
                      ['code', 'Authenticator'],
                      ['recovery', 'Recovery Code'],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={mode === key}
                      onClick={() => setMode(key)}
                      className={cn(
                        'cursor-pointer rounded-[6px] py-1.5 text-small',
                        mode === key ? 'bg-surface font-[650] shadow-sm' : 'text-ink-muted',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              ) : null}
              {view.enrollment === 'scan' ? (
                <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-4">
                  <FakeQr size={128} />
                  <div className="grid gap-2 text-small">
                    <span className="text-caption text-ink-muted">Or enter this key</span>
                    <code className="text-caption break-all">{manualSecret}</code>
                    <a className="text-caption text-primary" href={otpauthUri}>
                      Open in authenticator app (on this phone)
                    </a>
                  </div>
                </div>
              ) : null}
              {view.enrollment === 'codes' ? (
                <>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-control bg-nav p-4 font-mono text-body text-nav-ink">
                    {recoveryCodes.map((code) => (
                      <span key={code}>{code}</span>
                    ))}
                  </div>
                  <CopyButton text={recoveryCodes.join('\n')} label="Copy all 10 codes" />
                  <Ack value={ack} onChange={setAck} className="rounded-control bg-canvas p-3" />
                </>
              ) : null}
              {view.fields?.map((spec) => (
                <FieldInput key={spec.kind} spec={spec} mode={mode} segmentedCode />
              ))}
              {view.footnote && mode === 'recovery' ? (
                <p className="m-0 text-caption text-ink-muted">{view.footnote}</p>
              ) : null}
              <PrimaryButton
                view={view}
                busy={busy}
                acknowledged={ack}
                waitLabel={view.wait ? `Try again in ${view.wait.minutesLeft} min` : undefined}
              />
              {message ? (
                <p role="alert" className="-mt-2 m-0 text-small text-danger">
                  {message}
                </p>
              ) : null}
              <div className="flex flex-wrap justify-center gap-x-4">
                {view.secondary?.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    onClick={action.go}
                    disabled={busy}
                    className="cursor-pointer text-small text-primary underline-offset-2 hover:underline"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
