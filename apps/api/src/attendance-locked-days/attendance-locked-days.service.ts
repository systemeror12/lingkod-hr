import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  AttendanceLockedDayError,
  toWorkDate,
  type LockedAttendanceDay,
  type LockedAttendanceDayResult,
} from './attendance-locked-days.types';

/**
 * Attendance's read of locked attendance facts for other modules. Overtime
 * reads Actual Overtime Hours only through here: it never reads Attendance
 * tables or Attendance Payroll Facts, which carry no outside-schedule minutes.
 */
@Injectable()
export class AttendanceLockedDaysService {
  /**
   * Read one Employee's locked facts for each Work Date inside a caller-owned
   * transaction, in the order given. Each date comes from the Attendance Day
   * version in the latest locked Attendance Period Version covering it, so a
   * Locked Attendance Adjustment's successor wins. A date without one is
   * `NOT_LOCKED`, never zero minutes. An Employee outside the Agency is refused.
   */
  async readInTransaction(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
    workDateValues: readonly string[],
  ): Promise<LockedAttendanceDayResult[]> {
    const workDates = [...new Set(workDateValues)];
    const dates = workDates.map(toWorkDate);
    const employee = await transaction.employee.findFirst({
      where: { agencyId, id: employeeId },
      select: { id: true },
    });
    if (!employee) {
      throw new AttendanceLockedDayError(
        'The Employee does not belong to this Agency.',
        404,
        'ATTENDANCE_LOCKED_DAY_EMPLOYEE_NOT_FOUND',
      );
    }
    if (dates.length === 0) return [];

    const sorted = [...dates].sort((left, right) => left.getTime() - right.getTime());
    const lockedVersions = await transaction.attendancePeriodVersion.findMany({
      where: {
        agencyId,
        status: 'LOCKED',
        attendancePeriod: {
          dateFrom: { lte: sorted[sorted.length - 1]! },
          dateTo: { gte: sorted[0]! },
        },
      },
      orderBy: [{ versionNo: 'desc' }, { id: 'asc' }],
      select: { id: true, attendancePeriodId: true },
    });
    const latestVersionIds = new Map<string, string>();
    for (const version of lockedVersions) {
      if (!latestVersionIds.has(version.attendancePeriodId)) {
        latestVersionIds.set(version.attendancePeriodId, version.id);
      }
    }
    const rows =
      latestVersionIds.size === 0
        ? []
        : await transaction.attendancePeriodVersionDay.findMany({
            where: {
              agencyId,
              attendancePeriodVersionId: { in: [...latestVersionIds.values()] },
              attendanceDay: { employeeId, workDate: { in: dates } },
            },
            select: {
              attendancePeriodVersionId: true,
              attendanceDay: {
                select: {
                  id: true,
                  workDate: true,
                  calculationVersion: true,
                  outsideScheduleMinutes: true,
                  officialTravelMinutes: true,
                  ruleSnapshot: true,
                  workArrangementVersion: { select: { id: true, arrangementType: true } },
                },
              },
            },
          });

    const dayRuleIds = [
      ...new Set(
        rows
          .map((row) => snapshotOf(row.attendanceDay.ruleSnapshot).dayRuleId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const dayRules = await transaction.workScheduleDayRule.findMany({
      where: { agencyId, id: { in: dayRuleIds } },
      select: { id: true, ruleType: true },
    });
    const ruleTypes = new Map(dayRules.map((rule) => [rule.id, rule.ruleType]));

    const lockedByDate = new Map<string, LockedAttendanceDay>();
    for (const row of rows) {
      const day = row.attendanceDay;
      const workDate = day.workDate.toISOString().slice(0, 10);
      if (lockedByDate.has(workDate)) {
        // Overlapping periods would each claim the date; refuse to choose.
        throw new AttendanceLockedDayError(
          `Work Date ${workDate} has more than one locked Attendance Day version.`,
          409,
          'ATTENDANCE_LOCKED_DAY_AMBIGUOUS',
        );
      }
      const snapshot = snapshotOf(day.ruleSnapshot);
      const ruleType = snapshot.dayRuleId ? ruleTypes.get(snapshot.dayRuleId) : undefined;
      if (!ruleType || !day.workArrangementVersion) {
        throw new AttendanceLockedDayError(
          `The locked Attendance Day for ${workDate} has no resolved Day Rule or Work Arrangement Version.`,
          409,
          'ATTENDANCE_LOCKED_DAY_UNRESOLVED',
        );
      }
      lockedByDate.set(workDate, {
        status: 'LOCKED',
        workDate,
        attendancePeriodVersionId: row.attendancePeriodVersionId,
        attendanceDayId: day.id,
        calculationVersion: day.calculationVersion,
        outsideScheduleWorkedMinutes: day.outsideScheduleMinutes,
        dayType: ruleType === 'REST' ? 'REST_DAY' : 'WORKDAY',
        holidayClassification: snapshot.holidayClassifications[workDate] ?? null,
        officialTravel: {
          minutes: day.officialTravelMinutes,
          sourceIds: snapshot.officialTravelSourceIds,
        },
        workArrangementVersion: {
          id: day.workArrangementVersion.id,
          arrangementType: day.workArrangementVersion.arrangementType,
        },
      });
    }
    return workDates.map(
      (workDate) => lockedByDate.get(workDate) ?? { status: 'NOT_LOCKED', workDate },
    );
  }
}

/** The rule-snapshot fields this read needs, tolerating Days calculated before they existed. */
function snapshotOf(value: Prisma.JsonValue): {
  dayRuleId: string | null;
  holidayClassifications: Record<string, string>;
  officialTravelSourceIds: string[];
} {
  const snapshot =
    value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const holidays = snapshot.holidayClassifications;
  const sources = Array.isArray(snapshot.coverageSources) ? snapshot.coverageSources : [];
  return {
    dayRuleId: typeof snapshot.dayRuleId === 'string' ? snapshot.dayRuleId : null,
    holidayClassifications:
      holidays !== null && typeof holidays === 'object' && !Array.isArray(holidays)
        ? (holidays as Record<string, string>)
        : {},
    officialTravelSourceIds: [
      ...new Set(
        sources.flatMap((source) =>
          source !== null &&
          typeof source === 'object' &&
          !Array.isArray(source) &&
          source.coverageType === 'OFFICIAL_TRAVEL' &&
          typeof source.sourceId === 'string'
            ? [source.sourceId]
            : [],
        ),
      ),
    ],
  };
}
