-- Phase 9 year-end tax adjustment (#633), as payroll-schema.md §9 has it. A
-- regular period of December, or the one in which an Employee's service ends,
-- withholds the difference between the annual table's tax on the year's
-- taxable compensation and the tax the year's finalized payrolls withheld
-- (BIR RR No. 11-2018 sec. 2.79(B)(5)(b)). The Tax Line stores that basis,
-- and its withholding tax is negative when the period refunds the excess.
ALTER TABLE "tax_lines" ADD COLUMN "year_end_adjustment" JSONB;

ALTER TABLE "tax_lines"
  ADD CONSTRAINT "tax_lines_year_end_adjustment_check"
    CHECK ("year_end_adjustment" IS NULL OR jsonb_typeof("year_end_adjustment") = 'object');

-- Only a year-end adjustment refunds.
ALTER TABLE "tax_lines" DROP CONSTRAINT "tax_lines_withholding_tax_check";
ALTER TABLE "tax_lines"
  ADD CONSTRAINT "tax_lines_withholding_tax_check"
    CHECK ("withholding_tax" >= 0 OR "year_end_adjustment" IS NOT NULL);

DO $$
BEGIN
  IF (
    SELECT count(*) FROM pg_constraint
    WHERE conrelid = 'tax_lines'::regclass
      AND conname IN ('tax_lines_year_end_adjustment_check', 'tax_lines_withholding_tax_check')
  ) <> 2 THEN
    RAISE EXCEPTION 'Tax line year-end adjustment verification failed';
  END IF;
END;
$$;

-- Rollback/correction: only through a reviewed forward migration; tax lines
-- are retained payroll history.
-- Verification: pnpm db:policies tax_lines
