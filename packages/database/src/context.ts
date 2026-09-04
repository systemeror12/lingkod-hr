import { Prisma } from '@prisma/client';
import { prisma } from './client';

export type DatabaseCapability =
  | 'platform-security'
  | 'operational-provisioning'
  | 'staffing-authority-transition'
  | 'qualification-standard-transition'
  | 'plantilla-position-transition'
  | 'plantilla-position-evidence-transition'
  | 'employee-membership-link'
  | 'pds-mutation'
  | 'employee-document-transition'
  | 'personnel-baseline-transition'
  | 'organization-unit-correction';

export interface DatabaseContext {
  agencyId?: string;
  userId?: string;
  membershipId?: string;
  sessionTokenHash?: string;
  invitationTokenHash?: string;
  providerSid?: string;
  capabilities?: readonly DatabaseCapability[];
}

function hasCapability(context: DatabaseContext, capability: DatabaseCapability): boolean {
  return context.capabilities?.includes(capability) ?? false;
}

export async function withDatabaseContext<T>(
  context: DatabaseContext,
  work: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (transaction) => {
    await setDatabaseContext(transaction, context);
    return work(transaction);
  });
}

export async function setDatabaseContext(
  transaction: Prisma.TransactionClient,
  context: DatabaseContext,
): Promise<void> {
  await transaction.$queryRaw`
    SELECT
      set_config('app.agency_id', ${context.agencyId ?? ''}, true),
      set_config('app.user_id', ${context.userId ?? ''}, true),
      set_config('app.membership_id', ${context.membershipId ?? ''}, true),
      set_config('app.session_token_hash', ${context.sessionTokenHash ?? ''}, true),
      set_config('app.invitation_token_hash', ${context.invitationTokenHash ?? ''}, true),
      set_config('app.provider_sid', ${context.providerSid ?? ''}, true),
      set_config('app.platform_security', ${hasCapability(context, 'platform-security') ? 'true' : ''}, true),
      set_config(
        'app.operational_provisioning',
        ${hasCapability(context, 'operational-provisioning') ? 'true' : ''},
        true
      ),
      set_config(
        'app.staffing_authority_transition',
        ${hasCapability(context, 'staffing-authority-transition') ? 'on' : ''},
        true
      ),
      set_config(
        'app.qualification_standard_transition',
        ${hasCapability(context, 'qualification-standard-transition') ? 'on' : ''},
        true
      ),
      set_config(
        'app.plantilla_position_transition',
        ${hasCapability(context, 'plantilla-position-transition') ? 'on' : ''},
        true
      ),
      set_config(
        'app.plantilla_position_evidence_transition',
        ${hasCapability(context, 'plantilla-position-evidence-transition') ? 'on' : ''},
        true
      ),
      set_config(
        'app.employee_membership_link',
        ${hasCapability(context, 'employee-membership-link') ? 'on' : ''},
        true
      ),
      set_config(
        'app.pds_mutation',
        ${hasCapability(context, 'pds-mutation') ? 'on' : ''},
        true
      ),
      set_config(
        'app.employee_document_transition',
        ${hasCapability(context, 'employee-document-transition') ? 'on' : ''},
        true
      ),
      set_config(
        'app.personnel_baseline_transition',
        ${hasCapability(context, 'personnel-baseline-transition') ? 'on' : ''},
        true
      ),
      set_config(
        'app.organization_unit_correction',
        ${hasCapability(context, 'organization-unit-correction') ? 'on' : ''},
        true
      )
  `;
}
