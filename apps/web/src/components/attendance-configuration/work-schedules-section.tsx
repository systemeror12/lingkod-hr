'use client';

import { useEffect, useImperativeHandle, useRef, useState, type FormEvent, type Ref } from 'react';
import { Field, inputClass, labelClass, FormError } from '../ui/field';
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
  rowBoxClass,
  sectionTitleClass,
  targetChecked,
  targetValue,
  validForm,
} from './helpers';
import {
  type ScheduleType,
  type DayRuleType,
  type EventPattern,
  scheduleTypes,
  ruleTypes,
  eventPatterns,
  weekdayLabels,
  type WorkScheduleDayRule,
  type WorkScheduleVersion,
  type WorkSchedule,
  type WorkScheduleDetail,
  type BreakForm,
  type DayRuleForm,
  type ScheduleFormValues,
  type TabSectionHandle,
} from './types';
import { useEvidenceOptions } from './use-evidence-options';

type ScheduleDialog = 'create' | 'edit' | 'detail' | 'successor' | 'activate';

function defaultDayRule(weekday: number, ruleType: DayRuleType): DayRuleForm {
  const base: DayRuleForm = {
    weekday,
    ruleType,
    dutyStartTime: '',
    earliestStartTime: '',
    latestStartTime: '',
    dutyEndTime: '',
    endNextCalendarDay: false,
    requiredMinutes: '0',
    coreStartTime: '',
    coreEndTime: '',
    eventPattern: 'IN_OUT',
    collectionBeforeMinutes: '0',
    collectionAfterMinutes: '0',
    breaks: [],
  };
  if (ruleType === 'FIXED') {
    return {
      ...base,
      dutyStartTime: '08:00',
      dutyEndTime: '17:00',
      requiredMinutes: '480',
      breaks: [{ breakStartTime: '12:00', breakEndTime: '13:00', endNextCalendarDay: false }],
    };
  }
  if (ruleType === 'FLEXIBLE') {
    return {
      ...base,
      earliestStartTime: '07:00',
      latestStartTime: '09:00',
      dutyEndTime: '18:00',
      requiredMinutes: '480',
      breaks: [{ breakStartTime: '12:00', breakEndTime: '13:00', endNextCalendarDay: false }],
    };
  }
  return base;
}

function emptyDayRules(): DayRuleForm[] {
  return [1, 2, 3, 4, 5, 6, 7].map((weekday) =>
    defaultDayRule(weekday, weekday <= 5 ? 'FIXED' : 'REST'),
  );
}

function emptyScheduleValues(): ScheduleFormValues {
  return {
    code: '',
    name: '',
    scheduleType: 'REGULAR',
    timezone: 'Asia/Manila',
    effectiveDate: manilaToday(),
    dayRules: emptyDayRules(),
  };
}

function scheduleValuesFrom(
  schedule: WorkSchedule,
  version: WorkScheduleVersion,
): ScheduleFormValues {
  return {
    code: schedule.code,
    name: schedule.name,
    scheduleType: version.scheduleType,
    timezone: version.timezone,
    effectiveDate: version.effectiveFrom,
    dayRules: [1, 2, 3, 4, 5, 6, 7].map((weekday) => {
      const rule = version.dayRules.find((entry) => entry.weekday === weekday);
      return rule ? dayRuleFrom(rule) : defaultDayRule(weekday, 'REST');
    }),
    rowVersion: version.rowVersion,
  };
}

function dayRuleFrom(rule: WorkScheduleDayRule): DayRuleForm {
  return {
    weekday: rule.weekday,
    ruleType: rule.ruleType,
    dutyStartTime: rule.dutyStartTime ?? '',
    earliestStartTime: rule.earliestStartTime ?? '',
    latestStartTime: rule.latestStartTime ?? '',
    dutyEndTime: rule.dutyEndTime ?? '',
    endNextCalendarDay: rule.endNextCalendarDay,
    requiredMinutes: String(rule.requiredMinutes),
    coreStartTime: rule.coreStartTime ?? '',
    coreEndTime: rule.coreEndTime ?? '',
    eventPattern: rule.eventPattern,
    collectionBeforeMinutes: String(rule.collectionBeforeMinutes),
    collectionAfterMinutes: String(rule.collectionAfterMinutes),
    breaks: rule.breaks.map((entry) => ({
      breakStartTime: entry.breakStartTime,
      breakEndTime: entry.breakEndTime,
      endNextCalendarDay: entry.endNextCalendarDay,
    })),
  };
}

function timeOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function breakPayload(item: BreakForm): Record<string, unknown> {
  return {
    breakStartTime: item.breakStartTime,
    breakEndTime: item.breakEndTime,
    endNextCalendarDay: item.endNextCalendarDay,
  };
}

function dayRulePayload(rule: DayRuleForm): Record<string, unknown> {
  const base: Record<string, unknown> = {
    weekday: rule.weekday,
    ruleType: rule.ruleType,
    requiredMinutes: rule.ruleType === 'REST' ? 0 : Number(rule.requiredMinutes || '0'),
    eventPattern: rule.ruleType === 'REST' ? 'IN_OUT' : rule.eventPattern,
    collectionBeforeMinutes:
      rule.ruleType === 'REST' ? 0 : Number(rule.collectionBeforeMinutes || '0'),
    collectionAfterMinutes:
      rule.ruleType === 'REST' ? 0 : Number(rule.collectionAfterMinutes || '0'),
  };
  if (rule.ruleType === 'FIXED') {
    return {
      ...base,
      dutyStartTime: timeOrNull(rule.dutyStartTime),
      dutyEndTime: timeOrNull(rule.dutyEndTime),
      endNextCalendarDay: rule.endNextCalendarDay,
      breaks: rule.breaks.map(breakPayload),
    };
  }
  if (rule.ruleType === 'FLEXIBLE') {
    return {
      ...base,
      earliestStartTime: timeOrNull(rule.earliestStartTime),
      latestStartTime: timeOrNull(rule.latestStartTime),
      dutyEndTime: timeOrNull(rule.dutyEndTime),
      endNextCalendarDay: rule.endNextCalendarDay,
      coreStartTime: timeOrNull(rule.coreStartTime),
      coreEndTime: timeOrNull(rule.coreEndTime),
      breaks: rule.breaks.map(breakPayload),
    };
  }
  return base;
}

function schedulePayload(
  values: ScheduleFormValues,
  includeIdentity: boolean,
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    scheduleType: values.scheduleType,
    timezone: values.timezone,
    effectiveDate: values.effectiveDate,
    dayRules: values.dayRules.map(dayRulePayload),
  };
  if (includeIdentity) {
    result.code = values.code;
    result.name = values.name;
  } else if (values.rowVersion !== undefined) {
    result.rowVersion = values.rowVersion;
  }
  return result;
}

export function ruleWindow(rule: WorkScheduleDayRule): string {
  if (rule.ruleType === 'REST') return 'No duty';
  if (rule.ruleType === 'FIXED') {
    return (
      (rule.dutyStartTime ?? '—') +
      '–' +
      (rule.dutyEndTime ?? '—') +
      (rule.endNextCalendarDay ? ' (+1 day)' : '')
    );
  }
  return (
    (rule.earliestStartTime ?? '—') +
    '–' +
    (rule.latestStartTime ?? '—') +
    ' start · ends ' +
    (rule.dutyEndTime ?? '—') +
    (rule.endNextCalendarDay ? ' (+1 day)' : '')
  );
}

function breaksLabel(rule: WorkScheduleDayRule): string {
  if (!rule.breaks.length) return '—';
  return rule.breaks
    .map(
      (entry) =>
        entry.breakStartTime +
        '–' +
        entry.breakEndTime +
        (entry.endNextCalendarDay ? ' (+1 day)' : ''),
    )
    .join(', ');
}

function ScheduleDayRuleTable({
  caption,
  rules,
}: {
  caption: string;
  rules: WorkScheduleDayRule[];
}) {
  return (
    <Table aria-label={caption} className="min-w-[640px]">
      <thead>
        <tr>
          <Th>Day</Th>
          <Th>Rule</Th>
          <Th>Window</Th>
          <Th>Required</Th>
          <Th>Unpaid breaks</Th>
          <Th>Collection window</Th>
        </tr>
      </thead>
      <tbody>
        {rules.map((rule) => (
          <Tr key={rule.id}>
            <RowHeader>{weekdayLabels[rule.weekday]}</RowHeader>
            <Td>{label(rule.ruleType)}</Td>
            <Td>{ruleWindow(rule)}</Td>
            <Td>
              {rule.requiredMinutes} min
              {rule.ruleType === 'FLEXIBLE' && rule.coreStartTime && rule.coreEndTime
                ? ' · core ' + rule.coreStartTime + '–' + rule.coreEndTime
                : ''}
            </Td>
            <Td>{breaksLabel(rule)}</Td>
            <Td>
              {rule.collectionBeforeMinutes || rule.collectionAfterMinutes
                ? '+' +
                  rule.collectionBeforeMinutes +
                  ' before · +' +
                  rule.collectionAfterMinutes +
                  ' after'
                : '—'}
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

function ScheduleDetailBody({
  detail,
  detailLoading,
  error,
}: {
  detail: WorkScheduleDetail | null;
  detailLoading: boolean;
  error: string;
}) {
  return (
    <>
      <DialogBody className="grid gap-6">
        {detailLoading ? (
          <DetailLoading name="Work Schedule history">Loading schedule history…</DetailLoading>
        ) : null}
        <FormError message={error} />
        {detail ? (
          <>
            <dl className="m-0 grid gap-4 text-small min-[621px]:grid-cols-2">
              <VersionMeta label="Code">{detail.schedule.code}</VersionMeta>
              <VersionMeta label="Name">{detail.schedule.name}</VersionMeta>
              <VersionMeta label="Effective on">{dateLabel(detail.asOf)}</VersionMeta>
              <VersionMeta label="Effective version">
                {detail.effective
                  ? 'v' +
                    detail.effective.versionNo +
                    ' · ' +
                    label(detail.effective.scheduleType) +
                    ' · ' +
                    detail.effective.timezone
                  : 'No effective version'}
              </VersionMeta>
            </dl>
            <section className="grid gap-3" aria-labelledby="work-schedule-version-history-title">
              <h3 className={sectionTitleClass} id="work-schedule-version-history-title">
                Version history
              </h3>
              {detail.versions.map((version) => (
                <VersionCard
                  key={version.id}
                  meta={
                    <>
                      <VersionEffectivity from={version.effectiveFrom} to={version.effectiveTo} />
                      <VersionMeta label="Schedule type">{label(version.scheduleType)}</VersionMeta>
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
                >
                  <ScheduleDayRuleTable
                    caption={'Version ' + version.versionNo + ' day rules'}
                    rules={version.dayRules}
                  />
                </VersionCard>
              ))}
            </section>
            <TransitionHistory history={detail.history} id="work-schedule-audit-history-title" />
          </>
        ) : null}
      </DialogBody>
      <DetailFooter />
    </>
  );
}

function DayRuleEditor({
  onChange,
  rule,
}: {
  onChange: (rule: DayRuleForm) => void;
  rule: DayRuleForm;
}) {
  const id = 'day-rule-' + rule.weekday;
  function update(patch: Partial<DayRuleForm>): void {
    onChange({ ...rule, ...patch });
  }
  function setBreak(index: number, patch: Partial<BreakForm>): void {
    update({
      breaks: rule.breaks.map((entry, position) =>
        position === index ? { ...entry, ...patch } : entry,
      ),
    });
  }
  return (
    <section aria-labelledby={id + '-title'} className={'grid gap-4 ' + rowBoxClass}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h4 className={sectionTitleClass} id={id + '-title'}>
          {weekdayLabels[rule.weekday]}
        </h4>
        <div className="flex flex-wrap items-end gap-3">
          <label className={labelClass}>
            <span>Day rule</span>
            <select
              className={inputClass + ' w-auto'}
              id={id + '-type'}
              onChange={(event) =>
                onChange(defaultDayRule(rule.weekday, targetValue(event) as DayRuleType))
              }
              value={rule.ruleType}
            >
              {ruleTypes.map((entry) => (
                <option key={entry} value={entry}>
                  {label(entry)}
                </option>
              ))}
            </select>
          </label>
          {rule.ruleType !== 'REST' ? (
            <label className={labelClass}>
              <span>Required minutes</span>
              <input
                className={inputClass + ' w-[130px]'}
                min="1"
                onChange={(event) => update({ requiredMinutes: targetValue(event) })}
                required
                type="number"
                value={rule.requiredMinutes}
              />
            </label>
          ) : null}
        </div>
      </header>
      {rule.ruleType === 'FIXED' ? (
        <div className="grid gap-3 min-[700px]:grid-cols-3">
          <Field htmlFor={id + '-duty-start'} label="Duty start">
            <input
              className={inputClass}
              id={id + '-duty-start'}
              onChange={(event) => update({ dutyStartTime: targetValue(event) })}
              required
              type="time"
              value={rule.dutyStartTime}
            />
          </Field>
          <Field htmlFor={id + '-duty-end'} label="Duty end">
            <input
              className={inputClass}
              id={id + '-duty-end'}
              onChange={(event) => update({ dutyEndTime: targetValue(event) })}
              required
              type="time"
              value={rule.dutyEndTime}
            />
          </Field>
          <label className="flex min-h-9 items-center gap-2 self-end text-caption font-[650] text-ink">
            <input
              checked={rule.endNextCalendarDay}
              onChange={(event) => update({ endNextCalendarDay: targetChecked(event) })}
              type="checkbox"
            />
            Duty ends on the next calendar day
          </label>
        </div>
      ) : null}
      {rule.ruleType === 'FLEXIBLE' ? (
        <div className="grid gap-3 min-[700px]:grid-cols-3">
          <Field htmlFor={id + '-earliest-start'} label="Earliest start">
            <input
              className={inputClass}
              id={id + '-earliest-start'}
              onChange={(event) => update({ earliestStartTime: targetValue(event) })}
              required
              type="time"
              value={rule.earliestStartTime}
            />
          </Field>
          <Field htmlFor={id + '-latest-start'} label="Latest start">
            <input
              className={inputClass}
              id={id + '-latest-start'}
              onChange={(event) => update({ latestStartTime: targetValue(event) })}
              required
              type="time"
              value={rule.latestStartTime}
            />
          </Field>
          <Field htmlFor={id + '-duty-end'} label="Duty end">
            <input
              className={inputClass}
              id={id + '-duty-end'}
              onChange={(event) => update({ dutyEndTime: targetValue(event) })}
              required
              type="time"
              value={rule.dutyEndTime}
            />
          </Field>
          <Field htmlFor={id + '-core-start'} label="Core start (optional)">
            <input
              className={inputClass}
              id={id + '-core-start'}
              onChange={(event) => update({ coreStartTime: targetValue(event) })}
              type="time"
              value={rule.coreStartTime}
            />
          </Field>
          <Field htmlFor={id + '-core-end'} label="Core end (optional)">
            <input
              className={inputClass}
              id={id + '-core-end'}
              onChange={(event) => update({ coreEndTime: targetValue(event) })}
              type="time"
              value={rule.coreEndTime}
            />
          </Field>
          <label className="flex min-h-9 items-center gap-2 self-end text-caption font-[650] text-ink">
            <input
              checked={rule.endNextCalendarDay}
              onChange={(event) => update({ endNextCalendarDay: targetChecked(event) })}
              type="checkbox"
            />
            Duty ends on the next calendar day
          </label>
        </div>
      ) : null}
      {rule.ruleType !== 'REST' ? (
        <>
          <div className="grid gap-3 min-[700px]:grid-cols-3">
            <Field htmlFor={id + '-event-pattern'} label="Break events">
              <select
                className={inputClass}
                id={id + '-event-pattern'}
                onChange={(event) => update({ eventPattern: targetValue(event) as EventPattern })}
                value={rule.eventPattern}
              >
                {eventPatterns.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry === 'IN_OUT' ? 'Clock in and out only' : 'Explicit break events'}
                  </option>
                ))}
              </select>
            </Field>
            <Field htmlFor={id + '-collection-before'} label="Collection opens before (minutes)">
              <input
                className={inputClass}
                id={id + '-collection-before'}
                min="0"
                onChange={(event) => update({ collectionBeforeMinutes: targetValue(event) })}
                type="number"
                value={rule.collectionBeforeMinutes}
              />
            </Field>
            <Field htmlFor={id + '-collection-after'} label="Collection closes after (minutes)">
              <input
                className={inputClass}
                id={id + '-collection-after'}
                min="0"
                onChange={(event) => update({ collectionAfterMinutes: targetValue(event) })}
                type="number"
                value={rule.collectionAfterMinutes}
              />
            </Field>
          </div>
          <div className="grid gap-2">
            <span className="text-caption font-[650] text-ink">Unpaid break intervals</span>
            {rule.breaks.length === 0 ? (
              <span className="text-small text-ink-muted">No unpaid breaks.</span>
            ) : null}
            {rule.breaks.map((entry, index) => (
              <div className="flex flex-wrap items-end gap-3" key={index}>
                <label className={labelClass}>
                  <span>Break start</span>
                  <input
                    aria-label={weekdayLabels[rule.weekday] + ' break start ' + (index + 1)}
                    className={inputClass + ' w-auto'}
                    onChange={(event) => setBreak(index, { breakStartTime: targetValue(event) })}
                    required
                    type="time"
                    value={entry.breakStartTime}
                  />
                </label>
                <label className={labelClass}>
                  <span>Break end</span>
                  <input
                    aria-label={weekdayLabels[rule.weekday] + ' break end ' + (index + 1)}
                    className={inputClass + ' w-auto'}
                    onChange={(event) => setBreak(index, { breakEndTime: targetValue(event) })}
                    required
                    type="time"
                    value={entry.breakEndTime}
                  />
                </label>
                <label className="flex min-h-9 items-center gap-2 text-caption text-ink">
                  <input
                    checked={entry.endNextCalendarDay}
                    onChange={(event) =>
                      setBreak(index, { endNextCalendarDay: targetChecked(event) })
                    }
                    type="checkbox"
                  />
                  Ends next calendar day
                </label>
                <Button
                  onClick={() =>
                    update({ breaks: rule.breaks.filter((_, position) => position !== index) })
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
              disabled={rule.breaks.length >= 12}
              onClick={() =>
                update({
                  breaks: [
                    ...rule.breaks,
                    { breakStartTime: '12:00', breakEndTime: '13:00', endNextCalendarDay: false },
                  ],
                })
              }
              type="button"
              variant="secondary"
            >
              Add unpaid break
            </Button>
          </div>
        </>
      ) : null}
    </section>
  );
}

function ScheduleDefinitionFields({
  dialog,
  setValue,
  values,
}: {
  dialog: ScheduleDialog;
  setValue: <K extends keyof ScheduleFormValues>(field: K, value: ScheduleFormValues[K]) => void;
  values: ScheduleFormValues;
}) {
  const creating = dialog === 'create';
  return (
    <>
      <section className="grid gap-4" aria-labelledby="work-schedule-definition-title">
        <h3 className={sectionTitleClass} id="work-schedule-definition-title">
          Schedule definition
        </h3>
        {creating ? (
          <div className="grid gap-4 min-[621px]:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
            <Field htmlFor="work-schedule-code" label="Work Schedule code">
              <input
                autoFocus
                className={inputClass}
                data-autofocus=""
                id="work-schedule-code"
                maxLength={80}
                onChange={(event) => setValue('code', targetValue(event))}
                required
                value={values.code}
              />
            </Field>
            <Field htmlFor="work-schedule-name" label="Work Schedule name">
              <input
                className={inputClass}
                id="work-schedule-name"
                maxLength={200}
                onChange={(event) => setValue('name', targetValue(event))}
                required
                value={values.name}
              />
            </Field>
          </div>
        ) : null}
        <div className="grid gap-4 min-[621px]:grid-cols-3">
          <Field htmlFor="work-schedule-type" label="Schedule type">
            <select
              className={inputClass}
              id="work-schedule-type"
              onChange={(event) => setValue('scheduleType', targetValue(event) as ScheduleType)}
              value={values.scheduleType}
            >
              {scheduleTypes.map((entry) => (
                <option key={entry} value={entry}>
                  {label(entry)}
                </option>
              ))}
            </select>
          </Field>
          <Field htmlFor="work-schedule-timezone" label="Time zone">
            <input
              className={inputClass}
              id="work-schedule-timezone"
              maxLength={100}
              onChange={(event) => setValue('timezone', targetValue(event))}
              required
              value={values.timezone}
            />
          </Field>
          <Field htmlFor="work-schedule-effective-date" label="Effective date">
            <input
              className={inputClass}
              id="work-schedule-effective-date"
              onChange={(event) => setValue('effectiveDate', targetValue(event))}
              required
              type="date"
              value={values.effectiveDate}
            />
          </Field>
        </div>
      </section>
      <section className="grid gap-4" aria-labelledby="work-schedule-rules-title">
        <div className="grid gap-1">
          <h3 className={sectionTitleClass} id="work-schedule-rules-title">
            Seven-day rule matrix
          </h3>
          <p className="m-0 text-small text-ink-muted">One rule per weekday</p>
        </div>
        {values.dayRules.map((rule) => (
          <DayRuleEditor
            key={rule.weekday}
            onChange={(next) =>
              setValue(
                'dayRules',
                values.dayRules.map((entry) => (entry.weekday === rule.weekday ? next : entry)),
              )
            }
            rule={rule}
          />
        ))}
      </section>
    </>
  );
}

/** The Work Schedules tab: the register and its create, edit, successor, detail, and activation forms. */
export function WorkSchedulesSection({
  agencyId,
  canActivate,
  canManage,
  onFormChange,
  onRefresh,
  recordId,
  ref,
  request,
  schedules,
}: {
  ref: Ref<TabSectionHandle>;
  agencyId: string;
  request: (path: string, init?: RequestInit) => Promise<unknown>;
  canManage: boolean;
  canActivate: boolean;
  schedules: WorkSchedule[];
  onRefresh: () => Promise<void>;
  onFormChange: (showing: boolean) => void;
  recordId: string | null;
}) {
  const [dialog, setDialog] = useState<ScheduleDialog | null>(null);
  const [selectedSchedule, setSelectedSchedule] = useState<WorkSchedule | null>(null);
  const [scheduleDetail, setScheduleDetail] = useState<WorkScheduleDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [scheduleValues, setScheduleValues] = useState(emptyScheduleValues);
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

  useImperativeHandle(ref, () => ({
    openCreate(target) {
      setScheduleValues(emptyScheduleValues());
      openDialog('create', target, null);
    },
  }));

  useEffect(() => {
    let active = true;
    if (!recordId) {
      if (dialog === 'detail') {
        setDialog(null);
        setSelectedSchedule(null);
        setScheduleDetail(null);
      }
      return;
    }
    setSelectedSchedule(null);
    setScheduleDetail(null);
    setError('');
    setDialog('detail');
    setDetailLoading(true);
    void request('/work-schedules/' + encodeURIComponent(recordId))
      .then((value) => {
        if (!active) return;
        const next = value as WorkScheduleDetail;
        setScheduleDetail(next);
        setSelectedSchedule(next.schedule);
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

  const editing = dialog === 'create' || dialog === 'edit';
  const showingForm = editing || dialog === 'detail';

  useEffect(() => {
    onFormChange(showingForm);
    return () => onFormChange(false);
  }, [onFormChange, showingForm]);

  function openDialog(
    kind: ScheduleDialog,
    target: { focus(): void },
    schedule: WorkSchedule | null,
  ): void {
    returnFocusRef.current = target;
    setError('');
    setActivation(emptyActivation());
    setSelectedSchedule(schedule);
    setDialog(kind);
  }

  function closeDialog(force = false): void {
    if (busy && !force) return;
    const focusTarget = returnFocusRef.current;
    navigation.navigate({ record: null, view: null, kind: null });
    setDialog(null);
    setSelectedSchedule(null);
    setScheduleDetail(null);
    setTimeout(() => {
      focusTarget?.focus();
      setTimeout(() => focusTarget?.focus(), 0);
    }, 0);
  }

  function openDetail(schedule: WorkSchedule, target: { focus(): void }): void {
    returnFocusRef.current = target;
    navigation.navigate({ record: schedule.id, view: 'form', kind: 'work-schedule' });
  }

  async function submitSchedule(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !validForm(event)) return;
    setBusy(true);
    setError('');
    try {
      const creating = dialog === 'create';
      await request(
        creating
          ? '/work-schedules'
          : '/work-schedules/' + selectedSchedule?.id + '/drafts/' + selectedSchedule?.draft?.id,
        {
          method: creating ? 'POST' : 'PATCH',
          body: JSON.stringify(schedulePayload(scheduleValues, creating)),
        },
      );
      await onRefresh();
      setSuccess(
        creating
          ? 'Draft Work Schedule “' + scheduleValues.code + '” was created.'
          : 'Draft Work Schedule “' + scheduleValues.code + '” was updated.',
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
    if (!selectedSchedule) return;
    setBusy(true);
    setError('');
    try {
      await request('/work-schedules/' + selectedSchedule.id + '/successor', { method: 'POST' });
      await onRefresh();
      setSuccess('A Draft successor for “' + selectedSchedule.code + '” was created.');
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
    if (busy || !validForm(event) || !selectedSchedule?.draft) return;
    setBusy(true);
    setError('');
    try {
      await request(
        '/work-schedules/' +
          selectedSchedule.id +
          '/drafts/' +
          selectedSchedule.draft.id +
          '/activate',
        {
          method: 'POST',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify(activation),
        },
      );
      await onRefresh();
      setSuccess('Work Schedule “' + selectedSchedule.code + '” was activated.');
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

  function scheduleActions(schedule: WorkSchedule) {
    return (
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={(event) =>
            openDetail(schedule, event.currentTarget as unknown as { focus(): void })
          }
        >
          Details
        </Button>
        {schedule.draft && canManage ? (
          <Button
            type="button"
            variant="secondary"
            onClick={(event) => {
              setScheduleValues(
                scheduleValuesFrom(schedule, schedule.draft as WorkScheduleVersion),
              );
              openDialog('edit', event.currentTarget as unknown as { focus(): void }, schedule);
            }}
          >
            Edit Draft
          </Button>
        ) : null}
        {schedule.draft && canActivate ? (
          <Button
            type="button"
            variant="primary"
            onClick={(event) =>
              openDialog('activate', event.currentTarget as unknown as { focus(): void }, schedule)
            }
          >
            Activate
          </Button>
        ) : null}
        {schedule.currentVersion && !schedule.draft && canManage ? (
          <Button
            type="button"
            variant="secondary"
            onClick={(event) =>
              openDialog('successor', event.currentTarget as unknown as { focus(): void }, schedule)
            }
          >
            Create Successor
          </Button>
        ) : null}
      </div>
    );
  }

  const selectedLabel = selectedSchedule ? selectedSchedule.code : 'Attendance Configuration';
  const dialogDescriptionId = 'work-schedule-dialog-description';

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
          title="Work Schedule register"
          flush
          actions={
            <span className="text-caption text-ink-muted">
              {countLabel(schedules.length, 'schedule')} · Agency scoped · Evidence required
            </span>
          }
        >
          {schedules.length === 0 ? (
            <StateSurface compact label="Work Schedules">
              <strong className="text-body font-[650] text-ink">No Work Schedules yet.</strong>
              <p className="m-0 max-w-[560px]">
                Create a Draft with one rule per weekday, then pin the authority Document Version
                and activate it. Activation retires the superseded version in history.
              </p>
            </StateSurface>
          ) : (
            <Table aria-label="Work Schedules" className="min-w-[860px]">
              <thead>
                <tr>
                  <Th>Schedule</Th>
                  <Th>Current version</Th>
                  <Th>Draft</Th>
                  <Th>Time zone</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((schedule) => (
                  <Tr key={schedule.id}>
                    <RowHeader>
                      <div className="grid gap-1">
                        <button
                          className={recordLinkClass}
                          onClick={(event) =>
                            openDetail(
                              schedule,
                              event.currentTarget as unknown as { focus(): void },
                            )
                          }
                          type="button"
                        >
                          {schedule.code}
                        </button>
                        <span className="text-caption font-normal text-ink-muted">
                          {schedule.name}
                        </span>
                      </div>
                    </RowHeader>
                    <Td>
                      {schedule.currentVersion
                        ? 'v' +
                          schedule.currentVersion.versionNo +
                          ' · ' +
                          label(schedule.currentVersion.scheduleType) +
                          ' · ' +
                          dateLabel(schedule.currentVersion.effectiveFrom)
                        : 'No active version'}
                    </Td>
                    <Td className="text-ink-muted">
                      {schedule.draft
                        ? 'v' +
                          schedule.draft.versionNo +
                          ' · ' +
                          dateLabel(schedule.draft.effectiveFrom)
                        : 'None'}
                    </Td>
                    <Td className="text-ink-muted">
                      {(schedule.currentVersion ?? schedule.draft)?.timezone ?? '—'}
                    </Td>
                    <Td>{scheduleActions(schedule)}</Td>
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
                ? 'Create Work Schedule'
                : dialog === 'edit'
                  ? 'Edit Draft Work Schedule'
                  : dialog === 'successor'
                    ? 'Create Successor · ' + selectedLabel
                    : dialog === 'activate'
                      ? 'Activate ' + selectedLabel
                      : 'Work Schedule · ' + selectedLabel}
            </DialogTitle>
            <DialogDescription id={dialogDescriptionId}>
              {editing
                ? 'Declare the schedule type, time zone, effective date, and exactly one Day Rule per weekday. Required minutes exclude unpaid breaks.'
                : dialog === 'activate'
                  ? 'Activation pins the authority Document Version, validates the Draft, and retires any predecessor by supersession.'
                  : dialog === 'successor'
                    ? 'The successor copies the current published definition and receives a later effective date. It remains Draft until reviewed.'
                    : 'Inspect effective-dated versions, the seven-day rule matrix, and the immutable transition history.'}
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
          <ScheduleDetailBody detail={scheduleDetail} detailLoading={detailLoading} error={error} />
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
            onSubmit={(event) => void submitSchedule(event)}
          >
            <DialogBody className="grid auto-rows-max content-start gap-6">
              <FormError message={error} />
              <ScheduleDefinitionFields
                dialog={dialog}
                setValue={(field, value) =>
                  setScheduleValues((current) => ({ ...current, [field]: value }))
                }
                values={scheduleValues}
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
