import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasPermission, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';

export interface EmployeeInput {
  employeeNumber: string;
  legalName: string;
  birthDate: string;
  sex: string;
  civilStatus: string;
  contactEmail: string;
}

export interface EmployeeMembershipSummary {
  id: string;
  displayName: string;
  email: string | null;
}

export interface EmployeeSummary {
  id: string;
  employeeNumber: string;
  legalName: string;
  birthDate: string;
  sex: string;
  civilStatus: string;
  contactEmail: string;
  serviceStatus: string;
  firstGovernmentServiceDate: string | null;
  agencyServiceStartDate: string | null;
  currentServiceSegment: EmployeeServiceProjection | null;
  membershipId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeServiceProjection {
  id: string;
  positionId: string | null;
  organizationUnitId: string;
  appointmentStatus: string;
  salaryGrade: number | null;
  salaryStep: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface EmployeeDetail extends EmployeeSummary {
  rowVersion: number;
  linkableMemberships: EmployeeMembershipSummary[];
}

export interface EmployeeAuditWriter {
  write(
    transaction: Prisma.TransactionClient,
    event: Prisma.AuditEventUncheckedCreateInput,
  ): Promise<void>;
}

export const EMPLOYEE_AUDIT_WRITER = Symbol('EMPLOYEE_AUDIT_WRITER');

export const employeeAuditWriter: EmployeeAuditWriter = {
  async write(transaction, event): Promise<void> {
    await transaction.auditEvent.create({ data: event });
  },
};

export class EmployeeServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'EmployeeServiceError';
  }
}

const EMPLOYEE_LIST_LIMIT = 200;

const employeeSelect = {
  id: true,
  agencyId: true,
  employeeNumber: true,
  legalName: true,
  birthDate: true,
  sex: true,
  civilStatus: true,
  contactEmail: true,
  serviceStatus: true,
  firstGovernmentServiceDate: true,
  agencyServiceStartDate: true,
  currentServiceSegment: {
    select: {
      id: true,
      positionId: true,
      organizationUnitId: true,
      appointmentStatus: true,
      salaryGrade: true,
      salaryStep: true,
      effectiveFrom: true,
      effectiveTo: true,
    },
  },
  rowVersion: true,
  createdAt: true,
  updatedAt: true,
  memberships: { select: { id: true } },
} as const;

const linkableMembershipSelect = {
  id: true,
  user: { select: { displayName: true, emailNormalized: true } },
} as const;

type EmployeeRecord = Prisma.EmployeeGetPayload<{ select: typeof employeeSelect }>;
type LinkableMembershipRecord = Prisma.AgencyMembershipGetPayload<{
  select: typeof linkableMembershipSelect;
}>;

function databaseContext(context: RequestContext, membershipLink = false) {
  return {
    agencyId: context.agencyId,
    userId: context.userId,
    membershipId: context.membershipId,
    ...(membershipLink ? { employeeMembershipLink: true } : {}),
  };
}

function dateInvalid(): EmployeeServiceError {
  return new EmployeeServiceError(
    'The Employee birth date is invalid.',
    400,
    'EMPLOYEE_BIRTH_DATE_INVALID',
  );
}

function toDatabaseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw dateInvalid();
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw dateInvalid();
  }
  return date;
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function formatDateTime(value: Date): string {
  return value.toISOString();
}

function employeeSummary(record: EmployeeRecord): EmployeeSummary {
  return {
    id: record.id,
    employeeNumber: record.employeeNumber,
    legalName: record.legalName,
    birthDate: formatDate(record.birthDate),
    sex: record.sex,
    civilStatus: record.civilStatus,
    contactEmail: record.contactEmail,
    serviceStatus: record.serviceStatus,
    firstGovernmentServiceDate: record.firstGovernmentServiceDate
      ? formatDate(record.firstGovernmentServiceDate)
      : null,
    agencyServiceStartDate: record.agencyServiceStartDate
      ? formatDate(record.agencyServiceStartDate)
      : null,
    currentServiceSegment: record.currentServiceSegment
      ? {
          id: record.currentServiceSegment.id,
          positionId: record.currentServiceSegment.positionId,
          organizationUnitId: record.currentServiceSegment.organizationUnitId,
          appointmentStatus: record.currentServiceSegment.appointmentStatus,
          salaryGrade: record.currentServiceSegment.salaryGrade,
          salaryStep: record.currentServiceSegment.salaryStep,
          effectiveFrom: formatDate(record.currentServiceSegment.effectiveFrom),
          effectiveTo: record.currentServiceSegment.effectiveTo
            ? formatDate(record.currentServiceSegment.effectiveTo)
            : null,
        }
      : null,
    membershipId: record.memberships[0]?.id ?? null,
    createdAt: formatDateTime(record.createdAt),
    updatedAt: formatDateTime(record.updatedAt),
  };
}

function membershipSummary(record: LinkableMembershipRecord): EmployeeMembershipSummary {
  return {
    id: record.id,
    displayName: record.user.displayName,
    email: record.user.emailNormalized,
  };
}

@Injectable()
export class EmployeesService {
  constructor(
    @Inject(EMPLOYEE_AUDIT_WRITER)
    private readonly auditWriter: EmployeeAuditWriter,
  ) {}

  async list(context: RequestContext): Promise<EmployeeSummary[]> {
    this.assertPermission(context, 'personnel.employees.read', 'EMPLOYEE_READ_FORBIDDEN');
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const records = await transaction.employee.findMany({
        where: { agencyId: context.agencyId },
        orderBy: { createdAt: 'desc' },
        take: EMPLOYEE_LIST_LIMIT,
        select: employeeSelect,
      });
      return records.map(employeeSummary);
    });
  }

  async findById(context: RequestContext, employeeId: string): Promise<EmployeeDetail | null> {
    this.assertPermission(context, 'personnel.employees.read', 'EMPLOYEE_READ_FORBIDDEN');
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const record = await transaction.employee.findUnique({
        where: { agencyId_id: { agencyId: context.agencyId, id: employeeId } },
        select: employeeSelect,
      });
      if (!record) return null;
      return this.employeeDetail(transaction, context.agencyId, record);
    });
  }

  async create(context: RequestContext, input: EmployeeInput): Promise<EmployeeSummary> {
    this.assertPermission(context, 'personnel.employees.create', 'EMPLOYEE_CREATE_FORBIDDEN');
    const employeeNumber = input.employeeNumber.trim();
    const legalName = input.legalName.trim();
    const contactEmail = input.contactEmail.trim();
    const birthDate = toDatabaseDate(input.birthDate);
    try {
      return await withDatabaseContext(databaseContext(context), async (transaction) => {
        const numberTaken = await transaction.employee.findFirst({
          where: { agencyId: context.agencyId, employeeNumber },
          select: { id: true },
        });
        if (numberTaken) throw this.numberConflict();
        const personTaken = await transaction.employee.findFirst({
          where: { agencyId: context.agencyId, legalName, birthDate },
          select: { id: true },
        });
        if (personTaken) throw this.personConflict();
        const created = await transaction.employee.create({
          data: {
            agencyId: context.agencyId,
            employeeNumber,
            legalName,
            birthDate,
            sex: input.sex,
            civilStatus: input.civilStatus,
            contactEmail,
            createdByMembershipId: context.membershipId,
            updatedByMembershipId: context.membershipId,
          },
          select: employeeSelect,
        });
        await this.auditWriter.write(transaction, {
          agencyId: context.agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: 'EMPLOYEE_CREATED',
          entityType: 'Employee',
          entityId: created.id,
          previousStatus: 'None',
          newStatus: 'PREBOARDING',
          requestId: context.requestId,
          occurredAt: new Date(),
          metadata: { employeeNumber, legalName, serviceStatus: 'PREBOARDING' },
        });
        return employeeSummary(created);
      });
    } catch (error: unknown) {
      if (error instanceof EmployeeServiceError) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw this.concurrentConflict();
      }
      throw error;
    }
  }

  async linkMembership(
    context: RequestContext,
    employeeId: string,
    membershipId: string,
  ): Promise<EmployeeDetail> {
    this.assertPermission(context, 'personnel.employees.update', 'EMPLOYEE_UPDATE_FORBIDDEN');
    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      await this.lockEmployee(transaction, context.agencyId, employeeId);
      const record = await this.employeeRecord(transaction, context.agencyId, employeeId);
      if (!record) throw this.notFound();
      if (record.memberships[0]?.id) throw this.membershipConflict();
      await this.lockMembership(transaction, context.agencyId, membershipId);
      const membership = await transaction.agencyMembership.findUnique({
        where: { agencyId_id: { agencyId: context.agencyId, id: membershipId } },
        select: { id: true, status: true, employeeId: true },
      });
      if (!membership || membership.status !== 'ACTIVE') throw this.membershipInvalid();
      if (membership.employeeId) throw this.membershipConflict();
      await transaction.agencyMembership.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: membershipId } },
        data: { employeeId },
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'EMPLOYEE_MEMBERSHIP_LINKED',
        entityType: 'Employee',
        entityId: employeeId,
        previousStatus: 'UNLINKED',
        newStatus: 'LINKED',
        requestId: context.requestId,
        occurredAt: new Date(),
        metadata: { membershipId },
      });
      const linked = await this.employeeRecord(transaction, context.agencyId, employeeId);
      if (!linked) throw this.notFound();
      return this.employeeDetail(transaction, context.agencyId, linked);
    });
  }

  async unlinkMembership(context: RequestContext, employeeId: string): Promise<EmployeeDetail> {
    this.assertPermission(context, 'personnel.employees.update', 'EMPLOYEE_UPDATE_FORBIDDEN');
    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      await this.lockEmployee(transaction, context.agencyId, employeeId);
      const record = await this.employeeRecord(transaction, context.agencyId, employeeId);
      if (!record) throw this.notFound();
      const membershipId = record.memberships[0]?.id;
      if (!membershipId) throw this.membershipNotLinked();
      await transaction.agencyMembership.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: membershipId } },
        data: { employeeId: null },
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'EMPLOYEE_MEMBERSHIP_UNLINKED',
        entityType: 'Employee',
        entityId: employeeId,
        previousStatus: 'LINKED',
        newStatus: 'UNLINKED',
        requestId: context.requestId,
        occurredAt: new Date(),
        metadata: { membershipId },
      });
      const unlinked = await this.employeeRecord(transaction, context.agencyId, employeeId);
      if (!unlinked) throw this.notFound();
      return this.employeeDetail(transaction, context.agencyId, unlinked);
    });
  }

  private async employeeRecord(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
  ): Promise<EmployeeRecord | null> {
    return transaction.employee.findUnique({
      where: { agencyId_id: { agencyId, id: employeeId } },
      select: employeeSelect,
    });
  }

  private async employeeDetail(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    record: EmployeeRecord,
  ): Promise<EmployeeDetail> {
    const linkable = await transaction.agencyMembership.findMany({
      where: { agencyId, status: 'ACTIVE', employeeId: null },
      orderBy: { createdAt: 'asc' },
      take: EMPLOYEE_LIST_LIMIT,
      select: linkableMembershipSelect,
    });
    return {
      ...employeeSummary(record),
      rowVersion: record.rowVersion,
      linkableMemberships: linkable.map(membershipSummary),
    };
  }

  private async lockEmployee(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
  ): Promise<void> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "employees" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${employeeId} AS uuid) FOR UPDATE`,
    );
    if (rows.length !== 1) throw this.notFound();
  }

  private async lockMembership(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    membershipId: string,
  ): Promise<void> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "agency_memberships" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${membershipId} AS uuid) FOR UPDATE`,
    );
    if (rows.length !== 1) throw this.membershipInvalid();
  }

  private assertPermission(context: RequestContext, permission: string, code: string): void {
    if (
      !context.agencyId ||
      !context.userId ||
      !context.membershipId ||
      !hasPermission(context, permission, { agencyId: context.agencyId })
    ) {
      throw new EmployeeServiceError(
        'The current Agency Membership lacks the required permission.',
        403,
        code,
      );
    }
  }

  private numberConflict(): EmployeeServiceError {
    return new EmployeeServiceError(
      'That Employee Number is already used in this Agency.',
      409,
      'EMPLOYEE_NUMBER_CONFLICT',
    );
  }

  private personConflict(): EmployeeServiceError {
    return new EmployeeServiceError(
      'This person already has an Employee record in this Agency.',
      409,
      'EMPLOYEE_IDENTITY_CONFLICT',
    );
  }

  private concurrentConflict(): EmployeeServiceError {
    return new EmployeeServiceError(
      'This Employee conflicts with an existing record in this Agency.',
      409,
      'EMPLOYEE_CONFLICT',
    );
  }

  private notFound(): EmployeeServiceError {
    return new EmployeeServiceError('The Employee could not be found.', 404, 'EMPLOYEE_NOT_FOUND');
  }

  private membershipInvalid(): EmployeeServiceError {
    return new EmployeeServiceError(
      'Select an active Agency Membership in this Agency.',
      409,
      'EMPLOYEE_MEMBERSHIP_INVALID',
    );
  }

  private membershipConflict(): EmployeeServiceError {
    return new EmployeeServiceError(
      'The Employee and Agency Membership are already linked to other records.',
      409,
      'EMPLOYEE_MEMBERSHIP_CONFLICT',
    );
  }

  private membershipNotLinked(): EmployeeServiceError {
    return new EmployeeServiceError(
      'This Employee has no Agency Membership link to remove.',
      409,
      'EMPLOYEE_MEMBERSHIP_NOT_LINKED',
    );
  }
}
