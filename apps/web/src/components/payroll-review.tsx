'use client';

import { useState, type FormEvent } from 'react';
import { cn } from '../lib/class-names';
import type { AuthorityOption } from '../lib/payroll-page-data';
import {
  approvalEntries,
  checkpointLabel,
  instantLabel,
  type PayrollPeriodReview,
  type ReviewAction,
} from '../lib/payroll-periods';
import { Button } from './ui/button';
import { Field, FormError, inputClass } from './ui/field';
import { StatusTag } from './ui/status-tag';

/** What each review command is called, after hris-controls.md §5.20. */
export function actionLabel(action: ReviewAction): string {
  switch (action.kind) {
    case 'certify':
      return 'Certify HR inputs';
    case 'return':
      return 'Return for correction';
    case 'checkpoint':
      return `Record ${checkpointLabel[action.checkpoint]} review`;
    case 'revoke':
      return 'Revoke certification';
    case 'approve':
      return 'Approve payroll';
    case 'return-approved':
      return 'Return before finalization';
    case 'finalize':
      return 'Finalize payroll';
  }
}

const sameAction = (left: ReviewAction | null, right: ReviewAction) =>
  left?.kind === right.kind &&
  (left.kind !== 'checkpoint' ||
    right.kind !== 'checkpoint' ||
    left.checkpoint === right.checkpoint);

/** The command's route and body; the API checks every rule again. */
function command(
  review: PayrollPeriodReview,
  action: ReviewAction,
  fields: Fields,
): { path: string; body: Record<string, unknown> } {
  const base = `/payroll-periods/${review.id}`;
  const rowVersion = review.rowVersion;
  switch (action.kind) {
    case 'certify':
      return {
        path: `${base}/certify`,
        body: {
          calculationVersion: review.calculationVersion,
          calculationHash: review.calculationHash,
        },
      };
    case 'return':
      return { path: `${base}/return`, body: { reason: fields.reason, rowVersion } };
    case 'revoke':
      return { path: `${base}/revoke-certification`, body: { reason: fields.reason, rowVersion } };
    case 'return-approved':
      return { path: `${base}/return-approved`, body: { reason: fields.reason, rowVersion } };
    case 'approve':
      return { path: `${base}/approve`, body: { rowVersion } };
    case 'finalize':
      return { path: `${base}/finalize`, body: { rowVersion } };
    case 'checkpoint': {
      const route = action.checkpoint === 'BUDGET' ? 'budget-review' : 'accounting-review';
      const exportId = review.certification?.reviewExportId ?? '';
      return {
        path: `${base}/review-exports/${exportId}/${route}`,
        body:
          fields.outcome === 'CONFIRMED'
            ? {
                outcome: 'CONFIRMED',
                externalReference: fields.externalReference,
                evidenceDocumentVersionId: fields.evidence,
              }
            : { outcome: 'RETURNED', reason: fields.reason },
      };
    }
  }
}

/** What a completed command did, for the status line. */
function doneNotice(code: string, action: ReviewAction, fields: Fields): string {
  switch (action.kind) {
    case 'certify':
      return `${code} certified. It waits for the Budget and Accounting reviews.`;
    case 'return':
      return `${code} returned to Draft for correction.`;
    case 'revoke':
      return `Certification of ${code} revoked. It is back in For review.`;
    case 'checkpoint':
      return fields.outcome === 'CONFIRMED'
        ? `${checkpointLabel[action.checkpoint]} review of ${code} confirmed.`
        : `${checkpointLabel[action.checkpoint]} review returned ${code} to For review.`;
    case 'approve':
      return `${code} approved. It is not final until it is finalized.`;
    case 'return-approved':
      return `${code} returned before finalization. It is back in For review.`;
    case 'finalize':
      return `${code} finalized.`;
  }
}

type Fields = {
  outcome: 'CONFIRMED' | 'RETURNED';
  reason: string;
  externalReference: string;
  evidence: string;
};

const emptyFields: Fields = {
  outcome: 'CONFIRMED',
  reason: '',
  externalReference: '',
  evidence: '',
};

/**
 * A period's Approvals and the review commands the signed-in actor may take on it: who
 * certified, who recorded each checkpoint review, who approved and finalized, and when. Opening
 * a command shows its form here; the API decides it, and a refusal shows the API's reason.
 */
export function PayrollReview({
  code,
  review,
  actions,
  acting,
  onAct,
  request,
  onDone,
  evidenceOptions,
  evidenceReadable,
}: {
  code: string;
  review: PayrollPeriodReview;
  actions: ReviewAction[];
  acting: ReviewAction | null;
  onAct: (action: ReviewAction | null) => void;
  request: (path: string, init: RequestInit) => Promise<unknown>;
  onDone: (notice: string) => Promise<void>;
  evidenceOptions: AuthorityOption[];
  evidenceReadable: boolean;
}) {
  const [fields, setFields] = useState(emptyFields);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const entries = approvalEntries(review);
  const prefix = `review-${review.id}`;

  function open(action: ReviewAction): void {
    setFields(emptyFields);
    setRefusal('');
    onAct(action);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!acting) return;
    setBusy(true);
    setRefusal('');
    try {
      const { path, body } = command(review, acting, fields);
      await request(path, { method: 'POST', body: JSON.stringify(body) });
      onAct(null);
      await onDone(doneNotice(code, acting, fields));
    } catch (caught: unknown) {
      setRefusal(caught instanceof Error ? caught.message : 'The command was refused.');
    } finally {
      setBusy(false);
    }
  }

  const set = (key: keyof Fields) => (event: { currentTarget: EventTarget }) => {
    const value = (event.currentTarget as unknown as { value: string }).value;
    setFields((current) => ({ ...current, [key]: value }));
  };
  const needsReason =
    acting !== null &&
    (acting.kind === 'return' ||
      acting.kind === 'revoke' ||
      acting.kind === 'return-approved' ||
      (acting.kind === 'checkpoint' && fields.outcome === 'RETURNED'));

  return (
    <div className="grid gap-4">
      <section aria-label={`${code} approvals`} className="grid gap-2">
        <h3 className="m-0 text-panel-title text-ink">Approvals</h3>
        <ol className="m-0 grid list-none gap-2 p-0 min-[900px]:grid-cols-5">
          {entries.map((entry) => (
            <li
              key={entry.step}
              data-step={entry.step}
              className={cn(
                'grid content-start gap-1 rounded-control border px-3 py-2',
                entry.state === 'done' ? 'border-border' : 'border-dashed border-border-subtle',
              )}
            >
              <span className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-small font-[650] text-ink">{entry.step}</strong>
                {entry.state === 'pending' ? <StatusTag tone="neutral">Pending</StatusTag> : null}
              </span>
              {entry.state === 'done' ? (
                <>
                  <span className="text-small text-ink">{entry.by}</span>
                  <span className="text-caption text-ink-muted">
                    {entry.at ? instantLabel(entry.at) : '—'}
                  </span>
                  {entry.note ? (
                    <span className="text-caption break-words text-ink-muted">{entry.note}</span>
                  ) : null}
                </>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      {actions.length > 0 ? (
        <section aria-label={`${code} review actions`} className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => (
              <Button
                key={actionLabel(action)}
                aria-pressed={sameAction(acting, action)}
                disabled={busy}
                onClick={() => open(action)}
                type="button"
                variant={action.primary ? 'primary' : 'secondary'}
              >
                {actionLabel(action)}
              </Button>
            ))}
          </div>
          {acting && actions.some((action) => sameAction(acting, action)) ? (
            <form
              aria-label={actionLabel(acting)}
              className="grid max-w-[640px] gap-3 rounded-control border border-border bg-canvas p-3"
              onSubmit={(event) => void submit(event)}
            >
              <strong className="text-small font-[650] text-ink">{actionLabel(acting)}</strong>
              {acting.kind === 'certify' ? (
                <p className="m-0 text-small break-all text-ink-muted">
                  Certifies calculation version {review.calculationVersion}, hash{' '}
                  <span className="font-mono">{review.calculationHash}</span>.
                </p>
              ) : null}
              {acting.kind === 'approve' ? (
                <p className="m-0 text-small text-ink-muted">
                  Approves the certified version both checkpoint reviews confirmed.
                </p>
              ) : null}
              {acting.kind === 'finalize' ? (
                <p className="m-0 text-small text-ink-muted">
                  Finalizing consumes the period’s inputs and makes its results immutable. It marks
                  no one paid.
                </p>
              ) : null}
              {acting.kind === 'checkpoint' ? (
                <fieldset className="m-0 flex flex-wrap gap-4 border-0 p-0">
                  <legend className="sr-only">Outcome</legend>
                  {(['CONFIRMED', 'RETURNED'] as const).map((outcome) => (
                    <label key={outcome} className="flex items-center gap-2 text-small text-ink">
                      <input
                        checked={fields.outcome === outcome}
                        name={`${prefix}-outcome`}
                        onChange={() => setFields((current) => ({ ...current, outcome }))}
                        type="radio"
                      />
                      {outcome === 'CONFIRMED' ? 'Confirm' : 'Return'}
                    </label>
                  ))}
                </fieldset>
              ) : null}
              {acting.kind === 'checkpoint' && fields.outcome === 'CONFIRMED' ? (
                <>
                  <Field htmlFor={`${prefix}-reference`} label="External reference">
                    <input
                      className={inputClass}
                      id={`${prefix}-reference`}
                      maxLength={200}
                      onChange={set('externalReference')}
                      required
                      value={fields.externalReference}
                    />
                  </Field>
                  {evidenceReadable ? (
                    <Field htmlFor={`${prefix}-evidence`} label="Evidence">
                      <select
                        className={inputClass}
                        id={`${prefix}-evidence`}
                        onChange={set('evidence')}
                        required
                        value={fields.evidence}
                      >
                        <option value="">Choose a finalized Document Version</option>
                        {evidenceOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ) : (
                    // Without documents.evidence.read the Agency's Document Versions can't be
                    // listed, so the reviewer names the one their evidence is.
                    <Field htmlFor={`${prefix}-evidence`} label="Evidence Document Version ID">
                      <input
                        className={cn(inputClass, 'font-mono')}
                        id={`${prefix}-evidence`}
                        onChange={set('evidence')}
                        required
                        value={fields.evidence}
                      />
                    </Field>
                  )}
                </>
              ) : null}
              {needsReason ? (
                <Field htmlFor={`${prefix}-reason`} label="Reason">
                  <textarea
                    className={cn(inputClass, 'min-h-20 py-2')}
                    id={`${prefix}-reason`}
                    onChange={set('reason')}
                    required
                    value={fields.reason}
                  />
                </Field>
              ) : null}
              <FormError message={refusal} />
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy} type="submit" variant="primary">
                  {acting.kind === 'checkpoint'
                    ? fields.outcome === 'CONFIRMED'
                      ? `Confirm ${checkpointLabel[acting.checkpoint]} review`
                      : `Return ${checkpointLabel[acting.checkpoint]} review`
                    : actionLabel(acting)}
                </Button>
                <Button disabled={busy} onClick={() => onAct(null)} type="button">
                  Cancel
                </Button>
              </div>
            </form>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
