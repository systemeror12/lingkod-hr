'use client';

import { useEffect, useImperativeHandle, useRef, useState, type FormEvent, type Ref } from 'react';
import { Field, inputClass, FormError } from '../ui/field';
import { useRecordNavigation } from '../record-navigation';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Panel } from '../ui/panel';
import { RowHeader, Table, Td, Th, Tr } from '../ui/table';
import { StateSurface } from '../state-surface';
import { manilaToday } from '../../lib/manila-date';
import {
  ActivationForm,
  DetailFooter,
  DetailLoading,
  TransitionHistory,
  VersionCard,
  VersionEffectivity,
  VersionMeta,
} from './shared';
import {
  countLabel,
  dateLabel,
  emptyActivation,
  label,
  noteClass,
  recordLinkClass,
  sectionTitleClass,
  targetChecked,
  targetValue,
  validForm,
} from './helpers';
import {
  type ArrangementType,
  arrangementTypes,
  scheduleTypes,
  type WorkArrangementVersion,
  type WorkArrangement,
  type WorkArrangementDetail,
  type HolidayCalendar,
  type ArrangementFormValues,
  type TabSectionHandle,
} from './types';
import { useEvidenceOptions } from './use-evidence-options';

type ArrangementDialogKind = 'create' | 'edit' | 'detail' | 'successor' | 'activate';

function emptyArrangementValues(holidayCalendarId: string): ArrangementFormValues {
  return {
    code: '',
    name: '',
    arrangementType: 'ONSITE',
    permittedScheduleTypes: ['REGULAR'],
    holidayCalendarId,
    effectiveDate: manilaToday(),
  };
}

function arrangementValuesFrom(
  arrangement: WorkArrangement,
  version: WorkArrangementVersion,
): ArrangementFormValues {
  return {
    code: arrangement.code,
    name: arrangement.name,
    arrangementType: version.arrangementType,
    permittedScheduleTypes: version.permittedScheduleTypes,
    holidayCalendarId: version.holidayCalendarId,
    effectiveDate: version.effectiveFrom,
    rowVersion: version.rowVersion,
  };
}

function arrangementPayload(
  values: ArrangementFormValues,
  includeIdentity: boolean,
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    arrangementType: values.arrangementType,
    permittedScheduleTypes: values.permittedScheduleTypes,
    holidayCalendarId: values.holidayCalendarId,
    effectiveDate: values.effectiveDate,
  };
  if (includeIdentity) {
    result.code = values.code;
    result.name = values.name;
  } else if (values.rowVersion !== undefined) {
    result.rowVersion = values.rowVersion;
  }
  return result;
}

function ArrangementDetailBody({
  calendars,
  detail,
  detailLoading,
  error,
}: {
  calendars: HolidayCalendar[];
  detail: WorkArrangementDetail | null;
  detailLoading: boolean;
  error: string;
}) {
  function calendarName(id: string): string {
    const calendar = calendars.find((entry) => entry.id === id);
    return calendar ? calendar.code + ' · ' + calendar.name : id;
  }
  return (
    <>
      <DialogBody className="grid gap-6">
        {detailLoading ? (
          <DetailLoading name="Work Arrangement history">
            Loading arrangement history…
          </DetailLoading>
        ) : null}
        <FormError message={error} />
        {detail ? (
          <>
            <dl className="m-0 grid gap-4 text-small min-[621px]:grid-cols-2">
              <VersionMeta label="Code">{detail.arrangement.code}</VersionMeta>
              <VersionMeta label="Name">{detail.arrangement.name}</VersionMeta>
              <VersionMeta label="Effective on">{dateLabel(detail.asOf)}</VersionMeta>
              <VersionMeta label="Effective version">
                {detail.effective
                  ? 'v' +
                    detail.effective.versionNo +
                    ' · ' +
                    label(detail.effective.arrangementType)
                  : 'No effective version'}
              </VersionMeta>
            </dl>
            <section
              className="grid gap-3"
              aria-labelledby="work-arrangement-version-history-title"
            >
              <h3 className={sectionTitleClass} id="work-arrangement-version-history-title">
                Version history
              </h3>
              {detail.versions.map((version) => (
                <VersionCard
                  key={version.id}
                  meta={
                    <>
                      <VersionEffectivity from={version.effectiveFrom} to={version.effectiveTo} />
                      <VersionMeta label="Arrangement type">
                        {label(version.arrangementType)}
                      </VersionMeta>
                      <VersionMeta label="Permitted schedule types">
                        {version.permittedScheduleTypes.map((entry) => label(entry)).join(', ')}
                      </VersionMeta>
                      <VersionMeta label="Holiday Calendar">
                        {calendarName(version.holidayCalendarId)}
                      </VersionMeta>
                      <VersionMeta label="Approving authority">
                        {version.approvingAuthority ?? 'Not recorded'}
                      </VersionMeta>
                      <VersionMeta label="Activated">
                        {version.activatedAt ? dateLabel(version.activatedAt) : 'Not activated'}
                      </VersionMeta>
                    </>
                  }
                  state={version.versionState}
                  versionNo={version.versionNo}
                />
              ))}
            </section>
            <TransitionHistory history={detail.history} id="work-arrangement-audit-history-title" />
          </>
        ) : null}
      </DialogBody>
      <DetailFooter />
    </>
  );
}

function ArrangementDefinitionFields({
  calendars,
  dialog,
  setValue,
  values,
}: {
  calendars: HolidayCalendar[];
  dialog: ArrangementDialogKind | null;
  setValue: <K extends keyof ArrangementFormValues>(
    field: K,
    value: ArrangementFormValues[K],
  ) => void;
  values: ArrangementFormValues;
}) {
  const creating = dialog === 'create';
  return (
    <fieldset className="grid gap-4">
      <legend className="mb-1 text-panel-title text-ink">Arrangement definition</legend>
      {creating ? (
        <div className="grid gap-4 min-[621px]:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
          <Field htmlFor="work-arrangement-code" label="Work Arrangement code">
            <input
              autoFocus
              className={inputClass}
              data-autofocus=""
              id="work-arrangement-code"
              maxLength={80}
              onChange={(event) => setValue('code', targetValue(event))}
              required
              value={values.code}
            />
          </Field>
          <Field htmlFor="work-arrangement-name" label="Work Arrangement name">
            <input
              className={inputClass}
              id="work-arrangement-name"
              maxLength={200}
              onChange={(event) => setValue('name', targetValue(event))}
              required
              value={values.name}
            />
          </Field>
        </div>
      ) : null}
      <div className="grid gap-4 min-[621px]:grid-cols-3">
        <Field htmlFor="work-arrangement-type" label="Arrangement type">
          <select
            className={inputClass}
            id="work-arrangement-type"
            onChange={(event) => setValue('arrangementType', targetValue(event) as ArrangementType)}
            value={values.arrangementType}
          >
            {arrangementTypes.map((entry) => (
              <option key={entry} value={entry}>
                {label(entry)}
              </option>
            ))}
          </select>
        </Field>
        <Field htmlFor="work-arrangement-calendar" label="Holiday Calendar">
          <select
            className={inputClass}
            id="work-arrangement-calendar"
            onChange={(event) => setValue('holidayCalendarId', targetValue(event))}
            required
            value={values.holidayCalendarId}
          >
            <option value="">Select a Holiday Calendar</option>
            {calendars.map((calendar) => (
              <option key={calendar.id} value={calendar.id}>
                {calendar.code} · {calendar.name}
              </option>
            ))}
          </select>
        </Field>
        <Field htmlFor="work-arrangement-effective-date" label="Effective date">
          <input
            className={inputClass}
            id="work-arrangement-effective-date"
            onChange={(event) => setValue('effectiveDate', targetValue(event))}
            required
            type="date"
            value={values.effectiveDate}
          />
        </Field>
      </div>
      <fieldset className="grid gap-2">
        <legend className="text-caption font-[650] text-ink">Permitted schedule types</legend>
        <div className="flex flex-wrap gap-3">
          {scheduleTypes.map((entry) => (
            <label
              className="flex min-h-11 items-center gap-2 rounded-control border border-border px-3 text-small text-ink"
              key={entry}
            >
              <input
                checked={values.permittedScheduleTypes.includes(entry)}
                onChange={(event) =>
                  setValue(
                    'permittedScheduleTypes',
                    targetChecked(event)
                      ? [...values.permittedScheduleTypes, entry]
                      : values.permittedScheduleTypes.filter((value) => value !== entry),
                  )
                }
                type="checkbox"
              />
              {label(entry)}
            </label>
          ))}
        </div>
      </fieldset>
    </fieldset>
  );
}

/**
 * The Work Arrangements tab: the register, its record detail, and its Draft, successor, and
 * activation forms. `recordId` is the Work Arrangement the URL selects, if any.
 */
export function WorkArrangementsSection({
  ref,
  agencyId,
  request,
  canManage,
  canActivate,
  arrangements,
  calendars,
  recordId,
  onRefresh,
  onFormChange,
}: {
  ref: Ref<TabSectionHandle>;
  agencyId: string;
  request: (path: string, init?: RequestInit) => Promise<unknown>;
  canManage: boolean;
  canActivate: boolean;
  arrangements: WorkArrangement[];
  calendars: HolidayCalendar[];
  recordId: string | null;
  onRefresh: () => Promise<void>;
  onFormChange: (showing: boolean) => void;
}) {
  const [dialog, setDialog] = useState<ArrangementDialogKind | null>(null);
  const [selected, setSelected] = useState<WorkArrangement | null>(null);
  const [detail, setDetail] = useState<WorkArrangementDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [values, setValues] = useState(() => emptyArrangementValues(calendars[0]?.id ?? ''));
  const [activation, setActivation] = useState(emptyActivation);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState('');
  const returnFocusRef = useRef<{ focus(): void } | null>(null);
  const navigation = useRecordNavigation();
  const { evidenceOptions, evidenceLoading } = useEvidenceOptions(
    agencyId,
    dialog === 'activate',
    setError,
  );
  const editing = dialog === 'create' || dialog === 'edit';
  const showingForm = editing || dialog === 'detail';

  useImperativeHandle(ref, () => ({
    openCreate(target) {
      setValues(emptyArrangementValues(calendars[0]?.id ?? ''));
      openDialog('create', target, null);
    },
  }));

  useEffect(() => {
    onFormChange(showingForm);
    return () => onFormChange(false);
  }, [onFormChange, showingForm]);

  useEffect(() => {
    let active = true;
    if (!recordId) {
      if (dialog === 'detail') {
        setDialog(null);
        setSelected(null);
        setDetail(null);
      }
      return;
    }
    setSelected(null);
    setDetail(null);
    setError('');
    setDialog('detail');
    setDetailLoading(true);
    void request('/work-arrangements/' + encodeURIComponent(recordId))
      .then((value) => {
        if (!active) return;
        const next = value as WorkArrangementDetail;
        setDetail(next);
        setSelected(next.arrangement);
      })
      .catch((caught: unknown) => {
        if (active)
          setError(caught instanceof Error ? caught.message : 'This record is unavailable.');
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [recordId]);

  function openDialog(
    kind: ArrangementDialogKind,
    target: { focus(): void },
    entity: WorkArrangement | null,
  ): void {
    returnFocusRef.current = target;
    setError('');
    setActivation(emptyActivation());
    setSelected(entity);
    setDialog(kind);
  }

  function closeDialog(force = false): void {
    if (busy && !force) return;
    const focusTarget = returnFocusRef.current;
    navigation.navigate({ record: null, view: null, kind: null });
    setDialog(null);
    setSelected(null);
    setDetail(null);
    setTimeout(() => {
      focusTarget?.focus();
      setTimeout(() => focusTarget?.focus(), 0);
    }, 0);
  }

  function openDetail(arrangement: WorkArrangement, target: { focus(): void }): void {
    returnFocusRef.current = target;
    navigation.navigate({ record: arrangement.id, view: 'form', kind: 'work-arrangement' });
  }

  async function submitArrangement(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !validForm(event)) return;
    setBusy(true);
    setError('');
    try {
      const creating = dialog === 'create';
      await request(
        creating
          ? '/work-arrangements'
          : '/work-arrangements/' + selected?.id + '/drafts/' + selected?.draft?.id,
        {
          method: creating ? 'POST' : 'PATCH',
          body: JSON.stringify(arrangementPayload(values, creating)),
        },
      );
      await onRefresh();
      setSuccess(
        creating
          ? 'Draft Work Arrangement “' + values.code + '” was created.'
          : 'Draft Work Arrangement “' + values.code + '” was updated.',
      );
      closeDialog(true);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error ? requestError.message : 'The Draft could not be saved.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitSuccessor(): Promise<void> {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      await request('/work-arrangements/' + selected.id + '/successor', { method: 'POST' });
      await onRefresh();
      setSuccess('A Draft successor for “' + selected.code + '” was created.');
      closeDialog(true);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'The successor could not be created.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitActivation(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !validForm(event) || !selected?.draft) return;
    setBusy(true);
    setError('');
    try {
      await request(
        '/work-arrangements/' + selected.id + '/drafts/' + selected.draft.id + '/activate',
        {
          method: 'POST',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify(activation),
        },
      );
      await onRefresh();
      setSuccess('Work Arrangement “' + selected.code + '” was activated.');
      closeDialog(true);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'The version could not be activated.',
      );
    } finally {
      setBusy(false);
    }
  }

  function arrangementActions(arrangement: WorkArrangement) {
    return (
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={(event) =>
            openDetail(arrangement, event.currentTarget as unknown as { focus(): void })
          }
        >
          Details
        </Button>
        {arrangement.draft && canManage ? (
          <Button
            type="button"
            variant="secondary"
            onClick={(event) => {
              setValues(
                arrangementValuesFrom(arrangement, arrangement.draft as WorkArrangementVersion),
              );
              openDialog('edit', event.currentTarget as unknown as { focus(): void }, arrangement);
            }}
          >
            Edit Draft
          </Button>
        ) : null}
        {arrangement.draft && canActivate ? (
          <Button
            type="button"
            variant="primary"
            onClick={(event) =>
              openDialog(
                'activate',
                event.currentTarget as unknown as { focus(): void },
                arrangement,
              )
            }
          >
            Activate
          </Button>
        ) : null}
        {arrangement.currentVersion && !arrangement.draft && canManage ? (
          <Button
            type="button"
            variant="secondary"
            onClick={(event) =>
              openDialog(
                'successor',
                event.currentTarget as unknown as { focus(): void },
                arrangement,
              )
            }
          >
            Create Successor
          </Button>
        ) : null}
      </div>
    );
  }

  const selectedLabel = selected ? selected.code : 'Attendance Configuration';
  const dialogDescriptionId = 'work-arrangement-dialog-description';

  return (
    <Dialog
      presentation={showingForm ? 'form' : 'dialog'}
      open={dialog !== null}
      onOpenChange={(open) => !open && closeDialog()}
    >
      <div hidden={showingForm} className="grid min-w-0 gap-5">
        {success ? (
          <p
            className="m-0 rounded-control border border-success/40 bg-success/5 px-3 py-2.5 text-small text-success"
            role="status"
          >
            {success}
          </p>
        ) : null}

        <Panel
          title="Work Arrangement register"
          flush
          actions={
            <span className="text-caption text-ink-muted">
              {countLabel(arrangements.length, 'arrangement')} · Agency scoped · Holiday Calendar
              pinned
            </span>
          }
        >
          {arrangements.length === 0 ? (
            <StateSurface compact label="Work Arrangements">
              <strong className="text-body font-[650] text-ink">No Work Arrangements yet.</strong>
              <p className="m-0 max-w-[560px]">
                Each Work Arrangement Version pins one Holiday Calendar scope and the schedule types
                it permits for an operating mode.
              </p>
            </StateSurface>
          ) : (
            <Table aria-label="Work Arrangements" className="min-w-[860px]">
              <thead>
                <tr>
                  <Th>Arrangement</Th>
                  <Th>Current version</Th>
                  <Th>Permitted schedule types</Th>
                  <Th>Draft</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {arrangements.map((arrangement) => (
                  <Tr key={arrangement.id}>
                    <RowHeader>
                      <div className="grid gap-1">
                        <button
                          className={recordLinkClass}
                          onClick={(event) =>
                            openDetail(
                              arrangement,
                              event.currentTarget as unknown as { focus(): void },
                            )
                          }
                          type="button"
                        >
                          {arrangement.code}
                        </button>
                        <span className="text-caption font-normal text-ink-muted">
                          {arrangement.name}
                        </span>
                      </div>
                    </RowHeader>
                    <Td>
                      {arrangement.currentVersion
                        ? 'v' +
                          arrangement.currentVersion.versionNo +
                          ' · ' +
                          label(arrangement.currentVersion.arrangementType) +
                          ' · ' +
                          dateLabel(arrangement.currentVersion.effectiveFrom)
                        : 'No active version'}
                    </Td>
                    <Td className="text-ink-muted">
                      {arrangement.currentVersion
                        ? arrangement.currentVersion.permittedScheduleTypes
                            .map((entry) => label(entry))
                            .join(', ')
                        : '—'}
                    </Td>
                    <Td className="text-ink-muted">
                      {arrangement.draft
                        ? 'v' +
                          arrangement.draft.versionNo +
                          ' · ' +
                          dateLabel(arrangement.draft.effectiveFrom)
                        : 'None'}
                    </Td>
                    <Td>{arrangementActions(arrangement)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      </div>

      <DialogContent
        aria-describedby={dialogDescriptionId}
        className={editing ? 'max-w-[980px]' : undefined}
      >
        <DialogHeader>
          <div className="grid min-w-0 gap-1.5">
            <DialogTitle>
              {dialog === 'create'
                ? 'Create Work Arrangement'
                : dialog === 'edit'
                  ? 'Edit Draft Work Arrangement'
                  : dialog === 'successor'
                    ? 'Create Successor · ' + selectedLabel
                    : dialog === 'activate'
                      ? 'Activate ' + selectedLabel
                      : 'Work Arrangement · ' + selectedLabel}
            </DialogTitle>
            <DialogDescription id={dialogDescriptionId}>
              {dialog === 'activate'
                ? 'Activation pins the authority Document Version, validates the Draft, and retires any predecessor by supersession.'
                : dialog === 'successor'
                  ? 'The successor copies the current published definition and receives a later effective date. It remains Draft until reviewed.'
                  : dialog === 'create' || dialog === 'edit'
                    ? 'Declare the operating mode, its permitted schedule types, the pinned Holiday Calendar, and the effective date.'
                    : 'Inspect effective-dated versions, the pinned Holiday Calendar, and the immutable transition history.'}
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <Button
              aria-label="Close Attendance Configuration dialog"
              disabled={busy}
              type="button"
            >
              <span aria-hidden="true" className="text-xl leading-none">
                ×
              </span>
            </Button>
          </DialogClose>
        </DialogHeader>

        {dialog === 'detail' ? (
          <ArrangementDetailBody
            calendars={calendars}
            detail={detail}
            detailLoading={detailLoading}
            error={error}
          />
        ) : dialog === 'activate' ? (
          <ActivationForm
            activation={activation}
            error={error}
            evidenceLoading={evidenceLoading}
            evidenceOptions={evidenceOptions}
            onSubmit={submitActivation}
            setActivation={setActivation}
          />
        ) : dialog === 'successor' ? (
          <>
            <DialogBody className="grid gap-5">
              <FormError message={error} />
              <p className={noteClass}>
                The successor copies the current published definition and receives a later effective
                date. It remains Draft until reviewed and activated.
              </p>
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button disabled={busy} type="button" variant="secondary">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                disabled={busy}
                onClick={() => void submitSuccessor()}
                type="button"
                variant="primary"
              >
                {busy ? 'Creating…' : 'Create Successor'}
              </Button>
            </DialogFooter>
          </>
        ) : dialog === 'create' || dialog === 'edit' ? (
          <form
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
            onSubmit={(event) => void submitArrangement(event)}
          >
            <DialogBody className="grid auto-rows-max content-start gap-6">
              <FormError message={error} />
              <ArrangementDefinitionFields
                calendars={calendars}
                dialog={dialog}
                setValue={(field, value) =>
                  setValues((current) => ({ ...current, [field]: value }))
                }
                values={values}
              />
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button disabled={busy} type="button" variant="secondary">
                  Cancel
                </Button>
              </DialogClose>
              <Button disabled={busy} type="submit" variant="primary">
                {busy ? 'Saving…' : dialog === 'create' ? 'Create Draft' : 'Save Draft'}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
