import { Injectable } from '@nestjs/common';
import { holdsAgencyWide, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import {
  AuthorizedInputServiceError,
  summarySelect,
  toAuthorizedInputSummary,
  type AuthorizedInputSummary,
} from './authorized-payroll-component-inputs.records';

export const READ_PERMISSION = 'payroll.inputs.read';

const LIST_LIMIT = 200;

/** One input as the register shows it, with the names its ids point to. */
export interface AuthorizedInputListItem extends AuthorizedInputSummary {
  payComponentCode: string;
  payComponentName: string;
  authorityDocumentNo: string | null;
  recordedByName: string | null;
  approvedByName: string | null;
}

/** A national catalogue component an Agency may record an input for. */
export interface AuthorizableComponent {
  id: string;
  code: string;
  name: string;
  category: string;
}

export interface AuthorizedInputList {
  inputs: AuthorizedInputListItem[];
  payComponents: AuthorizableComponent[];
}

/**
 * The Agency's Authorized Payroll Component Inputs, latest effective first, and
 * the catalogue components that accept one, so an approver can find a recorded
 * input and a recorder can choose its component.
 */
@Injectable()
export class ListAuthorizedPayrollComponentInputsService {
  async execute(context: RequestContext): Promise<AuthorizedInputList> {
    if (!holdsAgencyWide(context, READ_PERMISSION)) {
      throw new AuthorizedInputServiceError(
        `Reading Authorized Payroll Component Inputs needs the ${READ_PERMISSION} permission for the whole Agency.`,
        403,
        'AUTHORIZED_INPUT_READ_FORBIDDEN',
      );
    }
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const rows = await transaction.authorizedPayrollComponentInput.findMany({
        where: { agencyId: context.agencyId },
        orderBy: [{ effectiveFrom: 'desc' }, { id: 'desc' }],
        take: LIST_LIMIT,
        select: summarySelect,
      });
      const inputs = rows.map(toAuthorizedInputSummary);
      const [components, versions, memberships] = await Promise.all([
        transaction.payComponent.findMany({
          where: {
            OR: [
              { acceptsAuthorizedInput: true },
              { id: { in: inputs.map((input) => input.payComponentId) } },
            ],
          },
          orderBy: { code: 'asc' },
          select: {
            id: true,
            code: true,
            name: true,
            category: true,
            acceptsAuthorizedInput: true,
          },
        }),
        transaction.documentVersion.findMany({
          where: {
            agencyId: context.agencyId,
            id: { in: inputs.map((input) => input.authorityDocumentVersionId) },
          },
          select: { id: true, document: { select: { documentNo: true } } },
        }),
        transaction.agencyMembership.findMany({
          where: {
            agencyId: context.agencyId,
            id: {
              in: inputs.flatMap((input) =>
                input.approvedByMembershipId
                  ? [input.recordedByMembershipId, input.approvedByMembershipId]
                  : [input.recordedByMembershipId],
              ),
            },
          },
          select: { id: true, user: { select: { displayName: true } } },
        }),
      ]);
      const component = new Map(components.map((row) => [row.id, row]));
      const documentNo = new Map(versions.map((row) => [row.id, row.document.documentNo]));
      const name = new Map(memberships.map((row) => [row.id, row.user.displayName]));
      return {
        inputs: inputs.map((input) => ({
          ...input,
          payComponentCode: component.get(input.payComponentId)?.code ?? '',
          payComponentName: component.get(input.payComponentId)?.name ?? '',
          authorityDocumentNo: documentNo.get(input.authorityDocumentVersionId) ?? null,
          recordedByName: name.get(input.recordedByMembershipId) ?? null,
          approvedByName: input.approvedByMembershipId
            ? (name.get(input.approvedByMembershipId) ?? null)
            : null,
        })),
        payComponents: components
          .filter((row) => row.acceptsAuthorizedInput)
          .map(({ id, code, name: componentName, category }) => ({
            id,
            code,
            name: componentName,
            category,
          })),
      };
    });
  }
}
