import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { DocumentsService } from '../documents/documents.service';
import { ownEmployeeId } from '../employee-scope';
import {
  payslipNotFound,
  PayslipsServiceError,
  requireAgencyWide,
  requireHeld,
  toPayslipView,
  type PayslipView,
} from './payslips.shared';

const PERMISSION = 'payroll.payslips.read';

/** One of the caller's own RELEASED Payslips: what it states, without the file. */
export interface OwnPayslipView {
  id: string;
  payrollPeriodId: string;
  periodCode: string;
  runType: string;
  periodFrom: string;
  periodTo: string;
  paymentDate: string;
  calculationVersion: number;
  grossAmount: string;
  totalDeductions: string;
  netAmount: string;
  releasedAt: string;
}

/**
 * One Payroll Employee Result of a period with its Payslip, as the payroll officers read it. The
 * Payslip is null while its result is FINALIZED but generation has not created it yet.
 */
export interface PeriodPayslipEntry {
  payrollEmployeeId: string;
  employee: { id: string; employeeNumber: string; legalName: string };
  payslip: PayslipView | null;
}

export interface OwnPayslipDetail {
  payslip: OwnPayslipView;
  /** A short-lived signed link to the Payslip's PDF. */
  file: { accessUrl: string; expiresAt: string };
}

/**
 * The reads of Payslips (hris-controls.md §5.21, §6.10). The Employee's own
 * read (`payroll.payslips.read:own`, #640) returns only RELEASED Payslips of
 * results whose Employee is linked to the caller's Agency Membership, whatever
 * scope the grant has, so a GENERATING, READY, WITHHELD, or SUPERSEDED
 * Payslip, or another Employee's, is not found. The period read (#641) needs
 * the same permission held Agency-wide and returns every Payslip of one
 * period in each status, without its file.
 */
@Injectable()
export class PayslipReadService {
  constructor(@Inject(DocumentsService) private readonly documents: DocumentsService) {}

  /** The caller's RELEASED Payslips, latest payment date first; none without a linked Employee. */
  async listOwn(context: RequestContext): Promise<OwnPayslipView[]> {
    requireHeld(context, PERMISSION);
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const employeeId = await ownEmployeeId(transaction, context);
      if (!employeeId) return [];
      const views = await readOwn(transaction, context, employeeId, {});
      return views
        .map(({ view }) => view)
        .sort(
          (a, b) =>
            b.paymentDate.localeCompare(a.paymentDate) || b.releasedAt.localeCompare(a.releasedAt),
        );
    });
  }

  /**
   * Every Payslip of one period, by Employee number, in whatever status it is: one entry per
   * result that has a Payslip or is FINALIZED. Needs the read held Agency-wide.
   */
  async listPeriod(context: RequestContext, periodId: string): Promise<PeriodPayslipEntry[]> {
    requireAgencyWide(context, PERMISSION, 'Reading the payslips of a Payroll Period');
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const period = await transaction.payrollPeriod.findUnique({
        where: { agencyId_id: { agencyId: context.agencyId, id: periodId } },
        select: { id: true },
      });
      if (!period) {
        throw new PayslipsServiceError(
          'The Payroll Period could not be found.',
          404,
          'PAYROLL_PERIOD_NOT_FOUND',
        );
      }
      const results = await transaction.payrollEmployee.findMany({
        where: { agencyId: context.agencyId, payrollPeriodId: periodId },
        select: { id: true, employeeId: true, status: true },
      });
      const payslips = await transaction.payslip.findMany({
        where: {
          agencyId: context.agencyId,
          payrollEmployeeId: { in: results.map((result) => result.id) },
        },
      });
      const payslipOf = new Map(payslips.map((payslip) => [payslip.payrollEmployeeId, payslip]));
      const listed = results.filter(
        (result) => payslipOf.has(result.id) || result.status === 'FINALIZED',
      );
      const employees = await transaction.employee.findMany({
        where: {
          agencyId: context.agencyId,
          id: { in: [...new Set(listed.map((result) => result.employeeId))] },
        },
        select: { id: true, employeeNumber: true, legalName: true },
      });
      const employeeOf = new Map(employees.map((employee) => [employee.id, employee]));
      return listed
        .map((result) => {
          const payslip = payslipOf.get(result.id);
          const employee = employeeOf.get(result.employeeId);
          if (!employee) throw new Error(`Payroll Employee Result ${result.id} names no Employee.`);
          return {
            payrollEmployeeId: result.id,
            employee,
            payslip: payslip ? toPayslipView(payslip, periodId) : null,
          };
        })
        .sort(
          (a, b) =>
            a.employee.employeeNumber.localeCompare(b.employee.employeeNumber) ||
            a.payrollEmployeeId.localeCompare(b.payrollEmployeeId),
        );
    });
  }

  /** One of the caller's RELEASED Payslips with a link to its PDF, else not found. */
  async readOwn(context: RequestContext, payslipId: string): Promise<OwnPayslipDetail> {
    requireHeld(context, PERMISSION);
    const found = await withDatabaseContext(
      requestDatabaseContext(context),
      async (transaction) => {
        const employeeId = await ownEmployeeId(transaction, context);
        if (!employeeId) return null;
        const [own] = await readOwn(transaction, context, employeeId, { id: payslipId });
        if (!own) return null;
        const document = await transaction.document.findFirst({
          where: { agencyId: context.agencyId, id: own.documentId },
          select: { currentVersionId: true },
        });
        return document?.currentVersionId ? { ...own, versionId: document.currentVersionId } : null;
      },
    );
    if (!found) throw payslipNotFound();
    // Payroll has checked that the Payslip is the caller's own and RELEASED.
    const access = await this.documents.issueAccessLinkForPersonnel(
      context,
      found.documentId,
      found.versionId,
    );
    if (!access) throw payslipNotFound();
    return {
      payslip: found.view,
      file: { accessUrl: access.accessUrl, expiresAt: access.expiresAt },
    };
  }
}

async function readOwn(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  employeeId: string,
  where: Prisma.PayslipWhereInput,
): Promise<{ view: OwnPayslipView; documentId: string }[]> {
  const results = await transaction.payrollEmployee.findMany({
    where: { agencyId: context.agencyId, employeeId, status: 'FINALIZED' },
    include: { payrollPeriod: true },
  });
  if (results.length === 0) return [];
  const resultById = new Map(results.map((result) => [result.id, result]));
  const payslips = await transaction.payslip.findMany({
    where: {
      ...where,
      agencyId: context.agencyId,
      payrollEmployeeId: { in: [...resultById.keys()] },
      status: 'RELEASED',
    },
  });
  return payslips.flatMap((payslip) => {
    const result = resultById.get(payslip.payrollEmployeeId);
    if (!result || !payslip.documentId || !payslip.releasedAt) return [];
    const period = result.payrollPeriod;
    return [
      {
        documentId: payslip.documentId,
        view: {
          id: payslip.id,
          payrollPeriodId: period.id,
          periodCode: period.code,
          runType: period.runType,
          periodFrom: isoDate(period.periodFrom),
          periodTo: isoDate(period.periodTo),
          paymentDate: isoDate(period.paymentDate),
          calculationVersion: result.calculationVersion,
          grossAmount: result.grossAmount.toFixed(4),
          totalDeductions: result.totalDeductions.toFixed(4),
          netAmount: result.netAmount.toFixed(4),
          releasedAt: payslip.releasedAt.toISOString(),
        },
      },
    ];
  });
}

const isoDate = (value: Date) => value.toISOString().slice(0, 10);
