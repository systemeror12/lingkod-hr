import { Prisma } from '@prisma/client';

export async function hasEligibleParentCoverage(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  parentUnitId: string,
  effectiveFrom: Date,
  effectiveTo: Date | null,
): Promise<boolean> {
  const [coverage] = await transaction.$queryRaw<{ isEligible: boolean }[]>`
    SELECT COALESCE(
      DATERANGE(
        ${effectiveFrom}::date,
        COALESCE(${effectiveTo}::date + 1, 'infinity'::date),
        '[)'
      ) <@ RANGE_AGG(
        DATERANGE(
          "effective_from",
          COALESCE("effective_to" + 1, 'infinity'::date),
          '[)'
        )
      ),
      false
    ) AS "isEligible"
    FROM "organization_unit_versions"
    WHERE "agency_id" = ${agencyId}::uuid
      AND "organization_unit_id" = ${parentUnitId}::uuid
      AND "status" IN ('ACTIVE', 'SUPERSEDED')
      AND "domain_status" = 'ACTIVE'
  `;
  return coverage?.isEligible ?? false;
}

export async function coverageEligibleParentIds(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  unitId: string,
  effectiveFrom: Date,
  effectiveTo: Date | null,
): Promise<string[]> {
  const records = await transaction.$queryRaw<{ id: string }[]>`
    SELECT "organization_unit_id" AS "id"
    FROM "organization_unit_versions"
    WHERE "agency_id" = ${agencyId}::uuid
      AND "organization_unit_id" <> ${unitId}::uuid
      AND "status" IN ('ACTIVE', 'SUPERSEDED')
      AND "domain_status" = 'ACTIVE'
    GROUP BY "organization_unit_id"
    HAVING DATERANGE(
      ${effectiveFrom}::date,
      COALESCE(${effectiveTo}::date + 1, 'infinity'::date),
      '[)'
    ) <@ RANGE_AGG(
      DATERANGE(
        "effective_from",
        COALESCE("effective_to" + 1, 'infinity'::date),
        '[)'
      )
    )
  `;
  return records.map(({ id }) => id);
}

export async function wouldCreateHierarchyCycle(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  unitId: string,
  parentUnitId: string,
  effectiveFrom: Date,
  effectiveTo: Date | null,
): Promise<boolean> {
  const [cycle] = await transaction.$queryRaw<{ hasCycle: boolean }[]>`
    WITH RECURSIVE parent_chain (unit_id, valid_from, valid_to, path, has_cycle) AS (
      SELECT
        ${parentUnitId}::uuid,
        ${effectiveFrom}::date,
        COALESCE(${effectiveTo}::date, 'infinity'::date),
        ARRAY[${unitId}::uuid, ${parentUnitId}::uuid],
        ${unitId}::uuid = ${parentUnitId}::uuid
      UNION ALL
      SELECT
        version."parent_unit_id",
        GREATEST(chain.valid_from, version."effective_from"),
        LEAST(chain.valid_to, COALESCE(version."effective_to", 'infinity'::date)),
        chain.path || version."parent_unit_id",
        version."parent_unit_id" = ANY(chain.path)
      FROM parent_chain chain
      JOIN "organization_unit_versions" version
        ON version."agency_id" = ${agencyId}::uuid
        AND version."organization_unit_id" = chain.unit_id
        AND version."status" IN ('ACTIVE', 'SUPERSEDED')
        AND version."parent_unit_id" IS NOT NULL
        AND version."effective_from" <= chain.valid_to
        AND COALESCE(version."effective_to", 'infinity'::date) >= chain.valid_from
      WHERE NOT chain.has_cycle
    )
    SELECT COALESCE(BOOL_OR(has_cycle), false) AS "hasCycle"
    FROM parent_chain
  `;
  return cycle?.hasCycle ?? false;
}
