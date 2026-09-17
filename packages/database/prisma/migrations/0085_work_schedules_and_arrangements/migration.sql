-- Phase 7 Attendance configuration.
--
-- Stable Work Schedules and Work Arrangements own immutable, authority-backed
-- versions. A Work Schedule Version carries exactly seven Day Rules with ordered
-- unpaid break intervals. Holiday Calendar stable identity is created here because a
-- Work Arrangement Version selects one stable scoped calendar; calendar versions,
-- entries, and Schedule Assignments follow in the next migration.
--
-- There is no grace or rounding column: Event Collection Windows are explicit
-- whole-minute offsets on each Day Rule and never act as grace or rounding rules.

CREATE TABLE "work_schedules" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "code" CITEXT NOT NULL,
  "name" TEXT NOT NULL,
  "current_version_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "work_schedules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "work_schedules_code_check" CHECK (length(btrim("code"::text)) > 0),
  CONSTRAINT "work_schedules_name_check" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "work_schedules_agency_fkey" FOREIGN KEY ("agency_id")
    REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "work_schedules_agency_code_key" UNIQUE ("agency_id", "code"),
  CONSTRAINT "work_schedules_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE TABLE "work_schedule_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "work_schedule_id" UUID NOT NULL,
  "version_no" INTEGER NOT NULL,
  "schedule_type" TEXT NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Manila',
  "holiday_effect_rules" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "authority_document_version_id" UUID,
  "approving_authority" TEXT,
  "status" TEXT NOT NULL,
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "activated_by_membership_id" UUID,
  "activated_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "work_schedule_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "work_schedule_versions_version_no_check" CHECK ("version_no" > 0),
  CONSTRAINT "work_schedule_versions_schedule_type_check" CHECK (
    "schedule_type" IN ('REGULAR', 'FLEXIBLE', 'SHIFT', 'COMPRESSED')
  ),
  CONSTRAINT "work_schedule_versions_timezone_check" CHECK (length(btrim("timezone")) > 0),
  CONSTRAINT "work_schedule_versions_holiday_effect_rules_check" CHECK (
    jsonb_typeof("holiday_effect_rules") = 'object'
  ),
  CONSTRAINT "work_schedule_versions_status_check" CHECK (
    "status" IN ('DRAFT', 'ACTIVE', 'SUPERSEDED')
  ),
  CONSTRAINT "work_schedule_versions_effective_period_check" CHECK (
    "effective_to" IS NULL OR "effective_to" >= "effective_from"
  ),
  CONSTRAINT "work_schedule_versions_approving_authority_check" CHECK (
    "approving_authority" IS NULL OR length(btrim("approving_authority")) > 0
  ),
  CONSTRAINT "work_schedule_versions_activated_evidence_check" CHECK (
    "status" = 'DRAFT' OR (
      "authority_document_version_id" IS NOT NULL
      AND "approving_authority" IS NOT NULL
      AND "activated_by_membership_id" IS NOT NULL
      AND "activated_at" IS NOT NULL
    )
  ),
  CONSTRAINT "work_schedule_versions_schedule_fkey" FOREIGN KEY ("agency_id", "work_schedule_id")
    REFERENCES "work_schedules"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "work_schedule_versions_authority_fkey" FOREIGN KEY ("agency_id", "authority_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "work_schedule_versions_activator_fkey" FOREIGN KEY ("agency_id", "activated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "work_schedule_versions_version_key" UNIQUE ("work_schedule_id", "version_no"),
  CONSTRAINT "work_schedule_versions_agency_id_key" UNIQUE ("agency_id", "id")
);

ALTER TABLE "work_schedule_versions"
  ADD CONSTRAINT "work_schedule_versions_effective_excl"
  EXCLUDE USING gist (
    "work_schedule_id" WITH =,
    daterange("effective_from", COALESCE("effective_to", 'infinity'::date), '[]') WITH &&
  ) WHERE ("status" = 'ACTIVE');

CREATE INDEX "work_schedule_versions_schedule_status_idx"
  ON "work_schedule_versions" ("agency_id", "work_schedule_id", "status");
CREATE INDEX "work_schedule_versions_effective_idx"
  ON "work_schedule_versions" ("agency_id", "effective_from");

CREATE TABLE "work_schedule_day_rules" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "work_schedule_version_id" UUID NOT NULL,
  "weekday" SMALLINT NOT NULL,
  "rule_type" TEXT NOT NULL,
  "duty_start_time" TIME(6),
  "earliest_start_time" TIME(6),
  "latest_start_time" TIME(6),
  "duty_end_time" TIME(6),
  "end_next_calendar_day" BOOLEAN NOT NULL DEFAULT FALSE,
  "required_minutes" INTEGER NOT NULL,
  "core_start_time" TIME(6),
  "core_end_time" TIME(6),
  "event_pattern" TEXT NOT NULL,
  "collection_before_minutes" INTEGER NOT NULL,
  "collection_after_minutes" INTEGER NOT NULL,
  CONSTRAINT "work_schedule_day_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "work_schedule_day_rules_weekday_check" CHECK ("weekday" BETWEEN 1 AND 7),
  CONSTRAINT "work_schedule_day_rules_rule_type_check" CHECK (
    "rule_type" IN ('REST', 'FIXED', 'FLEXIBLE')
  ),
  CONSTRAINT "work_schedule_day_rules_event_pattern_check" CHECK (
    "event_pattern" IN ('IN_OUT', 'WITH_BREAK_EVENTS')
  ),
  CONSTRAINT "work_schedule_day_rules_required_minutes_check" CHECK ("required_minutes" >= 0),
  CONSTRAINT "work_schedule_day_rules_collection_offsets_check" CHECK (
    "collection_before_minutes" >= 0 AND "collection_after_minutes" >= 0
  ),
  CONSTRAINT "work_schedule_day_rules_rule_fields_check" CHECK (
    (
      "rule_type" = 'REST'
      AND "duty_start_time" IS NULL
      AND "duty_end_time" IS NULL
      AND "earliest_start_time" IS NULL
      AND "latest_start_time" IS NULL
      AND "core_start_time" IS NULL
      AND "core_end_time" IS NULL
      AND "required_minutes" = 0
    )
    OR (
      "rule_type" = 'FIXED'
      AND "duty_start_time" IS NOT NULL
      AND "duty_end_time" IS NOT NULL
      AND "earliest_start_time" IS NULL
      AND "latest_start_time" IS NULL
      AND "core_start_time" IS NULL
      AND "core_end_time" IS NULL
      AND "required_minutes" > 0
    )
    OR (
      "rule_type" = 'FLEXIBLE'
      AND "duty_start_time" IS NULL
      AND "duty_end_time" IS NOT NULL
      AND "earliest_start_time" IS NOT NULL
      AND "latest_start_time" IS NOT NULL
      AND "required_minutes" > 0
    )
  ),
  CONSTRAINT "work_schedule_day_rules_window_order_check" CHECK (
    ("rule_type" <> 'FLEXIBLE' OR "earliest_start_time" < "latest_start_time")
    AND ("core_start_time" IS NULL) = ("core_end_time" IS NULL)
    AND (
      "duty_start_time" IS NULL
      OR "duty_end_time" IS NULL
      OR (
        (NOT "end_next_calendar_day" AND "duty_end_time" > "duty_start_time")
        OR ("end_next_calendar_day" AND "duty_end_time" <= "duty_start_time")
      )
    )
    AND (
      "latest_start_time" IS NULL
      OR "duty_end_time" IS NULL
      OR (
        (NOT "end_next_calendar_day" AND "duty_end_time" > "latest_start_time")
        OR ("end_next_calendar_day" AND "duty_end_time" <= "latest_start_time")
      )
    )
    AND (
      "core_start_time" IS NULL
      OR "core_end_time" IS NULL
      OR (
        (NOT "end_next_calendar_day" AND "core_end_time" > "core_start_time")
        OR ("end_next_calendar_day" AND "core_end_time" <= "core_start_time")
      )
    )
  ),
  CONSTRAINT "work_schedule_day_rules_rest_collection_check" CHECK (
    "rule_type" <> 'REST'
    OR ("event_pattern" = 'IN_OUT'
      AND "collection_before_minutes" = 0
      AND "collection_after_minutes" = 0)
  ),
  CONSTRAINT "work_schedule_day_rules_version_fkey" FOREIGN KEY ("agency_id", "work_schedule_version_id")
    REFERENCES "work_schedule_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "work_schedule_day_rules_weekday_key" UNIQUE ("work_schedule_version_id", "weekday"),
  CONSTRAINT "work_schedule_day_rules_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE TABLE "work_schedule_break_intervals" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "day_rule_id" UUID NOT NULL,
  "sequence_no" INTEGER NOT NULL,
  "break_start_time" TIME(6) NOT NULL,
  "break_end_time" TIME(6) NOT NULL,
  "end_next_calendar_day" BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT "work_schedule_break_intervals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "work_schedule_break_intervals_sequence_no_check" CHECK ("sequence_no" > 0),
  CONSTRAINT "work_schedule_break_intervals_order_check" CHECK (
    (NOT "end_next_calendar_day" AND "break_end_time" > "break_start_time")
    OR ("end_next_calendar_day" AND "break_end_time" <= "break_start_time")
  ),
  CONSTRAINT "work_schedule_break_intervals_day_rule_fkey" FOREIGN KEY ("agency_id", "day_rule_id")
    REFERENCES "work_schedule_day_rules"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "work_schedule_break_intervals_sequence_key" UNIQUE ("day_rule_id", "sequence_no"),
  CONSTRAINT "work_schedule_break_intervals_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE TABLE "holiday_calendars" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "code" CITEXT NOT NULL,
  "name" TEXT NOT NULL,
  "scope_type" TEXT NOT NULL,
  "scope_reference" TEXT NOT NULL,
  "current_version_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "holiday_calendars_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "holiday_calendars_code_check" CHECK (length(btrim("code"::text)) > 0),
  CONSTRAINT "holiday_calendars_name_check" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "holiday_calendars_scope_type_check" CHECK (
    "scope_type" IN ('AGENCY', 'OFFICE', 'WORKSITE')
  ),
  CONSTRAINT "holiday_calendars_scope_reference_check" CHECK (
    length(btrim("scope_reference")) > 0
  ),
  CONSTRAINT "holiday_calendars_agency_fkey" FOREIGN KEY ("agency_id")
    REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "holiday_calendars_agency_code_key" UNIQUE ("agency_id", "code"),
  CONSTRAINT "holiday_calendars_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE TABLE "work_arrangements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "code" CITEXT NOT NULL,
  "name" TEXT NOT NULL,
  "current_version_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "work_arrangements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "work_arrangements_code_check" CHECK (length(btrim("code"::text)) > 0),
  CONSTRAINT "work_arrangements_name_check" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "work_arrangements_agency_fkey" FOREIGN KEY ("agency_id")
    REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "work_arrangements_agency_code_key" UNIQUE ("agency_id", "code"),
  CONSTRAINT "work_arrangements_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE TABLE "work_arrangement_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "work_arrangement_id" UUID NOT NULL,
  "version_no" INTEGER NOT NULL,
  "arrangement_type" TEXT NOT NULL,
  "permitted_schedule_types" JSONB NOT NULL,
  "holiday_calendar_id" UUID NOT NULL,
  "authority_document_version_id" UUID,
  "approving_authority" TEXT,
  "status" TEXT NOT NULL,
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "activated_by_membership_id" UUID,
  "activated_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "work_arrangement_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "work_arrangement_versions_version_no_check" CHECK ("version_no" > 0),
  CONSTRAINT "work_arrangement_versions_arrangement_type_check" CHECK (
    "arrangement_type" IN ('ONSITE', 'WORK_FROM_HOME', 'HYBRID', 'FIELD', 'OTHER')
  ),
  CONSTRAINT "work_arrangement_versions_permitted_types_check" CHECK (
    jsonb_typeof("permitted_schedule_types") = 'array'
    AND jsonb_array_length("permitted_schedule_types") > 0
    AND "permitted_schedule_types" <@ '["REGULAR", "FLEXIBLE", "SHIFT", "COMPRESSED"]'::jsonb
  ),
  CONSTRAINT "work_arrangement_versions_status_check" CHECK (
    "status" IN ('DRAFT', 'ACTIVE', 'SUPERSEDED')
  ),
  CONSTRAINT "work_arrangement_versions_effective_period_check" CHECK (
    "effective_to" IS NULL OR "effective_to" >= "effective_from"
  ),
  CONSTRAINT "work_arrangement_versions_approving_authority_check" CHECK (
    "approving_authority" IS NULL OR length(btrim("approving_authority")) > 0
  ),
  CONSTRAINT "work_arrangement_versions_activated_evidence_check" CHECK (
    "status" = 'DRAFT' OR (
      "authority_document_version_id" IS NOT NULL
      AND "approving_authority" IS NOT NULL
      AND "activated_by_membership_id" IS NOT NULL
      AND "activated_at" IS NOT NULL
    )
  ),
  CONSTRAINT "work_arrangement_versions_arrangement_fkey" FOREIGN KEY ("agency_id", "work_arrangement_id")
    REFERENCES "work_arrangements"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "work_arrangement_versions_holiday_calendar_fkey" FOREIGN KEY ("agency_id", "holiday_calendar_id")
    REFERENCES "holiday_calendars"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "work_arrangement_versions_authority_fkey" FOREIGN KEY ("agency_id", "authority_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "work_arrangement_versions_activator_fkey" FOREIGN KEY ("agency_id", "activated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "work_arrangement_versions_version_key" UNIQUE ("work_arrangement_id", "version_no"),
  CONSTRAINT "work_arrangement_versions_agency_id_key" UNIQUE ("agency_id", "id")
);

ALTER TABLE "work_arrangement_versions"
  ADD CONSTRAINT "work_arrangement_versions_effective_excl"
  EXCLUDE USING gist (
    "work_arrangement_id" WITH =,
    daterange("effective_from", COALESCE("effective_to", 'infinity'::date), '[]') WITH &&
  ) WHERE ("status" = 'ACTIVE');

CREATE INDEX "work_arrangement_versions_arrangement_status_idx"
  ON "work_arrangement_versions" ("agency_id", "work_arrangement_id", "status");
CREATE INDEX "work_arrangement_versions_effective_idx"
  ON "work_arrangement_versions" ("agency_id", "effective_from");
CREATE INDEX "work_schedule_day_rules_version_idx"
  ON "work_schedule_day_rules" ("agency_id", "work_schedule_version_id");
CREATE INDEX "work_schedule_break_intervals_day_rule_idx"
  ON "work_schedule_break_intervals" ("agency_id", "day_rule_id");

CREATE OR REPLACE FUNCTION guard_work_schedule_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  version_status TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Work Schedules are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."current_version_id" IS NOT NULL THEN
      RAISE EXCEPTION 'Work Schedules are created without a current version'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
    OR NEW."code" IS DISTINCT FROM OLD."code"
    OR NEW."name" IS DISTINCT FROM OLD."name"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'Work Schedule identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."current_version_id" IS NOT NULL THEN
    SELECT v."status" INTO version_status
    FROM "work_schedule_versions" v
    WHERE v."agency_id" = NEW."agency_id"
      AND v."id" = NEW."current_version_id"
      AND v."work_schedule_id" = NEW."id";
    IF version_status IS NULL OR version_status = 'DRAFT' THEN
      RAISE EXCEPTION 'Work Schedule current version must be a published version of the same schedule'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_work_schedule_version_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT'
      AND current_setting('app.work_schedule_transition', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'Work Schedule version transitions require the application service'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Work Schedule versions are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'SUPERSEDED' THEN
    RAISE EXCEPTION 'Superseded Work Schedule versions are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'DRAFT' AND NEW."status" = 'DRAFT' THEN
    IF NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
      OR NEW."work_schedule_id" IS DISTINCT FROM OLD."work_schedule_id"
      OR NEW."version_no" IS DISTINCT FROM OLD."version_no"
      OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
      RAISE EXCEPTION 'Draft Work Schedule version identity is immutable'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF current_setting('app.work_schedule_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Work Schedule version transitions require the application service'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'DRAFT' AND NEW."status" = 'ACTIVE' THEN
    IF NEW."authority_document_version_id" IS NULL
      OR NEW."approving_authority" IS NULL
      OR NEW."activated_by_membership_id" IS NULL
      OR NEW."activated_at" IS NULL
      OR NEW."effective_to" IS NOT NULL
      OR NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
      OR NEW."work_schedule_id" IS DISTINCT FROM OLD."work_schedule_id"
      OR NEW."version_no" IS DISTINCT FROM OLD."version_no"
      OR NEW."schedule_type" IS DISTINCT FROM OLD."schedule_type"
      OR NEW."timezone" IS DISTINCT FROM OLD."timezone"
      OR NEW."holiday_effect_rules" IS DISTINCT FROM OLD."holiday_effect_rules"
      OR NEW."effective_from" IS DISTINCT FROM OLD."effective_from"
      OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
      RAISE EXCEPTION 'Work Schedule activation must preserve the draft definition and carry authority evidence'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'ACTIVE' AND NEW."status" = 'SUPERSEDED' THEN
    IF NEW."effective_to" IS NULL
      OR NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
      OR NEW."work_schedule_id" IS DISTINCT FROM OLD."work_schedule_id"
      OR NEW."version_no" IS DISTINCT FROM OLD."version_no"
      OR NEW."schedule_type" IS DISTINCT FROM OLD."schedule_type"
      OR NEW."timezone" IS DISTINCT FROM OLD."timezone"
      OR NEW."holiday_effect_rules" IS DISTINCT FROM OLD."holiday_effect_rules"
      OR NEW."authority_document_version_id" IS DISTINCT FROM OLD."authority_document_version_id"
      OR NEW."approving_authority" IS DISTINCT FROM OLD."approving_authority"
      OR NEW."effective_from" IS DISTINCT FROM OLD."effective_from"
      OR NEW."activated_by_membership_id" IS DISTINCT FROM OLD."activated_by_membership_id"
      OR NEW."activated_at" IS DISTINCT FROM OLD."activated_at"
      OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
      RAISE EXCEPTION 'Work Schedule supersession may only close the effective period'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Unsupported Work Schedule version transition'
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION guard_work_schedule_day_rule_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  parent_status TEXT;
  parent_version_id UUID;
  parent_agency_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    parent_version_id := OLD."work_schedule_version_id";
    parent_agency_id := OLD."agency_id";
  ELSE
    parent_version_id := NEW."work_schedule_version_id";
    parent_agency_id := NEW."agency_id";
  END IF;
  SELECT v."status" INTO parent_status
  FROM "work_schedule_versions" v
  WHERE v."agency_id" = parent_agency_id
    AND v."id" = parent_version_id;
  IF parent_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'Day Rules may only change while the Work Schedule version is a draft'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
      OR NEW."work_schedule_version_id" IS DISTINCT FROM OLD."work_schedule_version_id"
      OR NEW."weekday" IS DISTINCT FROM OLD."weekday" THEN
      RAISE EXCEPTION 'Day Rule identity is immutable'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_work_schedule_break_interval_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  parent_status TEXT;
  parent_day_rule_id UUID;
  parent_agency_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    parent_day_rule_id := OLD."day_rule_id";
    parent_agency_id := OLD."agency_id";
  ELSE
    parent_day_rule_id := NEW."day_rule_id";
    parent_agency_id := NEW."agency_id";
  END IF;
  SELECT v."status" INTO parent_status
  FROM "work_schedule_day_rules" d
  JOIN "work_schedule_versions" v
    ON v."agency_id" = d."agency_id" AND v."id" = d."work_schedule_version_id"
  WHERE d."agency_id" = parent_agency_id
    AND d."id" = parent_day_rule_id;
  IF parent_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'Break intervals may only change while the Work Schedule version is a draft'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
      OR NEW."day_rule_id" IS DISTINCT FROM OLD."day_rule_id"
      OR NEW."sequence_no" IS DISTINCT FROM OLD."sequence_no" THEN
      RAISE EXCEPTION 'Break interval identity is immutable'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_holiday_calendar_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Holiday Calendars are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."current_version_id" IS NOT NULL THEN
      RAISE EXCEPTION 'Holiday Calendars are created without a current version'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
    OR NEW."code" IS DISTINCT FROM OLD."code"
    OR NEW."name" IS DISTINCT FROM OLD."name"
    OR NEW."scope_type" IS DISTINCT FROM OLD."scope_type"
    OR NEW."scope_reference" IS DISTINCT FROM OLD."scope_reference"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'Holiday Calendar identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_work_arrangement_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  version_status TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Work Arrangements are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."current_version_id" IS NOT NULL THEN
      RAISE EXCEPTION 'Work Arrangements are created without a current version'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
    OR NEW."code" IS DISTINCT FROM OLD."code"
    OR NEW."name" IS DISTINCT FROM OLD."name"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'Work Arrangement identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."current_version_id" IS NOT NULL THEN
    SELECT v."status" INTO version_status
    FROM "work_arrangement_versions" v
    WHERE v."agency_id" = NEW."agency_id"
      AND v."id" = NEW."current_version_id"
      AND v."work_arrangement_id" = NEW."id";
    IF version_status IS NULL OR version_status = 'DRAFT' THEN
      RAISE EXCEPTION 'Work Arrangement current version must be a published version of the same arrangement'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_work_arrangement_version_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT'
      AND current_setting('app.work_arrangement_transition', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'Work Arrangement version transitions require the application service'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Work Arrangement versions are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'SUPERSEDED' THEN
    RAISE EXCEPTION 'Superseded Work Arrangement versions are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'DRAFT' AND NEW."status" = 'DRAFT' THEN
    IF NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
      OR NEW."work_arrangement_id" IS DISTINCT FROM OLD."work_arrangement_id"
      OR NEW."version_no" IS DISTINCT FROM OLD."version_no"
      OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
      RAISE EXCEPTION 'Draft Work Arrangement version identity is immutable'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF current_setting('app.work_arrangement_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Work Arrangement version transitions require the application service'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'DRAFT' AND NEW."status" = 'ACTIVE' THEN
    IF NEW."authority_document_version_id" IS NULL
      OR NEW."approving_authority" IS NULL
      OR NEW."activated_by_membership_id" IS NULL
      OR NEW."activated_at" IS NULL
      OR NEW."effective_to" IS NOT NULL
      OR NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
      OR NEW."work_arrangement_id" IS DISTINCT FROM OLD."work_arrangement_id"
      OR NEW."version_no" IS DISTINCT FROM OLD."version_no"
      OR NEW."arrangement_type" IS DISTINCT FROM OLD."arrangement_type"
      OR NEW."permitted_schedule_types" IS DISTINCT FROM OLD."permitted_schedule_types"
      OR NEW."holiday_calendar_id" IS DISTINCT FROM OLD."holiday_calendar_id"
      OR NEW."effective_from" IS DISTINCT FROM OLD."effective_from"
      OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
      RAISE EXCEPTION 'Work Arrangement activation must preserve the draft definition and carry authority evidence'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'ACTIVE' AND NEW."status" = 'SUPERSEDED' THEN
    IF NEW."effective_to" IS NULL
      OR NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
      OR NEW."work_arrangement_id" IS DISTINCT FROM OLD."work_arrangement_id"
      OR NEW."version_no" IS DISTINCT FROM OLD."version_no"
      OR NEW."arrangement_type" IS DISTINCT FROM OLD."arrangement_type"
      OR NEW."permitted_schedule_types" IS DISTINCT FROM OLD."permitted_schedule_types"
      OR NEW."holiday_calendar_id" IS DISTINCT FROM OLD."holiday_calendar_id"
      OR NEW."authority_document_version_id" IS DISTINCT FROM OLD."authority_document_version_id"
      OR NEW."approving_authority" IS DISTINCT FROM OLD."approving_authority"
      OR NEW."effective_from" IS DISTINCT FROM OLD."effective_from"
      OR NEW."activated_by_membership_id" IS DISTINCT FROM OLD."activated_by_membership_id"
      OR NEW."activated_at" IS DISTINCT FROM OLD."activated_at"
      OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
      RAISE EXCEPTION 'Work Arrangement supersession may only close the effective period'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Unsupported Work Arrangement version transition'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "work_schedules_updated_at_trigger"
  BEFORE UPDATE ON "work_schedules"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_row_version();
CREATE TRIGGER "work_schedules_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "work_schedules"
  FOR EACH ROW EXECUTE FUNCTION guard_work_schedule_mutation();
CREATE TRIGGER "work_schedule_versions_updated_at_trigger"
  BEFORE UPDATE ON "work_schedule_versions"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_row_version();
CREATE TRIGGER "work_schedule_versions_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "work_schedule_versions"
  FOR EACH ROW EXECUTE FUNCTION guard_work_schedule_version_mutation();
CREATE TRIGGER "work_schedule_day_rules_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "work_schedule_day_rules"
  FOR EACH ROW EXECUTE FUNCTION guard_work_schedule_day_rule_mutation();
CREATE TRIGGER "work_schedule_break_intervals_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "work_schedule_break_intervals"
  FOR EACH ROW EXECUTE FUNCTION guard_work_schedule_break_interval_mutation();
CREATE TRIGGER "holiday_calendars_updated_at_trigger"
  BEFORE UPDATE ON "holiday_calendars"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_row_version();
CREATE TRIGGER "holiday_calendars_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "holiday_calendars"
  FOR EACH ROW EXECUTE FUNCTION guard_holiday_calendar_mutation();
CREATE TRIGGER "work_arrangements_updated_at_trigger"
  BEFORE UPDATE ON "work_arrangements"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_row_version();
CREATE TRIGGER "work_arrangements_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "work_arrangements"
  FOR EACH ROW EXECUTE FUNCTION guard_work_arrangement_mutation();
CREATE TRIGGER "work_arrangement_versions_updated_at_trigger"
  BEFORE UPDATE ON "work_arrangement_versions"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_row_version();
CREATE TRIGGER "work_arrangement_versions_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "work_arrangement_versions"
  FOR EACH ROW EXECUTE FUNCTION guard_work_arrangement_version_mutation();

GRANT SELECT, INSERT, UPDATE ON TABLE "work_schedules" TO hris_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "work_schedule_versions" TO hris_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "work_schedule_day_rules" TO hris_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "work_schedule_break_intervals" TO hris_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "holiday_calendars" TO hris_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "work_arrangements" TO hris_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "work_arrangement_versions" TO hris_app;

ALTER TABLE "work_schedules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "work_schedules" FORCE ROW LEVEL SECURITY;
ALTER TABLE "work_schedule_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "work_schedule_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "work_schedule_day_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "work_schedule_day_rules" FORCE ROW LEVEL SECURITY;
ALTER TABLE "work_schedule_break_intervals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "work_schedule_break_intervals" FORCE ROW LEVEL SECURITY;
ALTER TABLE "holiday_calendars" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "holiday_calendars" FORCE ROW LEVEL SECURITY;
ALTER TABLE "work_arrangements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "work_arrangements" FORCE ROW LEVEL SECURITY;
ALTER TABLE "work_arrangement_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "work_arrangement_versions" FORCE ROW LEVEL SECURITY;

CREATE POLICY "work_schedules_select" ON "work_schedules"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "work_schedules_insert" ON "work_schedules"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "work_schedules_update" ON "work_schedules"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "work_schedule_versions_select" ON "work_schedule_versions"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "work_schedule_versions_insert" ON "work_schedule_versions"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "work_schedule_versions_update" ON "work_schedule_versions"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "work_schedule_day_rules_select" ON "work_schedule_day_rules"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "work_schedule_day_rules_insert" ON "work_schedule_day_rules"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "work_schedule_day_rules_update" ON "work_schedule_day_rules"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "work_schedule_day_rules_delete" ON "work_schedule_day_rules"
  FOR DELETE USING ("agency_id" = app_agency_id());
CREATE POLICY "work_schedule_break_intervals_select" ON "work_schedule_break_intervals"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "work_schedule_break_intervals_insert" ON "work_schedule_break_intervals"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "work_schedule_break_intervals_update" ON "work_schedule_break_intervals"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "work_schedule_break_intervals_delete" ON "work_schedule_break_intervals"
  FOR DELETE USING ("agency_id" = app_agency_id());
CREATE POLICY "holiday_calendars_select" ON "holiday_calendars"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "holiday_calendars_insert" ON "holiday_calendars"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "holiday_calendars_update" ON "holiday_calendars"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "work_arrangements_select" ON "work_arrangements"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "work_arrangements_insert" ON "work_arrangements"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "work_arrangements_update" ON "work_arrangements"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "work_arrangement_versions_select" ON "work_arrangement_versions"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "work_arrangement_versions_insert" ON "work_arrangement_versions"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "work_arrangement_versions_update" ON "work_arrangement_versions"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('attendance.configuration.read', 'attendance', 'MEDIUM', 'Read Work Schedule, Work Arrangement, and Holiday Calendar configuration'),
  ('attendance.configuration.manage', 'attendance', 'HIGH', 'Maintain draft Work Schedule and Work Arrangement versions'),
  ('attendance.configuration.activate', 'attendance', 'CRITICAL', 'Activate Work Schedule and Work Arrangement versions')
ON CONFLICT ("code") DO NOTHING;

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'attendance.configuration.read',
  'attendance.configuration.manage',
  'attendance.configuration.activate'
)
WHERE r."code" = 'hrmo_administrator' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'attendance.configuration.read'
WHERE r."code" IN ('personnel_records_officer', 'payroll_preparer', 'internal_auditor')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
