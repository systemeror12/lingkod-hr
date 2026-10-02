'use client';

// PROTOTYPE (#398). Variant D: the screen opens with the letterhead of whoever is speaking, the
// way a Philippine government memorandum does. Invitations carry the inviting Agency's
// letterhead; sign-in and reset carry LingkodHR's. Throwaway; do not import.

import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/class-names';
import { agency, manualSecret, otpauthUri, recoveryCodes, user } from './fake-states';
import { PrototypeMotion } from './motion';
import {
  Ack,
  CopyButton,
  FakeQr,
  FieldInput,
  PrimaryButton,
  fieldError,
  onSubmit,
  useFactorMode,
  type VariantProps,
} from './public-variants';

export const SEAL_GOLD = '#b8901f';

const clock = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila',
  hour: 'numeric',
  minute: '2-digit',
});

/** A wall-clock time in Manila, so waits and expiries need no ticking countdown. */
function at(minutesFromNow: number) {
  return clock.format(new Date(Date.now() + minutesFromNow * 60_000));
}

/** Placeholder for the Agency's own seal; LingkodHR's mark when no Agency is speaking yet. */
function Seal({ text, stamped, small }: { text: string; stamped: boolean; small?: boolean }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={cn(small ? 'size-11 shrink-0' : 'size-14', stamped && 'lh-stamp')}
      aria-hidden="true"
    >
      <circle
        cx="32"
        cy="32"
        r="30"
        fill={stamped ? SEAL_GOLD : 'none'}
        stroke={SEAL_GOLD}
        strokeWidth="2"
      />
      <circle
        cx="32"
        cy="32"
        r="25"
        fill="none"
        stroke={stamped ? '#fff' : SEAL_GOLD}
        strokeWidth="1"
        strokeDasharray="2 2.5"
      />
      <text
        x="32"
        y="37"
        textAnchor="middle"
        fontSize={text.length > 1 ? 13 : 20}
        fontWeight="700"
        fill={stamped ? '#fff' : '#0f2240'}
        fontFamily="inherit"
      >
        {text}
      </text>
    </svg>
  );
}

const outcomeText = { danger: 'text-danger', warning: 'text-warning', success: 'text-success' };

/**
 * Letterhead, step body, and step footer. `align="start"` suits a narrow column beside an image;
 * the body remounts per state, so its entrance and error nudge replay on every step.
 */
export function LetterheadContent(props: VariantProps & { align?: 'center' | 'start' }) {
  const { align = 'center' } = props;
  const { view, busy } = props;
  const [mode, setMode] = useFactorMode(view);
  const [ack, setAck] = useState(false);
  const fromAgency = view.flow === 'Activate access';
  const outcome = view.outcome;
  const stepIndex = view.rail.findIndex(({ status }) => status === 'current');
  const placedOnField = view.error?.field !== undefined;
  // Clock times are read after mount, so the server and browser renders always agree.
  const [times, setTimes] = useState<{ expiresAt: string | null; waitUntil: string | null }>({
    expiresAt: null,
    waitUntil: null,
  });
  useEffect(() => {
    setTimes({
      expiresAt: view.pendingSeconds ? at(view.pendingSeconds / 60) : null,
      waitUntil: view.wait?.minutesLeft ? at(view.wait.minutesLeft) : null,
    });
  }, [view.pendingSeconds, view.wait?.minutesLeft]);
  const { expiresAt, waitUntil } = times;

  const lines = (
    <>
      {fromAgency ? (
        <p className="m-0 text-caption text-ink-muted">Republic of the Philippines</p>
      ) : null}
      <p className="m-0 text-small text-ink">{fromAgency ? agency.department : 'LingkodHR'}</p>
      <p className="m-0 text-[1.0625rem] leading-snug font-[650] text-nav">
        {fromAgency ? agency.name : 'Personnel records for government agencies'}
      </p>
    </>
  );

  return (
    <>
      <PrototypeMotion />
      {align === 'center' ? (
        <header className="grid justify-items-center gap-0.5 text-center">
          <Seal text={fromAgency ? 'DOH' : 'L'} stamped={outcome?.tone === 'success'} />
          <div className="mt-2 grid gap-0.5">{lines}</div>
        </header>
      ) : (
        <header className="flex items-center gap-3.5">
          <Seal small text={fromAgency ? 'DOH' : 'L'} stamped={outcome?.tone === 'success'} />
          <div className="grid gap-0.5">{lines}</div>
        </header>
      )}
      <div
        aria-hidden="true"
        className="mt-5 mb-7 h-[6px] border-t-2 border-b"
        style={{ borderColor: SEAL_GOLD }}
      />

      <div key={props.stateKey} className="lh-step-in grid gap-5">
        <div className="grid gap-2">
          <h1
            id="proto-title"
            className="m-0 text-[1.625rem] leading-tight font-[650] tracking-[-0.015em] text-ink"
          >
            {outcome?.title ?? view.title}
          </h1>
          {outcome ? (
            <p
              className={cn(
                'm-0 max-w-[60ch] text-body',
                outcome.tone === 'success' ? 'text-ink-muted' : outcomeText[outcome.tone],
              )}
            >
              {outcome.body}
            </p>
          ) : view.error && !placedOnField ? (
            <p role="alert" className="m-0 text-body font-[600] text-danger">
              {view.error.message}
            </p>
          ) : view.lead ? (
            <p className="m-0 max-w-[60ch] text-body text-ink-muted">{view.lead}</p>
          ) : null}
          {view.identity &&
          !outcome &&
          view.enrollment !== 'codes' &&
          !view.fields?.some(({ kind }) => kind === 'email') ? (
            <p className="m-0 text-small text-ink-muted">
              Account: <span className="text-ink">{view.identity}</span>
            </p>
          ) : null}
        </div>

        {outcome ? (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {outcome.action ? (
              <Button variant="primary" className="min-h-11 px-6" onClick={outcome.action.go}>
                {outcome.action.label}
              </Button>
            ) : null}
            {outcome.secondary ? (
              <button
                type="button"
                className="cursor-pointer text-small text-primary underline underline-offset-4"
                onClick={outcome.secondary.go}
              >
                {outcome.secondary.label}
              </button>
            ) : null}
          </div>
        ) : view.codesLeft ? (
          <div className="grid gap-4">
            <p className="m-0 text-body">
              You have{' '}
              <strong className={cn('font-[700]', view.codesLeft.count === 0 && 'text-danger')}>
                {view.codesLeft.count === 0 ? 'no' : view.codesLeft.count} Recovery Codes
              </strong>{' '}
              left.
            </p>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              {view.codesLeft.actions.map((action) =>
                action.primary ? (
                  <Button
                    key={action.label}
                    variant="primary"
                    className="min-h-11 px-6"
                    onClick={action.go}
                  >
                    {action.label}
                  </Button>
                ) : (
                  <button
                    key={action.label}
                    type="button"
                    className="cursor-pointer text-small text-primary underline underline-offset-4"
                    onClick={action.go}
                  >
                    {action.label}
                  </button>
                ),
              )}
            </div>
          </div>
        ) : (
          <form
            className={cn('grid gap-5', view.error && 'lh-nudge')}
            onSubmit={onSubmit(props, ack)}
            noValidate
          >
            {view.enrollment === 'scan' ? (
              <div className="grid gap-5 min-[540px]:grid-cols-[auto_minmax(0,1fr)] min-[540px]:items-start">
                <FakeQr size={152} />
                <ol className="m-0 grid list-decimal gap-2 pl-5 text-small">
                  <li>Open an authenticator app on your phone.</li>
                  <li>Scan this code, or type the setup key.</li>
                  <li>Enter the 6-digit code the app shows.</li>
                  <li className="list-none">
                    <details className="text-caption text-ink-muted">
                      <summary className="cursor-pointer text-primary">Show setup key</summary>
                      <code className="mt-1 block text-small break-all text-ink">
                        {manualSecret}
                      </code>
                      <code className="mt-1 block break-all">{otpauthUri}</code>
                    </details>
                  </li>
                </ol>
              </div>
            ) : null}
            {view.enrollment === 'codes' ? (
              <>
                <figure className="m-0 grid gap-3 rounded-control border-2 border-dashed border-border p-5">
                  <figcaption className="flex flex-wrap justify-between gap-2 text-caption text-ink-muted">
                    <span>LingkodHR Recovery Codes</span>
                    <span>{user.email}</span>
                  </figcaption>
                  <ol className="m-0 grid list-none grid-cols-2 gap-x-8 gap-y-1.5 p-0 font-mono text-[0.9375rem] text-ink">
                    {recoveryCodes.map((code, index) => (
                      <li
                        key={code}
                        className="lh-code"
                        style={{ animationDelay: `${200 + index * 55}ms` }}
                      >
                        {code}
                      </li>
                    ))}
                  </ol>
                  <p className="m-0 text-caption text-ink-muted">
                    Issued 2 October 2026. Each code works once. Keep this slip away from your
                    phone.
                  </p>
                </figure>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => (globalThis as unknown as { print(): void }).print()}
                  >
                    Print slip
                  </Button>
                  <CopyButton text={recoveryCodes.join('\n')} label="Copy codes" />
                </div>
                <Ack value={ack} onChange={setAck} />
              </>
            ) : null}
            {view.fields?.map((spec) => (
              <div key={spec.kind} className="grid gap-1.5">
                <FieldInput spec={spec} mode={mode} error={fieldError(view, spec.kind, mode)} />
                {spec.kind === 'code' && view.factor ? (
                  <button
                    type="button"
                    className="cursor-pointer justify-self-start text-caption text-primary underline underline-offset-4"
                    onClick={() => setMode(mode === 'code' ? 'recovery' : 'code')}
                  >
                    {mode === 'code'
                      ? 'No phone? Use a Recovery Code'
                      : 'Use your authenticator app'}
                  </button>
                ) : null}
              </div>
            ))}
            {view.footnote && mode === 'recovery' ? (
              <p className="m-0 text-caption text-ink-muted">{view.footnote}</p>
            ) : null}
            {view.wait ? (
              <p role="alert" className="m-0 text-body">
                {view.wait.message.split('.')[0]}. You can try again after{' '}
                <strong className="font-[700]">{waitUntil}</strong>.
              </p>
            ) : null}
            <div className="relative flex flex-wrap items-center gap-x-5 gap-y-2">
              <span
                aria-hidden="true"
                className="absolute -bottom-2.5 left-0 h-0.5 w-full overflow-hidden rounded-full"
              >
                {busy ? <span className="lh-busy block h-full w-2/5 bg-primary" /> : null}
              </span>
              <PrimaryButton view={view} busy={busy} acknowledged={ack} />
              {view.secondary?.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  disabled={busy}
                  className="cursor-pointer text-small text-primary underline underline-offset-4 disabled:opacity-50"
                  onClick={action.go}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </form>
        )}
      </div>

      {view.rail.length > 1 && stepIndex >= 0 && !outcome ? (
        <footer className="mt-8 flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-border-subtle pt-3 text-caption text-ink-muted">
          <span>
            Step {stepIndex + 1} of {view.rail.length}: {view.rail[stepIndex]?.label}
          </span>
          {expiresAt ? (
            <span>
              {view.pendingLabel} at {expiresAt}
            </span>
          ) : null}
        </footer>
      ) : null}
    </>
  );
}

/** Variant D: the letterhead sheet on its own, centred on the canvas. */
export function Letterhead(props: VariantProps) {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-4 py-10 text-ink">
      <section
        aria-labelledby="proto-title"
        className="w-full max-w-[560px] rounded-panel border border-border bg-surface px-6 pt-8 pb-6 min-[621px]:px-12"
      >
        <LetterheadContent {...props} />
      </section>
    </main>
  );
}
