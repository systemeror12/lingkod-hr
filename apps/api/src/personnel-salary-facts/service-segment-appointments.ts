import type { Prisma } from '@prisma/client';

/**
 * The nature of the appointment that issued one primary Service Segment, such
 * as `ORIGINAL` or `TRANSFER`, or null when no appointment is on record for
 * it, as for a migrated baseline.
 */
export interface ServiceSegmentAppointment {
  employeeId: string;
  serviceSegmentId: string;
  natureOfAppointment: string | null;
}

/**
 * Personnel's read, for Payroll, of the appointment nature behind each
 * primary, non-voided Service Segment of the Agency that covers any date from
 * `from` through `to` (inclusive ISO dates), inside the caller's Agency
 * transaction. A segment a step increment or other action succeeds keeps its
 * appointment, so the nature is the one the Employee entered under. The
 * appointment's current version gives it.
 */
export async function readServiceSegmentAppointmentsInTransaction(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  from: string,
  to: string,
): Promise<ServiceSegmentAppointment[]> {
  const segments = await transaction.serviceSegment.findMany({
    where: {
      agencyId,
      segmentType: 'PRIMARY',
      status: { in: ['ACTIVE', 'CLOSED'] },
      effectiveFrom: { lte: new Date(`${to}T00:00:00.000Z`) },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date(`${from}T00:00:00.000Z`) } }],
    },
    orderBy: [{ employeeId: 'asc' }, { effectiveFrom: 'asc' }],
    select: { id: true, employeeId: true, appointmentId: true },
  });
  const appointmentIds = [...new Set(segments.flatMap((segment) => segment.appointmentId ?? []))];
  const natures = new Map(
    (appointmentIds.length > 0
      ? await transaction.appointment.findMany({
          where: { agencyId, id: { in: appointmentIds } },
          select: { id: true, currentVersion: { select: { natureOfAppointment: true } } },
        })
      : []
    ).map((appointment) => [appointment.id, appointment.currentVersion?.natureOfAppointment]),
  );
  return segments.map((segment) => ({
    employeeId: segment.employeeId,
    serviceSegmentId: segment.id,
    natureOfAppointment: (segment.appointmentId && natures.get(segment.appointmentId)) ?? null,
  }));
}
