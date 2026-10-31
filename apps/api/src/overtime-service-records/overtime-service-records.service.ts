import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasPermission, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { AttendanceLockedDaysService } from '../attendance-locked-days/attendance-locked-days.service';
import { requestDatabaseContext } from '../database-context';
import { manilaToday, resolveEmployeeScope, scopeCovers } from '../employee-scope';
import {
  OVERTIME_AUTHORITY_AUDIT_WRITER,
  type OvertimeAuthorityAuditWriter,
} from '../overtime-authorities/overtime-authorities.audit';
import { formatDate, toDatabaseDate } from '../overtime-authorities/overtime-authority.records';
import {
  OvertimeServiceRecordError,
  type OvertimeServiceCertificationInput,
  type OvertimeServiceDeclineInput,
  type OvertimeServiceRecordInput,
  type OvertimeServiceRecordSummary,
  type OvertimeServiceStatus,
} from './overtime-service-records.types';

const recordSelect = {
  id: true,
  agencyId: true,
  overtimeAuthorityEmployeeId: true,
  employeeId: true,
  workDate: true,
  claimedHours: true,
  accomplishment: true,
  actualMinutes: true,
  sourceAttendanceDayId: true,
  dayClassification: true,
  status: true,
  certifiedMinutes: true,
  declineReason: true,
  recordedByMembershipId: true,
  certifiedByMembershipId: true,
  certifiedAt: true,
  createdAt: true,
  employee: { select: { employeeNumber: true, legalName: true } },
  authorityEmployee: {
    select: {
      authorizedHours: true,
      authority: { select: { id: true, authorityNo: true } },
    },
  },
} as const;

/**
 * Record overtime service rendered under an approved Overtime Authority, submit
 * it for certification with its Actual Overtime Hours from locked Attendance,
 * and certify or decline it (hris-controls §5.17).
 */
@Injectable()
export class OvertimeServiceRecordsService {
  constructor(
    @Inject(OVERTIME_AUTHORITY_AUDIT_WRITER)
    private readonly auditWriter: OvertimeAuthorityAuditWriter,
    @Inject(AttendanceLockedDaysService)
    private readonly lockedDays: AttendanceLockedDaysService,
  ) {}

  /**
   * Create a RENDERED record. The authority must be APPROVED and cover the
   * Employee and Work Date, and the Work Date must fall from its Asia/Manila
   * approval date through today; there is no ratification path. Its row is locked
   * FOR SHARE so a concurrent cancellation waits for this record.
   */
  async record(
    context: RequestContext,
    input: OvertimeServiceRecordInput,
  ): Promise<OvertimeServiceRecordSummary> {
    try {
      return await withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
        await assertEmployeeAccess(
          transaction,
          context,
          'overtime.service.record',
          input.employeeId,
        );
        const authorities = await transaction.$queryRaw<
          Array<{ status: string; work_date_from: Date; work_date_to: Date; approved_on: Date }>
        >(
          Prisma.sql`SELECT "status", "work_date_from", "work_date_to", CAST("approved_at" AT TIME ZONE 'Asia/Manila' AS date) AS "approved_on" FROM "overtime_authorities" WHERE "agency_id" = CAST(${context.agencyId} AS uuid) AND "id" = CAST(${input.overtimeAuthorityId} AS uuid) FOR SHARE`,
        );
        const authority = authorities[0];
        if (!authority) {
          throw new OvertimeServiceRecordError(
            'The Overtime Authority could not be found.',
            404,
            'OVERTIME_AUTHORITY_NOT_FOUND',
          );
        }
        if (authority.status !== 'APPROVED') {
          throw notAuthorized(`The Overtime Authority is ${authority.status}, not APPROVED.`);
        }
        if (
          input.workDate < formatDate(authority.work_date_from) ||
          input.workDate > formatDate(authority.work_date_to)
        ) {
          throw notAuthorized('The Overtime Authority does not cover this Work Date.');
        }
        const approvedOn = formatDate(authority.approved_on);
        if (input.workDate < approvedOn) {
          throw notAuthorized(
            `The Work Date ${input.workDate} is before the Overtime Authority was approved on ${approvedOn}, and service rendered without prior authority cannot be ratified.`,
          );
        }
        const today = manilaToday();
        if (input.workDate > today) {
          throw new OvertimeServiceRecordError(
            `The Work Date ${input.workDate} is after today (${today}); record overtime service once it has been rendered.`,
            422,
            'OVERTIME_SERVICE_WORK_DATE_FUTURE',
          );
        }
        const coverage = await transaction.overtimeAuthorityEmployee.findFirst({
          where: {
            agencyId: context.agencyId,
            overtimeAuthorityId: input.overtimeAuthorityId,
            employeeId: input.employeeId,
          },
          select: { id: true },
        });
        if (!coverage) {
          throw notAuthorized('The Overtime Authority does not cover this Employee.');
        }
        const created = await transaction.overtimeServiceRecord.create({
          data: {
            agencyId: context.agencyId,
            overtimeAuthorityEmployeeId: coverage.id,
            employeeId: input.employeeId,
            workDate: toDatabaseDate(input.workDate),
            claimedHours: input.claimedHours,
            accomplishment: input.accomplishment,
            status: 'RENDERED',
            recordedByMembershipId: context.membershipId,
          },
          select: { id: true },
        });
        await this.auditWriter.write(transaction, {
          agencyId: context.agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: 'OVERTIME_SERVICE_RECORDED',
          entityType: 'OvertimeServiceRecord',
          entityId: created.id,
          previousStatus: 'None',
          newStatus: 'RENDERED',
          requestId: context.requestId,
          metadata: {
            overtimeAuthorityId: input.overtimeAuthorityId,
            employeeId: input.employeeId,
            workDate: input.workDate,
            claimedHours: input.claimedHours,
          },
        });
        return readRecord(transaction, context.agencyId, created.id);
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new OvertimeServiceRecordError(
          'The Employee already has an Overtime Service Record for this Work Date.',
          409,
          'OVERTIME_SERVICE_DATE_TAKEN',
        );
      }
      throw error;
    }
  }

  /**
   * Move a RENDERED record to FOR_CERTIFICATION, storing the outside-schedule
   * `WORKED` minutes, day classification, and source Attendance Day version
   * read through Attendance. A Work Date without locked Attendance is refused.
   */
  async submit(context: RequestContext, recordId: string): Promise<OvertimeServiceRecordSummary> {
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const current = await lockRecord(transaction, context.agencyId, recordId);
      await assertEmployeeAccess(
        transaction,
        context,
        'overtime.service.submit',
        current.employeeId,
      );
      if (current.status !== 'RENDERED') {
        throw new OvertimeServiceRecordError(
          `Only a RENDERED Overtime Service Record can be submitted; this one is ${current.status}.`,
          409,
          'OVERTIME_SERVICE_STATUS_INVALID',
        );
      }
      const [day] = await this.lockedDays.readInTransaction(
        transaction,
        context.agencyId,
        current.employeeId,
        [current.workDate],
      );
      if (!day || day.status !== 'LOCKED') {
        throw new OvertimeServiceRecordError(
          `Attendance for ${current.workDate} is not locked yet, so its Actual Overtime Hours are not known. Submit once the Attendance Period covering it is locked.`,
          409,
          'OVERTIME_SERVICE_ATTENDANCE_NOT_LOCKED',
        );
      }
      const dayClassification = day.holidayClassification ?? day.dayType;
      await transaction.overtimeServiceRecord.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: recordId } },
        data: {
          status: 'FOR_CERTIFICATION',
          actualMinutes: day.outsideScheduleWorkedMinutes,
          sourceAttendanceDayId: day.attendanceDayId,
          dayClassification,
        },
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'OVERTIME_SERVICE_SUBMITTED',
        entityType: 'OvertimeServiceRecord',
        entityId: recordId,
        previousStatus: 'RENDERED',
        newStatus: 'FOR_CERTIFICATION',
        requestId: context.requestId,
        metadata: {
          workDate: current.workDate,
          actualMinutes: day.outsideScheduleWorkedMinutes,
          sourceAttendanceDayId: day.attendanceDayId,
          attendancePeriodVersionId: day.attendancePeriodVersionId,
          dayClassification,
        },
      });
      return readRecord(transaction, context.agencyId, recordId);
    });
  }

  /**
   * Move a FOR_CERTIFICATION record to CERTIFIED. Attendance is re-read: a
   * changed source day version, official travel on the date, or a Work
   * Arrangement that does not require physically reporting is refused. The
   * covered Employee's row is locked before totalling, so certifications racing
   * under one authority cannot together pass the authorized hours.
   */
  async certify(
    context: RequestContext,
    recordId: string,
    input: OvertimeServiceCertificationInput,
  ): Promise<OvertimeServiceRecordSummary> {
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const current = await lockForDecision(
        transaction,
        context,
        'overtime.service.certify',
        recordId,
        'certified',
      );
      const [day] = await this.lockedDays.readInTransaction(
        transaction,
        context.agencyId,
        current.employeeId,
        [current.workDate],
      );
      if (
        !day ||
        day.status !== 'LOCKED' ||
        day.attendanceDayId !== current.sourceAttendanceDayId
      ) {
        const change =
          day?.status !== 'LOCKED'
            ? `changed after this record was submitted with ${current.actualMinutes} actual minutes; it is no longer locked`
            : day.outsideScheduleWorkedMinutes === current.actualMinutes
              ? `was recalculated after this record was submitted, with its Actual Overtime Hours unchanged at ${current.actualMinutes} minutes`
              : `changed after this record was submitted with ${current.actualMinutes} actual minutes; it now shows ${day.outsideScheduleWorkedMinutes} minutes`;
        throw new OvertimeServiceRecordError(
          `Attendance for ${current.workDate} ${change}. Decline this record and record the service again.`,
          409,
          'OVERTIME_SERVICE_ATTENDANCE_CHANGED',
        );
      }
      if (day.officialTravel.minutes > 0 || day.officialTravel.sourceIds.length > 0) {
        throw new OvertimeServiceRecordError(
          `The Employee was on official travel on ${current.workDate}, so the service cannot be certified.`,
          422,
          'OVERTIME_SERVICE_OFFICIAL_TRAVEL',
        );
      }
      assertPhysicalReporting(day.workArrangementVersion.arrangementType, current.workDate);
      if (input.certifiedMinutes > (current.actualMinutes ?? 0)) {
        throw new OvertimeServiceRecordError(
          `Certified time of ${input.certifiedMinutes} minutes exceeds the ${current.actualMinutes} actual minutes.`,
          422,
          'OVERTIME_SERVICE_CERTIFIED_EXCEEDS_ACTUAL',
        );
      }
      const [coverage] = await transaction.$queryRaw<Array<{ authorized_hours: Prisma.Decimal }>>(
        Prisma.sql`SELECT "authorized_hours" FROM "overtime_authority_employees" WHERE "agency_id" = CAST(${context.agencyId} AS uuid) AND "id" = CAST(${current.overtimeAuthorityEmployeeId} AS uuid) FOR UPDATE`,
      );
      if (!coverage) throw recordNotFound();
      const certified = await transaction.overtimeServiceRecord.aggregate({
        where: {
          agencyId: context.agencyId,
          overtimeAuthorityEmployeeId: current.overtimeAuthorityEmployeeId,
          status: 'CERTIFIED',
        },
        _sum: { certifiedMinutes: true },
      });
      const alreadyCertified = certified._sum.certifiedMinutes ?? 0;
      const authorizedMinutes = coverage.authorized_hours.times(60);
      if (authorizedMinutes.lessThan(alreadyCertified + input.certifiedMinutes)) {
        throw new OvertimeServiceRecordError(
          `Certifying ${input.certifiedMinutes} minutes on top of the ${alreadyCertified} already certified exceeds the Employee's ${authorizedMinutes.toString()} authorized minutes under this Overtime Authority.`,
          422,
          'OVERTIME_SERVICE_CERTIFIED_EXCEEDS_AUTHORIZED',
        );
      }
      await transaction.overtimeServiceRecord.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: recordId } },
        data: {
          status: 'CERTIFIED',
          certifiedMinutes: input.certifiedMinutes,
          certifiedByMembershipId: context.membershipId,
          certifiedAt: new Date(),
        },
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'OVERTIME_SERVICE_CERTIFIED',
        entityType: 'OvertimeServiceRecord',
        entityId: recordId,
        previousStatus: 'FOR_CERTIFICATION',
        newStatus: 'CERTIFIED',
        requestId: context.requestId,
        metadata: {
          workDate: current.workDate,
          certifiedMinutes: input.certifiedMinutes,
          actualMinutes: current.actualMinutes,
          sourceAttendanceDayId: day.attendanceDayId,
          attendancePeriodVersionId: day.attendancePeriodVersionId,
        },
      });
      return readRecord(transaction, context.agencyId, recordId);
    });
  }

  /**
   * Move a FOR_CERTIFICATION record to NOT_CERTIFIED, which excludes it from
   * compensation and frees its Work Date for a new record. No Attendance recheck:
   * declining is how a record whose Attendance changed leaves the queue. The
   * decliner is the actor of the Audit Event.
   */
  async decline(
    context: RequestContext,
    recordId: string,
    input: OvertimeServiceDeclineInput,
  ): Promise<OvertimeServiceRecordSummary> {
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const current = await lockForDecision(
        transaction,
        context,
        'overtime.service.reject',
        recordId,
        'declined',
      );
      await transaction.overtimeServiceRecord.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: recordId } },
        data: { status: 'NOT_CERTIFIED', declineReason: input.declineReason },
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'OVERTIME_SERVICE_DECLINED',
        entityType: 'OvertimeServiceRecord',
        entityId: recordId,
        previousStatus: 'FOR_CERTIFICATION',
        newStatus: 'NOT_CERTIFIED',
        requestId: context.requestId,
        metadata: { workDate: current.workDate, declineReason: input.declineReason },
      });
      return readRecord(transaction, context.agencyId, recordId);
    });
  }
}

async function lockRecord(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  recordId: string,
): Promise<OvertimeServiceRecordSummary> {
  const locked = await transaction.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "overtime_service_records" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${recordId} AS uuid) FOR UPDATE`,
  );
  if (locked.length !== 1) throw recordNotFound();
  return readRecord(transaction, agencyId, recordId);
}

/**
 * Lock a record for certifying or declining: the permission must reach its
 * Employee, whatever the grant the actor is not that Employee, and it must await
 * certification.
 */
async function lockForDecision(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  permission: string,
  recordId: string,
  verb: 'certified' | 'declined',
): Promise<OvertimeServiceRecordSummary> {
  const current = await lockRecord(transaction, context.agencyId, recordId);
  await assertEmployeeAccess(transaction, context, permission, current.employeeId);
  const membership = await transaction.agencyMembership.findFirst({
    where: { agencyId: context.agencyId, id: context.membershipId },
    select: { employeeId: true },
  });
  if (membership?.employeeId === current.employeeId) {
    throw new OvertimeServiceRecordError(
      'An Employee cannot certify or decline their own overtime service.',
      403,
      'OVERTIME_SERVICE_SELF_CERTIFICATION',
    );
  }
  if (current.status !== 'FOR_CERTIFICATION') {
    throw new OvertimeServiceRecordError(
      `Only a FOR_CERTIFICATION Overtime Service Record can be ${verb}; this one is ${current.status}.`,
      409,
      'OVERTIME_SERVICE_STATUS_INVALID',
    );
  }
  return current;
}

/**
 * COC and Overtime Pay need that the Employee physically reported for work (CSC
 * MC No. 6, s. 2022). `ONSITE` and `FIELD` duty requires it; `WORK_FROM_HOME` does
 * not. `HYBRID` is refused because Attendance cannot show that the Employee
 * physically reported for work on that date. Allowing `FIELD` and refusing
 * `HYBRID` is a Project Decision (#535), because no source names either type.
 * Work Arrangement Versions have no type for another fixed place, which earns
 * neither, or a satellite office, for which no authority was found. Both are
 * `OTHER`, refused under one code because the type cannot separate them.
 */
function assertPhysicalReporting(arrangementType: string, workDate: string): void {
  if (arrangementType === 'ONSITE' || arrangementType === 'FIELD') return;
  if (arrangementType === 'OTHER') {
    throw new OvertimeServiceRecordError(
      `The Work Arrangement on ${workDate} is OTHER, which does not show that the Employee physically reported for work. Work from another fixed place earns neither COC nor Overtime Pay, and no authority was found for crediting overtime from a satellite office.`,
      422,
      'OVERTIME_SERVICE_ARRANGEMENT_NO_AUTHORITY',
    );
  }
  if (arrangementType === 'HYBRID') {
    throw new OvertimeServiceRecordError(
      `The Work Arrangement on ${workDate} is HYBRID, so Attendance cannot show that the Employee physically reported for work on that date, and the service cannot be certified.`,
      422,
      'OVERTIME_SERVICE_ARRANGEMENT_NOT_PHYSICAL',
    );
  }
  throw new OvertimeServiceRecordError(
    `The Work Arrangement on ${workDate} is ${arrangementType}, which does not require physically reporting for work, so the service cannot be certified.`,
    422,
    'OVERTIME_SERVICE_ARRANGEMENT_NOT_PHYSICAL',
  );
}

async function readRecord(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  recordId: string,
): Promise<OvertimeServiceRecordSummary> {
  const record = await transaction.overtimeServiceRecord.findFirst({
    where: { agencyId, id: recordId },
    select: recordSelect,
  });
  if (!record) throw recordNotFound();
  return {
    id: record.id,
    agencyId: record.agencyId,
    overtimeAuthorityId: record.authorityEmployee.authority.id,
    overtimeAuthorityEmployeeId: record.overtimeAuthorityEmployeeId,
    authorityNo: record.authorityEmployee.authority.authorityNo,
    employeeId: record.employeeId,
    employeeNumber: record.employee.employeeNumber,
    employeeName: record.employee.legalName,
    workDate: formatDate(record.workDate),
    claimedHours: record.claimedHours.toFixed(4),
    authorizedHours: record.authorityEmployee.authorizedHours.toFixed(4),
    accomplishment: record.accomplishment,
    actualMinutes: record.actualMinutes,
    sourceAttendanceDayId: record.sourceAttendanceDayId,
    dayClassification: record.dayClassification,
    certifiedMinutes: record.certifiedMinutes,
    declineReason: record.declineReason,
    status: record.status as OvertimeServiceStatus,
    recordedByMembershipId: record.recordedByMembershipId,
    certifiedByMembershipId: record.certifiedByMembershipId,
    certifiedAt: record.certifiedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
  };
}

/**
 * Require the permission and that its grant reaches the Employee: an Agency
 * grant reaches everyone, a Supervisor's DIRECT_REPORTS grant their direct
 * reports (ADR 0007), and an Employee's OWN grant only themselves.
 */
async function assertEmployeeAccess(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  permission: string,
  employeeId: string,
): Promise<void> {
  if (!context.agencyId || !context.userId || !context.membershipId) throw forbidden();
  if (hasPermission(context, permission, { agencyId: context.agencyId })) return;
  const scope = await resolveEmployeeScope(context, permission, transaction);
  if (!scope) throw forbidden();
  if (!scopeCovers(scope, employeeId)) {
    throw new OvertimeServiceRecordError(
      'The Employee is outside the scope of the current Agency Membership.',
      403,
      'OVERTIME_SERVICE_SCOPE_FORBIDDEN',
    );
  }
}

function notAuthorized(reason: string): OvertimeServiceRecordError {
  return new OvertimeServiceRecordError(
    `Overtime service can be recorded only under an APPROVED Overtime Authority covering the Employee and Work Date. ${reason}`,
    422,
    'OVERTIME_SERVICE_NOT_AUTHORIZED',
  );
}

function recordNotFound(): OvertimeServiceRecordError {
  return new OvertimeServiceRecordError(
    'The Overtime Service Record could not be found.',
    404,
    'OVERTIME_SERVICE_RECORD_NOT_FOUND',
  );
}

function forbidden(): OvertimeServiceRecordError {
  return new OvertimeServiceRecordError(
    'The current Agency Membership lacks the required permission.',
    403,
    'OVERTIME_SERVICE_FORBIDDEN',
  );
}
