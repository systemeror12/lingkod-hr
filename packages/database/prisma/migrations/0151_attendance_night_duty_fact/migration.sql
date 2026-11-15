-- Night duty is the worked expected-duty minutes of an Attendance Day inside
-- the statutory 18:00-06:00 night window (RA No. 11701). It is stored on the
-- Day like CTO minutes, so period lock reconciliation can compare the published
-- NIGHT_DUTY Attendance Payroll Fact with the Day total (#328, #659).
-- `statutory_night_window_minutes` keeps counting every worked minute in the
-- window, so its outside-schedule part stays a separate factual quantity.
ALTER TABLE "attendance_days"
  ADD COLUMN "night_duty_minutes" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "attendance_days_night_duty_minutes_check" CHECK (
    "night_duty_minutes" >= 0
    AND "night_duty_minutes" <= "statutory_night_window_minutes"
  );

ALTER TABLE "attendance_payroll_facts"
  DROP CONSTRAINT "attendance_payroll_facts_type_check",
  ADD CONSTRAINT "attendance_payroll_facts_type_check" CHECK (
    "fact_type" IN (
      'EXPECTED','WORKED','OFFICIAL_BUSINESS','OFFICIAL_TRAVEL','TRAINING',
      'APPROVED_ABSENCE','POSTED_LEAVE','CTO','TARDINESS','UNDERTIME','ABSENCE',
      'NIGHT_DUTY'
    )
  );
