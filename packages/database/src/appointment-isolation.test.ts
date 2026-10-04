import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { expect, it } from 'vitest';

const enabled = process.env.DATABASE_E2E === 'true';

const PROTECTED_TABLES = [
  'appointment_agency_settings',
  'appointments',
  'appointment_versions',
  'appointment_document_version_links',
  'appointment_external_submission_events',
  'appointment_external_actions',
];

async function withContext<T>(
  client: PrismaClient,
  values: {
    agencyId: string;
    userId: string;
    membershipId: string;
    appointmentTransition?: boolean;
  },
  work: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return client.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT
        set_config('app.agency_id', ${values.agencyId}, true),
        set_config('app.user_id', ${values.userId}, true),
        set_config('app.membership_id', ${values.membershipId}, true),
        set_config(
          'app.appointment_transition',
          ${values.appointmentTransition ? 'on' : ''},
          true
        )
    `;
    return work(transaction);
  });
}

it.skipIf(!enabled)(
  'isolates Appointment records and freezes issued versions and evidence',
  async () => {
    const runtimeUrl = process.env.DATABASE_URL;
    const adminUrl = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
    if (!runtimeUrl || !adminUrl) {
      throw new Error('Runtime and administrative database URLs are required.');
    }

    const app = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
    const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
    const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const agencies = await Promise.all(
      ['A', 'B'].map((label) =>
        admin.agency.create({
          data: {
            code: `APPT-RLS-${label}-${suffix}`,
            name: `Appointment RLS ${label}`,
            agencyType: 'NGA',
            status: 'ACTIVE',
          },
        }),
      ),
    );
    const user = await admin.user.create({
      data: {
        emailNormalized: `appointment-rls-${suffix}@example.test`,
        displayName: 'Appointment RLS User',
        globalStatus: 'ACTIVE',
      },
    });
    const memberships = await Promise.all(
      agencies.map(({ id }) =>
        admin.agencyMembership.create({
          data: { agencyId: id, userId: user.id, status: 'ACTIVE' },
        }),
      ),
    );
    const agencyA = agencies[0];
    const agencyB = agencies[1];
    const membershipA = memberships[0];
    const membershipB = memberships[1];
    if (!agencyA || !agencyB || !membershipA || !membershipB) {
      throw new Error('Appointment RLS fixtures were not created.');
    }

    const appointmentIds = [randomUUID(), randomUUID()];
    const handoffIds = [randomUUID(), randomUUID()];
    const positionIds = [randomUUID(), randomUUID()];
    const versionIds = [randomUUID(), randomUUID()];
    const issuedVersionIds = [randomUUID(), randomUUID()];
    const documentVersionIds = [randomUUID(), randomUUID()];
    const linkIds = [randomUUID(), randomUUID()];
    const settingsIds = [randomUUID(), randomUUID()];
    const externalSubmissionIds = [randomUUID(), randomUUID()];
    const externalActionIds = [randomUUID(), randomUUID()];

    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      for (const [index, agency] of agencies.entries()) {
        const membership = memberships[index];
        const appointmentId = appointmentIds[index];
        const handoffId = handoffIds[index];
        const positionId = positionIds[index];
        const versionId = versionIds[index];
        const issuedVersionId = issuedVersionIds[index];
        const documentVersionId = documentVersionIds[index];
        const linkId = linkIds[index];
        const settingsId = settingsIds[index];
        const externalSubmissionId = externalSubmissionIds[index];
        const externalActionId = externalActionIds[index];
        if (
          !membership ||
          !appointmentId ||
          !handoffId ||
          !positionId ||
          !versionId ||
          !issuedVersionId ||
          !documentVersionId ||
          !linkId ||
          !settingsId ||
          !externalSubmissionId ||
          !externalActionId
        ) {
          throw new Error('Appointment RLS fixture identifiers are missing.');
        }
        const selectionPackage = {
          applicant: { id: randomUUID(), fullName: `Applicant ${index}` },
          applicationNo: `RLS-APP-${index}-${suffix}`,
          qualificationStandardVersionId: randomUUID(),
          position: { id: positionId, itemNumber: `RLS-ITEM-${index}` },
        };
        await transaction.$executeRaw`
          INSERT INTO "appointment_agency_settings"
            ("id", "agency_id", "regulatory_status", "status_evidence_document_version_id",
             "configured_by_membership_id", "updated_by_membership_id")
          VALUES
            (${settingsId}::uuid, ${agency.id}::uuid, 'REGULATED',
             ${documentVersionId}::uuid, ${membership.id}::uuid, ${membership.id}::uuid)
        `;
        await transaction.$executeRaw`
          INSERT INTO "appointments"
            ("id", "agency_id", "recruitment_handoff_id", "recruitment_selection_package",
             "position_id", "appointee_person_key", "workflow_status", "current_version_id",
             "created_by_membership_id", "updated_by_membership_id")
          VALUES
            (${appointmentId}::uuid, ${agency.id}::uuid, ${handoffId}::uuid,
             ${JSON.stringify(selectionPackage)}::jsonb, ${positionId}::uuid,
             ${randomUUID()}::uuid, 'DRAFT', ${versionId}::uuid,
             ${membership.id}::uuid, ${membership.id}::uuid)
        `;
        await transaction.$executeRaw`
          INSERT INTO "appointment_versions"
            ("id", "agency_id", "appointment_id", "version_no", "employment_status",
             "nature_of_appointment", "salary_grade", "salary_step", "effectivity_date",
             "appointing_authority_membership_id", "form_variant", "signature_method",
             "appointment_document_version_id", "status",
             "created_by_membership_id", "updated_by_membership_id")
          VALUES
            (${versionId}::uuid, ${agency.id}::uuid, ${appointmentId}::uuid, 1, 'PERMANENT',
             'ORIGINAL', 18, 1, '2026-10-01'::date, ${membership.id}::uuid,
             'CS_FORM_33_A_2025', 'WET_INK', ${documentVersionId}::uuid, 'DRAFT',
             ${membership.id}::uuid, ${membership.id}::uuid)
        `;
        await transaction.$executeRaw`
          INSERT INTO "appointment_versions"
            ("id", "agency_id", "appointment_id", "version_no", "employment_status",
             "nature_of_appointment", "salary_grade", "salary_step", "effectivity_date",
             "appointing_authority_membership_id", "form_variant", "signature_method",
             "appointment_document_version_id", "status", "issued_at",
             "issued_by_membership_id", "created_by_membership_id", "updated_by_membership_id")
          VALUES
            (${issuedVersionId}::uuid, ${agency.id}::uuid, ${appointmentId}::uuid, 2, 'PERMANENT',
             'ORIGINAL', 18, 1, '2026-10-01'::date, ${membership.id}::uuid,
             'CS_FORM_33_A_2025', 'WET_INK', ${documentVersionId}::uuid, 'ISSUED', now(),
             ${membership.id}::uuid, ${membership.id}::uuid, ${membership.id}::uuid)
        `;
        await transaction.$executeRaw`
          INSERT INTO "appointment_document_version_links"
            ("id", "agency_id", "appointment_version_id", "document_version_id", "link_role")
          VALUES
            (${linkId}::uuid, ${agency.id}::uuid, ${issuedVersionId}::uuid,
             ${documentVersionId}::uuid, 'PDS')
        `;
        await transaction.$executeRaw`
          INSERT INTO "appointment_external_submission_events"
            ("id", "agency_id", "appointment_version_id", "event_type",
             "external_reference", "occurred_at", "receiving_office",
             "recorded_by_membership_id", "evidence_document_version_id")
          VALUES
            (${externalSubmissionId}::uuid, ${agency.id}::uuid, ${issuedVersionId}::uuid,
             'SUBMITTED', ${`CSC-RLS-${index}-${suffix}`}, now(), 'CSC Field Office',
             ${membership.id}::uuid, ${documentVersionId}::uuid)
        `;
        await transaction.$executeRaw`
          INSERT INTO "appointment_external_actions"
            ("id", "agency_id", "appointment_version_id", "action",
             "external_reference", "action_at", "recorded_by_membership_id",
             "evidence_document_version_id")
          VALUES
            (${externalActionId}::uuid, ${agency.id}::uuid, ${issuedVersionId}::uuid,
             'APPROVED', ${`CSC-RLS-${index}-${suffix}`}, now(),
             ${membership.id}::uuid, ${documentVersionId}::uuid)
        `;
      }
    });

    try {
      const forced = await admin.$queryRaw<Array<{ table_name: string }>>`
        SELECT relname AS table_name
        FROM pg_class
        WHERE relnamespace = 'public'::regnamespace
          AND relname = ANY(${PROTECTED_TABLES})
          AND relforcerowsecurity = true
      `;
      expect(forced.map(({ table_name }) => table_name).sort()).toEqual(
        [...PROTECTED_TABLES].sort(),
      );

      const policies = await admin.$queryRaw<Array<{ tablename: string; count: bigint }>>`
        SELECT tablename, COUNT(*)::bigint AS count
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = ANY(${PROTECTED_TABLES})
        GROUP BY tablename
      `;
      for (const { count } of policies) expect(Number(count)).toBeGreaterThanOrEqual(2);

      const visibleToA = await withContext(
        app,
        {
          agencyId: agencyA.id,
          userId: user.id,
          membershipId: membershipA.id,
        },
        (transaction) => transaction.appointment.findMany(),
      );
      expect(visibleToA.map(({ id }) => id)).toEqual([appointmentIds[0]]);

      const visibleVersionsToB = await withContext(
        app,
        {
          agencyId: agencyB.id,
          userId: user.id,
          membershipId: membershipB.id,
        },
        (transaction) => transaction.appointmentVersion.findMany(),
      );
      expect(visibleVersionsToB.map(({ id }) => id).sort()).toEqual(
        [issuedVersionIds[1], versionIds[1]].sort(),
      );

      const visibleSettingsToB = await withContext(
        app,
        {
          agencyId: agencyB.id,
          userId: user.id,
          membershipId: membershipB.id,
        },
        (transaction) => transaction.appointmentAgencySettings.findMany(),
      );
      expect(visibleSettingsToB.map(({ id }) => id)).toEqual([settingsIds[1]]);

      await expect(
        withContext(
          app,
          {
            agencyId: agencyA.id,
            userId: user.id,
            membershipId: membershipA.id,
          },
          (transaction) =>
            transaction.appointment.create({
              data: {
                agencyId: agencyA.id,
                recruitmentHandoffId: handoffIds[0] as string,
                recruitmentSelectionPackage: {
                  applicant: { id: randomUUID(), fullName: 'No Capability' },
                  applicationNo: 'NO-CAP',
                  qualificationStandardVersionId: randomUUID(),
                  position: { id: positionIds[0], itemNumber: 'NO-CAP' },
                },
                positionId: positionIds[0] as string,
                appointeePersonKey: randomUUID(),
                workflowStatus: 'DRAFT',
                createdByMembershipId: membershipA.id,
                updatedByMembershipId: membershipA.id,
              },
            }),
        ),
      ).rejects.toThrow(/Appointments require the Appointment service|row-level security/i);

      const blockedUpdateCount = await withContext(
        app,
        {
          agencyId: agencyA.id,
          userId: user.id,
          membershipId: membershipA.id,
        },
        (transaction) =>
          transaction.$executeRaw`
            UPDATE "appointments"
            SET "workflow_status" = 'FOR_REVIEW'
            WHERE "id" = ${appointmentIds[0]}::uuid
          `,
      );
      expect(blockedUpdateCount).toBe(0);

      await expect(
        withContext(
          app,
          {
            agencyId: agencyA.id,
            userId: user.id,
            membershipId: membershipA.id,
            appointmentTransition: true,
          },
          (transaction) =>
            transaction.appointment.create({
              data: {
                agencyId: agencyB.id,
                recruitmentHandoffId: handoffIds[1] as string,
                recruitmentSelectionPackage: {
                  applicant: { id: randomUUID(), fullName: 'Cross Agency' },
                  applicationNo: 'CROSS',
                  qualificationStandardVersionId: randomUUID(),
                  position: { id: positionIds[1], itemNumber: 'CROSS' },
                },
                positionId: positionIds[1] as string,
                appointeePersonKey: randomUUID(),
                workflowStatus: 'DRAFT',
                createdByMembershipId: membershipA.id,
                updatedByMembershipId: membershipA.id,
              },
            }),
        ),
      ).rejects.toThrow(/row-level security|must bind their Recruitment handoff/i);

      await expect(
        withContext(
          app,
          {
            agencyId: agencyA.id,
            userId: user.id,
            membershipId: membershipA.id,
            appointmentTransition: true,
          },
          (transaction) =>
            transaction.$executeRaw`
              DELETE FROM "appointments"
              WHERE "id" = ${appointmentIds[0]}::uuid
            `,
        ),
      ).rejects.toThrow(/retained and cannot be deleted|permission denied/i);

      await expect(
        withContext(
          app,
          {
            agencyId: agencyA.id,
            userId: user.id,
            membershipId: membershipA.id,
            appointmentTransition: true,
          },
          (transaction) =>
            transaction.$executeRaw`
              UPDATE "appointments"
              SET "position_id" = ${positionIds[1]}::uuid
              WHERE "id" = ${appointmentIds[0]}::uuid
            `,
        ),
      ).rejects.toThrow(/immutable/i);

      await expect(
        withContext(
          app,
          {
            agencyId: agencyA.id,
            userId: user.id,
            membershipId: membershipA.id,
            appointmentTransition: true,
          },
          (transaction) =>
            transaction.$executeRaw`
              UPDATE "appointment_versions"
              SET "salary_grade" = 5
              WHERE "id" = ${issuedVersionIds[0]}::uuid
            `,
        ),
      ).rejects.toThrow(/Issued Appointment versions are frozen/i);

      await expect(
        withContext(
          app,
          {
            agencyId: agencyA.id,
            userId: user.id,
            membershipId: membershipA.id,
            appointmentTransition: true,
          },
          (transaction) =>
            transaction.$executeRaw`
              DELETE FROM "appointment_document_version_links"
              WHERE "id" = ${linkIds[0]}::uuid
            `,
        ),
      ).rejects.toThrow(/Issued Appointment evidence is frozen/i);

      const visibleSubmissionsToB = await withContext(
        app,
        {
          agencyId: agencyB.id,
          userId: user.id,
          membershipId: membershipB.id,
        },
        (transaction) => transaction.appointmentExternalSubmissionEvent.findMany(),
      );
      expect(visibleSubmissionsToB.map(({ id }) => id)).toEqual([externalSubmissionIds[1]]);

      const visibleActionsToB = await withContext(
        app,
        {
          agencyId: agencyB.id,
          userId: user.id,
          membershipId: membershipB.id,
        },
        (transaction) => transaction.appointmentExternalAction.findMany(),
      );
      expect(visibleActionsToB.map(({ id }) => id)).toEqual([externalActionIds[1]]);

      await expect(
        withContext(
          app,
          {
            agencyId: agencyA.id,
            userId: user.id,
            membershipId: membershipA.id,
            appointmentTransition: true,
          },
          (transaction) =>
            transaction.$executeRaw`
              INSERT INTO "appointment_external_submission_events"
                ("id", "agency_id", "appointment_version_id", "event_type",
                 "occurred_at", "receiving_office", "recorded_by_membership_id",
                 "evidence_document_version_id")
              VALUES
                (${randomUUID()}::uuid, ${agencyB.id}::uuid, ${issuedVersionIds[1]}::uuid,
                 'SUBMITTED', now(), 'CSC Field Office', ${membershipA.id}::uuid,
                 ${documentVersionIds[1]}::uuid)
            `,
        ),
      ).rejects.toThrow(/row-level security|require an issued Appointment version/i);

      await expect(
        withContext(
          app,
          {
            agencyId: agencyA.id,
            userId: user.id,
            membershipId: membershipA.id,
            appointmentTransition: true,
          },
          (transaction) =>
            transaction.$executeRaw`
              INSERT INTO "appointment_external_submission_events"
                ("id", "agency_id", "appointment_version_id", "event_type",
                 "occurred_at", "receiving_office", "recorded_by_membership_id",
                 "evidence_document_version_id")
              VALUES
                (${randomUUID()}::uuid, ${agencyA.id}::uuid, ${versionIds[0]}::uuid,
                 'SUBMITTED', now(), 'CSC Field Office', ${membershipA.id}::uuid,
                 ${documentVersionIds[0]}::uuid)
            `,
        ),
      ).rejects.toThrow(/require an issued Appointment version/i);

      await expect(
        withContext(
          app,
          {
            agencyId: agencyA.id,
            userId: user.id,
            membershipId: membershipA.id,
            appointmentTransition: true,
          },
          (transaction) =>
            transaction.$executeRaw`
              UPDATE "appointment_external_submission_events"
              SET "receiving_office" = 'Elsewhere'
              WHERE "id" = ${externalSubmissionIds[0]}::uuid
            `,
        ),
      ).rejects.toThrow(/permission denied|append-only/i);

      await expect(
        withContext(
          app,
          {
            agencyId: agencyA.id,
            userId: user.id,
            membershipId: membershipA.id,
            appointmentTransition: true,
          },
          (transaction) =>
            transaction.$executeRaw`
              DELETE FROM "appointment_external_actions"
              WHERE "id" = ${externalActionIds[0]}::uuid
            `,
        ),
      ).rejects.toThrow(/permission denied|append-only/i);
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        for (const table of [
          'appointment_external_submission_events',
          'appointment_external_actions',
          'appointment_document_version_links',
          'appointment_versions',
          'appointments',
          'appointment_agency_settings',
        ]) {
          await transaction.$executeRawUnsafe(
            `DELETE FROM "${table}" WHERE "agency_id" IN ('${agencyA.id}'::uuid, '${agencyB.id}'::uuid)`,
          );
        }
      });
      await admin.agencyMembership.deleteMany({
        where: { agencyId: { in: [agencyA.id, agencyB.id] } },
      });
      await admin.agency.deleteMany({ where: { id: { in: [agencyA.id, agencyB.id] } } });
      await admin.user.delete({ where: { id: user.id } });
      await app.$disconnect();
      await admin.$disconnect();
    }
  },
);
