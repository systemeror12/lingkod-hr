'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  isAuditEventDetail,
  isAuditEventListResponse,
  type AuditEvent,
  type AuditEventDetail,
  type AuditEventListResponse,
} from '../lib/audit-contract';

interface FocusableElement {
  focus(): void;
}

interface FocusableContainer {
  querySelectorAll(selector: string): ArrayLike<FocusableElement>;
}

function dateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Manila',
  })} ${date.toLocaleTimeString('en-PH', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Asia/Manila',
  })} PHT`;
}

function statusLabel(value: string | null): string {
  return value ?? '—';
}

function errorMessage(value: unknown, fallback: string): string {
  if (typeof value !== 'object' || value === null) return fallback;
  const error = (value as { error?: { message?: unknown } }).error;
  return typeof error?.message === 'string' ? error.message : fallback;
}

function focusableElements(container: FocusableContainer): FocusableElement[] {
  return Array.from(
    container.querySelectorAll(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
}

function DataBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <section className="grid gap-2" aria-labelledby={`${label.toLowerCase()}-data-title`}>
      <h3
        className="m-0 text-[11px] font-bold tracking-[0.08em] text-cobalt uppercase"
        id={`${label.toLowerCase()}-data-title`}
      >
        {label}
      </h3>
      {value === null ? (
        <p className="m-0 rounded-[3px] border border-line bg-canvas px-3 py-3 text-sm text-muted">
          None recorded
        </p>
      ) : (
        <pre className="m-0 max-h-64 overflow-auto rounded-[3px] border border-line bg-canvas p-3 font-mono text-xs leading-[1.6] whitespace-pre-wrap text-ink">
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </section>
  );
}

export function AuditWorkspace({
  agencyId,
  initial,
}: {
  agencyId: string;
  initial: AuditEventListResponse;
}) {
  const [events, setEvents] = useState(initial.events);
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const [hasMore, setHasMore] = useState(initial.hasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AuditEventDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const triggerRef = useRef<FocusableElement | null>(null);
  const closeRef = useRef<FocusableElement | null>(null);
  const panelRef = useRef<FocusableContainer | null>(null);
  const panelWasOpenRef = useRef(false);
  const detailRequestRef = useRef(0);

  useEffect(() => {
    if (selectedId) {
      panelWasOpenRef.current = true;
      setTimeout(() => closeRef.current?.focus(), 0);
    } else if (panelWasOpenRef.current) {
      triggerRef.current?.focus();
    }
  }, [selectedId]);

  function openDetail(event: AuditEvent, trigger: FocusableElement): void {
    triggerRef.current = trigger;
    setSelectedId(event.id);
    setDetail(null);
    setDetailError('');
    setDetailLoading(true);
    const requestNumber = detailRequestRef.current + 1;
    detailRequestRef.current = requestNumber;
    void fetch(`/api/v1/agencies/${agencyId}/audit-events/${event.id}`, {
      credentials: 'include',
    })
      .then(async (response) => {
        const value: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(
            response.status === 404
              ? 'This Audit Event is no longer available in the active Agency Context.'
              : errorMessage(value, 'The Audit Event could not be loaded.'),
          );
        }
        if (!isAuditEventDetail(value)) throw new Error('The Audit Event response was invalid.');
        return value;
      })
      .then((value) => {
        if (detailRequestRef.current === requestNumber) setDetail(value);
      })
      .catch((error: unknown) => {
        if (detailRequestRef.current !== requestNumber) return;
        setDetailError(
          error instanceof Error ? error.message : 'The Audit Event could not be loaded.',
        );
      })
      .finally(() => {
        if (detailRequestRef.current === requestNumber) setDetailLoading(false);
      });
  }

  function closeDetail(): void {
    detailRequestRef.current += 1;
    setSelectedId(null);
    setDetail(null);
    setDetailError('');
    setDetailLoading(false);
  }

  async function loadMore(): Promise<void> {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setListError('');
    try {
      const response = await fetch(
        `/api/v1/agencies/${agencyId}/audit-events?limit=25&cursor=${encodeURIComponent(nextCursor)}`,
        { credentials: 'include' },
      );
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(errorMessage(value, 'More Audit Events could not be loaded.'));
      if (!isAuditEventListResponse(value)) {
        throw new Error('The Audit Log response was invalid.');
      }
      const page = value;
      setEvents((current) => [...current, ...page.events]);
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (error: unknown) {
      setListError(
        error instanceof Error ? error.message : 'More Audit Events could not be loaded.',
      );
    } finally {
      setLoadingMore(false);
    }
  }

  function handlePanelKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDetail();
      return;
    }
    if (event.key !== 'Tab' || !panelRef.current) return;
    const focusable = focusableElements(panelRef.current);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    const target = event.target as unknown as FocusableElement;
    if (event.shiftKey && target === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && target === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <>
      <div className="grid gap-7">
        <header className="grid max-w-[720px] gap-2">
          <p className="m-0 text-[11px] font-bold tracking-[0.09em] text-cobalt uppercase">
            Evidence
          </p>
          <h1 className="m-0 text-[clamp(28px,3vw,38px)] leading-[1.08] font-[680] tracking-[-0.035em] text-midnight">
            Audit Log
          </h1>
          <p className="m-0 text-sm leading-[1.65] text-muted">
            Read-only Organization Unit evidence from the active Agency Context.
          </p>
        </header>

        <section
          className="overflow-hidden rounded-[5px] border border-line bg-paper"
          aria-labelledby="audit-events-heading"
        >
          <header className="flex min-h-[60px] items-center justify-between gap-4 border-b border-line px-5">
            <div className="grid gap-1">
              <h2 className="m-0 text-sm font-[670] text-midnight" id="audit-events-heading">
                Organization Unit events
              </h2>
              <span className="text-xs text-muted">
                {events.length === 1 ? '1 event' : `${events.length} events`}
              </span>
            </div>
            <span className="rounded-full bg-pale-blue px-2.5 py-1 text-xs font-[650] text-cobalt">
              Agency scoped · Read only
            </span>
          </header>

          {events.length === 0 ? (
            <div className="grid min-h-[260px] place-content-center gap-2 px-6 py-12 text-left">
              <strong className="text-[15px] font-[650] text-midnight">
                No Organization Unit audit events yet.
              </strong>
              <p className="m-0 max-w-[520px] text-[13px] leading-[1.6] text-muted">
                Persisted Organization Unit creation evidence will appear here after a Draft is
                created in this Agency.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-line">
              {events.map((event) => (
                <button
                  className="grid w-full gap-4 px-5 py-5 text-left hover:bg-canvas min-[621px]:grid-cols-[minmax(0,1fr)_auto] min-[621px]:items-start"
                  type="button"
                  key={event.id}
                  aria-expanded={selectedId === event.id}
                  onClick={(clickEvent) =>
                    openDetail(event, clickEvent.currentTarget as unknown as FocusableElement)
                  }
                >
                  <span className="grid min-w-0 gap-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <strong className="font-mono text-xs font-[700] tracking-[0.02em] text-midnight">
                        {event.action}
                      </strong>
                      <span className="rounded-full bg-pale-blue px-2 py-1 text-[10px] font-[700] tracking-[0.04em] text-cobalt uppercase">
                        {statusLabel(event.previousStatus)} → {statusLabel(event.newStatus)}
                      </span>
                    </span>
                    <span className="grid gap-1 text-[13px] text-muted min-[621px]:grid-cols-3 min-[621px]:gap-4">
                      <span>
                        <span className="font-[650] text-ink">Actor:</span> {event.actor}
                      </span>
                      <span>
                        <span className="font-[650] text-ink">Entity:</span> {event.entityType}
                      </span>
                      <span className="break-all font-mono text-[11px]">{event.entityId}</span>
                    </span>
                  </span>
                  <time
                    className="text-xs text-muted min-[621px]:text-right"
                    dateTime={event.occurredAt}
                  >
                    {dateLabel(event.occurredAt)}
                  </time>
                </button>
              ))}
            </div>
          )}
        </section>

        {listError ? (
          <p
            className="m-0 rounded-[4px] border border-[#d6aeb0] bg-[#fff7f7] px-4 py-3 text-sm text-[#7a3036]"
            role="alert"
          >
            {listError}
          </p>
        ) : null}
        {hasMore ? (
          <button
            className="min-h-11 justify-self-start rounded-[3px] border border-line bg-paper px-4 text-sm font-[650] text-ink hover:bg-canvas disabled:opacity-60"
            type="button"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? 'Loading…' : 'Load more events'}
          </button>
        ) : null}
      </div>

      {selectedId ? (
        <div className="fixed inset-0 z-20 bg-midnight/35" role="presentation">
          <section
            className="fixed inset-2 z-30 grid max-h-[calc(100dvh-16px)] grid-rows-[auto_1fr] overflow-hidden rounded-[5px] border border-line bg-paper shadow-[0_18px_55px_rgb(23_32_51/20%)] min-[820px]:inset-y-0 min-[820px]:right-0 min-[820px]:left-auto min-[820px]:w-[520px] min-[820px]:max-w-[calc(100vw-32px)] min-[820px]:rounded-none min-[820px]:rounded-l-[5px]"
            ref={(value) => {
              panelRef.current = value as unknown as FocusableContainer | null;
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="audit-detail-title"
            aria-busy={detailLoading}
            onKeyDown={handlePanelKeyDown}
          >
            <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
              <div className="grid gap-1.5">
                <p className="m-0 text-[11px] font-bold tracking-[0.09em] text-cobalt uppercase">
                  Read only
                </p>
                <h2
                  className="m-0 text-xl font-[680] tracking-[-0.025em] text-midnight"
                  id="audit-detail-title"
                >
                  Audit Event detail
                </h2>
              </div>
              <button
                className="min-h-9 min-w-9 rounded-[3px] text-xl text-muted hover:bg-canvas"
                type="button"
                ref={(value) => {
                  closeRef.current = value as unknown as FocusableElement | null;
                }}
                aria-label="Close audit event detail"
                onClick={closeDetail}
              >
                ×
              </button>
            </header>

            <div className="min-h-0 overflow-y-auto px-6 py-6">
              {detailLoading ? (
                <p className="m-0 text-sm text-muted" role="status">
                  Loading Audit Event…
                </p>
              ) : null}
              {detailError ? (
                <p
                  className="m-0 rounded-[4px] border border-[#d6aeb0] bg-[#fff7f7] px-4 py-3 text-sm text-[#7a3036]"
                  role="alert"
                >
                  {detailError}
                </p>
              ) : null}
              {detail ? (
                <div className="grid gap-6">
                  <div className="grid gap-4 rounded-[4px] border border-line bg-canvas px-4 py-4">
                    <div className="grid gap-1">
                      <span className="text-[10px] font-bold tracking-[0.08em] text-muted uppercase">
                        Action
                      </span>
                      <strong className="font-mono text-xs text-midnight">{detail.action}</strong>
                    </div>
                    <div className="grid gap-1">
                      <span className="text-[10px] font-bold tracking-[0.08em] text-muted uppercase">
                        Status transition
                      </span>
                      <strong className="text-sm text-ink">
                        {statusLabel(detail.previousStatus)} → {statusLabel(detail.newStatus)}
                      </strong>
                    </div>
                    <div className="grid gap-1">
                      <span className="text-[10px] font-bold tracking-[0.08em] text-muted uppercase">
                        Occurred in Philippine time
                      </span>
                      <time className="text-sm text-ink" dateTime={detail.occurredAt}>
                        {dateLabel(detail.occurredAt)}
                      </time>
                    </div>
                    <div className="grid gap-1">
                      <span className="text-[10px] font-bold tracking-[0.08em] text-muted uppercase">
                        Actor
                      </span>
                      <span className="text-sm text-ink">{detail.actor}</span>
                    </div>
                    <div className="grid gap-1">
                      <span className="text-[10px] font-bold tracking-[0.08em] text-muted uppercase">
                        Entity
                      </span>
                      <span className="break-all font-mono text-xs text-ink">
                        {detail.entityType} · {detail.entityId}
                      </span>
                    </div>
                    <div className="grid gap-1">
                      <span className="text-[10px] font-bold tracking-[0.08em] text-muted uppercase">
                        Request ID
                      </span>
                      <span className="break-all font-mono text-xs text-ink">
                        {detail.requestId ?? 'Not recorded'}
                      </span>
                    </div>
                  </div>
                  <DataBlock label="Before" value={detail.before} />
                  <DataBlock label="After" value={detail.after} />
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
