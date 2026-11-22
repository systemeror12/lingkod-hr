'use client';

import { useState, type FormEvent } from 'react';
import { cn } from '../lib/class-names';
import {
  instantLabel,
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
