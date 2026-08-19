-- Correction plan: retain this stricter published-period rule. If legacy data blocks deployment,
-- correct the conflicting periods explicitly, then rerun this migration rather than weakening or
-- deleting effective-dated history.

ALTER TABLE "organization_unit_versions"
  DROP CONSTRAINT "organization_unit_versions_active_no_overlap";

ALTER TABLE "organization_unit_versions"
  ADD CONSTRAINT "organization_unit_versions_published_no_overlap"
  EXCLUDE USING GIST (
    "agency_id" WITH =,
    "organization_unit_id" WITH =,
    DATERANGE(
      "effective_from",
      COALESCE("effective_to" + 1, 'infinity'::DATE),
      '[)'
    ) WITH &&
  ) WHERE ("status" IN ('ACTIVE', 'SUPERSEDED'));
