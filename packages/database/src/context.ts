import { Prisma } from '@prisma/client';
import { prisma } from './client';

export interface DatabaseContext {
  agencyId?: string;
  userId?: string;
  membershipId?: string;
  sessionTokenHash?: string;
  invitationTokenHash?: string;
  providerSid?: string;
  platformSecurity?: boolean;
  operationalProvisioning?: boolean;
  staffingAuthorityTransition?: boolean;
  qualificationStandardTransition?: boolean;
  plantillaPositionTransition?: boolean;
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
      set_config('app.platform_security', ${context.platformSecurity ? 'true' : ''}, true),
      set_config(
        'app.operational_provisioning',
        ${context.operationalProvisioning ? 'true' : ''},
        true
      ),
      set_config(
        'app.staffing_authority_transition',
        ${context.staffingAuthorityTransition ? 'on' : ''},
        true
      ),
      set_config(
        'app.qualification_standard_transition',
        ${context.qualificationStandardTransition ? 'on' : ''},
        true
      ),
      set_config(
        'app.plantilla_position_transition',
        ${context.plantillaPositionTransition ? 'on' : ''},
        true
      )
  `;
}
