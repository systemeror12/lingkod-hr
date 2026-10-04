import { StatusTag, type StatusTone } from './ui/status-tag';
export { inputClass as employeeInputClass, labelClass as employeeLabelClass } from './ui/field';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatEmployeeDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return value;
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

export function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

const serviceStatusTone: Record<string, StatusTone> = {
  PREBOARDING: 'info',
  ACTIVE: 'success',
  ON_EXTENDED_LEAVE: 'warning',
  SUSPENDED: 'danger',
  SEPARATED: 'neutral',
  DECEASED: 'neutral',
};

export function serviceStatusLabel(value: string): string {
  return titleCase(value.replaceAll('_', ' '));
}

export function EmployeeServiceStatus({ status }: { status: string }) {
  return (
    <StatusTag tone={serviceStatusTone[status] ?? 'neutral'}>
      {serviceStatusLabel(status)}
    </StatusTag>
  );
}

export function EmployeeStatus({ linked }: { linked: boolean }) {
  return (
    <StatusTag tone={linked ? 'success' : 'warning'}>{linked ? 'LINKED' : 'UNLINKED'}</StatusTag>
  );
}
