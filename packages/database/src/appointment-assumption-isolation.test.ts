import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { expect, it } from 'vitest';

const enabled = process.env.DATABASE_E2E === 'true';

const PROTECTED_TABLES = [
  'appointment_acknowledgments',
  'oaths_of_office',
  'oath_versions',
  'assumptions_to_duty',
  'assumption_versions',
  'assumption_outcome_events',
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

async function seedIssuedAppointment(
  transaction: Prisma.TransactionClient,
  values: {
    agencyId: string;
    membershipId: string;
    appointmentId: string;
    versionId: string;
    documentVersionId: string;
    draft?: boolean;
  },
): Promise<void> {
  const { agencyId, membershipId, appointmentId, versionId, documentVersionId } = values;
  const label = appointmentId.slice(0, 8);
  const selectionPackage = {
    applicant: { id: randomUUID(), fullName: `Applicant ${label}` },
    applicationNo: `ASSUME-${label}`,
    qualificationStandardVersionId: randomUUID(),
    position: { id: randomUUID(), itemNumber: `ASSUME-ITEM-${label}` },
  };
  await transaction.$executeRaw`
    INSERT INTO "appointments"
      ("id", "agency_id", "recruitment_handoff_id", "recruitment_selection_package",
       "position_id", "appointee_person_key", "workflow_status", "current_version_id",
       "issued_at", "created_by_membership_id", "updated_by_membership_id")
    VALUES
      (${appointmentId}::uuid, ${agencyId}::uuid, ${randomUUID()}::uuid,
       ${JSON.stringify(selectionPackage)}::jsonb, ${randomUUID()}::uuid,
       ${randomUUID()}::uuid, 'ISSUED', ${versionId}::uuid, now(),
       ${membershipId}::uuid, ${membershipId}::uuid)
  `;
  await transaction.$executeRaw`
    INSERT INTO "appointment_versions"
      ("id", "agency_id", "appointment_id", "version_no", "employment_status",
       "nature_of_appointment", "salary_grade", "salary_step", "effectivity_date",
       "appointing_authority_membership_id", "form_variant", "signature_method",
       "appointment_document_version_id", "status", "issued_at",
       "issued_by_membership_id", "created_by_membership_id", "updated_by_membership_id")
    VALUES
      (${versionId}::uuid, ${agencyId}::uuid, ${appointmentId}::uuid, 1, 'PERMANENT',
       'ORIGINAL', 18, 1, '2026-10-01'::date, ${membershipId}::uuid,
       'CS_FORM_33_A_2025', 'WET_INK', ${documentVersionId}::uuid, 'ISSUED', now(),
       ${membershipId}::uuid, ${membershipId}::uuid, ${membershipId}::uuid)
  `;
  if (values.draft) {
    await transaction.$executeRaw`
      INSERT INTO "appointment_versions"
        ("id", "agency_id", "appointment_id", "version_no", "employment_status",
         "nature_of_appointment", "salary_grade", "salary_step", "effectivity_date",
         "appointing_authority_membership_id", "form_variant", "signature_method",
         "appointment_document_version_id", "status",
         "created_by_membership_id", "updated_by_membership_id")
      VALUES
        (${values.draft}::uuid, ${agencyId}::uuid, ${appointmentId}::uuid, 2, 'PERMANENT',
         'ORIGINAL', 18, 1, '2026-10-01'::date, ${membershipId}::uuid,
         'CS_FORM_33_A_2025', 'WET_INK', ${documentVersionId}::uuid, 'DRAFT',
         ${membershipId}::uuid, ${membershipId}::uuid)
    `;
  }
}

async function seedAcknowledgment(
  transaction: Prisma.TransactionClient,
  values: {
    agencyId: string;
    versionId: string;
    acknowledgmentId: string;
    documentVersionId: string;
  },
): Promise<void> {
  await transaction.$executeRaw`
    INSERT INTO "appointment_acknowledgments"
      ("id", "agency_id", "appointment_version_id", "acknowledged_at",
       "evidence_document_version_id")
    VALUES
      (${values.acknowledgmentId}::uuid, ${values.agencyId}::uuid, ${values.versionId}::uuid,
       now(), ${values.documentVersionId}::uuid)
  `;
}

async function seedOath(
  transaction: Prisma.TransactionClient,
  values: {
    agencyId: string;
    appointmentVersionId: string;
    membershipId: string;
    oathId: string;
    oathVersionId: string;
    documentVersionId: string;
  },
): Promise<void> {
  await transaction.$executeRaw`
    INSERT INTO "oaths_of_office"
      ("id", "agency_id", "appointment_version_id",
       "created_by_membership_id", "updated_by_membership_id")
    VALUES
      (${values.oathId}::uuid, ${values.agencyId}::uuid, ${values.appointmentVersionId}::uuid,
       ${values.membershipId}::uuid, ${values.membershipId}::uuid)
  `;
  await transaction.$executeRaw`
    UPDATE "oaths_of_office"
    SET "current_version_id" = ${values.oathVersionId}::uuid
    WHERE "id" = ${values.oathId}::uuid
  `;
  await transaction.$executeRaw`
    INSERT INTO "oath_versions"
      ("id", "agency_id", "oath_id", "version_no", "oath_date",
       "administered_by_membership_id", "authority", "document_version_id")
    VALUES
      (${values.oathVersionId}::uuid, ${values.agencyId}::uuid, ${values.oathId}::uuid,
       1, '2026-10-03'::date, ${values.membershipId}::uuid, 'City Mayor',
       ${values.documentVersionId}::uuid)
  `;
}

async function seedAssumption(
  transaction: Prisma.TransactionClient,
  values: {
    agencyId: string;
    appointmentVersionId: string;
    membershipId: string;
    assumptionId: string;
    assumptionVersionId: string;
    oathVersionId: string;
    documentVersionId: string;
    status: 'PENDING' | 'ASSUMED';
  },
): Promise<void> {
  await transaction.$executeRaw`
    INSERT INTO "assumptions_to_duty"
      ("id", "agency_id", "appointment_version_id", "status",
       "created_by_membership_id", "updated_by_membership_id")
    VALUES
      (${values.assumptionId}::uuid, ${values.agencyId}::uuid,
       ${values.appointmentVersionId}::uuid, 'PENDING',
       ${values.membershipId}::uuid, ${values.membershipId}::uuid)
  `;
  if (values.status === 'ASSUMED') {
    await transaction.$executeRaw`
      INSERT INTO "assumption_versions"
        ("id", "agency_id", "assumption_id", "version_no", "oath_version_id",
         "actual_assumption_date", "certified_by_membership_id", "certifying_authority",
         "certified_at", "document_version_id")
      VALUES
        (${values.assumptionVersionId}::uuid, ${values.agencyId}::uuid,
         ${values.assumptionId}::uuid, 1, ${values.oathVersionId}::uuid,
         '2026-10-04'::date, ${values.membershipId}::uuid, 'City Mayor', now(),
         ${values.documentVersionId}::uuid)
    `;
    await transaction.$executeRaw`
      UPDATE "assumptions_to_duty"
      SET "status" = 'ASSUMED', "current_version_id" = ${values.assumptionVersionId}::uuid
      WHERE "id" = ${values.assumptionId}::uuid
    `;
  }
}

it.skipIf(!enabled)(
  'isolates and guards the appointee acknowledgment, oath, and Assumption to Duty',
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
            code: `ASSUME-RLS-${label}-${suffix}`,
            name: `Assumption RLS ${label}`,
            agencyType: 'NGA',
            status: 'ACTIVE',
          },
        }),
      ),
    );
    const user = await admin.user.create({
      data: {
        identityProvider: 'appointment-assumption-rls-e2e',
        externalSubject: `assumption-${suffix}`,
        emailNormalized: `assumption-rls-${suffix}@example.test`,
        displayName: 'Assumption RLS User',
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
      throw new Error('Assumption RLS fixtures were not created.');
    }

    const fixture = (label: string) => ({
      appointmentId: randomUUID(),
      versionId: randomUUID(),
      draftVersionId: randomUUID(),
      documentVersionId: randomUUID(),
      acknowledgmentId: randomUUID(),
      oathId: randomUUID(),
      oathVersionId: randomUUID(),
      assumptionId: randomUUID(),
      assumptionVersionId: randomUUID(),
      outcomeId: randomUUID(),
      label,
    });
    const a = fixture('A');
    const b = fixture('B');
    const aPending = fixture('A-PENDING');
    const aNoAcknowledgment = fixture('A-NO-ACK');

    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      for (const [agency, membership, chain] of [
        [agencyA, membershipA, a],
        [agencyB, membershipB, b],
        [agencyA, membershipA, aPending],
        [agencyA, membershipA, aNoAcknowledgment],
      ] as const) {
        await seedIssuedAppointment(transaction, {
          agencyId: agency.id,
          membershipId: membership.id,
          appointmentId: chain.appointmentId,
          versionId: chain.versionId,
          documentVersionId: chain.documentVersionId,
          draft: chain.draftVersionId,
        });
        if (chain !== aNoAcknowledgment) {
          await seedAcknowledgment(transaction, {
            agencyId: agency.id,
            versionId: chain.versionId,
            acknowledgmentId: chain.acknowledgmentId,
            documentVersionId: chain.documentVersionId,
          });
          await seedOath(transaction, {
            agencyId: agency.id,
            appointmentVersionId: chain.versionId,
            membershipId: membership.id,
            oathId: chain.oathId,
            oathVersionId: chain.oathVersionId,
            documentVersionId: chain.documentVersionId,
          });
        } else {
          await transaction.$executeRaw`
            INSERT INTO "oaths_of_office"
              ("id", "agency_id", "appointment_version_id",
               "created_by_membership_id", "updated_by_membership_id")
            VALUES
              (${chain.oathId}::uuid, ${agency.id}::uuid, ${chain.versionId}::uuid,
               ${membership.id}::uuid, ${membership.id}::uuid)
          `;
        }
        await seedAssumption(transaction, {
          agencyId: agency.id,
          appointmentVersionId: chain.versionId,
          membershipId: membership.id,
          assumptionId: chain.assumptionId,
          assumptionVersionId: chain.assumptionVersionId,
          oathVersionId: chain.oathVersionId,
          documentVersionId: chain.documentVersionId,
          status: chain === aPending ? 'PENDING' : 'ASSUMED',
        });
      }
      await transaction.$executeRaw`
        INSERT INTO "assumption_outcome_events"
          ("id", "agency_id", "assumption_id", "outcome", "outcome_date", "reason",
           "authorized_by_membership_id", "authority_document_version_id",
           "evidence_document_version_id")
        VALUES
          (${aPending.outcomeId}::uuid, ${agencyA.id}::uuid, ${aPending.assumptionId}::uuid,
           'CANCELLED', '2026-10-05'::date, 'The authority withdrew the appointment.',
           ${membershipA.id}::uuid, ${aPending.documentVersionId}::uuid,
           ${aPending.documentVersionId}::uuid)
      `;
    });

    const context = { agencyId: agencyA.id, userId: user.id, membershipId: membershipA.id };
    const otherContext = { agencyId: agencyB.id, userId: user.id, membershipId: membershipB.id };

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

      const visibleAcknowledgmentsToB = await withContext(app, otherContext, (transaction) =>
        transaction.appointmentAcknowledgment.findMany(),
      );
      expect(visibleAcknowledgmentsToB.map(({ id }) => id)).toEqual([b.acknowledgmentId]);

      const visibleOathsToB = await withContext(app, otherContext, (transaction) =>
        transaction.oathOfOffice.findMany(),
      );
      expect(visibleOathsToB.map(({ id }) => id)).toEqual([b.oathId]);

      const visibleOathVersionsToB = await withContext(app, otherContext, (transaction) =>
        transaction.oathVersion.findMany(),
      );
      expect(visibleOathVersionsToB.map(({ id }) => id)).toEqual([b.oathVersionId]);

      const visibleAssumptionsToB = await withContext(app, otherContext, (transaction) =>
        transaction.assumptionToDuty.findMany(),
      );
      expect(visibleAssumptionsToB.map(({ id }) => id)).toEqual([b.assumptionId]);

      const visibleAssumptionVersionsToB = await withContext(app, otherContext, (transaction) =>
        transaction.assumptionVersion.findMany(),
      );
      expect(visibleAssumptionVersionsToB.map(({ id }) => id)).toEqual([b.assumptionVersionId]);

      const visibleOutcomesToB = await withContext(app, otherContext, (transaction) =>
        transaction.assumptionOutcomeEvent.findMany(),
      );
      expect(visibleOutcomesToB).toEqual([]);

      const visibleOutcomesToA = await withContext(app, context, (transaction) =>
        transaction.assumptionOutcomeEvent.findMany(),
      );
      expect(visibleOutcomesToA.map(({ id }) => id)).toEqual([aPending.outcomeId]);

      await expect(
        withContext(
          app,
          context,
          (transaction) =>
            transaction.$executeRaw`
            INSERT INTO "appointment_acknowledgments"
              ("id", "agency_id", "appointment_version_id", "acknowledged_at",
               "evidence_document_version_id")
            VALUES
              (${randomUUID()}::uuid, ${agencyA.id}::uuid, ${a.draftVersionId}::uuid,
               now(), ${a.documentVersionId}::uuid)
          `,
        ),
      ).rejects.toThrow(/require the Appointment service|row-level security/i);

      await expect(
        withContext(
          app,
          { ...context, appointmentTransition: true },
          (transaction) =>
            transaction.$executeRaw`
            INSERT INTO "appointment_acknowledgments"
              ("id", "agency_id", "appointment_version_id", "acknowledged_at",
               "evidence_document_version_id")
            VALUES
              (${randomUUID()}::uuid, ${agencyA.id}::uuid, ${a.draftVersionId}::uuid,
               now(), ${a.documentVersionId}::uuid)
          `,
        ),
      ).rejects.toThrow(/requires an issued Appointment version/i);

      await expect(
        withContext(
          app,
          { ...context, appointmentTransition: true },
          (transaction) =>
            transaction.$executeRaw`
            INSERT INTO "oaths_of_office"
              ("id", "agency_id", "appointment_version_id", "current_version_id",
               "created_by_membership_id", "updated_by_membership_id")
            VALUES
              (${randomUUID()}::uuid, ${agencyA.id}::uuid,
               ${aNoAcknowledgment.versionId}::uuid, ${aNoAcknowledgment.oathVersionId}::uuid,
               ${membershipA.id}::uuid, ${membershipA.id}::uuid)
          `,
        ),
      ).rejects.toThrow(/begin without a current version/i);

      await expect(
        withContext(
          app,
          { ...context, appointmentTransition: true },
          (transaction) =>
            transaction.$executeRaw`
            INSERT INTO "oath_versions"
              ("id", "agency_id", "oath_id", "version_no", "oath_date",
               "administered_by_membership_id", "authority", "document_version_id")
            VALUES
              (${randomUUID()}::uuid, ${agencyA.id}::uuid,
               ${aNoAcknowledgment.oathId}::uuid, 1, '2026-10-03'::date,
               ${membershipA.id}::uuid, 'City Mayor',
               ${aNoAcknowledgment.documentVersionId}::uuid)
          `,
        ),
      ).rejects.toThrow(/require the appointee acknowledgment/i);

      await expect(
        withContext(
          app,
          { ...context, appointmentTransition: true },
          (transaction) =>
            transaction.$executeRaw`
            UPDATE "oaths_of_office"
            SET "appointment_version_id" = ${aPending.versionId}::uuid
            WHERE "id" = ${a.oathId}::uuid
          `,
        ),
      ).rejects.toThrow(/Oath identity is immutable/i);

      await expect(
        withContext(
          app,
          { ...context, appointmentTransition: true },
          (transaction) =>
            transaction.$executeRaw`
            INSERT INTO "assumptions_to_duty"
              ("id", "agency_id", "appointment_version_id", "status",
               "created_by_membership_id", "updated_by_membership_id")
            VALUES
              (${randomUUID()}::uuid, ${agencyA.id}::uuid, ${a.assumptionId}::uuid, 'ASSUMED',
               ${membershipA.id}::uuid, ${membershipA.id}::uuid)
          `,
        ),
      ).rejects.toThrow(/begin pending without a current version/i);

      await expect(
        withContext(
          app,
          { ...context, appointmentTransition: true },
          (transaction) =>
            transaction.$executeRaw`
            INSERT INTO "assumption_versions"
              ("id", "agency_id", "assumption_id", "version_no", "oath_version_id",
               "actual_assumption_date", "certified_by_membership_id",
               "certifying_authority", "certified_at", "document_version_id")
            VALUES
              (${randomUUID()}::uuid, ${agencyA.id}::uuid, ${aPending.assumptionId}::uuid,
               1, ${randomUUID()}::uuid, '2026-10-04'::date, ${membershipA.id}::uuid,
               'City Mayor', now(), ${aPending.documentVersionId}::uuid)
          `,
        ),
      ).rejects.toThrow(/require the linked Oath version/i);

      await expect(
        withContext(
          app,
          { ...context, appointmentTransition: true },
          (transaction) =>
            transaction.$executeRaw`
            INSERT INTO "assumption_versions"
              ("id", "agency_id", "assumption_id", "version_no", "oath_version_id",
               "actual_assumption_date", "certified_by_membership_id",
               "certifying_authority", "certified_at", "document_version_id")
            VALUES
              (${randomUUID()}::uuid, ${agencyA.id}::uuid, ${a.assumptionId}::uuid,
               1, ${a.oathVersionId}::uuid, '2026-10-04'::date, ${membershipA.id}::uuid,
               'City Mayor', now(), ${a.documentVersionId}::uuid)
          `,
        ),
      ).rejects.toThrow(/requires a pending Assumption/i);

      await expect(
        withContext(
          app,
          { ...context, appointmentTransition: true },
          (transaction) =>
            transaction.$executeRaw`
            INSERT INTO "assumption_outcome_events"
              ("id", "agency_id", "assumption_id", "outcome", "outcome_date", "reason",
               "authorized_by_membership_id", "authority_document_version_id",
               "evidence_document_version_id")
            VALUES
              (${randomUUID()}::uuid, ${agencyA.id}::uuid, ${a.assumptionId}::uuid,
               'DID_NOT_ASSUME', '2026-10-05'::date, 'The appointee did not report.',
               ${membershipA.id}::uuid, ${a.documentVersionId}::uuid,
               ${a.documentVersionId}::uuid)
          `,
        ),
      ).rejects.toThrow(/require a pending Assumption/i);

      await expect(
        withContext(
          app,
          { ...context, appointmentTransition: true },
          (transaction) =>
            transaction.$executeRaw`
            INSERT INTO "assumption_outcome_events"
              ("id", "agency_id", "assumption_id", "outcome", "outcome_date", "reason",
               "authorized_by_membership_id", "authority_document_version_id",
               "evidence_document_version_id")
            VALUES
              (${randomUUID()}::uuid, ${agencyB.id}::uuid, ${aPending.assumptionId}::uuid,
               'CANCELLED', '2026-10-05'::date, 'Cross-agency cancellation.',
               ${membershipA.id}::uuid, ${aPending.documentVersionId}::uuid,
               ${aPending.documentVersionId}::uuid)
          `,
        ),
      ).rejects.toThrow(/row-level security|require a pending Assumption/i);

      await expect(
        withContext(
          app,
          context,
          (transaction) =>
            transaction.$executeRaw`
            UPDATE "appointment_acknowledgments"
            SET "acknowledged_at" = now()
            WHERE "id" = ${a.acknowledgmentId}::uuid
          `,
        ),
      ).rejects.toThrow(/permission denied|retained and cannot be changed/i);

      await expect(
        withContext(
          app,
          context,
          (transaction) =>
            transaction.$executeRaw`
            UPDATE "assumption_versions"
            SET "certifying_authority" = 'Elsewhere'
            WHERE "id" = ${a.assumptionVersionId}::uuid
          `,
        ),
      ).rejects.toThrow(/permission denied|immutable/i);

      await expect(
        withContext(
          app,
          context,
          (transaction) =>
            transaction.$executeRaw`
            DELETE FROM "assumption_outcome_events"
            WHERE "id" = ${aPending.outcomeId}::uuid
          `,
        ),
      ).rejects.toThrow(/permission denied|retained and cannot be changed/i);

      await expect(
        withContext(
          app,
          context,
          (transaction) =>
            transaction.$executeRaw`
            DELETE FROM "oaths_of_office"
            WHERE "id" = ${a.oathId}::uuid
          `,
        ),
      ).rejects.toThrow(/permission denied|retained and cannot be deleted/i);
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        for (const table of [
          'assumption_outcome_events',
          'assumption_versions',
          'assumptions_to_duty',
          'oath_versions',
          'oaths_of_office',
          'appointment_acknowledgments',
          'appointment_versions',
          'appointments',
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
