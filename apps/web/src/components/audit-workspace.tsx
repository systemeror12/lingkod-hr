'use client';

import { RecordReturn, useRecordNavigation } from './record-navigation';

import { useEffect, useRef, useState } from 'react';
import {
  isAuditEventDetail,
  isAuditEventListResponse,
  type AuditEvent,
  type AuditEventDetail,
  type AuditEventListResponse,
} from '../lib/audit-contract';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

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
  const navigation = useRecordNavigation();
  const selectedId = navigation.search.get('record');
  function setSelectedId(id: string | null) {
    navigation.navigate({ record: id, view: id ? 'form' : null });
  }
  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
    else {
      setDetail(null);
      setDetailError('');
    }
    return () => {
      detailRequestRef.current += 1;
    };
  }, [selectedId]);
  const [loadedDetail, setDetail] = useState<AuditEventDetail | null>(null);
  const detail = loadedDetail?.id === selectedId ? loadedDetail : null;
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const closeRef = useRef<{ focus(): void } | null>(null);
  const returnFocusRef = useRef<{ focus(): void } | null>(null);
  const detailRequestRef = useRef(0);

  function handleDialogOpenChange(nextOpen: boolean): void {
    if (!nextOpen) closeDetail();
  }

  function openDetail(event: AuditEvent): void {
    setSelectedId(event.id);
  }

  function loadDetail(id: string): void {
    setDetail(null);
    setDetailError('');
    setDetailLoading(true);
    const requestNumber = detailRequestRef.current + 1;
    detailRequestRef.current = requestNumber;
    void fetch(`/api/v1/agencies/${agencyId}/audit-events/${encodeURIComponent(id)}`, {
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

  return (
    <Dialog presentation="form" open={Boolean(selectedId)} onOpenChange={handleDialogOpenChange}>
      <div hidden={Boolean(selectedId)} className="space-y-5">
        <header className="grid max-w-[720px] gap-2">
          <p className="m-0 text-[11px] font-bold tracking-[0.09em] text-cobalt uppercase">
            Evidence
          </p>
          <h1 className="m-0 text-[clamp(28px,3vw,38px)] leading-[1.08] font-[680] tracking-[-0.035em] text-midnight">
            Audit Log
          </h1>
          <p className="m-0 text-sm leading-[1.65] text-muted">
            Read-only business evidence from the active Agency Context.
          </p>
        </header>

        <section
          className="overflow-hidden rounded-[5px] border border-line bg-paper"
          aria-labelledby="audit-events-heading"
        >
          <header className="flex min-h-[60px] items-center justify-between gap-4 border-b border-line px-5">
            <div className="grid gap-1">
              <h2 className="m-0 text-sm font-[670] text-midnight" id="audit-events-heading">
                Agency events
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
                No Agency audit events yet.
              </strong>
              <p className="m-0 max-w-[520px] text-[13px] leading-[1.6] text-muted">
                Persisted business transitions will appear here after a controlled action is
                recorded in this Agency.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-line">
              {events.map((event) => (
                <button
                  className="grid w-full gap-4 bg-paper px-5 py-5 text-left hover:bg-canvas min-[621px]:grid-cols-[minmax(0,1fr)_auto] min-[621px]:items-start"
                  key={event.id}
                  type="button"
                  aria-expanded={selectedId === event.id}
                  onClick={(clickEvent) => {
                    returnFocusRef.current = clickEvent.currentTarget as unknown as {
                      focus(): void;
                    };
                    openDetail(event);
                  }}
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
            className="min-h-11 justify-self-start rounded-[3px] bg-canvas px-4 text-sm font-[650] text-ink hover:bg-[#e8edf3] disabled:opacity-60"
            type="button"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? 'Loading…' : 'Load more events'}
          </button>
        ) : null}
      </div>

      {selectedId ? (
        <div className="mb-4">
          <RecordReturn href={navigation.href({ record: null, view: null })}>
            ← Audit Log
          </RecordReturn>
        </div>
      ) : null}
      <DialogContent
        aria-busy={detailLoading}
        aria-describedby="audit-event-detail-description"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          closeRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current?.focus();
        }}
      >
        <DialogHeader>
          <div className="grid min-w-0 gap-1.5">
            <p className="m-0 font-mono text-[10px] font-bold tracking-[0.1em] text-cobalt uppercase">
              Audit evidence / Read only
            </p>
            <DialogTitle>Audit Event detail</DialogTitle>
            <DialogDescription id="audit-event-detail-description">
              Inspect persisted evidence from the active Agency Context.
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <button
              className="min-h-9 min-w-9 shrink-0 rounded-[3px] bg-canvas text-xl text-muted hover:bg-[#e8edf3]"
              type="button"
              ref={closeRef}
              aria-label="Close audit event detail"
            >
              ×
            </button>
          </DialogClose>
        </DialogHeader>

        <DialogBody>
          <div className="grid gap-6">
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
        </DialogBody>

        <DialogFooter>
          <DialogClose asChild>
            <button
              className="min-h-11 rounded-[3px] bg-canvas px-4 text-sm font-[650] text-ink hover:bg-[#e8edf3]"
              type="button"
            >
              Close
            </button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
