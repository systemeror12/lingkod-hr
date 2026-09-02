import { PrismaClient, type Prisma } from '@prisma/client';
import { expect, it } from 'vitest';

const enabled = process.env.DATABASE_E2E === 'true';
const pdsWorkHistoryTables = [
  'pds_work_experience_records',
  'pds_voluntary_work_records',
  'pds_learning_development_records',
  'pds_wes_artifacts',
  'pds_wes_entries',
] as const;

type SqlClient = PrismaClient | Prisma.TransactionClient;

async function withContext<T>(
  client: PrismaClient,
  values: { agencyId: string; userId: string; membershipId: string; pdsMutation?: boolean },
  work: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return client.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT
        set_config('app.agency_id', ${values.agencyId}, true),
        set_config('app.user_id', ${values.userId}, true),
        set_config('app.membership_id', ${values.membershipId}, true),
        set_config('app.pds_mutation', ${values.pdsMutation ? 'on' : ''}, true)
    `;
    return work(transaction);
  });
}

async function adminClient(): Promise<PrismaClient> {
  const url = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!url) throw new Error('A database owner URL is required for the integration test.');
  return new PrismaClient({ datasources: { db: { url } } });
}

async function tableExists(client: SqlClient, tableName: (typeof pdsWorkHistoryTables)[number]) {
  const rows = await client.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ${tableName}
  `;
  return rows.length > 0;
}

async function workHistoryTablesReady(client: SqlClient) {
  const statuses = await Promise.all(
    pdsWorkHistoryTables.map((tableName) => tableExists(client, tableName)),
  );
  return statuses.every(Boolean);
}

async function createEvidenceDocument(
  admin: PrismaClient,
  values: { agencyId: string; membershipId: string; suffix: string; label: string },
) {
  const document = await admin.document.create({
    data: {
      agencyId: values.agencyId,
      documentNo: `PDS-EVIDENCE-${values.label}-${values.suffix}`,
      documentType: 'PDS',
      classification: 'CONFIDENTIAL',
      status: 'DRAFT',
      createdByMembershipId: values.membershipId,
    },
  });
  const version = await admin.documentVersion.create({
    data: {
      agencyId: values.agencyId,
      documentId: document.id,
      versionNo: 1,
      storageKey: `pds-isolation/${values.suffix}/${values.label}`,
      contentHash: values.label.toLowerCase().repeat(64).slice(0, 64),
      mimeType: 'application/pdf',
      sizeBytes: 1,
      createdByMembershipId: values.membershipId,
    },
  });
  await admin.document.update({
    where: { id: document.id },
    data: { currentVersionId: version.id, status: 'ISSUED' },
  });
  return { document, version };
}

async function insertWorkExperience(
  client: SqlClient,
  values: {
    agencyId: string;
    pdsVersionId: string;
    sequenceNo: number;
    inclusiveFrom: Date;
    inclusiveTo: Date | null;
    positionTitle: string;
    departmentAgencyOfficeCompany: string;
    monthlySalary?: number | null;
    salaryGradeStep?: string | null;
    appointmentStatus?: string | null;
    governmentService?: 'Y' | 'N' | null;
    isCurrent?: boolean;
    documentId?: string | null;
    documentVersionId?: string | null;
  },
) {
  const rows = await client.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "pds_work_experience_records" (
      "agency_id",
      "pds_version_id",
      "sequence_no",
      "inclusive_from",
      "inclusive_to",
      "position_title",
      "department_agency_office_company",
      "monthly_salary",
      "salary_grade_step",
      "appointment_status",
      "government_service",
      "is_current",
      "document_id",
      "document_version_id"
    )
    VALUES (
      ${values.agencyId}::uuid,
      ${values.pdsVersionId}::uuid,
      ${values.sequenceNo},
      ${values.inclusiveFrom},
      ${values.inclusiveTo},
      ${values.positionTitle},
      ${values.departmentAgencyOfficeCompany},
      ${values.monthlySalary ?? null},
      ${values.salaryGradeStep ?? null},
      ${values.appointmentStatus ?? null},
      ${values.governmentService ?? null},
      ${values.isCurrent ?? false},
      ${values.documentId ?? null}::uuid,
      ${values.documentVersionId ?? null}::uuid
    )
    RETURNING "id"
  `;
  const row = rows[0];
  if (!row) throw new Error('Failed to insert a PDS work-experience record fixture.');
  return row.id;
}

async function insertVoluntaryWork(
  client: SqlClient,
  values: {
    agencyId: string;
    pdsVersionId: string;
    sequenceNo: number;
    organizationNameAddress: string;
    inclusiveFrom: Date;
    inclusiveTo: Date | null;
    hours?: number | null;
    positionNatureOfWork: string;
    documentId?: string | null;
    documentVersionId?: string | null;
  },
) {
  const rows = await client.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "pds_voluntary_work_records" (
      "agency_id",
      "pds_version_id",
      "sequence_no",
      "organization_name_address",
      "inclusive_from",
      "inclusive_to",
      "hours",
      "position_nature_of_work",
      "document_id",
      "document_version_id"
    )
    VALUES (
      ${values.agencyId}::uuid,
      ${values.pdsVersionId}::uuid,
      ${values.sequenceNo},
      ${values.organizationNameAddress},
      ${values.inclusiveFrom},
      ${values.inclusiveTo},
      ${values.hours ?? null},
      ${values.positionNatureOfWork},
      ${values.documentId ?? null}::uuid,
      ${values.documentVersionId ?? null}::uuid
    )
    RETURNING "id"
  `;
  const row = rows[0];
  if (!row) throw new Error('Failed to insert a PDS voluntary-work record fixture.');
  return row.id;
}

async function insertLearningDevelopment(
  client: SqlClient,
  values: {
    agencyId: string;
    pdsVersionId: string;
    sequenceNo: number;
    interventionTitle: string;
    attendanceFrom: Date;
    attendanceTo: Date | null;
    hours?: number | null;
    type?: string | null;
    conductedSponsoredBy?: string | null;
    documentId?: string | null;
    documentVersionId?: string | null;
  },
) {
  const rows = await client.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "pds_learning_development_records" (
      "agency_id",
      "pds_version_id",
      "sequence_no",
      "intervention_title",
      "attendance_from",
      "attendance_to",
      "hours",
      "type",
      "conducted_sponsored_by",
      "document_id",
      "document_version_id"
    )
    VALUES (
      ${values.agencyId}::uuid,
      ${values.pdsVersionId}::uuid,
      ${values.sequenceNo},
      ${values.interventionTitle},
      ${values.attendanceFrom},
      ${values.attendanceTo},
      ${values.hours ?? null},
      ${values.type ?? null},
      ${values.conductedSponsoredBy ?? null},
      ${values.documentId ?? null}::uuid,
      ${values.documentVersionId ?? null}::uuid
    )
    RETURNING "id"
  `;
  const row = rows[0];
  if (!row) throw new Error('Failed to insert a PDS learning-development record fixture.');
  return row.id;
}

async function insertWesArtifact(
  client: SqlClient,
  values: {
    agencyId: string;
    employeeId: string;
    pdsVersionId: string;
    contextKey: string;
    documentId?: string | null;
    documentVersionId?: string | null;
  },
) {
  const rows = await client.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "pds_wes_artifacts" (
      "agency_id",
      "employee_id",
      "pds_version_id",
      "context_key",
      "status",
      "document_id",
      "document_version_id"
    )
    VALUES (
      ${values.agencyId}::uuid,
      ${values.employeeId}::uuid,
      ${values.pdsVersionId}::uuid,
      ${values.contextKey},
      'DRAFT',
      ${values.documentId ?? null}::uuid,
      ${values.documentVersionId ?? null}::uuid
    )
    RETURNING "id"
  `;
  const row = rows[0];
  if (!row) throw new Error('Failed to insert a PDS WES artifact fixture.');
  return row.id;
}

async function insertWesEntry(
  client: SqlClient,
  values: {
    agencyId: string;
    wesArtifactId: string;
    pdsVersionId: string;
    workExperienceId: string;
    sequenceNo: number;
    durationText: string;
    position: string;
    officeUnit: string;
    immediateSupervisor: string;
    agencyOrganizationLocation: string;
    accomplishments?: string | null;
    actualDuties: string;
  },
) {
  const rows = await client.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "pds_wes_entries" (
      "agency_id",
      "wes_artifact_id",
      "pds_version_id",
      "work_experience_id",
      "sequence_no",
      "duration_text",
      "position",
      "office_unit",
      "immediate_supervisor",
      "agency_organization_location",
      "accomplishments",
      "actual_duties"
    )
    VALUES (
      ${values.agencyId}::uuid,
      ${values.wesArtifactId}::uuid,
      ${values.pdsVersionId}::uuid,
      ${values.workExperienceId}::uuid,
      ${values.sequenceNo},
      ${values.durationText},
      ${values.position},
      ${values.officeUnit},
      ${values.immediateSupervisor},
      ${values.agencyOrganizationLocation},
      ${values.accomplishments ?? null},
      ${values.actualDuties}
    )
    RETURNING "id"
  `;
  const row = rows[0];
  if (!row) throw new Error('Failed to insert a PDS WES entry fixture.');
  return row.id;
}

async function countById(
  client: SqlClient,
  tableName: (typeof pdsWorkHistoryTables)[number],
  id: string,
) {
  const rows = await client.$queryRawUnsafe<Array<{ count: number }>>(
    `SELECT count(*)::int AS count FROM "${tableName}" WHERE "id" = CAST($1 AS uuid)`,
    id,
  );
  return Number(rows[0]?.count ?? 0);
}

async function deleteByAgencyIds(
  client: SqlClient,
  tableName: (typeof pdsWorkHistoryTables)[number],
  agencyIds: string[],
) {
  if (agencyIds.length === 0) return;
  await client.$executeRawUnsafe(
    `DELETE FROM "${tableName}" WHERE "agency_id" IN (${agencyIds
      .map((_, index) => `CAST($${index + 1} AS uuid)`)
      .join(', ')})`,
    ...agencyIds,
  );
}

it.skipIf(!enabled)('isolates PDS sections and enforces draft-only mutations', async () => {
  const runtimeUrl = process.env.DATABASE_URL;
  if (!runtimeUrl) throw new Error('DATABASE_URL is required for the integration test.');
  const app = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
  const admin = await adminClient();
  const suffix = `${Date.now()}-pds`;
  const agencyA = await admin.agency.create({
    data: { code: `PDS-A-${suffix}`, name: 'PDS Agency A', agencyType: 'NGA', status: 'ACTIVE' },
  });
  const agencyB = await admin.agency.create({
    data: { code: `PDS-B-${suffix}`, name: 'PDS Agency B', agencyType: 'NGA', status: 'ACTIVE' },
  });
  const user = await admin.user.create({
    data: {
      identityProvider: 'pds-rls-e2e',
      externalSubject: `pds-${suffix}`,
      emailNormalized: `pds-${suffix}@example.test`,
      displayName: 'PDS RLS User',
      globalStatus: 'ACTIVE',
    },
  });
  const membershipA = await admin.agencyMembership.create({
    data: { agencyId: agencyA.id, userId: user.id, status: 'ACTIVE' },
  });
  const membershipB = await admin.agencyMembership.create({
    data: { agencyId: agencyB.id, userId: user.id, status: 'ACTIVE' },
  });
  const employeeA = await admin.employee.create({
    data: {
      agencyId: agencyA.id,
      employeeNumber: `PDS-A-${suffix}`,
      legalName: 'PDS Agency A Employee',
      birthDate: new Date('1990-01-01'),
      sex: 'FEMALE',
      civilStatus: 'SINGLE',
      contactEmail: `pds-a-${suffix}@example.test`,
      createdByMembershipId: membershipA.id,
      updatedByMembershipId: membershipA.id,
    },
  });
  const employeeB = await admin.employee.create({
    data: {
      agencyId: agencyB.id,
      employeeNumber: `PDS-B-${suffix}`,
      legalName: 'PDS Agency B Employee',
      birthDate: new Date('1990-01-01'),
      sex: 'MALE',
      civilStatus: 'SINGLE',
      contactEmail: `pds-b-${suffix}@example.test`,
      createdByMembershipId: membershipB.id,
      updatedByMembershipId: membershipB.id,
    },
  });
  const pdsB = await admin.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    const version = await transaction.pdsVersion.create({
      data: {
        agencyId: agencyB.id,
        employeeId: employeeB.id,
        versionNo: 1,
        formVersion: 'CS_FORM_212_REVISED_2026',
        asOfDate: new Date('2026-08-31'),
        status: 'DRAFT',
        createdByMembershipId: membershipB.id,
        updatedByMembershipId: membershipB.id,
      },
    });
    await transaction.pdsPersonalDetails.create({
      data: { agencyId: agencyB.id, pdsVersionId: version.id, surname: 'Foreign' },
    });
    await transaction.pdsEducationRecord.create({
      data: {
        agencyId: agencyB.id,
        pdsVersionId: version.id,
        level: 'COLLEGE',
        sequenceNo: 1,
        schoolName: 'Foreign University',
        degreeCourse: 'Foreign Course',
        periodOfAttendance: '2010-2014',
        highestLevelUnits: 'Graduate',
        yearGraduated: 2014,
        honors: 'N/A',
      },
    });
    return version;
  });

  try {
    await expect(
      withContext(
        app,
        { agencyId: agencyA.id, userId: user.id, membershipId: membershipA.id },
        (transaction) => transaction.pdsVersion.findMany({ where: { id: pdsB.id } }),
      ),
    ).resolves.toHaveLength(0);

    const pdsA = await withContext(
      app,
      {
        agencyId: agencyA.id,
        userId: user.id,
        membershipId: membershipA.id,
        pdsMutation: true,
      },
      async (transaction) => {
        const version = await transaction.pdsVersion.create({
          data: {
            agencyId: agencyA.id,
            employeeId: employeeA.id,
            versionNo: 1,
            formVersion: 'CS_FORM_212_REVISED_2026',
            asOfDate: new Date('2026-08-31'),
            status: 'DRAFT',
            createdByMembershipId: membershipA.id,
            updatedByMembershipId: membershipA.id,
          },
        });
        await transaction.pdsPersonalDetails.create({
          data: { agencyId: agencyA.id, pdsVersionId: version.id, surname: 'Local' },
        });
        await transaction.pdsFamilyRecord.create({
          data: {
            agencyId: agencyA.id,
            pdsVersionId: version.id,
            relationshipType: 'CHILD',
            sequenceNo: 1,
            fullName: 'Local Child',
            birthDate: new Date('2020-01-01'),
          },
        });
        await transaction.pdsEducationRecord.create({
          data: {
            agencyId: agencyA.id,
            pdsVersionId: version.id,
            level: 'COLLEGE',
            sequenceNo: 1,
            schoolName: 'Local University',
            degreeCourse: 'Local Course',
            periodOfAttendance: '2010-2014',
            highestLevelUnits: 'Graduate',
            yearGraduated: 2014,
            honors: 'N/A',
          },
        });
        await transaction.pdsEligibilityRecord.create({
          data: {
            agencyId: agencyA.id,
            pdsVersionId: version.id,
            sequenceNo: 1,
            eligibilityName: 'Career Service',
            rating: '85.5',
            examDate: new Date('2020-01-01'),
            examPlace: 'Manila',
          },
        });
        return version;
      },
    );

    await expect(
      withContext(
        app,
        { agencyId: agencyA.id, userId: user.id, membershipId: membershipA.id },
        (transaction) =>
          transaction.pdsEducationRecord.findMany({ where: { pdsVersionId: pdsB.id } }),
      ),
    ).resolves.toHaveLength(0);

    await expect(
      withContext(
        app,
        { agencyId: agencyA.id, userId: user.id, membershipId: membershipA.id },
        (transaction) =>
          transaction.pdsPersonalDetails.update({
            where: { pdsVersionId: pdsA.id },
            data: { surname: 'Blocked' },
          }),
      ),
    ).rejects.toThrow(/application service|section rows/i);

    await expect(
      withContext(
        app,
        {
          agencyId: agencyA.id,
          userId: user.id,
          membershipId: membershipA.id,
          pdsMutation: true,
        },
        (transaction) =>
          transaction.pdsPersonalDetails.update({
            where: { pdsVersionId: pdsA.id },
            data: { surname: 'Updated' },
          }),
      ),
    ).resolves.toMatchObject({ surname: 'Updated' });

    await expect(
      withContext(
        app,
        {
          agencyId: agencyA.id,
          userId: user.id,
          membershipId: membershipA.id,
          pdsMutation: true,
        },
        (transaction) =>
          transaction.pdsVersion.create({
            data: {
              agencyId: agencyB.id,
              employeeId: employeeB.id,
              versionNo: 2,
              formVersion: 'CS_FORM_212_REVISED_2026',
              asOfDate: new Date('2026-08-31'),
              status: 'DRAFT',
              createdByMembershipId: membershipB.id,
              updatedByMembershipId: membershipB.id,
            },
          }),
      ),
    ).rejects.toThrow(/row-level security/i);

    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await transaction.pdsVersion.update({
        where: { id: pdsA.id },
        data: { status: 'CERTIFIED' },
      });
    });
    await expect(
      withContext(
        app,
        {
          agencyId: agencyA.id,
          userId: user.id,
          membershipId: membershipA.id,
          pdsMutation: true,
        },
        (transaction) =>
          transaction.pdsFamilyRecord.deleteMany({ where: { pdsVersionId: pdsA.id } }),
      ),
    ).rejects.toThrow(/immutable/i);
    await expect(
      withContext(
        app,
        {
          agencyId: agencyA.id,
          userId: user.id,
          membershipId: membershipA.id,
          pdsMutation: true,
        },
        (transaction) =>
          transaction.pdsEducationRecord.deleteMany({ where: { pdsVersionId: pdsA.id } }),
      ),
    ).rejects.toThrow(/immutable/i);
    await expect(
      withContext(
        app,
        {
          agencyId: agencyA.id,
          userId: user.id,
          membershipId: membershipA.id,
          pdsMutation: true,
        },
        (transaction) =>
          transaction.pdsEligibilityRecord.deleteMany({ where: { pdsVersionId: pdsA.id } }),
      ),
    ).rejects.toThrow(/immutable/i);
  } finally {
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await transaction.pdsEligibilityRecord.deleteMany({
        where: { pdsVersion: { agencyId: { in: [agencyA.id, agencyB.id] } } },
      });
      await transaction.pdsEducationRecord.deleteMany({
        where: { pdsVersion: { agencyId: { in: [agencyA.id, agencyB.id] } } },
      });
      await transaction.pdsFamilyRecord.deleteMany({
        where: { pdsVersion: { agencyId: { in: [agencyA.id, agencyB.id] } } },
      });
      await transaction.pdsPersonalDetails.deleteMany({
        where: { agencyId: { in: [agencyA.id, agencyB.id] } },
      });
      await transaction.pdsVersion.deleteMany({
        where: { agencyId: { in: [agencyA.id, agencyB.id] } },
      });
      await transaction.agencyMembership.deleteMany({
        where: { agencyId: { in: [agencyA.id, agencyB.id] } },
      });
      await transaction.employee.deleteMany({
        where: { agencyId: { in: [agencyA.id, agencyB.id] } },
      });
    });
    await admin.agency.deleteMany({ where: { id: { in: [agencyA.id, agencyB.id] } } });
    await admin.user.delete({ where: { id: user.id } });
    await app.$disconnect();
    await admin.$disconnect();
  }
});

it.skipIf(!enabled)(
  'isolates PDS work history rows and enforces WES and evidence integrity',
  async () => {
    const runtimeUrl = process.env.DATABASE_URL;
    if (!runtimeUrl) throw new Error('DATABASE_URL is required for the integration test.');
    const app = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
    const admin = await adminClient();

    expect(await workHistoryTablesReady(admin)).toBe(true);

    const suffix = `${Date.now()}-pds-work-history`;
    const agencyA = await admin.agency.create({
      data: {
        code: `PDS-WORK-A-${suffix}`,
        name: 'PDS Work Agency A',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const agencyB = await admin.agency.create({
      data: {
        code: `PDS-WORK-B-${suffix}`,
        name: 'PDS Work Agency B',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const user = await admin.user.create({
      data: {
        identityProvider: 'pds-work-rls-e2e',
        externalSubject: `pds-work-${suffix}`,
        emailNormalized: `pds-work-${suffix}@example.test`,
        displayName: 'PDS Work RLS User',
        globalStatus: 'ACTIVE',
      },
    });
    const membershipA = await admin.agencyMembership.create({
      data: { agencyId: agencyA.id, userId: user.id, status: 'ACTIVE' },
    });
    const membershipB = await admin.agencyMembership.create({
      data: { agencyId: agencyB.id, userId: user.id, status: 'ACTIVE' },
    });
    const employeeA = await admin.employee.create({
      data: {
        agencyId: agencyA.id,
        employeeNumber: `PDS-WORK-A-${suffix}`,
        legalName: 'PDS Work Agency A Employee',
        birthDate: new Date('1990-01-01'),
        sex: 'FEMALE',
        civilStatus: 'SINGLE',
        contactEmail: `pds-work-a-${suffix}@example.test`,
        createdByMembershipId: membershipA.id,
        updatedByMembershipId: membershipA.id,
      },
    });
    const employeeB = await admin.employee.create({
      data: {
        agencyId: agencyB.id,
        employeeNumber: `PDS-WORK-B-${suffix}`,
        legalName: 'PDS Work Agency B Employee',
        birthDate: new Date('1991-01-01'),
        sex: 'MALE',
        civilStatus: 'SINGLE',
        contactEmail: `pds-work-b-${suffix}@example.test`,
        createdByMembershipId: membershipB.id,
        updatedByMembershipId: membershipB.id,
      },
    });
    const evidenceA = await createEvidenceDocument(admin, {
      agencyId: agencyA.id,
      membershipId: membershipA.id,
      suffix,
      label: 'A',
    });
    const evidenceB = await createEvidenceDocument(admin, {
      agencyId: agencyB.id,
      membershipId: membershipB.id,
      suffix,
      label: 'B',
    });
    const pdsB = await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      const version = await transaction.pdsVersion.create({
        data: {
          agencyId: agencyB.id,
          employeeId: employeeB.id,
          versionNo: 1,
          formVersion: 'CS_FORM_212_REVISED_2026',
          asOfDate: new Date('2026-08-31'),
          status: 'DRAFT',
          createdByMembershipId: membershipB.id,
          updatedByMembershipId: membershipB.id,
        },
      });
      await transaction.pdsPersonalDetails.create({
        data: { agencyId: agencyB.id, pdsVersionId: version.id, surname: 'Foreign' },
      });
      return version;
    });

    try {
      const pdsA = await withContext(
        app,
        {
          agencyId: agencyA.id,
          userId: user.id,
          membershipId: membershipA.id,
          pdsMutation: true,
        },
        async (transaction) => {
          const version = await transaction.pdsVersion.create({
            data: {
              agencyId: agencyA.id,
              employeeId: employeeA.id,
              versionNo: 1,
              formVersion: 'CS_FORM_212_REVISED_2026',
              asOfDate: new Date('2026-08-31'),
              status: 'DRAFT',
              createdByMembershipId: membershipA.id,
              updatedByMembershipId: membershipA.id,
            },
          });
          await transaction.pdsPersonalDetails.create({
            data: { agencyId: agencyA.id, pdsVersionId: version.id, surname: 'Local' },
          });
          return version;
        },
      );

      const localRows = await withContext(
        app,
        {
          agencyId: agencyA.id,
          userId: user.id,
          membershipId: membershipA.id,
          pdsMutation: true,
        },
        async (transaction) => {
          const workExperienceId = await insertWorkExperience(transaction, {
            agencyId: agencyA.id,
            pdsVersionId: pdsA.id,
            sequenceNo: 1,
            inclusiveFrom: new Date('2018-01-01'),
            inclusiveTo: new Date('2020-12-31'),
            positionTitle: 'Personnel Officer I',
            departmentAgencyOfficeCompany: 'Lingkod HR Office',
            monthlySalary: 21877,
            salaryGradeStep: '24-2',
            appointmentStatus: 'PERMANENT',
            governmentService: 'Y',
            documentId: evidenceA.document.id,
            documentVersionId: evidenceA.version.id,
          });
          const secondWorkExperienceId = await insertWorkExperience(transaction, {
            agencyId: agencyA.id,
            pdsVersionId: pdsA.id,
            sequenceNo: 2,
            inclusiveFrom: new Date('2015-01-01'),
            inclusiveTo: new Date('2017-12-31'),
            positionTitle: 'Administrative Aide',
            departmentAgencyOfficeCompany: 'Records Division',
            monthlySalary: 15000,
            salaryGradeStep: '10-1',
            appointmentStatus: 'CASUAL',
            governmentService: 'Y',
          });
          const voluntaryWorkId = await insertVoluntaryWork(transaction, {
            agencyId: agencyA.id,
            pdsVersionId: pdsA.id,
            sequenceNo: 1,
            organizationNameAddress: 'Barangay Council, Manila',
            inclusiveFrom: new Date('2021-01-01'),
            inclusiveTo: new Date('2021-06-30'),
            hours: 24,
            positionNatureOfWork: 'Coordinator',
            documentId: evidenceA.document.id,
            documentVersionId: evidenceA.version.id,
          });
          const learningDevelopmentId = await insertLearningDevelopment(transaction, {
            agencyId: agencyA.id,
            pdsVersionId: pdsA.id,
            sequenceNo: 1,
            interventionTitle: 'Records Management Workshop',
            attendanceFrom: new Date('2022-03-01'),
            attendanceTo: new Date('2022-03-03'),
            hours: 16,
            type: 'Technical',
            conductedSponsoredBy: 'CSC',
            documentId: evidenceA.document.id,
            documentVersionId: evidenceA.version.id,
          });
          const wesArtifactId = await insertWesArtifact(transaction, {
            agencyId: agencyA.id,
            employeeId: employeeA.id,
            pdsVersionId: pdsA.id,
            contextKey: `VACANCY-${suffix}`,
            documentId: evidenceA.document.id,
            documentVersionId: evidenceA.version.id,
          });
          const wesEntryId = await insertWesEntry(transaction, {
            agencyId: agencyA.id,
            wesArtifactId,
            pdsVersionId: pdsA.id,
            workExperienceId,
            sequenceNo: 1,
            durationText: 'Jan 2018 - Dec 2020',
            position: 'Personnel Officer I',
            officeUnit: 'Lingkod HR Office',
            immediateSupervisor: 'Maria Santos',
            agencyOrganizationLocation: 'Lingkod HR, Manila',
            accomplishments: 'Digitized employee records.',
            actualDuties: 'Handled personnel records and reports.',
          });
          return {
            workExperienceId,
            secondWorkExperienceId,
            voluntaryWorkId,
            learningDevelopmentId,
            wesArtifactId,
            wesEntryId,
          };
        },
      );

      const foreignRows = await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        const workExperienceId = await insertWorkExperience(transaction, {
          agencyId: agencyB.id,
          pdsVersionId: pdsB.id,
          sequenceNo: 1,
          inclusiveFrom: new Date('2019-01-01'),
          inclusiveTo: new Date('2020-12-31'),
          positionTitle: 'Foreign Personnel Officer',
          departmentAgencyOfficeCompany: 'Foreign HR Office',
          monthlySalary: 20000,
          salaryGradeStep: '20-1',
          appointmentStatus: 'PERMANENT',
          governmentService: 'Y',
          documentId: evidenceB.document.id,
          documentVersionId: evidenceB.version.id,
        });
        const voluntaryWorkId = await insertVoluntaryWork(transaction, {
          agencyId: agencyB.id,
          pdsVersionId: pdsB.id,
          sequenceNo: 1,
          organizationNameAddress: 'Foreign NGO, Cebu',
          inclusiveFrom: new Date('2021-01-01'),
          inclusiveTo: new Date('2021-06-30'),
          hours: 40,
          positionNatureOfWork: 'Volunteer',
          documentId: evidenceB.document.id,
          documentVersionId: evidenceB.version.id,
        });
        const learningDevelopmentId = await insertLearningDevelopment(transaction, {
          agencyId: agencyB.id,
          pdsVersionId: pdsB.id,
          sequenceNo: 1,
          interventionTitle: 'Foreign HR Seminar',
          attendanceFrom: new Date('2023-02-01'),
          attendanceTo: new Date('2023-02-02'),
          hours: 8,
          type: 'Managerial',
          conductedSponsoredBy: 'Foreign CSC',
          documentId: evidenceB.document.id,
          documentVersionId: evidenceB.version.id,
        });
        const wesArtifactId = await insertWesArtifact(transaction, {
          agencyId: agencyB.id,
          employeeId: employeeB.id,
          pdsVersionId: pdsB.id,
          contextKey: `FOREIGN-${suffix}`,
          documentId: evidenceB.document.id,
          documentVersionId: evidenceB.version.id,
        });
        const wesEntryId = await insertWesEntry(transaction, {
          agencyId: agencyB.id,
          wesArtifactId,
          pdsVersionId: pdsB.id,
          workExperienceId,
          sequenceNo: 1,
          durationText: 'Jan 2019 - Dec 2020',
          position: 'Foreign Personnel Officer',
          officeUnit: 'Foreign HR Office',
          immediateSupervisor: 'Jose Reyes',
          agencyOrganizationLocation: 'Foreign HR, Cebu',
          actualDuties: 'Prepared personnel summaries.',
        });
        return {
          workExperienceId,
          voluntaryWorkId,
          learningDevelopmentId,
          wesArtifactId,
          wesEntryId,
        };
      });

      await withContext(
        app,
        { agencyId: agencyA.id, userId: user.id, membershipId: membershipA.id },
        async (transaction) => {
          expect(
            await countById(
              transaction,
              'pds_work_experience_records',
              foreignRows.workExperienceId,
            ),
          ).toBe(0);
          expect(
            await countById(transaction, 'pds_voluntary_work_records', foreignRows.voluntaryWorkId),
          ).toBe(0);
          expect(
            await countById(
              transaction,
              'pds_learning_development_records',
              foreignRows.learningDevelopmentId,
            ),
          ).toBe(0);
          expect(await countById(transaction, 'pds_wes_artifacts', foreignRows.wesArtifactId)).toBe(
            0,
          );
          expect(await countById(transaction, 'pds_wes_entries', foreignRows.wesEntryId)).toBe(0);
        },
      );

      await expect(
        withContext(
          app,
          {
            agencyId: agencyA.id,
            userId: user.id,
            membershipId: membershipA.id,
          },
          (transaction) =>
            insertWorkExperience(transaction, {
              agencyId: agencyA.id,
              pdsVersionId: pdsA.id,
              sequenceNo: 99,
              inclusiveFrom: new Date('2014-01-01'),
              inclusiveTo: new Date('2014-12-31'),
              positionTitle: 'Blocked Insert',
              departmentAgencyOfficeCompany: 'Blocked Office',
              governmentService: 'Y',
            }),
        ),
      ).rejects.toThrow(/application service|section rows/i);

      await expect(
        withContext(
          app,
          {
            agencyId: agencyA.id,
            userId: user.id,
            membershipId: membershipA.id,
            pdsMutation: true,
          },
          (transaction) =>
            insertWorkExperience(transaction, {
              agencyId: agencyB.id,
              pdsVersionId: pdsB.id,
              sequenceNo: 2,
              inclusiveFrom: new Date('2013-01-01'),
              inclusiveTo: new Date('2013-12-31'),
              positionTitle: 'Cross Agency Write',
              departmentAgencyOfficeCompany: 'Foreign Office',
              governmentService: 'Y',
            }),
        ),
      ).rejects.toThrow(/row-level security|immutable/i);

      await expect(
        withContext(
          app,
          {
            agencyId: agencyA.id,
            userId: user.id,
            membershipId: membershipA.id,
            pdsMutation: true,
          },
          (transaction) =>
            insertWorkExperience(transaction, {
              agencyId: agencyA.id,
              pdsVersionId: pdsA.id,
              sequenceNo: 1,
              inclusiveFrom: new Date('2014-01-01'),
              inclusiveTo: new Date('2014-12-31'),
              positionTitle: 'Duplicate Work Sequence',
              departmentAgencyOfficeCompany: 'Local Office',
              governmentService: 'Y',
            }),
        ),
      ).rejects.toThrow(/unique/i);

      await expect(
        withContext(
          app,
          {
            agencyId: agencyA.id,
            userId: user.id,
            membershipId: membershipA.id,
            pdsMutation: true,
          },
          (transaction) =>
            insertWorkExperience(transaction, {
              agencyId: agencyA.id,
              pdsVersionId: pdsA.id,
              sequenceNo: 9,
              inclusiveFrom: new Date('2024-02-01'),
              inclusiveTo: new Date('2024-01-01'),
              positionTitle: 'Invalid Work Dates',
              departmentAgencyOfficeCompany: 'Local Office',
              governmentService: 'Y',
            }),
        ),
      ).rejects.toThrow(/date|range|check/i);

      await expect(
        withContext(
          app,
          {
            agencyId: agencyA.id,
            userId: user.id,
            membershipId: membershipA.id,
            pdsMutation: true,
          },
          (transaction) =>
            transaction.$executeRaw`
              UPDATE "pds_wes_artifacts"
              SET "status" = 'CERTIFIED'
              WHERE "id" = ${localRows.wesArtifactId}::uuid
            `,
        ),
      ).rejects.toThrow(/status|completion/i);

      await expect(
        withContext(
          app,
          {
            agencyId: agencyA.id,
            userId: user.id,
            membershipId: membershipA.id,
            pdsMutation: true,
          },
          (transaction) =>
            insertVoluntaryWork(transaction, {
              agencyId: agencyA.id,
              pdsVersionId: pdsA.id,
              sequenceNo: 1,
              organizationNameAddress: 'Duplicate Volunteer Org',
              inclusiveFrom: new Date('2021-07-01'),
              inclusiveTo: new Date('2021-12-31'),
              hours: 12,
              positionNatureOfWork: 'Volunteer',
            }),
        ),
      ).rejects.toThrow(/unique/i);

      await expect(
        withContext(
          app,
          {
            agencyId: agencyA.id,
            userId: user.id,
            membershipId: membershipA.id,
            pdsMutation: true,
          },
          (transaction) =>
            insertVoluntaryWork(transaction, {
              agencyId: agencyA.id,
              pdsVersionId: pdsA.id,
              sequenceNo: 9,
              organizationNameAddress: 'Invalid Volunteer Hours',
              inclusiveFrom: new Date('2021-07-01'),
              inclusiveTo: new Date('2021-12-31'),
              hours: -1,
              positionNatureOfWork: 'Volunteer',
            }),
        ),
      ).rejects.toThrow(/hours|check/i);

      await expect(
        withContext(
          app,
          {
            agencyId: agencyA.id,
            userId: user.id,
            membershipId: membershipA.id,
            pdsMutation: true,
          },
          (transaction) =>
            insertLearningDevelopment(transaction, {
              agencyId: agencyA.id,
              pdsVersionId: pdsA.id,
              sequenceNo: 1,
              interventionTitle: 'Duplicate L&D Sequence',
              attendanceFrom: new Date('2022-05-01'),
              attendanceTo: new Date('2022-05-02'),
              hours: 8,
              type: 'Technical',
              conductedSponsoredBy: 'CSC',
            }),
        ),
      ).rejects.toThrow(/unique/i);

      await expect(
        withContext(
          app,
          {
            agencyId: agencyA.id,
            userId: user.id,
            membershipId: membershipA.id,
            pdsMutation: true,
          },
          (transaction) =>
            insertWesEntry(transaction, {
              agencyId: agencyA.id,
              wesArtifactId: localRows.wesArtifactId,
              pdsVersionId: pdsA.id,
              workExperienceId: localRows.secondWorkExperienceId,
              sequenceNo: 1,
              durationText: 'January 2018 - December 2020',
              position: 'Duplicate WES Sequence',
              officeUnit: 'Lingkod HR Office',
              immediateSupervisor: 'Maria Santos',
              agencyOrganizationLocation: 'Lingkod HR, Manila',
              actualDuties: 'Prepared reports.',
            }),
        ),
      ).rejects.toThrow(/unique/i);

      await expect(
        withContext(
          app,
          {
            agencyId: agencyA.id,
            userId: user.id,
            membershipId: membershipA.id,
            pdsMutation: true,
          },
          (transaction) =>
            insertWesEntry(transaction, {
              agencyId: agencyA.id,
              wesArtifactId: localRows.wesArtifactId,
              pdsVersionId: pdsA.id,
              workExperienceId: localRows.workExperienceId,
              sequenceNo: 2,
              durationText: 'January 2021 - December 2022',
              position: 'Duplicate WES Parent',
              officeUnit: 'Lingkod HR Office',
              immediateSupervisor: 'Maria Santos',
              agencyOrganizationLocation: 'Lingkod HR, Manila',
              actualDuties: 'Prepared reports.',
            }),
        ),
      ).rejects.toThrow(/unique/i);

      await expect(
        withContext(
          app,
          {
            agencyId: agencyA.id,
            userId: user.id,
            membershipId: membershipA.id,
            pdsMutation: true,
          },
          (transaction) =>
            insertWesEntry(transaction, {
              agencyId: agencyA.id,
              wesArtifactId: localRows.wesArtifactId,
              pdsVersionId: pdsA.id,
              workExperienceId: localRows.secondWorkExperienceId,
              sequenceNo: 3,
              durationText: '   ',
              position: 'Blank WES Duration',
              officeUnit: 'Lingkod HR Office',
              immediateSupervisor: 'Maria Santos',
              agencyOrganizationLocation: 'Lingkod HR, Manila',
              actualDuties: 'Prepared reports.',
            }),
        ),
      ).rejects.toThrow(/duration|check/i);

      await expect(
        withContext(
          app,
          {
            agencyId: agencyA.id,
            userId: user.id,
            membershipId: membershipA.id,
            pdsMutation: true,
          },
          (transaction) =>
            insertLearningDevelopment(transaction, {
              agencyId: agencyA.id,
              pdsVersionId: pdsA.id,
              sequenceNo: 9,
              interventionTitle: 'Half Evidence Pair',
              attendanceFrom: new Date('2022-05-01'),
              attendanceTo: new Date('2022-05-02'),
              hours: 8,
              type: 'Technical',
              conductedSponsoredBy: 'CSC',
              documentId: evidenceA.document.id,
            }),
        ),
      ).rejects.toThrow(/evidence|document|check/i);

      const pdsAHistory = await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        const version = await transaction.pdsVersion.create({
          data: {
            agencyId: agencyA.id,
            employeeId: employeeA.id,
            versionNo: 2,
            formVersion: 'CS_FORM_212_REVISED_2026',
            asOfDate: new Date('2026-09-01'),
            status: 'CERTIFIED',
            createdByMembershipId: membershipA.id,
            updatedByMembershipId: membershipA.id,
          },
        });
        return version;
      });
      const historyWorkId = await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        return insertWorkExperience(transaction, {
          agencyId: agencyA.id,
          pdsVersionId: pdsAHistory.id,
          sequenceNo: 1,
          inclusiveFrom: new Date('2010-01-01'),
          inclusiveTo: new Date('2012-12-31'),
          positionTitle: 'Archived Work Row',
          departmentAgencyOfficeCompany: 'Archived Office',
          monthlySalary: 18000,
          salaryGradeStep: '12-1',
          appointmentStatus: 'PERMANENT',
          governmentService: 'Y',
        });
      });

      await expect(
        withContext(
          app,
          {
            agencyId: agencyA.id,
            userId: user.id,
            membershipId: membershipA.id,
            pdsMutation: true,
          },
          (transaction) =>
            insertWesEntry(transaction, {
              agencyId: agencyA.id,
              wesArtifactId: localRows.wesArtifactId,
              pdsVersionId: pdsA.id,
              workExperienceId: historyWorkId,
              sequenceNo: 3,
              durationText: 'January 2010 - December 2012',
              position: 'Cross Version Parent',
              officeUnit: 'Archived Office',
              immediateSupervisor: 'Juan Dela Cruz',
              agencyOrganizationLocation: 'Archived Agency, Manila',
              actualDuties: 'Archived duties.',
            }),
        ),
      ).rejects.toThrow(/foreign key|constraint/i);

      await expect(
        withContext(
          app,
          {
            agencyId: agencyA.id,
            userId: user.id,
            membershipId: membershipA.id,
            pdsMutation: true,
          },
          (transaction) =>
            insertLearningDevelopment(transaction, {
              agencyId: agencyA.id,
              pdsVersionId: pdsA.id,
              sequenceNo: 9,
              interventionTitle: 'Foreign Evidence Link',
              attendanceFrom: new Date('2022-09-01'),
              attendanceTo: new Date('2022-09-02'),
              hours: 8,
              type: 'Technical',
              conductedSponsoredBy: 'CSC',
              documentId: evidenceB.document.id,
              documentVersionId: evidenceB.version.id,
            }),
        ),
      ).rejects.toThrow(/foreign key|row-level security/i);

      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.pdsVersion.update({
          where: { id: pdsA.id },
          data: { status: 'CERTIFIED' },
        });
      });

      const pdsAEditable = await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        return transaction.pdsVersion.create({
          data: {
            agencyId: agencyA.id,
            employeeId: employeeA.id,
            versionNo: 3,
            formVersion: 'CS_FORM_212_REVISED_2026',
            asOfDate: new Date('2026-09-02'),
            status: 'DRAFT',
            createdByMembershipId: membershipA.id,
            updatedByMembershipId: membershipA.id,
          },
        });
      });

      await expect(
        withContext(
          app,
          {
            agencyId: agencyA.id,
            userId: user.id,
            membershipId: membershipA.id,
            pdsMutation: true,
          },
          (transaction) =>
            transaction.$executeRaw`
              UPDATE "pds_work_experience_records"
              SET "pds_version_id" = ${pdsAEditable.id}::uuid
              WHERE "id" = ${localRows.workExperienceId}::uuid
            `,
        ),
      ).rejects.toThrow(/immutable|ownership/i);

      await expect(
        withContext(
          app,
          {
            agencyId: agencyA.id,
            userId: user.id,
            membershipId: membershipA.id,
            pdsMutation: true,
          },
          (transaction) =>
            transaction.$executeRaw`
              UPDATE "pds_work_experience_records"
              SET "position_title" = 'Locked Title'
              WHERE "id" = ${localRows.workExperienceId}::uuid
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
            pdsMutation: true,
          },
          (transaction) =>
            transaction.$executeRaw`
              DELETE FROM "pds_voluntary_work_records"
              WHERE "id" = ${localRows.voluntaryWorkId}::uuid
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
            pdsMutation: true,
          },
          (transaction) =>
            transaction.$executeRaw`
              UPDATE "pds_learning_development_records"
              SET "intervention_title" = 'Locked Title'
              WHERE "id" = ${localRows.learningDevelopmentId}::uuid
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
            pdsMutation: true,
          },
          (transaction) =>
            transaction.$executeRaw`
              DELETE FROM "pds_wes_entries"
              WHERE "id" = ${localRows.wesEntryId}::uuid
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
            pdsMutation: true,
          },
          (transaction) =>
            transaction.$executeRaw`
              DELETE FROM "pds_wes_artifacts"
              WHERE "id" = ${localRows.wesArtifactId}::uuid
            `,
        ),
      ).rejects.toThrow(/immutable/i);
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await deleteByAgencyIds(transaction, 'pds_wes_entries', [agencyA.id, agencyB.id]);
        await deleteByAgencyIds(transaction, 'pds_wes_artifacts', [agencyA.id, agencyB.id]);
        await deleteByAgencyIds(transaction, 'pds_learning_development_records', [
          agencyA.id,
          agencyB.id,
        ]);
        await deleteByAgencyIds(transaction, 'pds_voluntary_work_records', [
          agencyA.id,
          agencyB.id,
        ]);
        await deleteByAgencyIds(transaction, 'pds_work_experience_records', [
          agencyA.id,
          agencyB.id,
        ]);
        await transaction.pdsPersonalDetails.deleteMany({
          where: { agencyId: { in: [agencyA.id, agencyB.id] } },
        });
        await transaction.pdsVersion.deleteMany({
          where: { agencyId: { in: [agencyA.id, agencyB.id] } },
        });
        await transaction.documentVersion.deleteMany({
          where: { agencyId: { in: [agencyA.id, agencyB.id] } },
        });
        await transaction.document.deleteMany({
          where: { agencyId: { in: [agencyA.id, agencyB.id] } },
        });
        await transaction.agencyMembership.deleteMany({
          where: { agencyId: { in: [agencyA.id, agencyB.id] } },
        });
        await transaction.employee.deleteMany({
          where: { agencyId: { in: [agencyA.id, agencyB.id] } },
        });
      });
      await admin.agency.deleteMany({ where: { id: { in: [agencyA.id, agencyB.id] } } });
      await admin.user.delete({ where: { id: user.id } });
      await app.$disconnect();
      await admin.$disconnect();
    }
  },
);
