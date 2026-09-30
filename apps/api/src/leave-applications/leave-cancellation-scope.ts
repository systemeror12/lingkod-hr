import { Prisma } from '@prisma/client';

export interface ApprovedAllocationLine {
  id: string;
  dateFrom: string;
  dateTo: string;
  quantity: string;
  unitCode: string;
}

export interface RequestedCancellationScope {
  allocationLineId: string;
  dateFrom: string;
  dateTo: string;
  quantity: string;
}

export interface CancellationScopePlan {
  allocationLineId: string;
  dateFrom: string;
  dateTo: string;
  quantity: string;
}

export class LeaveCancellationScopeError extends Error {}

function dayCount(dateFrom: string, dateTo: string): number {
  return (
    Math.round(
      (Date.parse(`${dateTo}T00:00:00Z`) - Date.parse(`${dateFrom}T00:00:00Z`)) / 86_400_000,
    ) + 1
  );
}

/**
 * Turns a cancellation request into exact scopes over the approved allocation
 * lines. A scope may only narrow a line: no added dates, no extra quantity, and
 * a partial scope keeps the retained period contiguous by including the line's
 * first or last date (decided in #220).
 */
export function planCancellationScopes(
  scopeType: 'WHOLE' | 'PARTIAL',
  lines: readonly ApprovedAllocationLine[],
  requested: readonly RequestedCancellationScope[] = [],
): CancellationScopePlan[] {
  if (scopeType === 'WHOLE') {
    return lines.map((line) => ({
      allocationLineId: line.id,
      dateFrom: line.dateFrom,
      dateTo: line.dateTo,
      quantity: line.quantity,
    }));
  }
  const byId = new Map(lines.map((line) => [line.id, line]));
  const seen = new Set<string>();
  return requested.map((scope) => {
    const line = byId.get(scope.allocationLineId);
    if (!line) {
      throw new LeaveCancellationScopeError(
        'A cancellation scope must name an approved allocation line of this Leave Application.',
      );
    }
    if (seen.has(line.id)) {
      throw new LeaveCancellationScopeError('An allocation line can be cancelled only once.');
    }
    seen.add(line.id);
    if (scope.dateFrom < line.dateFrom || scope.dateTo > line.dateTo) {
      throw new LeaveCancellationScopeError(
        'A cancellation scope cannot add dates outside the approved allocation line.',
      );
    }
    let quantity: Prisma.Decimal;
    try {
      quantity = new Prisma.Decimal(scope.quantity);
    } catch {
      throw new LeaveCancellationScopeError('Enter a valid cancelled quantity.');
    }
    const approved = new Prisma.Decimal(line.quantity);
    if (quantity.lessThanOrEqualTo(0) || quantity.greaterThan(approved)) {
      throw new LeaveCancellationScopeError(
        'A cancellation scope cannot exceed the approved allocation line quantity.',
      );
    }
    const coversWholeLine = scope.dateFrom === line.dateFrom && scope.dateTo === line.dateTo;
    if (coversWholeLine !== quantity.equals(approved)) {
      throw new LeaveCancellationScopeError(
        coversWholeLine
          ? 'A scope covering the whole allocation line cancels its full quantity.'
          : 'Cancelling the full line quantity requires the line’s whole date range.',
      );
    }
    if (!coversWholeLine && scope.dateFrom !== line.dateFrom && scope.dateTo !== line.dateTo) {
      throw new LeaveCancellationScopeError(
        'A partial scope must include the first or last date of its allocation line.',
      );
    }
    const days = dayCount(scope.dateFrom, scope.dateTo);
    const dayUnit = line.unitCode === 'CALENDAR_DAY' || line.unitCode === 'WORKING_DAY';
    if (
      dayUnit &&
      (line.unitCode === 'CALENDAR_DAY' ? !quantity.equals(days) : quantity.greaterThan(days))
    ) {
      throw new LeaveCancellationScopeError(
        'The cancelled quantity does not fit the cancelled dates.',
      );
    }
    return {
      allocationLineId: line.id,
      dateFrom: scope.dateFrom,
      dateTo: scope.dateTo,
      quantity: quantity.toFixed(4),
    };
  });
}
