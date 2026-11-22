'use client';

import { useState } from 'react';
import { dateLabel } from '../lib/overtime-format';
import {
  instantLabel,
  moneyLabel,
  runTypeLabel,
  type PayrollRunType,
} from '../lib/payroll-periods';
import { Facts } from './payroll-inputs-workspace';
import { StateSurface } from './state-surface';
import { Button, buttonVariants } from './ui/button';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';
import { FormError } from './ui/field';
import { PageHeader, type Breadcrumb } from './ui/page-header';
import { Panel } from './ui/panel';
import { StatusTag } from './ui/status-tag';
import { Table, Td, Th, Tr } from './ui/table';

/** One of the Employee's own RELEASED Payslips, as `GET /payslips` reads it. */
export interface OwnPayslip {
  id: string;
  payrollPeriodId: string;
  periodCode: string;
  runType: PayrollRunType;
  periodFrom: string;
  periodTo: string;
  paymentDate: string;
  calculationVersion: number;
  grossAmount: string;
  totalDeductions: string;
  netAmount: string;
  releasedAt: string;
}

/** The short-lived signed link `GET /payslips/:id` gives to the Payslip's PDF. */
type PayslipFile =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; accessUrl: string; expiresAt: string };

/**
 * My Payslips: the Employee's own released payslips, one row per Payroll Period, each opening
 * the payslip form with its amounts, its PDF, and when it was released. The API returns only
 * released payslips of the Employee linked to the signed-in membership; this screen shows them.
 */
export function MyPayslips({ agencyId, payslips }: { agencyId: string; payslips: OwnPayslip[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [file, setFile] = useState<PayslipFile>({ state: 'loading' });
  const open = payslips.find((payslip) => payslip.id === openId) ?? null;

  async function openPayslip(payslip: OwnPayslip): Promise<void> {
    setOpenId(payslip.id);
    setFile({ state: 'loading' });
    try {
      const response = await fetch(`/api/v1/agencies/${agencyId}/payslips/${payslip.id}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      const value = (await response.json().catch(() => null)) as {
        file?: { accessUrl?: unknown; expiresAt?: unknown };
        error?: { message?: string };
      } | null;
      const accessUrl = value?.file?.accessUrl;
      const expiresAt = value?.file?.expiresAt;
      if (!response.ok || typeof accessUrl !== 'string' || typeof expiresAt !== 'string') {
        throw new Error(value?.error?.message ?? 'The payslip PDF could not be prepared.');
      }
      setFile({ state: 'ready', accessUrl, expiresAt });
    } catch (caught: unknown) {
      setFile({
        state: 'error',
        message:
          caught instanceof Error ? caught.message : 'The payslip PDF could not be prepared.',
      });
    }
  }

  const breadcrumbs: Breadcrumb[] = [{ label: 'Payroll' }, { label: 'My Payslips' }];
  if (open) breadcrumbs.push({ label: open.periodCode });

  return (
    <Dialog
      presentation="form"
      open={open !== null}
      onOpenChange={(next) => {
        if (!next) setOpenId(null);
      }}
    >
      <div className="grid gap-5">
        <PageHeader breadcrumbs={breadcrumbs} title="My Payslips" />

        <div hidden={open !== null} className="grid min-w-0 gap-5">
          <p className="m-0 max-w-[760px] text-small text-ink-muted">
            Your payslips appear here once the Payroll Approver releases them, one per Payroll
            Period.
          </p>
          <Panel title="Released payslips" flush>
            {payslips.length === 0 ? (
              <StateSurface compact label="No released payslips">
                <strong className="text-body font-[650] text-ink">No released payslips yet.</strong>
                <p className="m-0">A payslip appears here once it is released to you.</p>
              </StateSurface>
            ) : (
              <Table className="min-w-[760px]">
                <thead>
                  <tr>
                    <Th>Payroll Period</Th>
                    <Th>Payment date</Th>
                    <Th kind="numeric">Gross</Th>
                    <Th kind="numeric">Deductions</Th>
                    <Th kind="numeric">Net pay</Th>
                    <Th>Released</Th>
                  </tr>
                </thead>
                <tbody>
                  {payslips.map((payslip) => (
                    <Tr key={payslip.id} selected={payslip.id === openId}>
                      <Td>
                        <DialogTrigger asChild>
                          <button
                            className="w-fit cursor-pointer border-0 bg-transparent p-0 text-left font-[600] text-primary hover:underline"
                            onClick={() => void openPayslip(payslip)}
                            type="button"
                          >
                            {payslip.periodCode}
                          </button>
                        </DialogTrigger>
                        <span className="block text-caption text-ink-muted">
                          {dateLabel(payslip.periodFrom)} – {dateLabel(payslip.periodTo)}
                        </span>
                      </Td>
                      <Td>{dateLabel(payslip.paymentDate)}</Td>
                      <Td kind="numeric">{moneyLabel(payslip.grossAmount)}</Td>
                      <Td kind="numeric">{moneyLabel(payslip.totalDeductions)}</Td>
                      <Td kind="numeric">{moneyLabel(payslip.netAmount)}</Td>
                      <Td>{instantLabel(payslip.releasedAt)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>
        </div>

        <DialogContent aria-describedby="my-payslip-description">
          {open ? (
            <>
              <DialogHeader>
                <div className="grid min-w-0 gap-1.5">
                  <DialogTitle>{open.periodCode}</DialogTitle>
                  <DialogDescription id="my-payslip-description">
                    Your payslip · calculation version {open.calculationVersion}. Read-only.
                  </DialogDescription>
                </div>
                <StatusTag tone="success">Released</StatusTag>
              </DialogHeader>
              <DialogBody className="grid gap-6">
                <div className="flex flex-wrap items-center gap-3">
                  {file.state === 'ready' ? (
                    <>
                      <a
                        className={buttonVariants({ variant: 'primary' })}
                        href={file.accessUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Open payslip PDF
                      </a>
                      <span className="text-caption text-ink-muted">
                        The link works until {instantLabel(file.expiresAt)}.
                      </span>
                    </>
                  ) : file.state === 'loading' ? (
                    <span className="text-small text-ink-muted" role="status">
                      Preparing the payslip PDF…
                    </span>
                  ) : (
                    <FormError message={file.message} />
                  )}
                </div>
                <Facts
                  facts={[
                    ['Payroll Period', open.periodCode],
                    ['Run type', runTypeLabel[open.runType] ?? open.runType],
                    ['Period', `${dateLabel(open.periodFrom)} – ${dateLabel(open.periodTo)}`],
                    ['Payment date', dateLabel(open.paymentDate)],
                    ['Gross', moneyLabel(open.grossAmount)],
                    ['Deductions', moneyLabel(open.totalDeductions)],
                    ['Net pay', moneyLabel(open.netAmount)],
                  ]}
                />
                <section aria-label="History" className="grid gap-2">
                  <h3 className="m-0 text-panel-title text-ink">History</h3>
                  <p className="m-0 text-small text-ink">
                    Released to you {instantLabel(open.releasedAt)}.
                  </p>
                </section>
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="secondary">
                    Close
                  </Button>
                </DialogClose>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </div>
    </Dialog>
  );
}
