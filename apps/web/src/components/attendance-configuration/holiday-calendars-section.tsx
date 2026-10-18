'use client';

import { useEffect, useImperativeHandle, useRef, useState, type FormEvent, type Ref } from 'react';
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
import { Field, FormError, inputClass, labelClass } from '../ui/field';
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
  rowBoxClass,
  sectionTitleClass,
  targetValue,
  validForm,
} from './helpers';
import {
  holidayCalendarScopeTypes,
  holidayDayTypes,
  type HolidayCalendar,
  type HolidayCalendarDetail,
  type HolidayCalendarFormValues,
  type HolidayCalendarScopeType,
  type HolidayCalendarVersion,
  type HolidayDayType,
  type HolidayEntryForm,
  type TabSectionHandle,
} from './types';
import { useEvidenceOptions } from './use-evidence-options';

type CalendarDialogKind = 'create' | 'edit' | 'detail' | 'successor' | 'activate';

function emptyHolidayCalendarValues(): HolidayCalendarFormValues {
  return {
    code: '',
    name: '',
    scopeType: 'AGENCY',
    scopeReference: '',
    effectiveDate: manilaToday(),
    entries: [
      { holidayDate: manilaToday(), name: '', dayType: 'REGULAR_HOLIDAY', sourceReference: '' },
    ],
  };
}

function holidayCalendarValuesFrom(
  calendar: HolidayCalendar,
  version: HolidayCalendarVersion,
): HolidayCalendarFormValues {
  return {
    code: calendar.code,
    name: calendar.name,
    scopeType: calendar.scopeType,
    scopeReference: calendar.scopeReference,
    effectiveDate: version.effectiveFrom,
    entries: version.entries.map((entry) => ({
      holidayDate: entry.holidayDate,
      name: entry.name,
      dayType: entry.dayType,
      sourceReference: entry.sourceReference,
    })),
    rowVersion: version.rowVersion,
  };
}

function holidayCalendarPayload(
  values: HolidayCalendarFormValues,
  includeIdentity: boolean,
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    effectiveDate: values.effectiveDate,
    entries: values.entries.map((entry) => ({
      holidayDate: entry.holidayDate,
      name: entry.name,
      dayType: entry.dayType,
      sourceReference: entry.sourceReference,
    })),
  };
  if (includeIdentity) {
    result.code = values.code;
    result.name = values.name;
    result.scopeType = values.scopeType;
    result.scopeReference = values.scopeReference;
  } else if (values.rowVersion !== undefined) {
    result.rowVersion = values.rowVersion;
  }
  return result;
}

function HolidayCalendarDetailBody({
  detail,
  detailLoading,
  error,
}: {
  detail: HolidayCalendarDetail | null;
  detailLoading: boolean;
  error: string;
}) {
  return (
    <>
      <DialogBody className="grid gap-6">
        {detailLoading ? (
          <DetailLoading name="Holiday Calendar history">
            Loading Holiday Calendar history…
          </DetailLoading>
        ) : null}
        <FormError message={error} />
        {detail ? (
          <>
            <dl className="m-0 grid gap-4 text-small min-[621px]:grid-cols-2">
              <VersionMeta label="Code">{detail.calendar.code}</VersionMeta>
              <VersionMeta label="Name">{detail.calendar.name}</VersionMeta>
              <VersionMeta label="Scope">
                {label(detail.calendar.scopeType)} · {detail.calendar.scopeReference}
              </VersionMeta>
              <VersionMeta label="Effective on">{dateLabel(detail.asOf)}</VersionMeta>
              <VersionMeta label="Effective version">
                {detail.effective
                  ? 'v' +
                    detail.effective.versionNo +
                    ' · ' +
                    detail.effective.entries.length +
                    (detail.effective.entries.length === 1 ? ' entry' : ' entries')
                  : 'No effective version'}
              </VersionMeta>
            </dl>
            <section
              className="grid gap-3"
              aria-labelledby="holiday-calendar-version-history-title"
            >
              <h3 className={sectionTitleClass} id="holiday-calendar-version-history-title">
                Version history
              </h3>
              {detail.versions.map((version) => (
                <VersionCard
                  key={version.id}
                  meta={
                    <>
                      <VersionEffectivity from={version.effectiveFrom} to={version.effectiveTo} />
                      <VersionMeta label="Approving authority">
                        {version.approvingAuthority ?? 'Not recorded'}
                      </VersionMeta>
                      <VersionMeta label="Activated">
                        {version.activatedAt ? dateLabel(version.activatedAt) : 'Not activated'}
                      </VersionMeta>
                      <VersionMeta label="Entries">{version.entries.length.toString()}</VersionMeta>
                    </>
                  }
                  state={version.versionState}
                  versionNo={version.versionNo}
                >
                  {version.entries.length ? (
                    <Table
                      aria-label={'Version ' + version.versionNo + ' holiday entries'}
                      className="min-w-[560px]"
                    >
                      <thead>
                        <tr>
                          <Th kind="date">Date</Th>
                          <Th>Holiday</Th>
                          <Th>Day type</Th>
                          <Th>Source</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {version.entries.map((entry) => (
                          <Tr key={entry.id}>
                            <Td kind="date">{dateLabel(entry.holidayDate)}</Td>
                            <RowHeader>{entry.name}</RowHeader>
                            <Td>{label(entry.dayType)}</Td>
                            <Td className="text-ink-muted">{entry.sourceReference}</Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                  ) : (
                    <p className="m-0 text-small text-ink-muted">
                      No holiday entries in this version.
                    </p>
                  )}
                </VersionCard>
              ))}
            </section>
            <TransitionHistory history={detail.history} id="holiday-calendar-audit-history-title" />
          </>
        ) : null}
      </DialogBody>
      <DetailFooter />
    </>
  );
}

function HolidayCalendarDefinitionFields({
  dialog,
  setValue,
  values,
}: {
  dialog: CalendarDialogKind;
  setValue: <K extends keyof HolidayCalendarFormValues>(
    field: K,
    value: HolidayCalendarFormValues[K],
  ) => void;
  values: HolidayCalendarFormValues;
}) {
  const creating = dialog === 'create';
  function setEntry(index: number, patch: Partial<HolidayEntryForm>): void {
    setValue(
      'entries',
      values.entries.map((entry, position) =>
        position === index ? { ...entry, ...patch } : entry,
      ),
    );
  }
  return (
    <>
      <fieldset className="grid gap-4">
        <legend className="mb-1 text-panel-title text-ink">Calendar definition</legend>
        {creating ? (
          <div className="grid gap-4 min-[621px]:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
            <Field htmlFor="holiday-calendar-code" label="Holiday Calendar code">
              <input
                autoFocus
                className={inputClass}
                data-autofocus=""
                id="holiday-calendar-code"
                maxLength={80}
                onChange={(event) => setValue('code', targetValue(event))}
                required
                value={values.code}
              />
            </Field>
            <Field htmlFor="holiday-calendar-name" label="Holiday Calendar name">
              <input
                className={inputClass}
                id="holiday-calendar-name"
                maxLength={200}
                onChange={(event) => setValue('name', targetValue(event))}
                required
                value={values.name}
              />
            </Field>
          </div>
        ) : null}
        <div className="grid gap-4 min-[621px]:grid-cols-3">
          <Field htmlFor="holiday-calendar-scope-type" label="Calendar scope">
            <select
              className={inputClass}
              disabled={!creating}
              id="holiday-calendar-scope-type"
              onChange={(event) =>
                setValue('scopeType', targetValue(event) as HolidayCalendarScopeType)
              }
              value={values.scopeType}
            >
              {holidayCalendarScopeTypes.map((entry) => (
                <option key={entry} value={entry}>
                  {label(entry)}
                </option>
              ))}
            </select>
          </Field>
          <Field htmlFor="holiday-calendar-scope-reference" label="Scope reference">
            <input
              className={inputClass}
              disabled={!creating}
              id="holiday-calendar-scope-reference"
              maxLength={300}
              onChange={(event) => setValue('scopeReference', targetValue(event))}
              required
              value={values.scopeReference}
            />
          </Field>
          <Field htmlFor="holiday-calendar-effective-date" label="Effective date">
            <input
              className={inputClass}
              id="holiday-calendar-effective-date"
              onChange={(event) => setValue('effectiveDate', targetValue(event))}
              required
              type="date"
              value={values.effectiveDate}
            />
          </Field>
        </div>
      </fieldset>
      <section className="grid gap-4" aria-labelledby="holiday-calendar-entries-title">
        <div className="grid gap-1">
          <h3 className={sectionTitleClass} id="holiday-calendar-entries-title">
            Holiday entries
          </h3>
          <p className="m-0 text-small text-ink-muted">One row per holiday date and day type</p>
        </div>
        {values.entries.length === 0 ? (
          <p className="m-0 text-small text-ink-muted">
            A version needs at least one entry before it can be activated.
          </p>
        ) : null}
        {values.entries.map((entry, index) => (
          <div
            className={
              'grid items-end gap-3 ' +
              rowBoxClass +
              ' min-[900px]:grid-cols-[150px_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]'
            }
            key={index}
          >
            <label className={labelClass}>
              <span>Holiday date</span>
              <input
                aria-label={'Holiday date ' + (index + 1)}
                className={inputClass}
                onChange={(event) => setEntry(index, { holidayDate: targetValue(event) })}
                required
                type="date"
                value={entry.holidayDate}
              />
            </label>
            <label className={labelClass}>
              <span>Holiday</span>
              <input
                aria-label={'Holiday name ' + (index + 1)}
                className={inputClass}
                maxLength={200}
                onChange={(event) => setEntry(index, { name: targetValue(event) })}
                required
                value={entry.name}
              />
            </label>
            <label className={labelClass}>
              <span>Day type</span>
              <select
                aria-label={'Holiday day type ' + (index + 1)}
                className={inputClass}
                onChange={(event) =>
                  setEntry(index, { dayType: targetValue(event) as HolidayDayType })
                }
                value={entry.dayType}
              >
                {holidayDayTypes.map((value) => (
                  <option key={value} value={value}>
                    {label(value)}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              <span>Source</span>
              <input
                aria-label={'Holiday source ' + (index + 1)}
                className={inputClass}
                maxLength={300}
                onChange={(event) => setEntry(index, { sourceReference: targetValue(event) })}
                required
                value={entry.sourceReference}
              />
            </label>
            <Button
              onClick={() =>
                setValue(
                  'entries',
                  values.entries.filter((_, position) => position !== index),
                )
              }
              type="button"
              variant="secondary"
            >
              Remove
            </Button>
          </div>
        ))}
        <Button
          className="w-fit"
          disabled={values.entries.length >= 400}
          onClick={() =>
            setValue('entries', [
              ...values.entries,
              {
                holidayDate: values.effectiveDate,
                name: '',
                dayType: 'REGULAR_HOLIDAY',
                sourceReference: '',
              },
            ])
          }
          type="button"
          variant="secondary"
        >
          Add holiday entry
        </Button>
      </section>
    </>
  );
}

/** The Holiday Calendars tab: its register and the dialogs that create, revise, and activate. */
export function HolidayCalendarsSection({
  ref,
  agencyId,
  request,
  canManage,
  canActivate,
  calendars,
  onRefresh,
  onFormChange,
}: {
  ref: Ref<TabSectionHandle>;
  agencyId: string;
  request: (path: string, init?: RequestInit) => Promise<unknown>;
  canManage: boolean;
  canActivate: boolean;
  calendars: HolidayCalendar[];
  onRefresh: () => Promise<void>;
  onFormChange: (showing: boolean) => void;
}) {
  const [dialog, setDialog] = useState<CalendarDialogKind | null>(null);
  const [selectedCalendar, setSelectedCalendar] = useState<HolidayCalendar | null>(null);
  const [calendarDetail, setCalendarDetail] = useState<HolidayCalendarDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [calendarValues, setCalendarValues] = useState(emptyHolidayCalendarValues);
  const [activation, setActivation] = useState(emptyActivation);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState('');
  const returnFocusRef = useRef<{ focus(): void } | null>(null);
  const { evidenceOptions, evidenceLoading } = useEvidenceOptions(
    agencyId,
    dialog === 'activate',
    setError,
  );

  const editingCalendar = dialog === 'create' || dialog === 'edit';
  const showingForm = editingCalendar || dialog === 'detail';

  useEffect(() => {
    onFormChange(showingForm);
    return () => onFormChange(false);
  }, [onFormChange, showingForm]);

  function openDialog(
    kind: CalendarDialogKind,
    target: { focus(): void },
    entity: HolidayCalendar | null,
  ): void {
    returnFocusRef.current = target;
    setError('');
    setActivation(emptyActivation());
    setSelectedCalendar(entity);
    setDialog(kind);
  }

  useImperativeHandle(ref, () => ({
    openCreate(target) {
      setCalendarValues(emptyHolidayCalendarValues());
      openDialog('create', target, null);
    },
  }));

  function closeDialog(force = false): void {
    if (busy && !force) return;
    const focusTarget = returnFocusRef.current;
    setDialog(null);
    setSelectedCalendar(null);
    setCalendarDetail(null);
    setTimeout(() => {
      focusTarget?.focus();
      setTimeout(() => focusTarget?.focus(), 0);
    }, 0);
  }

  function openCalendarDetail(calendar: HolidayCalendar, target: { focus(): void }): void {
    returnFocusRef.current = target;
    setError('');
    setActivation(emptyActivation());
    setSelectedCalendar(calendar);
    setCalendarDetail(null);
    setDialog('detail');
    setDetailLoading(true);
    void request('/holiday-calendars/' + encodeURIComponent(calendar.id))
      .then((value) => {
        setCalendarDetail(value as HolidayCalendarDetail);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : 'This record is unavailable.');
      })
      .finally(() => {
        setDetailLoading(false);
      });
  }

  async function submitHolidayCalendar(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !validForm(event)) return;
    setBusy(true);
    setError('');
    try {
      const creating = dialog === 'create';
      await request(
        creating
          ? '/holiday-calendars'
          : '/holiday-calendars/' + selectedCalendar?.id + '/drafts/' + selectedCalendar?.draft?.id,
        {
          method: creating ? 'POST' : 'PATCH',
          body: JSON.stringify(holidayCalendarPayload(calendarValues, creating)),
        },
      );
      await onRefresh();
      setSuccess(
        creating
          ? 'Draft Holiday Calendar “' + calendarValues.code + '” was created.'
          : 'Draft Holiday Calendar “' + calendarValues.code + '” was updated.',
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
    if (!selectedCalendar) return;
    setBusy(true);
    setError('');
    try {
      await request('/holiday-calendars/' + selectedCalendar.id + '/successor', {
        method: 'POST',
      });
      await onRefresh();
      setSuccess('A Draft successor for “' + selectedCalendar.code + '” was created.');
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
    if (busy || !validForm(event) || !selectedCalendar?.draft) return;
    setBusy(true);
    setError('');
    try {
      await request(
        '/holiday-calendars/' +
          selectedCalendar.id +
          '/drafts/' +
          selectedCalendar.draft.id +
          '/activate',
        {
          method: 'POST',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify(activation),
        },
      );
      await onRefresh();
      setSuccess('Holiday Calendar “' + selectedCalendar.code + '” was activated.');
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

  function calendarActions(calendar: HolidayCalendar) {
    return (
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={(event) =>
            openCalendarDetail(calendar, event.currentTarget as unknown as { focus(): void })
          }
        >
          Details
        </Button>
        {calendar.draft && canManage ? (
          <Button
            type="button"
            variant="secondary"
            onClick={(event) => {
              setCalendarValues(
                holidayCalendarValuesFrom(calendar, calendar.draft as HolidayCalendarVersion),
              );
              openDialog('edit', event.currentTarget as unknown as { focus(): void }, calendar);
            }}
          >
            Edit Draft
          </Button>
        ) : null}
        {calendar.draft && canActivate ? (
          <Button
            type="button"
            variant="primary"
            onClick={(event) =>
              openDialog('activate', event.currentTarget as unknown as { focus(): void }, calendar)
            }
          >
            Activate
          </Button>
        ) : null}
        {calendar.currentVersion && !calendar.draft && canManage ? (
          <Button
            type="button"
            variant="secondary"
            onClick={(event) =>
              openDialog('successor', event.currentTarget as unknown as { focus(): void }, calendar)
            }
          >
            Create Successor
          </Button>
        ) : null}
      </div>
    );
  }

  const selectedLabel = selectedCalendar ? selectedCalendar.code : 'Attendance Configuration';
  const dialogDescriptionId = 'holiday-calendar-dialog-description';

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
          title="Holiday Calendar register"
          flush
          actions={
            <span className="text-caption text-ink-muted">
              {countLabel(calendars.length, 'calendar')} · Agency scoped · Published per version
            </span>
          }
        >
          {calendars.length === 0 ? (
            <StateSurface compact label="Holiday Calendars">
              <strong className="text-body font-[650] text-ink">No Holiday Calendars yet.</strong>
              <p className="m-0 max-w-[560px]">
                A Holiday Calendar fixes the day types that Work Arrangement Versions pin for their
                scope. Each activated version is immutable and superseded in turn.
              </p>
            </StateSurface>
          ) : (
            <Table aria-label="Holiday Calendars" className="min-w-[860px]">
              <thead>
                <tr>
                  <Th>Holiday Calendar</Th>
                  <Th>Scope</Th>
                  <Th>Current version</Th>
                  <Th>Draft</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {calendars.map((calendar) => (
                  <Tr key={calendar.id}>
                    <RowHeader>
                      <div className="grid gap-1">
                        <button
                          className={recordLinkClass}
                          onClick={(event) =>
                            openCalendarDetail(
                              calendar,
                              event.currentTarget as unknown as { focus(): void },
                            )
                          }
                          type="button"
                        >
                          {calendar.code}
                        </button>
                        <span className="text-caption font-normal text-ink-muted">
                          {calendar.name}
                        </span>
                      </div>
                    </RowHeader>
                    <Td className="text-ink-muted">
                      {label(calendar.scopeType) + ' · ' + calendar.scopeReference}
                    </Td>
                    <Td>
                      {calendar.currentVersion
                        ? 'v' +
                          calendar.currentVersion.versionNo +
                          ' · ' +
                          calendar.currentVersion.entries.length +
                          (calendar.currentVersion.entries.length === 1
                            ? ' entry · '
                            : ' entries · ') +
                          dateLabel(calendar.currentVersion.effectiveFrom)
                        : 'No active version'}
                    </Td>
                    <Td className="text-ink-muted">
                      {calendar.draft
                        ? 'v' +
                          calendar.draft.versionNo +
                          ' · ' +
                          dateLabel(calendar.draft.effectiveFrom)
                        : 'None'}
                    </Td>
                    <Td>{calendarActions(calendar)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      </div>

      <DialogContent
        aria-describedby={dialogDescriptionId}
        className={editingCalendar ? 'max-w-[980px]' : undefined}
      >
        <DialogHeader>
          <div className="grid min-w-0 gap-1.5">
            <DialogTitle>
              {dialog === 'create'
                ? 'Create Holiday Calendar'
                : dialog === 'edit'
                  ? 'Edit Draft Holiday Calendar'
                  : dialog === 'successor'
                    ? 'Create Successor · ' + selectedLabel
                    : dialog === 'activate'
                      ? 'Activate ' + selectedLabel
                      : 'Holiday Calendar · ' + selectedLabel}
            </DialogTitle>
            <DialogDescription id={dialogDescriptionId}>
              {dialog === 'activate'
                ? 'Activation pins the authority Document Version, validates the Draft, and retires any predecessor by supersession.'
                : dialog === 'successor'
                  ? 'The successor copies the current published definition and receives a later effective date. It remains Draft until reviewed.'
                  : dialog === 'create' || dialog === 'edit'
                    ? 'Declare the calendar scope, effective date, and one row per holiday date and day type.'
                    : 'Inspect effective-dated versions, their holiday entries, and the immutable transition history.'}
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
          <HolidayCalendarDetailBody
            detail={calendarDetail}
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
            onSubmit={(event) => void submitHolidayCalendar(event)}
          >
            <DialogBody className="grid auto-rows-max content-start gap-6">
              <FormError message={error} />
              <HolidayCalendarDefinitionFields
                dialog={dialog}
                setValue={(field, value) =>
                  setCalendarValues((current) => ({ ...current, [field]: value }))
                }
                values={calendarValues}
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
