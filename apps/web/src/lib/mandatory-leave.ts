import type { StatusTone } from '../components/ui/status-tag';

/** The stored quantities of a Mandatory Leave Assessment that the list and detail views label. */
export interface AssessmentQuantities {
  result: string;
  requiredQuantity: string | null;
  fulfilledQuantity: string | null;
}

// Quantities are fixed four-place decimals; compare them as integers to avoid float drift.
function units(quantity: string): number {
  return Math.round(Number(quantity) * 10_000);
}

function isMet(assessment: AssessmentQuantities): boolean {
  return (
    assessment.result === 'SUBJECT' &&
    assessment.requiredQuantity !== null &&
    assessment.fulfilledQuantity !== null &&
    units(assessment.fulfilledQuantity) >= units(assessment.requiredQuantity)
  );
}

/** Label the stored result as recorded; a SUBJECT obligation already fulfilled reads as Met. */
export function obligationStatus(assessment: AssessmentQuantities | null): {
  label: string;
  tone: StatusTone;
} {
  if (assessment === null) return { label: 'Not yet evaluated', tone: 'neutral' };
  if (isMet(assessment)) return { label: 'Met', tone: 'success' };
  if (assessment.result === 'SUBJECT') return { label: 'SUBJECT', tone: 'warning' };
  if (assessment.result === 'INDETERMINATE') return { label: 'INDETERMINATE', tone: 'danger' };
  return { label: assessment.result, tone: 'neutral' };
}

/** Working days still to fulfill under a SUBJECT assessment, or `null` when none is owed. */
export function remainingQuantity(assessment: AssessmentQuantities): string | null {
  if (
    assessment.result !== 'SUBJECT' ||
    assessment.requiredQuantity === null ||
    assessment.fulfilledQuantity === null
  ) {
    return null;
  }
  const remaining = units(assessment.requiredQuantity) - units(assessment.fulfilledQuantity);
  return String(Math.max(remaining, 0) / 10_000);
}
