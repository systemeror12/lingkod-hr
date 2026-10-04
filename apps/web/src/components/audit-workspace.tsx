'use client';

import { RecordReturn, useRecordNavigation } from './record-navigation';

import { useEffect, useRef, useState, type ReactNode } from 'react';
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
import { Button } from './ui/button';
import { FormError } from './ui/field';
import { PageHeader } from './ui/page-header';
import { Panel } from './ui/panel';
import { StatusTag } from './ui/status-tag';
import { RowHeader, Table, Td, Th, Tr } from './ui/table';
import { StateSurface } from './state-surface';

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
      <h3 className="m-0 text-panel-title text-ink" id={`${label.toLowerCase()}-data-title`}>
        {label}
      </h3>
      {value === null ? (
        <p className="m-0 rounded-control border border-border bg-canvas px-3 py-3 text-small text-ink-muted">
          None recorded
        </p>
      ) : (
        <pre className="m-0 max-h-64 overflow-auto rounded-control border border-border bg-canvas p-3 font-mono text-caption leading-[1.6] whitespace-pre-wrap text-ink">
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
      <div className="grid gap-5">
        <PageHeader breadcrumbs={[{ label: 'Oversight' }]} title="Audit Log" />

        <div hidden={Boolean(selectedId)} className="grid min-w-0 gap-5">
          <p className="m-0 max-w-[760px] text-small text-ink-muted">
            Read-only business evidence from the active Agency Context.
          </p>

          <Panel
            title="Agency events"
            flush
            actions={
              <>
                <span className="text-caption text-ink-muted">
                  {events.length === 1 ? '1 event' : `${events.length} events`}
                  {hasMore ? ' · more available' : ''}
                </span>
                <StatusTag tone="info">Agency scoped · Read only</StatusTag>
              </>
            }
          >
            {events.length === 0 ? (
              <StateSurface compact label="Agency events">
                <strong className="text-body font-[650] text-ink">
                  No Agency audit events yet.
                </strong>
                <p className="m-0 max-w-[560px]">
                  Persisted business transitions will appear here after a controlled action is
                  recorded in this Agency.
                </p>
              </StateSurface>
            ) : (
              <Table aria-label="Agency audit events" className="min-w-[860px]">
                <thead>
                  <tr>
                    <Th>Action</Th>
                    <Th>Status transition</Th>
                    <Th>Actor</Th>
                    <Th>Entity</Th>
                    <Th kind="date">Occurred</Th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <Tr key={event.id}>
                      <RowHeader>
                        <button
                          className="w-fit cursor-pointer border-0 bg-transparent p-0 text-left font-mono text-caption font-[600] text-primary hover:underline"
                          type="button"
                          aria-expanded={selectedId === event.id}
                          onClick={(clickEvent) => {
                            returnFocusRef.current = clickEvent.currentTarget as unknown as {
                              focus(): void;
                            };
                            openDetail(event);
                          }}
                        >
                          {event.action}
                        </button>
                      </RowHeader>
                      <Td>
                        <StatusTag tone="neutral">
                          {statusLabel(event.previousStatus)} → {statusLabel(event.newStatus)}
                        </StatusTag>
                      </Td>
                      <Td>{event.actor}</Td>
                      <Td>
                        {event.entityType}
                        <span className="block font-mono text-caption break-all text-ink-muted">
                          {event.entityId}
                        </span>
                      </Td>
                      <Td kind="date">
                        <time dateTime={event.occurredAt}>{dateLabel(event.occurredAt)}</time>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
            {listError || hasMore ? (
              <div className="grid justify-items-start gap-3 border-t border-border p-4">
                <FormError message={listError} className="self-stretch" />
                {hasMore ? (
                  <Button
                    disabled={loadingMore}
                    onClick={() => void loadMore()}
                    type="button"
                    variant="secondary"
                  >
                    {loadingMore ? 'Loading…' : 'Load more events'}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </Panel>
        </div>

        {selectedId ? (
          <div>
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
              <DialogTitle>Audit Event detail</DialogTitle>
              <DialogDescription id="audit-event-detail-description">
                Inspect persisted evidence from the active Agency Context.
              </DialogDescription>
            </div>
            <DialogClose asChild>
              <Button
                aria-label="Close audit event detail"
                className="shrink-0 px-3 text-lg"
                ref={closeRef}
                type="button"
              >
                ×
              </Button>
            </DialogClose>
          </DialogHeader>

          <DialogBody>
            <div className="grid gap-6">
              {detailLoading ? (
                <StateSurface compact busy label="Audit Event">
                  <p className="m-0" role="status">
                    Loading Audit Event…
                  </p>
                </StateSurface>
              ) : null}
              <FormError message={detailError} />
              {detail ? (
                <div className="grid gap-6">
                  <dl className="m-0 grid gap-x-10 gap-y-4 min-[621px]:grid-cols-2 min-[900px]:grid-cols-3">
                    {(
                      [
                        [
                          'Action',
                          <span key="action" className="font-mono text-small">
                            {detail.action}
                          </span>,
                        ],
                        [
                          'Status transition',
                          `${statusLabel(detail.previousStatus)} → ${statusLabel(detail.newStatus)}`,
                        ],
                        [
                          'Occurred in Philippine time',
                          <time key="occurred" dateTime={detail.occurredAt}>
                            {dateLabel(detail.occurredAt)}
                          </time>,
                        ],
                        ['Actor', detail.actor],
                        [
                          'Entity',
                          <span key="entity" className="font-mono text-small break-all">
                            {detail.entityType} · {detail.entityId}
                          </span>,
                        ],
                        [
                          'Request ID',
                          <span key="request" className="font-mono text-small break-all">
                            {detail.requestId ?? 'Not recorded'}
                          </span>,
                        ],
                      ] satisfies [string, ReactNode][]
                    ).map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-caption text-ink-muted">{label}</dt>
                        <dd className="m-0 text-body font-[600] text-ink">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <DataBlock label="Before" value={detail.before} />
                  <DataBlock label="After" value={detail.after} />
                </div>
              ) : null}
            </div>
          </DialogBody>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Close
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </div>
    </Dialog>
  );
}
