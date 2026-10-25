import type { FormEvent, ReactNode } from 'react';
import { DialogBody, DialogClose, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Field, inputClass, FormError } from '../ui/field';
import { StatusTag, type StatusTone } from '../ui/status-tag';
import { StateSurface } from '../state-surface';
import { dateLabel, label, sectionTitleClass, targetValue } from './helpers';
import type { ActivationValues, EvidenceOption, VersionState, WorkScheduleDetail } from './types';

const VERSION_TONES: Record<VersionState, StatusTone> = {
  DRAFT: 'warning',
  ACTIVE: 'success',
  SUPERSEDED: 'neutral',
};

export function StatusBadge({ status }: { status: VersionState }) {
  return <StatusTag tone={VERSION_TONES[status]}>{label(status)}</StatusTag>;
}

export function VersionMeta({ children, label: name }: { children: ReactNode; label: string }) {
  return (
    <div>
      <dt className="text-caption text-ink-muted">{name}</dt>
      <dd className="m-0 text-ink">{children}</dd>
    </div>
  );
}

export function VersionCard({
  children,
  meta,
  state,
  versionNo,
}: {
  children?: ReactNode;
  meta: ReactNode;
  state: VersionState;
  versionNo: number;
}) {
  return (
    <article className="grid gap-3 rounded-control border border-border p-4 text-small">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="text-ink">Version {versionNo}</strong>
        <StatusBadge status={state} />
      </div>
      <dl className="m-0 grid gap-2 min-[621px]:grid-cols-2">{meta}</dl>
      {children}
    </article>
  );
}

export function VersionEffectivity({ from, to }: { from: string; to: string | null }) {
  return (
    <VersionMeta label="Effectivity">
      {dateLabel(from)}
      {to ? ' – ' + dateLabel(to) : ' – open-ended'}
    </VersionMeta>
  );
}

export function DetailFooter() {
  return (
    <DialogFooter>
      <DialogClose asChild>
        <Button type="button" variant="secondary">
          Close
        </Button>
      </DialogClose>
    </DialogFooter>
  );
}

export function TransitionHistory({
  history,
  id,
}: {
  history: WorkScheduleDetail['history'];
  id: string;
}) {
  return (
    <section className="grid gap-3" aria-labelledby={id}>
      <h3 className={sectionTitleClass} id={id}>
        Transition history
      </h3>
      {history.length ? (
        <ol className="m-0 grid gap-2 pl-5 text-small text-ink-muted">
          {history.map((entry) => (
            <li key={entry.id}>
              {entry.action} · {entry.reason ?? 'No reason recorded'} ·{' '}
              {dateLabel(entry.occurredAt)}
            </li>
          ))}
        </ol>
      ) : (
        <p className="m-0 text-small text-ink-muted">No transitions recorded.</p>
      )}
    </section>
  );
}

export function DetailLoading({ children, name }: { children: string; name: string }) {
  return (
    <StateSurface compact busy label={name}>
      <p className="m-0">{children}</p>
    </StateSurface>
  );
}

export function ActivationForm({
  error,
  evidenceLoading,
  evidenceOptions,
  onSubmit,
  setActivation,
  activation,
}: {
  activation: ActivationValues;
  error: string;
  evidenceLoading: boolean;
  evidenceOptions: EvidenceOption[];
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  setActivation: (values: ActivationValues) => void;
}) {
  return (
    <form onSubmit={(event) => void onSubmit(event)}>
      <DialogBody className="grid gap-5">
        <FormError message={error} />
        <Field htmlFor="attendance-activation-evidence" label="Authority Document Version">
          <select
            className={inputClass}
            disabled={evidenceLoading}
            id="attendance-activation-evidence"
            onChange={(event) =>
              setActivation({
                ...activation,
                authorityDocumentVersionId: targetValue(event),
              })
            }
            required
            value={activation.authorityDocumentVersionId}
          >
            <option value="">
              {evidenceLoading ? 'Loading Document Versions…' : 'Select a finalized Document'}
            </option>
            {evidenceOptions.map((option) => (
              <option key={option.version.id} value={option.version.id}>
                {(option.documentNo ?? option.documentType) +
                  ' · version ' +
                  option.version.versionNo}
              </option>
            ))}
          </select>
        </Field>
        <Field htmlFor="attendance-activation-authority" label="Approving authority">
          <input
            className={inputClass}
            id="attendance-activation-authority"
            maxLength={300}
            onChange={(event) =>
              setActivation({ ...activation, approvingAuthority: targetValue(event) })
            }
            required
            value={activation.approvingAuthority}
          />
        </Field>
        <Field htmlFor="attendance-activation-reason" label="Activation reason">
          <textarea
            className={inputClass}
            id="attendance-activation-reason"
            maxLength={500}
            onChange={(event) => setActivation({ ...activation, reason: targetValue(event) })}
            required
            rows={3}
            value={activation.reason}
          />
        </Field>
      </DialogBody>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="secondary">
            Cancel
          </Button>
        </DialogClose>
        <Button disabled={evidenceLoading} type="submit" variant="primary">
          Activate Version
        </Button>
      </DialogFooter>
    </form>
  );
}
