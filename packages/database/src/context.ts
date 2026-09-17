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
  | 'personnel-action-transition'
  | 'government-identifier-transition'
  | 'payroll-bank-account-transition'
  | 'saln-compliance-transition'
  | 'service-record-transition'
  | 'organization-unit-correction'
  | 'approval-transition'
  | 'recruitment-transition'
  | 'appointment-transition'
  | 'work-schedule-transition'
  | 'work-arrangement-transition'
  | 'leave-policy-transition';

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
        'app.personnel_action_transition',
        ${hasCapability(context, 'personnel-action-transition') ? 'on' : ''},
        true
      ),
      set_config(
        'app.organization_unit_correction',
        ${hasCapability(context, 'organization-unit-correction') ? 'on' : ''},
        true
      ),
      set_config(
        'app.government_identifier_transition',
        ${hasCapability(context, 'government-identifier-transition') ? 'on' : ''},
        true
      ),
      set_config(
        'app.payroll_bank_account_transition',
        ${hasCapability(context, 'payroll-bank-account-transition') ? 'on' : ''},
        true
      ),
      set_config(
        'app.saln_compliance_transition',
        ${hasCapability(context, 'saln-compliance-transition') ? 'on' : ''},
        true
      ),
      set_config(
        'app.service_record_transition',
        ${hasCapability(context, 'service-record-transition') ? 'on' : ''},
        true
      ),
      set_config(
        'app.approval_transition',
        ${hasCapability(context, 'approval-transition') ? 'on' : ''},
        true
      ),
      set_config(
        'app.recruitment_transition',
        ${hasCapability(context, 'recruitment-transition') ? 'on' : ''},
        true
      ),
      set_config(
        'app.appointment_transition',
        ${hasCapability(context, 'appointment-transition') ? 'on' : ''},
        true
      ),
      set_config(
        'app.work_schedule_transition',
        ${hasCapability(context, 'work-schedule-transition') ? 'on' : ''},
        true
      ),
      set_config(
        'app.work_arrangement_transition',
        ${hasCapability(context, 'work-arrangement-transition') ? 'on' : ''},
        true
      ),
      set_config(
        'app.leave_policy_transition',
        ${hasCapability(context, 'leave-policy-transition') ? 'on' : ''},
        true
      )
  `;
}
