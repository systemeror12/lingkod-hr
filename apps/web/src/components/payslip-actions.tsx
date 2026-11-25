'use client';

import { useState, type FormEvent } from 'react';
import { cn } from '../lib/class-names';
import {
  DISBURSEMENT_OUTCOMES,
  instructionStatusDisplay,
  nextOutcomeSequence,
  outcomeDisplay,
  type DisbursementOutcomeKind,
  type PaymentExportRecord,
  type PaymentInstructionRecord,
} from '../lib/payment-exports';
import {
  instantLabel,
  moneyLabel,
  payslipStatusDisplay,
  type PeriodPayslipEntry,
} from '../lib/payroll-periods';
import { Button } from './ui/button';
import { Field, FormError, inputClass } from './ui/field';
import { StatusTag } from './ui/status-tag';

type Command = 'withhold' | 'release';

const commandLabel: Record<Command, string> = {
  withhold: 'Withhold payslip',
  release: 'Release withheld payslip',
};

/**
 * One Payslip's status and the Payroll Approver's commands on it: withholding a Ready payslip and
 * releasing a Withheld one, each with a reason. The commands offered follow the status the server
 * listed; the API decides each one, and a refusal shows its reason.
 */
export function PayslipActions({
  entry,
  canWithhold,
  canRelease,
  request,
  onDone,
}: {
  /** The server's entry for this result, `undefined` while the period's payslips are read. */
  entry: PeriodPayslipEntry | undefined;
  canWithhold: boolean;
  canRelease: boolean;
  request: (path: string, init: RequestInit) => Promise<unknown>;
  onDone: (notice: string) => Promise<void>;
}) {
  const [acting, setActing] = useState<Command | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');

  if (!entry) {
    return (
      <section aria-label="Payslip status" className="grid gap-2">
        <p className="m-0 text-small text-ink-muted" role="status">
          Reading the payslip’s status…
        </p>
      </section>
    );
  }
  const payslip = entry.payslip;
  const display = payslipStatusDisplay(payslip);
  const commands: Command[] = [];
  if (payslip?.status === 'READY' && canWithhold) commands.push('withhold');
  if (payslip?.status === 'WITHHELD' && canRelease) commands.push('release');

  function open(command: Command): void {
    setActing(command);
    setReason('');
    setRefusal('');
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!acting || !payslip) return;
    setBusy(true);
    setRefusal('');
    try {
      await request(`/payslips/${payslip.id}/${acting}`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      const name = entry?.employee.legalName ?? 'The Employee';
      const done =
        acting === 'withhold'
          ? `Payslip of ${name} withheld. Its Employee cannot read it until it is released.`
          : `Withheld payslip of ${name} released to its Employee.`;
      setActing(null);
      await onDone(done);
    } catch (caught: unknown) {
      setRefusal(caught instanceof Error ? caught.message : 'The command was refused.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Payslip status" className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-small text-ink-muted">Payslip</span>
        <StatusTag tone={display.tone}>{display.label}</StatusTag>
        {commands.map((command) => (
          <Button
            key={command}
            aria-pressed={acting === command}
            disabled={busy}
            onClick={() => open(command)}
            type="button"
            variant="secondary"
          >
            {commandLabel[command]}
          </Button>
        ))}
      </div>
      {payslip?.withheldAt ? (
        <p className="m-0 text-small break-words text-ink">
          Withheld {instantLabel(payslip.withheldAt)}: {payslip.withholdReason}
        </p>
      ) : null}
      {payslip?.releasedAt ? (
        <p className="m-0 text-small text-ink">Released {instantLabel(payslip.releasedAt)}</p>
      ) : null}
      {acting && commands.includes(acting) ? (
        <form
          aria-label={commandLabel[acting]}
          className="grid max-w-[640px] gap-3 rounded-control border border-border bg-canvas p-3"
          onSubmit={(event) => void submit(event)}
        >
          <strong className="text-small font-[650] text-ink">{commandLabel[acting]}</strong>
          <p className="m-0 text-small text-ink-muted">
            {acting === 'withhold'
              ? 'Its Employee cannot read a withheld payslip. Payment is unaffected.'
              : 'Its Employee can read it once it is released. Its withholding stays on record.'}
          </p>
          <Field htmlFor={`payslip-reason-${payslip?.id ?? ''}`} label="Reason">
            <textarea
              className={cn(inputClass, 'min-h-20 py-2')}
              id={`payslip-reason-${payslip?.id ?? ''}`}
              onChange={(event) =>
                setReason((event.currentTarget as unknown as { value: string }).value)
              }
              required
              value={reason}
            />
          </Field>
          <FormError message={refusal} />
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} type="submit" variant="primary">
              {commandLabel[acting]}
            </Button>
            <Button disabled={busy} onClick={() => setActing(null)} type="button">
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

type Attempt = { paymentExport: PaymentExportRecord; instruction: PaymentInstructionRecord };

type PaymentCommand =
  | {
      kind: 'outcome';
      instructionId: string;
      outcome: DisbursementOutcomeKind;
      externalReference: string;
      reason: string;
    }
  | { kind: 'supersede'; instructionId: string; reason: string };

/**
 * One payslip's Payment Instructions, oldest attempt first, each with its Disbursement Outcomes in
 * the order the API recorded them. The Cashier records the next outcome on an attempt, and
 * supersedes one the API marks retryable: a superseding Payment Export resends it to the
 * Employee's corrected destination. Nothing here reads as paid; the API decides every command.
 */
export function PaymentActions({
  attempts,
  canRecordOutcome,
  canSupersede,
  request,
  onDone,
}: {
  /** This payslip's attempts across the period's exports, `undefined` while they are read. */
  attempts: Attempt[] | undefined;
  canRecordOutcome: boolean;
  canSupersede: boolean;
  request: (path: string, init: RequestInit) => Promise<unknown>;
  onDone: (notice: string) => Promise<void>;
}) {
  const [command, setCommand] = useState<PaymentCommand | null>(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');

  if (!attempts) {
    return (
      <section aria-label="Payment" className="grid gap-2">
        <h3 className="m-0 text-panel-title text-ink">Payment</h3>
        <p className="m-0 text-small text-ink-muted" role="status">
          Reading the Payment Instructions…
        </p>
      </section>
    );
  }

  function open(next: PaymentCommand): void {
    setCommand(next);
    setRefusal('');
  }

  async function submit(event: FormEvent<HTMLFormElement>, attempt: Attempt): Promise<void> {
    event.preventDefault();
    if (!command) return;
    const { paymentExport, instruction } = attempt;
    const base = `/payroll-periods/${paymentExport.payrollPeriodId}/payment-exports/${paymentExport.id}/instructions/${instruction.id}`;
    setBusy(true);
    setRefusal('');
    try {
      if (command.kind === 'outcome') {
        const externalReference = command.externalReference.trim();
        const reason = command.reason.trim();
        await request(`${base}/disbursement-outcomes`, {
          method: 'POST',
          body: JSON.stringify({
            outcome: command.outcome,
            sequence: nextOutcomeSequence(instruction),
            ...(externalReference && { externalReference }),
            ...(reason && { reason }),
          }),
        });
        setCommand(null);
        await onDone(
          `${outcomeDisplay[command.outcome].label} recorded on ${instruction.paymentReference}.`,
        );
      } else {
        await request(`${base}/retries`, {
          method: 'POST',
          body: JSON.stringify({ reason: command.reason }),
        });
        setCommand(null);
        await onDone(
          `${instruction.paymentReference} superseded: a superseding Payment Export resends it to the corrected destination. It marks no one paid.`,
        );
      }
    } catch (caught: unknown) {
      setRefusal(caught instanceof Error ? caught.message : 'The command was refused.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Payment" className="grid gap-3">
      <h3 className="m-0 text-panel-title text-ink">Payment</h3>
      {attempts.length === 0 ? (
        <p className="m-0 text-small text-ink-muted">
          No Payment Instruction yet. The period’s Payment Export hands one off for a payslip with
          positive net pay.
        </p>
      ) : (
        <p className="m-0 text-small text-ink-muted">
          A Payment Instruction marks no one paid. Its Disbursement Outcomes record what the bank
          reported, in order.
        </p>
      )}
      {attempts.map((attempt, index) => {
        const { instruction, paymentExport } = attempt;
        const display = instructionStatusDisplay(instruction);
        const acting = command?.instructionId === instruction.id ? command : null;
        const label = `Payment attempt ${index + 1}`;
        return (
          <section
            key={instruction.id}
            aria-label={label}
            className="grid gap-3 rounded-control border border-border p-3"
          >
            <div className="flex flex-wrap items-center gap-3">
              <strong className="text-small font-[650] text-ink">{label}</strong>
              <StatusTag tone={display.tone}>{display.label}</StatusTag>
              <span className="text-small text-ink">{moneyLabel(instruction.amount)}</span>
              {canRecordOutcome ? (
                <Button
                  aria-pressed={acting?.kind === 'outcome'}
                  disabled={busy}
                  onClick={() =>
                    open({
                      kind: 'outcome',
                      instructionId: instruction.id,
                      outcome: 'SUBMITTED',
                      externalReference: '',
                      reason: '',
                    })
                  }
                  type="button"
                  variant="secondary"
                >
                  Record outcome
                </Button>
              ) : null}
              {canSupersede && instruction.retryable ? (
                <Button
                  aria-pressed={acting?.kind === 'supersede'}
                  disabled={busy}
                  onClick={() =>
                    open({ kind: 'supersede', instructionId: instruction.id, reason: '' })
                  }
                  type="button"
                  variant="secondary"
                >
                  Supersede instruction
                </Button>
              ) : null}
            </div>
            <p className="m-0 text-small break-words text-ink">
              {instruction.institutionName} {instruction.maskedAccountIdentifier} ·{' '}
              {instruction.accountHolderName} · Reference {instruction.paymentReference}
            </p>
            <p className="m-0 text-caption text-ink-muted">
              Handed off in the Payment Export of {instantLabel(paymentExport.generatedAt)}
              {instruction.retryReason
                ? `, superseding a prior attempt: ${instruction.retryReason}`
                : ''}
            </p>
            {instruction.outcomes.length === 0 ? (
              <p className="m-0 text-small text-ink-muted">No Disbursement Outcome recorded yet.</p>
            ) : (
              <ol aria-label="Disbursement Outcomes" className="m-0 grid gap-1.5 pl-5 text-small">
                {instruction.outcomes.map((outcome) => (
                  <li key={outcome.id} className="break-words text-ink">
                    <StatusTag tone={outcomeDisplay[outcome.outcome].tone}>
                      {outcomeDisplay[outcome.outcome].label}
                    </StatusTag>{' '}
                    {instantLabel(outcome.recordedAt)}
                    {outcome.externalReference ? ` · ${outcome.externalReference}` : ''}
                    {outcome.reason ? ` · ${outcome.reason}` : ''}
                  </li>
                ))}
              </ol>
            )}
            {acting?.kind === 'outcome' ? (
              <form
                aria-label="Record Disbursement Outcome"
                className="grid max-w-[640px] gap-3 rounded-control border border-border bg-canvas p-3"
                onSubmit={(event) => void submit(event, attempt)}
              >
                <strong className="text-small font-[650] text-ink">
                  Record Disbursement Outcome
                </strong>
                <Field htmlFor={`outcome-kind-${instruction.id}`} label="Outcome">
                  <select
                    className={inputClass}
                    id={`outcome-kind-${instruction.id}`}
                    onChange={(event) =>
                      setCommand({
                        ...acting,
                        outcome: (event.currentTarget as unknown as { value: string })
                          .value as DisbursementOutcomeKind,
                      })
                    }
                    value={acting.outcome}
                  >
                    {DISBURSEMENT_OUTCOMES.map((outcome) => (
                      <option key={outcome} value={outcome}>
                        {outcomeDisplay[outcome].label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  htmlFor={`outcome-reference-${instruction.id}`}
                  label="External reference (optional)"
                >
                  <input
                    className={inputClass}
                    id={`outcome-reference-${instruction.id}`}
                    maxLength={200}
                    onChange={(event) =>
                      setCommand({
                        ...acting,
                        externalReference: (event.currentTarget as unknown as { value: string })
                          .value,
                      })
                    }
                    value={acting.externalReference}
                  />
                </Field>
                <Field
                  htmlFor={`outcome-reason-${instruction.id}`}
                  label="Reason (Rejected or Returned only)"
                >
                  <textarea
                    className={cn(inputClass, 'min-h-20 py-2')}
                    id={`outcome-reason-${instruction.id}`}
                    onChange={(event) =>
                      setCommand({
                        ...acting,
                        reason: (event.currentTarget as unknown as { value: string }).value,
                      })
                    }
                    value={acting.reason}
                  />
                </Field>
                <FormError message={refusal} />
                <div className="flex flex-wrap gap-2">
                  <Button disabled={busy} type="submit" variant="primary">
                    Record outcome
                  </Button>
                  <Button disabled={busy} onClick={() => setCommand(null)} type="button">
                    Cancel
                  </Button>
                </div>
              </form>
            ) : null}
            {acting?.kind === 'supersede' ? (
              <form
                aria-label="Supersede instruction"
                className="grid max-w-[640px] gap-3 rounded-control border border-border bg-canvas p-3"
                onSubmit={(event) => void submit(event, attempt)}
              >
                <strong className="text-small font-[650] text-ink">Supersede instruction</strong>
                <p className="m-0 text-small text-ink-muted">
                  A superseding Payment Export resends the same payee and amount to the Employee’s
                  corrected Payroll Bank Account. This attempt and its export stay as they are.
                </p>
                <Field htmlFor={`supersede-reason-${instruction.id}`} label="Reason">
                  <textarea
                    className={cn(inputClass, 'min-h-20 py-2')}
                    id={`supersede-reason-${instruction.id}`}
                    onChange={(event) =>
                      setCommand({
                        ...acting,
                        reason: (event.currentTarget as unknown as { value: string }).value,
                      })
                    }
                    required
                    value={acting.reason}
                  />
                </Field>
                <FormError message={refusal} />
                <div className="flex flex-wrap gap-2">
                  <Button disabled={busy} type="submit" variant="primary">
                    Supersede instruction
                  </Button>
                  <Button disabled={busy} onClick={() => setCommand(null)} type="button">
                    Cancel
                  </Button>
                </div>
              </form>
            ) : null}
          </section>
        );
      })}
    </section>
  );
}
