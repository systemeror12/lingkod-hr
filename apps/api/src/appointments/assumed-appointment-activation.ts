import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasPermission, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { EmployeesService, EmployeeServiceError } from '../employees/employees.service';
import {
  PlantillaPositionsService,
  PlantillaPositionServiceError,
} from '../plantilla-positions/plantilla-positions.service';
import { ApplicationsService } from '../recruitment/applications.service';
import { RecruitmentService, RecruitmentServiceError } from '../recruitment/recruitment.service';
import { SelectionService } from '../recruitment/selection.service';
import type { appointmentActivationSchema } from './appointments.schemas';
import {
  AppointmentReadModel,
  AppointmentServiceError,
  safeAppointmentAuditMetadata,
  type AppointmentDetail,
} from './appointments.service';
import type { z } from 'zod';

export interface ActivateAssumedAppointmentCommand {
  context: RequestContext;
  appointmentId: string;
  input: z.infer<typeof appointmentActivationSchema>;
  idempotencyKey?: string | undefined;
}

/**
 * Activates a valid Assumed Appointment Contract and commits every owning
 * module's resulting records in one transaction.
 */
@Injectable()
export class AssumedAppointmentActivation {
  constructor(
    @Inject(AppointmentReadModel) private readonly appointments: AppointmentReadModel,
    @Inject(EmployeesService) private readonly employees: EmployeesService,
    @Inject(PlantillaPositionsService)
    private readonly plantilla: PlantillaPositionsService,
    @Inject(ApplicationsService) private readonly applications: ApplicationsService,
    @Inject(RecruitmentService) private readonly recruitment: RecruitmentService,
    @Inject(SelectionService) private readonly selection: SelectionService,
  ) {}

  async execute(command: ActivateAssumedAppointmentCommand): Promise<AppointmentDetail> {
    const { context, appointmentId, input } = command;
    this.assertPermission(context);
    const idempotencyKey = normalizeIdempotencyKey(command.idempotencyKey);

    try {
      return await withDatabaseContext(
        requestDatabaseContext(
          context,
          'appointment-transition',
          'plantilla-position-transition',
          'recruitment-transition',
          'personnel-baseline-transition',
        ),
        async (transaction) => {
          const record = await this.appointments.lockForActivation(
            transaction,
            context,
            appointmentId,
          );
          const completed = await transaction.auditEvent.findFirst({
            where: {
              agencyId: context.agencyId,
              action: 'APPOINTMENT_SERVICE_ACTIVATED',
              entityId: appointmentId,
            },
            select: { idempotencyKey: true },
          });
          if (completed) {
            if (
              idempotencyKey &&
              completed.idempotencyKey &&
              completed.idempotencyKey !== idempotencyKey
            ) {
              throw new AppointmentServiceError(
                'The Appointment service is already activated.',
                409,
                'APPOINTMENT_SERVICE_ALREADY_ACTIVATED',
              );
            }
            return this.appointments.detailInTransaction(transaction, context, appointmentId);
          }

          if (record.workflowStatus !== 'ISSUED') {
            throw new AppointmentServiceError(
              `The Appointment cannot perform this action from ${record.workflowStatus}.`,
              409,
              'APPOINTMENT_TRANSITION_NOT_ALLOWED',
            );
          }
          const version = record.currentVersion;
          if (!version || version.status !== 'ISSUED') {
            throw new AppointmentServiceError(
              'The Appointment version could not be found.',
              404,
              'APPOINTMENT_VERSION_NOT_FOUND',
            );
          }
          const contract = await this.appointments.resolveAssumedContractInTransaction(
            transaction,
            context,
            version.id,
          );
          if (!contract) {
            throw new AppointmentServiceError(
              'Only an assumed Appointment Contract can activate service.',
              409,
              'APPOINTMENT_SERVICE_ASSUMPTION_REQUIRED',
            );
          }
          const effectiveDate = contract.assumption.currentVersion?.actualAssumptionDate;
          if (!effectiveDate) {
            throw new AppointmentServiceError(
              'The Assumed Appointment Contract is no longer valid.',
              409,
              'APPOINTMENT_SERVICE_ASSUMPTION_REQUIRED',
            );
          }
          const reservation = await this.plantilla.resolveReservedAssignmentInTransaction(
            transaction,
            context,
            record.positionId,
            effectiveDate,
          );
          if (!reservation) {
            throw new AppointmentServiceError(
              'The Plantilla Position is not reserved at the assumption date.',
              409,
              'APPOINTMENT_POSITION_NOT_RESERVED',
            );
          }
          if (reservation.salaryGrade !== version.salaryGrade) {
            throw new AppointmentServiceError(
              'The salary grade does not match the reserved Plantilla Position.',
              409,
              'APPOINTMENT_SALARY_GRADE_MISMATCH',
            );
          }

          const employeeSource = input.employeeId
            ? { employeeId: input.employeeId }
            : input.employee
              ? { employee: { ...input.employee, legalName: contract.fullName } }
              : {};
          const personnel = await this.employees.activateFromAssumptionInTransaction(
            transaction,
            context,
            {
              appointmentId,
              appointmentVersionId: version.id,
              ...employeeSource,
              organizationUnitId: reservation.organizationUnitId,
              positionId: record.positionId,
              appointmentStatus: contract.employmentStatus,
              salaryGrade: version.salaryGrade,
              salaryStep: version.salaryStep,
              effectiveFrom: effectiveDate,
            },
            idempotencyKey ? `${idempotencyKey}:personnel` : undefined,
          );
          const assignment = await this.plantilla.completeReservedAssignmentInTransaction(
            transaction,
            context,
            record.positionId,
            {
              employeeId: personnel.employeeId,
              serviceSegmentId: personnel.serviceSegmentId,
              appointmentId,
              appointmentVersionId: version.id,
              effectiveDate,
              expectedOrganizationUnitId: reservation.organizationUnitId,
              expectedSalaryGrade: reservation.salaryGrade,
              reason: `The assumed Appointment activated service effective ${effectiveDate}.`,
            },
            idempotencyKey ? `${idempotencyKey}:plantilla` : undefined,
          );
          const closureReason = `The assumed Appointment activated service effective ${effectiveDate}.`;
          const handoff = record.recruitmentHandoffId
            ? await this.selection.resolveHandoffApplicationInTransaction(
                transaction,
                context,
                record.recruitmentHandoffId,
              )
            : null;
          const applicationClosure = handoff
            ? await this.applications.closeAfterActivationInTransaction(
                transaction,
                context,
                {
                  applicationId: handoff.applicationId,
                  appointmentId,
                  serviceSegmentId: personnel.serviceSegmentId,
                  reason: closureReason,
                },
                idempotencyKey ? `${idempotencyKey}:application` : undefined,
              )
            : null;
          const publicationClosure = applicationClosure
            ? await this.recruitment.closePublicationAndRequestAfterActivationInTransaction(
                transaction,
                context,
                {
                  publicationId: applicationClosure.publicationId,
                  appointmentId,
                  serviceSegmentId: personnel.serviceSegmentId,
                  reason: closureReason,
                },
                idempotencyKey ? `${idempotencyKey}:recruitment` : undefined,
              )
            : null;

          await transaction.auditEvent.create({
            data: {
              agencyId: context.agencyId,
              actorUserId: context.userId,
              actorMembershipId: context.membershipId,
              actorType: 'USER',
              action: 'APPOINTMENT_SERVICE_ACTIVATED',
              entityType: 'Appointment',
              entityId: appointmentId,
              previousStatus: record.workflowStatus,
              newStatus: record.workflowStatus,
              reason: closureReason,
              requestId: context.requestId,
              ...(idempotencyKey ? { idempotencyKey } : {}),
              metadata: safeAppointmentAuditMetadata({
                appointmentVersionId: version.id,
                employeeId: personnel.employeeId,
                employeeNumber: personnel.employeeNumber,
                serviceSegmentId: personnel.serviceSegmentId,
                positionId: record.positionId,
                positionVersionId: assignment.versionId,
                positionIncumbencyId: assignment.positionIncumbencyId,
                actualAssumptionDate: effectiveDate,
                handoffId: record.recruitmentHandoffId,
                applicationId: applicationClosure?.applicationId ?? null,
                publicationId: publicationClosure?.publicationId ?? null,
                requestId: publicationClosure?.requestToFillId ?? null,
              }),
            },
          });
          await transaction.outboxEvent.create({
            data: {
              agencyId: context.agencyId,
              eventType: 'APPOINTMENT_SERVICE_ACTIVATED',
              aggregateType: 'Appointment',
              aggregateId: appointmentId,
              idempotencyKey: idempotencyKey ?? `appointment-service:${appointmentId}`,
              payload: {
                appointmentId,
                appointmentVersionId: version.id,
                employeeId: personnel.employeeId,
                serviceSegmentId: personnel.serviceSegmentId,
                positionId: record.positionId,
                positionIncumbencyId: assignment.positionIncumbencyId,
                actualAssumptionDate: effectiveDate,
              },
            },
          });
          return this.appointments.detailInTransaction(transaction, context, appointmentId);
        },
      );
    } catch (error: unknown) {
      if (error instanceof AppointmentServiceError) throw error;
      if (
        error instanceof EmployeeServiceError ||
        error instanceof PlantillaPositionServiceError ||
        error instanceof RecruitmentServiceError
      ) {
        throw new AppointmentServiceError(error.message, error.statusCode, error.code);
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppointmentServiceError(
          'The Appointment service is already activated.',
          409,
          'APPOINTMENT_SERVICE_ALREADY_ACTIVATED',
        );
      }
      throw error;
    }
  }

  private assertPermission(context: RequestContext): void {
    if (
      !context.agencyId ||
      !context.userId ||
      !context.membershipId ||
      !hasPermission(context, 'personnel.employees.activate', { agencyId: context.agencyId })
    ) {
      throw new AppointmentServiceError(
        'The current Agency Membership cannot perform this Appointment action.',
        403,
        'APPOINTMENT_SERVICE_ACTIVATE_FORBIDDEN',
      );
    }
  }
}

function normalizeIdempotencyKey(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
