import { Injectable } from '@nestjs/common';
import { holdsAgencyWide, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import {
  ApplicabilityServiceError,
  isoDateOf,
  MANAGE_PERMISSION,
  READ_PERMISSION,
  type ApplicabilitySummary,
} from './agency-payroll-applicabilities.records';
import type { ApplicabilityScope } from './agency-payroll-applicabilities.schemas';

const LIST_LIMIT = 200;

/** One record as the register shows it, with the names its ids point to. */
export interface ApplicabilityListItem extends ApplicabilitySummary {
  payComponentCode: string;
  payComponentName: string;
  authorityDocumentNo: string | null;
  recordedByName: string | null;
}

/** A conditional catalogue component a record can name. */
export interface ConditionalComponent {
  id: string;
  code: string;
  name: string;
  category: string;
  isGaaRevalidated: boolean;
}

export interface ApplicabilityList {
  applicabilities: ApplicabilityListItem[];
  payComponents: ConditionalComponent[];
}

/**
 * The Agency's Agency Payroll Applicability records, latest effective first,
 * and the conditional components a record can name. Reading needs, Agency-wide,
 * `payroll.compensation.read` (compensation access, hris-controls.md §6.10) or
 * `payroll.compensation.manage`, which records and ends these records.
 */
@Injectable()
export class ListAgencyPayrollApplicabilitiesService {
  async execute(context: RequestContext): Promise<ApplicabilityList> {
    if (
      !holdsAgencyWide(context, READ_PERMISSION) &&
      !holdsAgencyWide(context, MANAGE_PERMISSION)
    ) {
      throw new ApplicabilityServiceError(
        `Reading Agency Payroll Applicability needs the ${READ_PERMISSION} or ${MANAGE_PERMISSION} permission for the whole Agency.`,
        403,
        'APPLICABILITY_READ_FORBIDDEN',
      );
    }
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const rows = await transaction.agencyPayrollApplicability.findMany({
        where: { agencyId: context.agencyId },
        orderBy: [{ effectiveFrom: 'desc' }, { recordedAt: 'desc' }],
        take: LIST_LIMIT,
      });
      const [components, versions, memberships] = await Promise.all([
        transaction.payComponent.findMany({
          where: {
            OR: [{ isConditional: true }, { id: { in: rows.map((row) => row.payComponentId) } }],
          },
          orderBy: { code: 'asc' },
          select: {
            id: true,
            code: true,
            name: true,
            category: true,
            isConditional: true,
            isGaaRevalidated: true,
          },
        }),
        transaction.documentVersion.findMany({
          where: {
            agencyId: context.agencyId,
            id: { in: rows.map((row) => row.authorityDocumentVersionId) },
          },
          select: { id: true, document: { select: { documentNo: true } } },
        }),
        transaction.agencyMembership.findMany({
          where: {
            agencyId: context.agencyId,
            id: { in: rows.map((row) => row.recordedByMembershipId) },
          },
          select: { id: true, user: { select: { displayName: true } } },
        }),
      ]);
      const component = new Map(components.map((row) => [row.id, row]));
      const documentNo = new Map(versions.map((row) => [row.id, row.document.documentNo]));
      const name = new Map(memberships.map((row) => [row.id, row.user.displayName]));
      return {
        applicabilities: rows.map((row) => ({
          id: row.id,
          payComponentId: row.payComponentId,
          scope: row.scope as ApplicabilityScope,
          employeeId: row.employeeId,
          authorityDocumentVersionId: row.authorityDocumentVersionId,
          fundingReference: row.fundingReference,
          effectiveFrom: isoDateOf(row.effectiveFrom),
          effectiveTo: row.effectiveTo ? isoDateOf(row.effectiveTo) : null,
          recordedByMembershipId: row.recordedByMembershipId,
          recordedAt: row.recordedAt.toISOString(),
          payComponentCode: component.get(row.payComponentId)?.code ?? '',
          payComponentName: component.get(row.payComponentId)?.name ?? '',
          authorityDocumentNo: documentNo.get(row.authorityDocumentVersionId) ?? null,
          recordedByName: name.get(row.recordedByMembershipId) ?? null,
        })),
        payComponents: components
          .filter((row) => row.isConditional)
          .map(({ id, code, name: componentName, category, isGaaRevalidated }) => ({
            id,
            code,
            name: componentName,
            category,
            isGaaRevalidated,
          })),
      };
    });
  }
}
